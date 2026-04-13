import type { BotSettings } from "@bot/shared"
import type { AppLogger } from "../../infra/logger"
import { getImagePresetMode, supportsReferenceImage } from "./presets"

type ImageApiResponse = {
  images?: unknown[]
  task_id?: string
}

type AsyncTaskResponse = {
  task?: {
    status?: string
    reason?: string
  }
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const getAsyncTaskResultEndpoint = (requestEndpoint: string) => {
  const parsed = new URL(requestEndpoint)
  return `${parsed.origin}/v3/async/task-result`
}

export class ImageService {
  private readonly log

  constructor(logger: AppLogger) {
    this.log = logger.child("image-service")
  }

  async generate(input: {
    prompt: string
    modelId?: string
    referenceImages?: string[]
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
    const mode = getImagePresetMode(modelId)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutMs)

    try {
      const payload = this.buildPayload(modelId, prompt, input.referenceImages ?? [])
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
        throw new Error(`image request failed(${response.status}): ${reason}`)
      }

      const data = (await response.json()) as ImageApiResponse
      const imageUrls =
        mode === "async"
          ? await this.waitForAsyncImages(endpoint, data.task_id, settings.apiKey)
          : (data.images ?? [])
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

  private buildPayload(modelId: string, prompt: string, referenceImages: string[]) {
    const canUseReference = supportsReferenceImage(modelId)
    const refs = canUseReference
      ? [...new Set(referenceImages.map((item) => item.trim()).filter(Boolean))]
      : []

    if (modelId === "seedream-5.0-lite") {
      return {
        prompt,
        size: "2048x2048",
        image: refs.slice(0, 14),
        watermark: false,
        optimize_prompt_options: { mode: "standard" },
        sequential_image_generation: "disabled"
      }
    }
    if (modelId === "jimeng-3.1") {
      return {
        prompt,
        use_pre_llm: true,
        seed: -1,
        logo_info: {
          add_logo: false
        }
      }
    }
    if (modelId === "qwen-image-txt2img") {
      return {
        prompt,
        size: "1024*1024",
        watermark: false
      }
    }
    if (modelId === "qwen-image-edit") {
      return {
        prompt,
        image: refs[0],
        watermark: false
      }
    }
    if (modelId === "z-image-turbo-lora") {
      return {
        prompt,
        size: "1024*1024",
        seed: -1,
        loras: []
      }
    }
    if (modelId === "z-image-turbo") {
      return {
        prompt,
        size: "1024*1024",
        seed: -1,
        enable_base64_output: false
      }
    }
    return {
      model: modelId,
      prompt,
      size: "1024*1024",
      watermark: false
    }
  }

  private async waitForAsyncImages(
    requestEndpoint: string,
    taskId: string | undefined,
    apiKey: string
  ): Promise<string[]> {
    if (!taskId) {
      throw new Error("async image task_id is empty")
    }
    const taskEndpoint = getAsyncTaskResultEndpoint(requestEndpoint)
    const maxAttempts = 40
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0) {
        await sleep(1500)
      }
      const query = `${taskEndpoint}?task_id=${encodeURIComponent(taskId)}`
      const response = await fetch(query, {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      })
      if (!response.ok) {
        const reason = await response.text()
        throw new Error(`async task query failed(${response.status}): ${reason}`)
      }
      const data = (await response.json()) as AsyncTaskResponse
      const status = data.task?.status ?? ""
      if (status === "TASK_STATUS_SUCCEED") {
        return (data.images ?? [])
          .map((item) => extractImageUrl(item))
          .filter((value): value is string => !!value)
      }
      if (status === "TASK_STATUS_FAILED") {
        throw new Error(data.task?.reason || "image async task failed")
      }
    }
    throw new Error("image async task timeout")
  }
}
