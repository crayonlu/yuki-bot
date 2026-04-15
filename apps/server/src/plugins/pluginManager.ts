import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type {
  ChatMessage,
  OneBotMessageEvent,
  OneBotQuotedMessage,
  PluginPermissions,
  PluginRuntimeState
} from "@bot/shared"
import type { SessionMemoryService } from "../domain/chat/sessionMemoryService"
import type { ConfigService } from "../domain/config/configService"
import type { ImageService } from "../domain/image/imageService"
import type { LlmService } from "../domain/llm/llmService"
import type { VisionService } from "../domain/vision/visionService"
import type { WebSearchService } from "../domain/web/webSearchService"
import type { WebFetchService } from "../domain/web/webFetchService"
import type { BotDatabase } from "../infra/db/sqlite"
import type { AppLogger } from "../infra/logger"
import { chatPlugin } from "./builtin/chatPlugin"
import { echoPlugin } from "./builtin/echoPlugin"
import { imagePlugin } from "./builtin/imagePlugin"
import type { BotPlugin, LoadedPlugin } from "./types"

type ReplyFn = (event: OneBotMessageEvent, text: string) => Promise<void>
type QuoteFetchFn = (messageId: number | string) => Promise<OneBotQuotedMessage | undefined>
type ForwardFn = (event: OneBotMessageEvent, contents: string[]) => Promise<void>

class PolicyDeniedError extends Error {
  code = "policy_denied" as const
}

const DEFAULT_PLUGIN_PERMISSIONS: PluginPermissions = {
  llm: false,
  webFetch: false,
  webSearch: false,
  visionAnalyze: false,
  imageGenerate: false,
  replyPrivate: false,
  replyGroup: false,
  configRead: false,
  configWrite: false
}

