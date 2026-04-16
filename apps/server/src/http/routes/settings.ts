import { Elysia } from "elysia"
import type { AppDeps } from "../types"

type RemoteModelItem = {
  id: string
  displayName: string
  endpoints: string[]
  modelType: string
}

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, "")

export const settingsRoutes = (deps: AppDeps) =>
  new Elysia({ prefix: "/api/settings" })
    .get("/", () => ({
      settings: deps.configService.getSettings(),
      providers: deps.configService.listProviderPresets()
    }))
    .post("/models", async ({ body }) => {
      const payload = (body ?? {}) as Record<string, unknown>
      const current = deps.configService.getSettings()
      const apiBaseUrl =
        typeof payload.apiBaseUrl === "string" && payload.apiBaseUrl.trim()
          ? payload.apiBaseUrl.trim()
          : current.apiBaseUrl
      const apiKey =
        typeof payload.apiKey === "string" && payload.apiKey.trim()
          ? payload.apiKey.trim()
          : current.apiKey

      if (!apiBaseUrl) {
        return { ok: false, error: "apiBaseUrl is required", models: [] }
      }
      if (!apiKey) {
        return { ok: false, error: "apiKey is required", models: [] }
      }

      const endpoint = `${normalizeBaseUrl(apiBaseUrl)}/models`
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      })
      if (!response.ok) {
        const reason = await response.text()
        return {
          ok: false,
          error: `list models failed(${response.status}): ${reason}`,
          models: []
        }
      }

      const data = (await response.json()) as {
        data?: Array<{
          id?: string
          display_name?: string
          title?: string
          endpoints?: string[]
          model_type?: string
        }>
      }
      const models: RemoteModelItem[] = (data.data ?? [])
        .filter((item) => typeof item.id === "string" && !!item.id)
        .map((item) => ({
          id: item.id as string,
          displayName:
            (typeof item.display_name === "string" && item.display_name) ||
            (typeof item.title === "string" && item.title) ||
            (item.id as string),
          endpoints: Array.isArray(item.endpoints)
            ? item.endpoints.filter((v): v is string => typeof v === "string")
            : [],
          modelType: typeof item.model_type === "string" ? item.model_type : "unknown"
        }))
        .filter(
          (item) =>
            item.modelType === "chat" ||
            item.modelType === "vision" ||
            item.modelType === "multimodal" ||
            item.modelType === "vlm" ||
            item.endpoints.includes("chat/completions")
        )

      return { ok: true, models }
    })
    .put("/", ({ body }) => {
      const payload = (body ?? {}) as Record<string, unknown>
      const imageModelConfigs = Array.isArray(payload.imageModelConfigs)
        ? payload.imageModelConfigs
            .map((item) => {
              if (!item || typeof item !== "object") return undefined
              const value = item as Record<string, unknown>
              if (typeof value.id !== "string" || typeof value.endpoint !== "string") {
                return undefined
              }
              return {
                id: value.id,
                endpoint: value.endpoint
              }
            })
            .filter((item): item is { id: string; endpoint: string } => !!item)
        : undefined
      const updated = deps.configService.updateSettings({
        providerId: typeof payload.providerId === "string" ? payload.providerId : undefined,
        model: typeof payload.model === "string" ? payload.model : undefined,
        apiBaseUrl: typeof payload.apiBaseUrl === "string" ? payload.apiBaseUrl : undefined,
        apiKey: typeof payload.apiKey === "string" ? payload.apiKey : undefined,
        systemPrompt: typeof payload.systemPrompt === "string" ? payload.systemPrompt : undefined,
        requestTimeoutMs:
          typeof payload.requestTimeoutMs === "number" ? payload.requestTimeoutMs : undefined,
        pluginTimeoutMs:
          typeof payload.pluginTimeoutMs === "number" ? payload.pluginTimeoutMs : undefined,
        memoryMaxTurns:
          typeof payload.memoryMaxTurns === "number" ? payload.memoryMaxTurns : undefined,
        chatResetCommand:
          typeof payload.chatResetCommand === "string" ? payload.chatResetCommand : undefined,
        imageModelConfigs,
        defaultImageModel:
          typeof payload.defaultImageModel === "string" ? payload.defaultImageModel : undefined,
        webFetchEnabled:
          typeof payload.webFetchEnabled === "boolean" ? payload.webFetchEnabled : undefined,
        webFetchTimeoutMs:
          typeof payload.webFetchTimeoutMs === "number" ? payload.webFetchTimeoutMs : undefined,
        webFetchMaxBytes:
          typeof payload.webFetchMaxBytes === "number" ? payload.webFetchMaxBytes : undefined,
        webFetchMaxRedirects:
          typeof payload.webFetchMaxRedirects === "number"
            ? payload.webFetchMaxRedirects
            : undefined,
        webFetchMaxUrlsPerMessage:
          typeof payload.webFetchMaxUrlsPerMessage === "number"
            ? payload.webFetchMaxUrlsPerMessage
            : undefined,
        webSearchEnabled:
          typeof payload.webSearchEnabled === "boolean" ? payload.webSearchEnabled : undefined,
        webSearchTimeoutMs:
          typeof payload.webSearchTimeoutMs === "number" ? payload.webSearchTimeoutMs : undefined,
        webSearchMaxCallsPerMessage:
          typeof payload.webSearchMaxCallsPerMessage === "number"
            ? payload.webSearchMaxCallsPerMessage
            : undefined,
        webSearchCountPerCall:
          typeof payload.webSearchCountPerCall === "number"
            ? payload.webSearchCountPerCall
            : undefined,
        webSearchFreshness:
          typeof payload.webSearchFreshness === "string" ? payload.webSearchFreshness : undefined,
        webSearchSummary:
          typeof payload.webSearchSummary === "boolean" ? payload.webSearchSummary : undefined,
        visionEnabled: typeof payload.visionEnabled === "boolean" ? payload.visionEnabled : undefined,
        visionModel: typeof payload.visionModel === "string" ? payload.visionModel : undefined,
        visionDetail:
          payload.visionDetail === "auto" || payload.visionDetail === "low" || payload.visionDetail === "high"
            ? payload.visionDetail
            : undefined,
        visionSummaryMaxChars:
          typeof payload.visionSummaryMaxChars === "number"
            ? payload.visionSummaryMaxChars
            : undefined,
        visionEvidenceLookback:
          typeof payload.visionEvidenceLookback === "number"
            ? payload.visionEvidenceLookback
            : undefined
      })
      return { settings: updated }
    })
