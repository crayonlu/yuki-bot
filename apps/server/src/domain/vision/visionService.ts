import type { BotSettings } from "@bot/shared"
import type { AppLogger } from "../../infra/logger"
import type { VisionAnalyzeResult } from "../../plugins/types"

const normalizeJsonText = (text: string) => {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1]
  if (fenced) return fenced.trim()
  return text.trim()
}

export class VisionService {
  private readonly log

  constructor(logger: AppLogger) {
    this.log = logger.child("vision-service")
  }

  async analyze(input: {
    query: string
    imageUrls: string[]
    settings: BotSettings
    traceId: string
  }): Promise<VisionAnalyzeResult> {
    const { query, imageUrls, settings, traceId } = input
    if (!settings.visionEnabled) {
      throw new Error("vision is disabled")
    }
    if (!settings.apiKey) {
      throw new Error("API key is empty, please configure it in dashboard settings.")
    }
    if (imageUrls.length === 0) {
      throw new Error("vision analyze requires at least one image")
    }

    const endpoint = settings.apiBaseUrl.replace(/\/$/, "") + "/chat/completions"
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutMs)
    const start = Date.now()

    const instruction = [
      "You are a visual perception extractor.",
      "Return valid JSON only.",
      "Schema:",
      "{",
      '  "summary": string,',
      '  "scene": string,',
      '  "objects": string[],',
      '  "texts": string[],',
      '  "warnings": string[],',
      '  "confidence": "low" | "medium" | "high"',
      "}",
      "Keep summary concise and factual."
    ].join("\n")

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: settings.visionModel,
          messages: [
            { role: "system", content: instruction },
            {
              role: "user",
              content: [
                ...imageUrls.map((url) => ({
                  type: "image_url",
                  image_url: {
                    url,
                    detail: settings.visionDetail
                  }
                })),
                {
                  type: "text",
                  text: `Question: ${query}\nFocus on evidence relevant to the question.`
                }
              ]
            }
          ],
          temperature: 0.2
        })
      })
      if (!response.ok) {
        const reason = await response.text()
        throw new Error(`vision request failed(${response.status}): ${reason}`)
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[]
      }
      const content = data.choices?.[0]?.message?.content
      if (!content) {
        throw new Error("vision response is empty")
      }

      const rawJson = normalizeJsonText(content)
      let parsed: {
        summary?: string
        scene?: string
        objects?: string[]
        texts?: string[]
        warnings?: string[]
        confidence?: "low" | "medium" | "high"
      }
      try {
        parsed = JSON.parse(rawJson)
      } catch {
        // fallback if provider returns non-json.
        parsed = {
          summary: content
        }
      }

      const summaryBase = (parsed.summary ?? content).trim()
      const summary =
        summaryBase.length <= settings.visionSummaryMaxChars
          ? summaryBase
          : `${summaryBase.slice(0, settings.visionSummaryMaxChars)}...(truncated)`
      const latencyMs = Date.now() - start
      const result: VisionAnalyzeResult = {
        summary,
        details: {
          scene: parsed.scene?.trim() || undefined,
          objects: Array.isArray(parsed.objects)
            ? parsed.objects.filter((item): item is string => typeof item === "string")
            : undefined,
          texts: Array.isArray(parsed.texts)
            ? parsed.texts.filter((item): item is string => typeof item === "string")
            : undefined,
          warnings: Array.isArray(parsed.warnings)
            ? parsed.warnings.filter((item): item is string => typeof item === "string")
            : undefined,
          confidence: parsed.confidence
        },
        latencyMs
      }
      this.log.info(
        "vision analyze success",
        {
          imageCount: imageUrls.length,
          latency_ms: latencyMs,
          confidence: result.details.confidence
        },
        traceId
      )
      return result
    } catch (error) {
      this.log.warn(
        "vision analyze failed",
        {
          imageCount: imageUrls.length,
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
