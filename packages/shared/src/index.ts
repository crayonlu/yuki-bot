export type LogLevel = "debug" | "info" | "warn" | "error"

export type ProviderPreset = {
  id: string
  name: string
  baseUrl: string
  models: string[]
}

export type ImageModelConfig = {
  id: string
  endpoint: string
}

export type BotSettings = {
  providerId: string
  model: string
  apiBaseUrl: string
  apiKey: string
  systemPrompt: string
  requestTimeoutMs: number
  pluginTimeoutMs: number
  memoryMaxTurns: number
  chatResetCommand: string
  imageModelConfigs: ImageModelConfig[]
  defaultImageModel: string
  webFetchEnabled: boolean
  webFetchTimeoutMs: number
  webFetchMaxBytes: number
  webFetchMaxRedirects: number
  webFetchMaxUrlsPerMessage: number
}

export type SettingsPayload = Partial<BotSettings>

export type OneBotMessageSegment = {
  type: string
  data?: Record<string, string>
}

export type OneBotReplyRef = {
  message_id: number | string
}

export type OneBotMessageEvent = {
  post_type: "message"
  message_type: "private" | "group"
  user_id: number
  group_id?: number
  message_id?: number | string
  message?: OneBotMessageSegment[]
  reply?: OneBotReplyRef
  raw_message: string
  self_id: number
  time: number
}

export type OneBotQuotedMessage = {
  message_id: number | string
  raw_message: string
  message: OneBotMessageSegment[]
}

export type PluginPermissions = {
  llm: boolean
  webFetch: boolean
  imageGenerate: boolean
  replyPrivate: boolean
  replyGroup: boolean
  configRead: boolean
  configWrite: boolean
}

export type PluginRuntimeState = {
  id: string
  name: string
  version: string
  enabled: boolean
  loaded: boolean
  lastError?: string
  modulePath: string
  updatedAt: number
  permissions: PluginPermissions
}

export type LogRecord = {
  id: number
  ts: number
  level: LogLevel
  source: string
  traceId: string
  message: string
  data?: string
}

export type ChatMessage = {
  role: "user" | "assistant"
  content: string
}