const runWithTimeout = async <T>(timeoutMs: number, task: () => Promise<T> | T): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export class PluginManager {
  private readonly loaded = new Map<string, LoadedPlugin>()
  private readonly log

  constructor(
    private readonly db: BotDatabase,
    private readonly configService: ConfigService,
    private readonly llmService: LlmService,
    private readonly webFetchService: WebFetchService,
    private readonly webSearchService: WebSearchService,
    private readonly visionService: VisionService,
    private readonly imageService: ImageService,
    private readonly sessionMemoryService: SessionMemoryService,
    logger: AppLogger,
    private readonly reply: ReplyFn,
    private readonly fetchQuotedMessage: QuoteFetchFn,
    private readonly forwardReply: ForwardFn
  ) {
    this.log = logger.child("plugin-manager")
  }

  private getBuiltin(id: string): BotPlugin | undefined {
    if (id === echoPlugin.id) return echoPlugin
    if (id === chatPlugin.id) return chatPlugin
    if (id === imagePlugin.id) return imagePlugin
    return undefined
  }

  private resolvePermissions(plugin: BotPlugin, persisted?: PluginPermissions): PluginPermissions {
    return {
      ...DEFAULT_PLUGIN_PERMISSIONS,
      ...(persisted ?? {}),
      ...(plugin.permissions ?? {})
    }
  }

  private deny(message: string): never {
    throw new PolicyDeniedError(message)
  }

  async bootstrap() {
    const existing = this.db.listPlugins()
    const now = Date.now()
    if (!existing.find((p) => p.id === echoPlugin.id)) {
      this.db.upsertPlugin({
        id: echoPlugin.id,
        name: echoPlugin.name,
        version: echoPlugin.version,
        modulePath: "builtin:echo",
        enabled: true,
        loaded: false,
        updatedAt: now,
        permissions: this.resolvePermissions(echoPlugin)
      })
    }
    if (!existing.find((p) => p.id === chatPlugin.id)) {
      this.db.upsertPlugin({
        id: chatPlugin.id,
        name: chatPlugin.name,
        version: chatPlugin.version,
        modulePath: "builtin:chat",
        enabled: true,
        loaded: false,
        updatedAt: now,
        permissions: this.resolvePermissions(chatPlugin)
      })
    }
    if (!existing.find((p) => p.id === imagePlugin.id)) {
      this.db.upsertPlugin({
        id: imagePlugin.id,
        name: imagePlugin.name,
        version: imagePlugin.version,
        modulePath: "builtin:image",
        enabled: true,
        loaded: false,
        updatedAt: now,
        permissions: this.resolvePermissions(imagePlugin)
      })
    }

    const states = this.db.listPlugins()
    for (const state of states) {
      if (state.enabled) {
        await this.load(state.id)
      } else {
        this.loaded.set(state.id, {
          plugin: this.getBuiltin(state.id) ?? {
            id: state.id,
            name: state.id,
            version: "unknown"
          },
          permissions: state.permissions,
          modulePath: state.modulePath,
          enabled: false,
          loaded: false,
          lastError: state.lastError,
          updatedAt: state.updatedAt
        })
      }
    }
  }

  private async resolvePlugin(state: PluginRuntimeState): Promise<BotPlugin> {
    if (state.modulePath.startsWith("builtin:")) {
      const builtin = this.getBuiltin(state.id)
      if (!builtin) throw new Error(`Unknown builtin plugin ${state.id}`)
      return builtin
    }

    const absPath = resolve(state.modulePath)
    const moduleUrl = pathToFileURL(absPath).href + `?v=${Date.now()}`
    const imported = (await import(moduleUrl)) as {
      default?: BotPlugin
      plugin?: BotPlugin
    }
    const plugin = imported.default ?? imported.plugin
    if (!plugin) {
      throw new Error(`Plugin at ${state.modulePath} missing default export`)
    }
    if (plugin.id !== state.id) {
      throw new Error(`Plugin id mismatch: expected ${state.id}, got ${plugin.id}`)
    }
    return plugin
  }

  async load(id: string): Promise<void> {
    const state = this.db.listPlugins().find((item) => item.id === id)
    if (!state) {
      throw new Error(`Plugin not found: ${id}`)
    }
    const plugin = await this.resolvePlugin(state)
    const permissions = this.resolvePermissions(plugin, state.permissions)
    await plugin.onLoad?.()
    const next: LoadedPlugin = {
      plugin,
      permissions,
      modulePath: state.modulePath,
      enabled: true,
      loaded: true,
      updatedAt: Date.now()
    }
    this.loaded.set(id, next)
    this.db.upsertPlugin({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      modulePath: state.modulePath,
      enabled: true,
      loaded: true,
      updatedAt: next.updatedAt,
      permissions
    })
    this.log.info("Plugin loaded", { pluginId: id })
  }

  async unload(id: string): Promise<void> {
    const current = this.loaded.get(id)
    if (!current) return
    await current.plugin.onUnload?.()
    const next: LoadedPlugin = {
      ...current,
      loaded: false,
      enabled: false,
      updatedAt: Date.now()
    }
    this.loaded.set(id, next)
    this.db.setPluginEnabled(id, false)
    this.log.info("Plugin unloaded", { pluginId: id })
  }

  async reload(id: string): Promise<void> {
    const isEnabled = this.loaded.get(id)?.enabled ?? true
    await this.safeUnloadForReload(id)
    this.db.setPluginEnabled(id, isEnabled)
    if (isEnabled) {
      await this.load(id)
    }
    this.log.info("Plugin reloaded", { pluginId: id })
  }

  private async safeUnloadForReload(id: string) {
    const current = this.loaded.get(id)
    if (!current) return
    try {
      await current.plugin.onUnload?.()
    } catch (error) {
      this.log.warn("Plugin onUnload failed during reload", {
        pluginId: id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    this.loaded.delete(id)
  }

  async setEnabled(id: string, enabled: boolean) {
    if (enabled) {
      await this.load(id)
      return
    }
    await this.unload(id)
  }

  async registerExternal(modulePath: string, pluginId: string) {
    const now = Date.now()
    this.db.upsertPlugin({
      id: pluginId,
      name: pluginId,
      version: "unknown",
      modulePath,
      enabled: true,
      loaded: false,
      updatedAt: now,
      permissions: {
        ...DEFAULT_PLUGIN_PERMISSIONS,
        replyPrivate: true,
        replyGroup: true
      }
    })
    await this.load(pluginId)
  }

  async ensureExternalPlugin(pluginId: string, modulePath: string) {
    const exists = this.db.listPlugins().some((item) => item.id === pluginId)
    if (exists) return
    await this.registerExternal(modulePath, pluginId)
  }

  updatePermissions(id: string, partial: Partial<PluginPermissions>) {
    const persisted = this.db.listPlugins().find((item) => item.id === id)
    if (!persisted) {
      throw new Error(`Plugin not found: ${id}`)
    }
    const nextPermissions: PluginPermissions = {
      ...DEFAULT_PLUGIN_PERMISSIONS,
      ...persisted.permissions,
      ...partial
    }
    this.db.setPluginPermissions(id, nextPermissions)
    const runtime = this.loaded.get(id)
    if (runtime) {
      runtime.permissions = nextPermissions
      runtime.updatedAt = Date.now()
    }
    this.log.info("Plugin permissions updated", { pluginId: id, permissions: nextPermissions })
    return this.list().find((item) => item.id === id)
  }

  list(): PluginRuntimeState[] {
    const persisted = this.db.listPlugins()
    return persisted.map((item) => {
      const runtime = this.loaded.get(item.id)
      return {
        ...item,
        loaded: runtime?.loaded ?? false,
        enabled: runtime?.enabled ?? item.enabled,
        lastError: runtime?.lastError ?? item.lastError,
        permissions: runtime?.permissions ?? item.permissions
      }
    })
  }

  private getFirstToken(rawMessage: string): string {
    const trimmed = rawMessage.trim()
    if (!trimmed) return ""
    const [first = ""] = trimmed.split(/\s+/, 1)
    return first
  }

  private resolveCommandTarget(commandToken: string): LoadedPlugin | undefined {
    const candidates = [...this.loaded.values()].filter(
      (runtime) =>
        runtime.enabled &&
        runtime.loaded &&
        !!runtime.plugin.onMessage &&
        !!runtime.plugin.commands?.includes(commandToken)
    )
    if (candidates.length === 0) return undefined
    candidates.sort((a, b) => {
      const priorityA = a.plugin.routePriority ?? 0
      const priorityB = b.plugin.routePriority ?? 0
      if (priorityA !== priorityB) return priorityB - priorityA
      return a.plugin.id.localeCompare(b.plugin.id)
    })
    if (candidates.length > 1) {
      this.log.warn("Multiple plugins match same command, selecting highest priority", {
        command: commandToken,
        selected: candidates[0]?.plugin.id,
        candidates: candidates.map((item) => item.plugin.id)
      })
    }
    return candidates[0]
  }

  private getChatFallbackPlugin(): LoadedPlugin | undefined {
    const runtime = this.loaded.get(chatPlugin.id)
    if (!runtime || !runtime.enabled || !runtime.loaded || !runtime.plugin.onMessage) {
      return undefined
    }
    return runtime
  }

  private async runPlugin(runtime: LoadedPlugin, event: OneBotMessageEvent, traceId: string) {
    const settings = this.configService.getSettings()
    try {
      const settingsView = runtime.permissions.configRead
        ? settings
        : {
            ...settings,
            apiKey: "",
            systemPrompt: ""
          }
      await runWithTimeout(settings.pluginTimeoutMs, async () => {
        await runtime.plugin.onMessage?.(event, {
          traceId,
          settings: settingsView,
          reply: async (text: string) => {
            if (event.message_type === "private" && !runtime.permissions.replyPrivate) {
              this.deny(`Plugin ${runtime.plugin.id} has no replyPrivate permission`)
            }
            if (event.message_type === "group" && !runtime.permissions.replyGroup) {
              this.deny(`Plugin ${runtime.plugin.id} has no replyGroup permission`)
            }
            await this.reply(event, text)
          },
          askLlm: async (text: string, extraContext?: string, history?: ChatMessage[]) => {
            if (!runtime.permissions.llm) {
              this.deny(`Plugin ${runtime.plugin.id} does not have llm permission`)
            }
            return this.llmService.generateReply({
              userText: text,
              extraContext,
              history,
              settings,
              traceId
            })
          },
          planTools: async ({
            userText,
            history,
            hasCurrentImages,
            hasRecentVisionEvidence,
            executedTools,
            contextPreview
          }) => {
            if (!runtime.permissions.llm) {
              this.deny(`Plugin ${runtime.plugin.id} does not have llm permission`)
            }
            return this.llmService.planTools({
              userText,
              history,
              hasCurrentImages,
              hasRecentVisionEvidence,
              executedTools,
              contextPreview,
              settings,
              traceId
            })
          },
          fetchUrl: async (url: string) => {
            if (!runtime.permissions.webFetch) {
              this.deny(`Plugin ${runtime.plugin.id} does not have webFetch permission`)
            }
            return this.webFetchService.fetchUrl(url, settings, traceId)
          },
          searchWeb: async ({ query }) => {
            if (!runtime.permissions.webSearch) {
              this.deny(`Plugin ${runtime.plugin.id} does not have webSearch permission`)
            }
            return this.webSearchService.search({
              query,
              settings,
              traceId
            })
          },
          analyzeVision: async ({ query, imageUrls }) => {
            if (!runtime.permissions.visionAnalyze) {
              this.deny(`Plugin ${runtime.plugin.id} does not have visionAnalyze permission`)
            }
            return this.visionService.analyze({
              query,
              imageUrls,
              settings,
              traceId
            })
          },
          generateImage: async ({ prompt, modelId, referenceImages }) => {
            if (!runtime.permissions.imageGenerate) {
              this.deny(`Plugin ${runtime.plugin.id} does not have imageGenerate permission`)
            }
            return this.imageService.generate({
              prompt,
              modelId,
              referenceImages,
              settings,
              traceId
            })
          },
          fetchQuotedMessage: () => {
            const messageId = event.reply?.message_id
            if (messageId === undefined) return Promise.resolve(undefined)
            return this.fetchQuotedMessage(messageId)
          },
          forward: async (contents: string[]) => {
            if (event.message_type === "private" && !runtime.permissions.replyPrivate) {
              this.deny(`Plugin ${runtime.plugin.id} has no replyPrivate permission`)
            }
            if (event.message_type === "group" && !runtime.permissions.replyGroup) {
              this.deny(`Plugin ${runtime.plugin.id} has no replyGroup permission`)
            }
            await this.forwardReply(event, contents)
          },
          getRecentHistory: (maxTurns: number) =>
            this.sessionMemoryService.getRecentHistory(event, maxTurns),
          appendHistoryTurn: (userText: string, assistantText: string) =>
            this.sessionMemoryService.appendTurn(event, userText, assistantText),
          appendVisionEvidence: (input) => this.sessionMemoryService.appendVisionEvidence(event, input),
          getRecentVisionEvidences: (limit: number) =>
            this.sessionMemoryService.getRecentVisionEvidences(event, limit),
          clearHistory: () => this.sessionMemoryService.clear(event),
          getSettings: () => {
            if (!runtime.permissions.configRead) {
              this.deny(`Plugin ${runtime.plugin.id} has no configRead permission`)
            }
            return this.configService.getSettings()
          },
          updateSettings: (payload) => {
            if (!runtime.permissions.configWrite) {
              this.deny(`Plugin ${runtime.plugin.id} has no configWrite permission`)
            }
            return this.configService.updateSettings(payload)
          },
          log: (message, data) =>
            this.log.info(message, { pluginId: runtime.plugin.id, ...data }, traceId)
        })
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const code = error instanceof PolicyDeniedError ? error.code : undefined
      runtime.lastError = message
      runtime.updatedAt = Date.now()
      this.db.setPluginError(runtime.plugin.id, message)
      this.log.error(
        "Plugin handler failed",
        { pluginId: runtime.plugin.id, error: message, code },
        traceId
      )
    }
  }

  async handleMessage(event: OneBotMessageEvent, traceId: string) {
    const commandToken = this.getFirstToken(event.raw_message)
    const target = this.resolveCommandTarget(commandToken)
    if (target) {
      await this.runPlugin(target, event, traceId)
      return
    }

    const fallback = this.getChatFallbackPlugin()
    if (fallback) {
      await this.runPlugin(fallback, event, traceId)
    }
  }
}
