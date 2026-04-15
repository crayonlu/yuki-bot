import type { BotSettings, SettingsPayload } from "@bot/shared"
import type { BotDatabase } from "../../infra/db/sqlite"
import { BUILTIN_IMAGE_CONFIGS } from "../image/presets"
import { findProviderById, PROVIDER_PRESETS } from "./providerRegistry"

const isHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

export class ConfigService {
  constructor(private readonly db: BotDatabase) {}

  getSettings(): BotSettings {
    const current = this.db.getSettings()
    const mergedImageConfigs = [...BUILTIN_IMAGE_CONFIGS, ...current.imageModelConfigs]
      .filter((item) => item.id && item.endpoint)
      .reduce<{ id: string; endpoint: string }[]>((acc, item) => {
        if (acc.some((saved) => saved.id === item.id)) return acc
        acc.push(item)
        return acc
      }, [])
    const nextDefault = mergedImageConfigs.some((item) => item.id === current.defaultImageModel)
      ? current.defaultImageModel
      : mergedImageConfigs[0]?.id || "seedream-5.0-lite"
    return {
      ...current,
      imageModelConfigs: mergedImageConfigs,
      defaultImageModel: nextDefault
    }
  }

  updateSettings(payload: SettingsPayload): BotSettings {
    if (payload.providerId) {
      const provider = findProviderById(payload.providerId)
      if (!provider) {
        throw new Error(`Unknown providerId: ${payload.providerId}`)
      }
      if (!payload.apiBaseUrl) {
        payload.apiBaseUrl = provider.baseUrl
      }
      if (!payload.model) {
        payload.model = provider.models[0] ?? ""
      }
    }

    if (payload.requestTimeoutMs && payload.requestTimeoutMs < 1000) {
      throw new Error("requestTimeoutMs must be >= 1000")
    }
    if (payload.pluginTimeoutMs && payload.pluginTimeoutMs < 100) {
      throw new Error("pluginTimeoutMs must be >= 100")
    }
    if (payload.memoryMaxTurns && payload.memoryMaxTurns < 1) {
      throw new Error("memoryMaxTurns must be >= 1")
    }
    if (payload.memoryMaxTurns && payload.memoryMaxTurns > 50) {
      throw new Error("memoryMaxTurns must be <= 50")
    }
    if (payload.chatResetCommand !== undefined) {
      const cmd = payload.chatResetCommand.trim()
      if (!cmd.startsWith("/")) {
        throw new Error("chatResetCommand must start with /")
      }
      if (/\s/.test(cmd)) {
        throw new Error("chatResetCommand must not include spaces")
      }
      payload.chatResetCommand = cmd
    }
    if (payload.imageModelConfigs !== undefined) {
      const normalized = payload.imageModelConfigs
        .map((item) => ({
          id: item.id.trim(),
          endpoint: item.endpoint.trim()
        }))
        .filter((item) => item.id && item.endpoint)
      const deduped = new Map<string, { id: string; endpoint: string }>()
      for (const item of normalized) {
        if (!isHttpUrl(item.endpoint)) {
          throw new Error(`image endpoint must be http/https URL: ${item.id}`)
        }
        deduped.set(item.id, item)
      }
      payload.imageModelConfigs = [...deduped.values()]
      if (payload.imageModelConfigs.length === 0) {
        throw new Error("imageModelConfigs must not be empty")
      }
    }
    const nextSettings = {
      ...this.db.getSettings(),
      ...payload
    }
    const hasDefaultModel = nextSettings.imageModelConfigs.some(
      (item) => item.id === nextSettings.defaultImageModel
    )
    if (!hasDefaultModel) {
      throw new Error("defaultImageModel must exist in imageModelConfigs")
    }
    if (payload.webFetchTimeoutMs && payload.webFetchTimeoutMs < 1000) {
      throw new Error("webFetchTimeoutMs must be >= 1000")
    }
    if (payload.webFetchMaxBytes && payload.webFetchMaxBytes < 10_000) {
      throw new Error("webFetchMaxBytes must be >= 10000")
    }
    if (payload.webFetchMaxRedirects && payload.webFetchMaxRedirects < 0) {
      throw new Error("webFetchMaxRedirects must be >= 0")
    }
    if (payload.webFetchMaxUrlsPerMessage && payload.webFetchMaxUrlsPerMessage < 1) {
      throw new Error("webFetchMaxUrlsPerMessage must be >= 1")
    }
    if (payload.webSearchTimeoutMs && payload.webSearchTimeoutMs < 1000) {
      throw new Error("webSearchTimeoutMs must be >= 1000")
    }
    if (payload.webSearchMaxCallsPerMessage && payload.webSearchMaxCallsPerMessage < 1) {
      throw new Error("webSearchMaxCallsPerMessage must be >= 1")
    }
    if (payload.webSearchMaxCallsPerMessage && payload.webSearchMaxCallsPerMessage > 10) {
      throw new Error("webSearchMaxCallsPerMessage must be <= 10")
    }
    if (payload.webSearchCountPerCall && payload.webSearchCountPerCall < 1) {
      throw new Error("webSearchCountPerCall must be >= 1")
    }
    if (payload.webSearchCountPerCall && payload.webSearchCountPerCall > 50) {
      throw new Error("webSearchCountPerCall must be <= 50")
    }
    if (payload.webSearchFreshness !== undefined) {
      const freshness = payload.webSearchFreshness.trim()
      if (!freshness) {
        throw new Error("webSearchFreshness must not be empty")
      }
      payload.webSearchFreshness = freshness
    }
    if (payload.visionModel !== undefined) {
      const model = payload.visionModel.trim()
      if (!model) {
        throw new Error("visionModel must not be empty")
      }
      payload.visionModel = model
    }
    if (payload.visionSummaryMaxChars && payload.visionSummaryMaxChars < 100) {
      throw new Error("visionSummaryMaxChars must be >= 100")
    }
    if (payload.visionSummaryMaxChars && payload.visionSummaryMaxChars > 4000) {
      throw new Error("visionSummaryMaxChars must be <= 4000")
    }
    if (payload.visionEvidenceLookback && payload.visionEvidenceLookback < 1) {
      throw new Error("visionEvidenceLookback must be >= 1")
    }
    if (payload.visionEvidenceLookback && payload.visionEvidenceLookback > 10) {
      throw new Error("visionEvidenceLookback must be <= 10")
    }
    if (payload.visionDetail !== undefined) {
      const detail = payload.visionDetail
      if (!["auto", "low", "high"].includes(detail)) {
        throw new Error("visionDetail must be one of auto/low/high")
      }
    }

    return this.db.updateSettings(payload)
  }

  listProviderPresets() {
    return PROVIDER_PRESETS
  }
}
