import type { BotSettings, SettingsPayload } from "@bot/shared";
import { BotDatabase } from "../../infra/db/sqlite";
import { findProviderById, PROVIDER_PRESETS } from "./providerRegistry";

export class ConfigService {
  constructor(private readonly db: BotDatabase) {}

  getSettings(): BotSettings {
    return this.db.getSettings();
  }

  updateSettings(payload: SettingsPayload): BotSettings {
    if (payload.providerId) {
      const provider = findProviderById(payload.providerId);
      if (!provider) {
        throw new Error(`Unknown providerId: ${payload.providerId}`);
      }
      if (!payload.apiBaseUrl) {
        payload.apiBaseUrl = provider.baseUrl;
      }
      if (!payload.model) {
        payload.model = provider.models[0] ?? "";
      }
    }

    if (payload.requestTimeoutMs && payload.requestTimeoutMs < 1000) {
      throw new Error("requestTimeoutMs must be >= 1000");
    }
    if (payload.pluginTimeoutMs && payload.pluginTimeoutMs < 100) {
      throw new Error("pluginTimeoutMs must be >= 100");
    }
    if (payload.memoryMaxTurns && payload.memoryMaxTurns < 1) {
      throw new Error("memoryMaxTurns must be >= 1");
    }
    if (payload.memoryMaxTurns && payload.memoryMaxTurns > 50) {
      throw new Error("memoryMaxTurns must be <= 50");
    }
    if (payload.chatResetCommand !== undefined) {
      const cmd = payload.chatResetCommand.trim();
      if (!cmd.startsWith("/")) {
        throw new Error("chatResetCommand must start with /");
      }
      if (/\s/.test(cmd)) {
        throw new Error("chatResetCommand must not include spaces");
      }
      payload.chatResetCommand = cmd;
    }
    if (payload.webFetchTimeoutMs && payload.webFetchTimeoutMs < 1000) {
      throw new Error("webFetchTimeoutMs must be >= 1000");
    }
    if (payload.webFetchMaxBytes && payload.webFetchMaxBytes < 10_000) {
      throw new Error("webFetchMaxBytes must be >= 10000");
    }
    if (payload.webFetchMaxRedirects && payload.webFetchMaxRedirects < 0) {
      throw new Error("webFetchMaxRedirects must be >= 0");
    }
    if (payload.webFetchMaxUrlsPerMessage && payload.webFetchMaxUrlsPerMessage < 1) {
      throw new Error("webFetchMaxUrlsPerMessage must be >= 1");
    }

    return this.db.updateSettings(payload);
  }

  listProviderPresets() {
    return PROVIDER_PRESETS;
  }
}
