import type { BotSettings } from "@bot/shared"
import type { AppLogger } from "../../infra/logger"

type ImageApiResponse = {
  images?: unknown[]
}

const extractImageUrl = (item: unknown): string | undefined => {
  if (typeof item === "string") return item
  if (!item || typeof item !== "object") return undefined
  const value = item as Record<string, unknown>
  if (typeof value.url === "string") return value.url
  if (typeof value.image_url === "string") return value.image_url
  if (value.data && typeof value.data === "object") {
    const nested = value.data as Record<string, unknown>
    if (typeof nested.url === "string") return nested.url
  }
  return undefined
}

export class ImageService {
  private readonly log

  constructor(logger: AppLogger) {
    this.log = logger.child("image-service")
  }

  async generate(input: {
    prompt: string
    modelId?: string
    settings: BotSettings
    traceId: string
  }): Promise<{ modelId: string; imageUrls: string[] }> {
    const { prompt, settings, traceId } = input
    if (!settings.apiKey) {
      throw new Error("API key is empty, please configure it in dashboard settings.")
    }
    const modelId = input.modelId?.trim() || settings.defaultImageModel
    const modelConfig = settings.imageModelConfigs.find((item) => item.id === modelId)
    if (!modelConfig) {
      throw new Error(`Unknown image model: ${modelId}`)
    }
    const endpoint = modelConfig.endpoint.trim()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutMs)

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: modelId,
          prompt,
          size: "2048x2048",
          watermark: false
        })
      })
      if (!response.ok) {
        const reason = await response.text()
        throw new Error(`image request failed(${response.status}): ${reason}`)
      }

      const data = (await response.json()) as ImageApiResponse
      const imageUrls = (data.images ?? [])
        .map((item) => extractImageUrl(item))
        .filter((value): value is string => !!value)
      if (imageUrls.length === 0) {
        throw new Error("image response is empty")
      }
      return { modelId, imageUrls }
    } catch (error) {
      this.log.error(
        "Image generation failed",
        {
          modelId,
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
