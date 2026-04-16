import type { BotPlugin } from "../types"

const HELP_TEXT =
  "Use /ask <your question> to chat with the configured model. Example: /ask explain this error"

const URL_REGEX = /https?:\/\/[^\s<>"'`]+/gi

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")

const cleanupUrl = (raw: string) => {
  const decoded = decodeHtmlEntities(raw).trim()
  const cutByComma = decoded.split(",")[0] ?? decoded
  const normalized = cutByComma.replace(/[\]\s]+$/g, "")
  return normalized
}

const looksLikeImageInputUrl = (value: string) => /^(https?:\/\/|data:image\/)/i.test(value)

const stripImageCqSegments = (text: string) => text.replace(/\[CQ:image,[^\]]+\]/gi, " ")

const extractUrls = (text: string) =>
  Array.from(new Set((stripImageCqSegments(text).match(URL_REGEX) ?? []).map(cleanupUrl)))

const extractFromMessageSegments = (
  segments: { type: string; data?: Record<string, string> }[] | undefined
) =>
  (segments ?? [])
    .filter((segment) => segment.type === "image")
    .flatMap((segment) => {
      const url = segment.data?.url?.trim()
      const file = segment.data?.file?.trim()
      return [url, file]
        .filter((item): item is string => !!item)
        .map(cleanupUrl)
        .filter((item) => looksLikeImageInputUrl(item))
    })

const extractFromRawMessage = (rawMessage: string) => {
  const matches = rawMessage.match(/\[CQ:image,[^\]]+\]/g) ?? []
  const values: string[] = []
  for (const token of matches) {
    const url = token.match(/url=([^,\]]+)/)?.[1]
    const file = token.match(/file=([^,\]]+)/)?.[1]
    if (url) values.push(cleanupUrl(url))
    if (file && looksLikeImageInputUrl(file)) values.push(cleanupUrl(file))
  }
  return values
}

const collectMessageImages = async (
  event: { raw_message: string; message?: { type: string; data?: Record<string, string> }[] },
  fetchQuotedMessage: () => Promise<
    | {
        raw_message: string
        message: { type: string; data?: Record<string, string> }[]
      }
    | undefined
  >
) => {
  const current = extractFromMessageSegments(event.message)
  const raw = extractFromRawMessage(event.raw_message)
  const quoted = await fetchQuotedMessage()
  const quotedImages = quoted
    ? [...extractFromMessageSegments(quoted.message), ...extractFromRawMessage(quoted.raw_message)]
    : []
  return [...new Set([...current, ...raw, ...quotedImages])].filter((item) =>
    looksLikeImageInputUrl(item)
  )
}

