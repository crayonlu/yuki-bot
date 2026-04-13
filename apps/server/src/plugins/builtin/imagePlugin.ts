import type { BotPlugin } from "../types"
import { requiresReferenceImage, supportsReferenceImage } from "../../domain/image/presets"

const HELP_TEXT =
  "Usage: /image [--model model_id] <prompt>. Example: /image --model seedream-5.0-lite a cyberpunk cat."

const parseCommand = (content: string) => {
  const body = content.slice("/image".length).trim()
  if (!body) return { ok: false as const, error: HELP_TEXT }
  if (body === "--help" || body === "-h" || body === "help") {
    return { ok: false as const, error: "__help__" }
  }

  if (body.startsWith("--model")) {
    const matched = body.match(/^--model\s+(\S+)\s+([\s\S]+)$/)
    if (!matched) {
      return { ok: false as const, error: "Invalid --model usage. " + HELP_TEXT }
    }
    const [, modelId, prompt] = matched
    return { ok: true as const, modelId, bench: false, prompt: prompt.trim() }
  }
  if (body.startsWith("--bench")) {
    const prompt = body.slice("--bench".length).trim()
    return { ok: true as const, modelId: undefined, bench: true, prompt }
  }

  return { ok: true as const, modelId: undefined, bench: false, prompt: body }
}

const getHelpWithModelMap = (modelIds: string[]) => {
  const lines = modelIds.map((id, idx) => `${idx + 1}: ${id}`)
  return [
    "Usage:",
    "- /image <prompt>",
    "- /image --model <id|index> <prompt>",
    "- /image --bench <prompt>   (run all configured models)",
    "",
    "Model map:",
    ...lines
  ].join("\n")
}

const resolveModelId = (raw: string | undefined, available: string[]) => {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const index = Number(trimmed)
  if (Number.isInteger(index) && index >= 1 && index <= available.length) {
    return available[index - 1]
  }
  return trimmed
}

const extractFromMessageSegments = (
  segments: { type: string; data?: Record<string, string> }[] | undefined
) =>
  (segments ?? [])
    .filter((segment) => segment.type === "image")
    .flatMap((segment) => {
      const url = segment.data?.url?.trim()
      const file = segment.data?.file?.trim()
      return [url, file].filter((item): item is string => !!item)
    })

const extractFromRawMessage = (rawMessage: string) => {
  const matches = rawMessage.match(/\[CQ:image,[^\]]+\]/g) ?? []
  const values: string[] = []
  for (const token of matches) {
    const url = token.match(/url=([^,\]]+)/)?.[1]
    const file = token.match(/file=([^,\]]+)/)?.[1]
    if (url) values.push(url)
    if (file) values.push(file)
  }
  return values
}

const collectReferenceImages = async (
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
  return [...new Set([...current, ...raw, ...quotedImages])]
}

const buildBenchForwardMessages = (
  benchResults: Array<
    | { ok: true; modelId: string; imageUrls: string[] }
    | { ok: false; modelId: string; error: string }
  >
) =>
  benchResults.map((item) => {
    if (!item.ok) return `Model ${item.modelId} failed:\n${item.error}`
    const lines = [
      `Model: ${item.modelId}`,
      ...item.imageUrls.slice(0, 2).map((url) => `[CQ:image,file=${url}]`)
    ]
    return lines.join("\n")
  })

export const imagePlugin: BotPlugin = {
  id: "builtin.image",
  name: "Image Plugin",
  version: "0.1.0",
  commands: ["/image"],
  routePriority: 90,
  permissions: {
    imageGenerate: true,
    replyPrivate: true,
    replyGroup: true,
    configRead: true
  },
  async onMessage(event, context) {
    const content = event.raw_message.trim()
    if (!content.startsWith("/image")) return

    const parsed = parseCommand(content)
    const available = context.settings.imageModelConfigs.map((item) => item.id)
    const helpText = getHelpWithModelMap(available)
    if (!parsed.ok) {
      await context.reply(parsed.error === "__help__" ? helpText : parsed.error)
      return
    }

    if (!parsed.prompt) {
      await context.reply(helpText)
      return
    }

    const referenceImages = await collectReferenceImages(event, context.fetchQuotedMessage)

    if (parsed.bench) {
      if (context.settings.pluginTimeoutMs < 60000) {
        await context.reply(
          `Warning: pluginTimeoutMs=${context.settings.pluginTimeoutMs} may be too small for --bench.`
        )
      }
      await context.reply(
        `Bench start: ${available.length} model(s), references: ${referenceImages.length}`
      )
      const benchResults: Array<
        | { ok: true; modelId: string; imageUrls: string[] }
        | { ok: false; modelId: string; error: string }
      > = []
      for (const modelId of available) {
        try {
          if (referenceImages.length === 0 && requiresReferenceImage(modelId)) {
            benchResults.push({
              ok: false,
              modelId,
              error: "this model requires at least one reference image"
            })
            continue
          }
          if (referenceImages.length > 0 && !supportsReferenceImage(modelId)) {
            benchResults.push({
              ok: false,
              modelId,
              error: "this model does not support reference images"
            })
            continue
          }
          const result = await context.generateImage({
            modelId,
            prompt: parsed.prompt,
            referenceImages
          })
          benchResults.push({
            ok: true,
            modelId: result.modelId,
            imageUrls: result.imageUrls
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          benchResults.push({
            ok: false,
            modelId,
            error: message
          })
        }
      }
      const forwardContents = buildBenchForwardMessages(benchResults)
      try {
        await context.forward(forwardContents)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await context.reply(`Forward failed, fallback to plain messages: ${message}`)
        for (const item of forwardContents) {
          await context.reply(item)
        }
      }
      await context.reply("Bench done.")
      return
    }

    const resolvedModelId = resolveModelId(parsed.modelId, available)
    if (resolvedModelId && !available.includes(resolvedModelId)) {
      await context.reply(`Unknown image model: ${parsed.modelId}\n\n${helpText}`)
      return
    }

    try {
      const targetModelId = resolvedModelId || context.settings.defaultImageModel
      if (referenceImages.length === 0 && requiresReferenceImage(targetModelId)) {
        await context.reply(`Model ${targetModelId} requires at least one reference image.`)
        return
      }
      if (referenceImages.length > 0 && !supportsReferenceImage(targetModelId)) {
        await context.reply(`Model ${targetModelId} does not support reference images.`)
      }
      const result = await context.generateImage({
        modelId: resolvedModelId,
        prompt: parsed.prompt,
        referenceImages: supportsReferenceImage(targetModelId) ? referenceImages : []
      })
      for (const imageUrl of result.imageUrls.slice(0, 4)) {
        await context.reply(`[CQ:image,file=${imageUrl}]`)
      }
      context.log("Image generated", {
        modelId: result.modelId,
        count: result.imageUrls.length
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await context.reply(`Image generation failed: ${message}`)
      context.log("Image generation failed", { error: message })
    }
  }
}
