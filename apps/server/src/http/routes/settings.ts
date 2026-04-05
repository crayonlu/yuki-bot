import { Elysia } from "elysia";
import type { AppDeps } from "../types";

export const settingsRoutes = (deps: AppDeps) =>
  new Elysia({ prefix: "/api/settings" })
    .get("/", () => ({
      settings: deps.configService.getSettings(),
      providers: deps.configService.listProviderPresets()
    }))
    .put("/", ({ body }) => {
      const payload = (body ?? {}) as Record<string, unknown>;
      const imageModelConfigs = Array.isArray(payload.imageModelConfigs)
        ? payload.imageModelConfigs
            .map((item) => {
              if (!item || typeof item !== "object") return undefined;
              const value = item as Record<string, unknown>;
              if (typeof value.id !== "string" || typeof value.endpoint !== "string") {
                return undefined;
              }
              return {
                id: value.id,
                endpoint: value.endpoint
              };
            })
            .filter((item): item is { id: string; endpoint: string } => !!item)
        : undefined;
      const updated = deps.configService.updateSettings({
        providerId:
          typeof payload.providerId === "string" ? payload.providerId : undefined,
        model: typeof payload.model === "string" ? payload.model : undefined,
        apiBaseUrl:
          typeof payload.apiBaseUrl === "string" ? payload.apiBaseUrl : undefined,
        apiKey: typeof payload.apiKey === "string" ? payload.apiKey : undefined,
        systemPrompt:
          typeof payload.systemPrompt === "string" ? payload.systemPrompt : undefined,
        requestTimeoutMs:
          typeof payload.requestTimeoutMs === "number"
            ? payload.requestTimeoutMs
            : undefined,
        pluginTimeoutMs:
          typeof payload.pluginTimeoutMs === "number"
            ? payload.pluginTimeoutMs
            : undefined,
        memoryMaxTurns:
          typeof payload.memoryMaxTurns === "number"
            ? payload.memoryMaxTurns
            : undefined,
        chatResetCommand:
          typeof payload.chatResetCommand === "string"
            ? payload.chatResetCommand
            : undefined,
        imageModelConfigs,
        defaultImageModel:
          typeof payload.defaultImageModel === "string"
            ? payload.defaultImageModel
            : undefined,
        webFetchEnabled:
          typeof payload.webFetchEnabled === "boolean"
            ? payload.webFetchEnabled
            : undefined,
        webFetchTimeoutMs:
          typeof payload.webFetchTimeoutMs === "number"
            ? payload.webFetchTimeoutMs
            : undefined,
        webFetchMaxBytes:
          typeof payload.webFetchMaxBytes === "number"
            ? payload.webFetchMaxBytes
            : undefined,
        webFetchMaxRedirects:
          typeof payload.webFetchMaxRedirects === "number"
            ? payload.webFetchMaxRedirects
            : undefined,
        webFetchMaxUrlsPerMessage:
          typeof payload.webFetchMaxUrlsPerMessage === "number"
            ? payload.webFetchMaxUrlsPerMessage
            : undefined
      });
      return { settings: updated };
    });