export const chatPlugin: BotPlugin = {
  id: "builtin.chat",
  name: "Chat Plugin",
  version: "0.1.0",
  commands: ["/ask", "/clean"],
  routePriority: -10,
  permissions: {
    llm: true,
    webFetch: true,
    webSearch: true,
    visionAnalyze: true,
    replyPrivate: true,
    replyGroup: true,
    configRead: true
  },
  async onMessage(event, context) {
    const content = event.raw_message.trim()
    if (!content) return
    const urls = extractUrls(content)
    const messageImages = await collectMessageImages(event, context.fetchQuotedMessage)
    const resetCommand = context.settings.chatResetCommand || "/clean"

    if (content === resetCommand) {
      context.clearHistory()
      await context.reply("Session history cleared.")
      context.log("Session history cleared")
      return
    }

    if (content === "/ask") {
      await context.reply(HELP_TEXT)
      return
    }

    const isAskCommand = content.startsWith("/ask ")
    const askPayload = isAskCommand ? content.slice("/ask ".length).trim() : content
    const forceWeb = askPayload.startsWith("--web ")
    const question = forceWeb ? askPayload.slice("--web ".length).trim() : askPayload
    if (!question) {
      await context.reply(HELP_TEXT)
      return
    }

    context.log("Dispatching ask to llm", { preview: question.slice(0, 100) })
    try {
      const history = context.getRecentHistory(context.settings.memoryMaxTurns)
      const recentEvidences = context.getRecentVisionEvidences(
        Math.max(1, context.settings.visionEvidenceLookback)
      )
      const latestEvidence = recentEvidences.find((item) => item.imageUrls.length > 0)
      const webContextBlocks: string[] = []
      const searchContextBlocks: string[] = []
      const visionContextBlocks: string[] = []
      let visionSummaryForMemory = ""
      const executedTools: string[] = []
      const maxPlanningSteps = 3
      for (let step = 0; step < maxPlanningSteps; step += 1) {
        const contextPreview = [...visionContextBlocks, ...searchContextBlocks, ...webContextBlocks]
          .join("\n\n---\n\n")
          .slice(0, 1600)
        const toolPlan = await context.planTools({
          userText: question,
          history,
          hasCurrentImages: messageImages.length > 0,
          hasRecentVisionEvidence: !!latestEvidence,
          executedTools,
          contextPreview: contextPreview || undefined
        })
        if (forceWeb && !executedTools.includes("webSearch")) {
          toolPlan.useWebSearch = true
        }
        context.log("Tool planning completed", {
          step: step + 1,
          use_web_search: toolPlan.useWebSearch,
          use_vision: toolPlan.useVision,
          vision_mode: toolPlan.visionMode,
          executed_tools: executedTools.join(",") || "none",
          reason: toolPlan.reason
        })

        let progressed = false

        if (
          context.settings.visionEnabled &&
          toolPlan.useVision &&
          !executedTools.includes("vision")
        ) {
          const useCurrent =
            (toolPlan.visionMode === "current" && messageImages.length > 0) ||
            (toolPlan.visionMode !== "recent" && messageImages.length > 0)
          const useRecent = !useCurrent && !!latestEvidence

          if (useCurrent) {
            try {
              const analyze = await context.analyzeVision({
                query: toolPlan.visionQuery?.trim() || question,
                imageUrls: messageImages
              })
              const details = analyze.details
              const detailLines = [
                details.scene ? `Scene: ${details.scene}` : undefined,
                details.objects?.length ? `Objects: ${details.objects.join(", ")}` : undefined,
                details.texts?.length ? `Texts: ${details.texts.join(" | ")}` : undefined,
                details.warnings?.length ? `Warnings: ${details.warnings.join(" | ")}` : undefined,
                details.confidence ? `Confidence: ${details.confidence}` : undefined
              ]
                .filter(Boolean)
                .join("\n")
              visionSummaryForMemory = analyze.summary
              visionContextBlocks.push(
                ["VisionContext(CurrentImages):", `Summary: ${analyze.summary}`, detailLines]
                  .filter(Boolean)
                  .join("\n")
              )
              context.appendVisionEvidence({
                messageId: event.message_id !== undefined ? String(event.message_id) : undefined,
                imageUrls: messageImages,
                summary: analyze.summary,
                details: JSON.stringify(analyze.details)
              })
              context.log("Vision analyze completed", {
                mode: "current_images",
                image_count: messageImages.length,
                latency_ms: analyze.latencyMs
              })
            } catch (error) {
              context.log("Vision analyze failed", {
                mode: "current_images",
                error: error instanceof Error ? error.message : String(error)
              })
            }
            executedTools.push("vision")
            progressed = true
          } else if (useRecent && latestEvidence) {
            visionContextBlocks.push(`VisionMemory(PreviousSummary): ${latestEvidence.summary}`)
            try {
              const analyze = await context.analyzeVision({
                query:
                  toolPlan.visionQuery?.trim() ||
                  `Follow-up question on prior image(s): ${question}`,
                imageUrls: latestEvidence.imageUrls
              })
              const details = analyze.details
              const detailLines = [
                details.scene ? `Scene: ${details.scene}` : undefined,
                details.objects?.length ? `Objects: ${details.objects.join(", ")}` : undefined,
                details.texts?.length ? `Texts: ${details.texts.join(" | ")}` : undefined,
                details.warnings?.length ? `Warnings: ${details.warnings.join(" | ")}` : undefined,
                details.confidence ? `Confidence: ${details.confidence}` : undefined
              ]
                .filter(Boolean)
                .join("\n")
              visionSummaryForMemory = analyze.summary
              visionContextBlocks.push(
                ["VisionContext(Recheck):", `Summary: ${analyze.summary}`, detailLines]
                  .filter(Boolean)
                  .join("\n")
              )
              context.appendVisionEvidence({
                messageId: latestEvidence.messageId,
                imageUrls: latestEvidence.imageUrls,
                summary: analyze.summary,
                details: JSON.stringify(analyze.details)
              })
              context.log("Vision analyze completed", {
                mode: "recheck_previous",
                image_count: latestEvidence.imageUrls.length,
                latency_ms: analyze.latencyMs
              })
            } catch (error) {
              context.log("Vision analyze failed", {
                mode: "recheck_previous",
                error: error instanceof Error ? error.message : String(error)
              })
            }
            executedTools.push("vision")
            progressed = true
          } else {
            context.log("Vision tool planned but no usable image source")
            executedTools.push("vision")
          }
        }

        if (
          context.settings.webSearchEnabled &&
          toolPlan.useWebSearch &&
          !executedTools.includes("webSearch")
        ) {
          const maxCalls = Math.max(1, context.settings.webSearchMaxCallsPerMessage)
          let query = toolPlan.webSearchQuery?.trim() || question
          let searchCount = 0
          let hitCount = 0
          let lastError = ""
          for (let index = 0; index < maxCalls; index += 1) {
            searchCount += 1
            try {
              const searchResult = await context.searchWeb({ query })
              const items = searchResult.items.slice(0, context.settings.webSearchCountPerCall)
              hitCount += items.length
              if (items.length > 0) {
                const lines = items.map((item, itemIndex) =>
                  [
                    `${itemIndex + 1}. ${item.title}`,
                    `URL: ${item.url}`,
                    item.summary ? `Summary: ${item.summary}` : undefined,
                    item.snippet ? `Snippet: ${item.snippet}` : undefined,
                    item.siteName ? `Site: ${item.siteName}` : undefined,
                    item.datePublished ? `Date: ${item.datePublished}` : undefined
                  ]
                    .filter(Boolean)
                    .join("\n")
                )
                searchContextBlocks.push([`SearchQuery: ${searchResult.query}`, ...lines].join("\n\n"))
                break
              }
            } catch (error) {
              lastError = error instanceof Error ? error.message : String(error)
            }
            if (index === 0) {
              query = `${question} 官方 来源`
            }
          }
          context.log("Web search attempt finished", {
            search_count: searchCount,
            hit_count: hitCount,
            error: lastError || undefined
          })
          executedTools.push("webSearch")
          progressed = true
        }

        if (!progressed) {
          break
        }
      }

      for (const url of urls.slice(0, context.settings.webFetchMaxUrlsPerMessage)) {
        try {
          const fetched = await context.fetchUrl(url)
          webContextBlocks.push(
            [
              `URL: ${fetched.finalUrl}`,
              fetched.title ? `Title: ${fetched.title}` : undefined,
              `Summary: ${fetched.summary}`,
              `ContentSnippet: ${fetched.contentText.slice(0, 1800)}`,
              `ContentType: ${fetched.contentType}`
            ]
              .filter(Boolean)
              .join("\n")
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          webContextBlocks.push(`URL: ${url}\nFetchError: ${message}`)
        }
      }

      const mergedContextBlocks = [...visionContextBlocks, ...searchContextBlocks, ...webContextBlocks]
      const extraContext =
        mergedContextBlocks.length > 0
          ? `External context:\n\n${mergedContextBlocks.join("\n\n---\n\n")}`
          : undefined
      let answer = ""
      try {
        answer = await context.askLlm(question, extraContext, history)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/aborted|timeout|429|server overload/i.test(message)) {
          context.log("Primary LLM call failed, retry with reduced context", {
            reason: message
          })
          answer = await context.askLlm(question, undefined, history.slice(-4))
        } else {
          throw error
        }
      }
      await context.reply(answer)
      const memoryQuestion =
        visionSummaryForMemory && !question.includes(visionSummaryForMemory)
          ? `${question}\n[VisionSummary]\n${visionSummaryForMemory}`
          : question
      context.appendHistoryTurn(memoryQuestion, answer)
      context.log("LLM reply completed")
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error"
      await context.reply(`LLM call failed: ${message}`)
      context.log("LLM reply failed", { error: message })
    }
  }
}
