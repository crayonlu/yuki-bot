import type {
  BotSettings,
  ChatMessage,
  OneBotMessageEvent,
  OneBotQuotedMessage,
  PluginPermissions,
  SettingsPayload
} from "@bot/shared"

export type WebFetchResult = {
  url: string
  finalUrl: string
  title?: string
  summary: string
  contentText: string
  contentType: string
}

export type ImageGenerateResult = {
  modelId: string
  imageUrls: string[]
}

export type PluginMessageContext = {
  traceId: string
  settings: BotSettings
  reply: (text: string) => Promise<void>
  askLlm: (text: string, extraContext?: string, history?: ChatMessage[]) => Promise<string>
  fetchUrl: (url: string) => Promise<WebFetchResult>
  generateImage: (input: {
    prompt: string
    modelId?: string
    referenceImages?: string[]
  }) => Promise<ImageGenerateResult>
  fetchQuotedMessage: () => Promise<OneBotQuotedMessage | undefined>
  forward: (contents: string[]) => Promise<void>
  getRecentHistory: (maxTurns: number) => ChatMessage[]
  appendHistoryTurn: (userText: string, assistantText: string) => void
  clearHistory: () => void
  getSettings: () => BotSettings
  updateSettings: (payload: SettingsPayload) => BotSettings
  log: (message: string, data?: Record<string, unknown>) => void
}

export type BotPlugin = {
  id: string
  name: string
  version: string
  commands?: string[]
  routePriority?: number
  permissions?: Partial<PluginPermissions>
  onLoad?: () => Promise<void> | void
  onUnload?: () => Promise<void> | void
  onMessage?: (event: OneBotMessageEvent, context: PluginMessageContext) => Promise<void> | void
}

export type LoadedPlugin = {
  plugin: BotPlugin
  modulePath: string
  permissions: PluginPermissions
  enabled: boolean
  loaded: boolean
  lastError?: string
  updatedAt: number
}
