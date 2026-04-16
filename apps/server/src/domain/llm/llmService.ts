import type { BotSettings, ChatMessage } from "@bot/shared"
import type { AppLogger } from "../../infra/logger"
import type { ToolPlanResult } from "../../plugins/types"

const extractJsonBlock = (content: string) => {
  const fenced = content.match(/```json\s*([\s\S]*?)```/i)?.[1]
  if (fenced) return fenced.trim()
  return content.trim()
}

const normalizeToolPlan = (parsed: Partial<ToolPlanResult>): ToolPlanResult => ({
  useWebSearch: !!parsed.useWebSearch || typeof parsed.webSearchQuery === "string",
  webSearchQuery: typeof parsed.webSearchQuery === "string" ? parsed.webSearchQuery : undefined,
  useVision:
    !!parsed.useVision ||
    parsed.visionMode === "current" ||
    parsed.visionMode === "recent" ||
    typeof parsed.visionQuery === "string",
  visionMode:
    parsed.visionMode === "recent"
      ? "recent"
      : parsed.visionMode === "current"
        ? "current"
        : undefined,
  visionQuery: typeof parsed.visionQuery === "string" ? parsed.visionQuery : undefined,
  reason: typeof parsed.reason === "string" ? parsed.reason : undefined
})

export class LlmService {
  private readonly log

  constructor(logger: AppLogger) {
    this.log = logger.child("llm-service")
  }

  async generateReply(input: {
    userText: string
    extraContext?: string
    history?: ChatMessage[]
    settings: BotSettings
    traceId: string
  }): Promise<string> {
    const { settings } = input
    if (!settings.apiKey) {
      throw new Error("API key is empty, please configure it in dashboard settings.")
    }

    const reply = await this.callOpenAiCompatible(input)
    return reply.trim()
  }

  async planTools(input: {
    userText: string
    history?: ChatMessage[]
    hasCurrentImages: boolean
    hasRecentVisionEvidence: boolean
    executedTools?: string[]
    contextPreview?: string
    settings: BotSettings
    traceId: string
  }): Promise<ToolPlanResult> {
    const {
      settings,
      userText,
      history,
      traceId,
      hasCurrentImages,
      hasRecentVisionEvidence,
      executedTools,
      contextPreview
    } = input
    if (!settings.apiKey) {
      throw new Error("API key is empty, please configure it in dashboard settings.")
    }
    const endpoint = settings.apiBaseUrl.replace(/\/$/, "") + "/chat/completions"
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutMs)
    const historyText = (history ?? [])
      .slice(-6)
      .map((item) => `${item.role}: ${item.content.slice(0, 220)}`)
      .join("\n")
    const plannerSystem = [
      "You are a tool planner for chat.",
      "Decide whether to use webSearch and/or visionAnalyze for this user message.",
      "Rules:",
      "- webSearch for fresh facts/news/prices/releases/external verification.",
      "- visionAnalyze for image-dependent questions or follow-up details on prior images.",
      "- If no tool needed, set both false.",
      "- Prefer minimal tools to reduce latency/cost.",
      '- If useVision=true and HasCurrentImages=true, prefer visionMode="current".',
      '- If useVision=true and no current images but HasRecentVisionEvidence=true, use visionMode="recent".',
      "- Do not request a tool already executed unless absolutely required."
    ].join("\n")
    const plannerUser = [
      `UserMessage: ${userText}`,
      `HasCurrentImages: ${hasCurrentImages}`,
      `HasRecentVisionEvidence: ${hasRecentVisionEvidence}`,
      executedTools?.length ? `ExecutedTools: ${executedTools.join(", ")}` : "ExecutedTools: none",
      contextPreview ? `CurrentContextPreview:\n${contextPreview}` : undefined,
      historyText ? `RecentHistory:\n${historyText}` : undefined
    ]
      .filter(Boolean)
      .join("\n\n")

    const requestPlanner = async (useToolCall: boolean): Promise<ToolPlanResult> => {
      const payload: Record<string, unknown> = {
        model: settings.model,
        messages: [
          { role: "system", content: plannerSystem },
          { role: "user", content: plannerUser }
        ],
        temperature: 0
      }
      if (useToolCall) {
        payload.tools = [
          {
            type: "function",
            function: {
              name: "decide_tools",
              description: "Plan whether web search or vision analysis is needed for this turn.",
              parameters: {
                type: "object",
                properties: {
                  useWebSearch: { type: "boolean" },
                  webSearchQuery: { type: "string" },
                  useVision: { type: "boolean" },
                  visionMode: { type: "string", enum: ["current", "recent"] },
                  visionQuery: { type: "string" },
                  reason: { type: "string" }
                },
                required: ["useWebSearch", "useVision"]
              }
            }
          }
        ]
        payload.tool_choice = {
          type: "function",
          function: {
            name: "decide_tools"
          }
        }
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify(payload)
      })
      if (!response.ok) {
        const reason = await response.text()
        throw new Error(`tool planner request failed(${response.status}): ${reason}`)
      }
      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string
            tool_calls?: Array<{
              type?: string
              function?: {
                name?: string
                arguments?: string
              }
            }>
          }
        }>
      }
      const choice = data.choices?.[0]?.message
      const toolCall = choice?.tool_calls?.find(
        (item) => item.type === "function" && item.function?.name === "decide_tools"
      )
      if (toolCall?.function?.arguments) {
        const parsed = JSON.parse(toolCall.function.arguments) as Partial<ToolPlanResult>
        return normalizeToolPlan(parsed)
      }
      const content = choice?.content
      if (!content) {
        throw new Error("tool planner response is empty")
      }
      const parsed = JSON.parse(extractJsonBlock(content)) as Partial<ToolPlanResult>
      return normalizeToolPlan(parsed)
    }

    try {
      try {
        return await requestPlanner(true)
      } catch (toolCallError) {
        this.log.warn(
          "Tool-call planner failed, fallback to JSON planner",
          {
            error: toolCallError instanceof Error ? toolCallError.message : String(toolCallError)
          },
          traceId
        )
        return await requestPlanner(false)
      }
    } catch (error) {
      this.log.warn(
        "Tool planner failed, fallback to no tools",
        {
          error: error instanceof Error ? error.message : String(error)
        },
        traceId
      )
      return {
        useWebSearch: false,
        useVision: false,
        reason: "planner_failed"
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private async callOpenAiCompatible(input: {
    userText: string
    extraContext?: string
    history?: ChatMessage[]
    settings: BotSettings
    traceId: string
  }) {
    const { settings, userText, extraContext, history, traceId } = input
    const endpoint = settings.apiBaseUrl.replace(/\/$/, "") + "/chat/completions"
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutMs)
    const finalUserText = extraContext ? `${userText}\n\n${extraContext}` : userText
    const messages = [
      { role: "system" as const, content: settings.systemPrompt },
      ...(history ?? []).map((item) => ({ role: item.role, content: item.content })),
      { role: "user" as const, content: finalUserText }
    ]

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: settings.model,
          messages,
          temperature: 0.7
        })
      })

      if (!response.ok) {
        const reason = await response.text()
        throw new Error(`LLM request failed(${response.status}): ${reason}`)
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[]
      }
      const content = data.choices?.[0]?.message?.content
      if (!content) {
        throw new Error("LLM response is empty")
      }
      return content
    } catch (error) {
      this.log.error(
        "OpenAI-compatible call failed",
        {
          providerId: settings.providerId,
          endpoint,
          error: error instanceof Error ? error.message : String(error)
        },
        traceId
      )
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}
