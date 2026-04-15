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

export type WebSearchItem = {
  title: string
  url: string
  snippet?: string
  summary?: string
  siteName?: string
  datePublished?: string
}

export type WebSearchResult = {
  query: string
  items: WebSearchItem[]
}

export type VisionAnalyzeResult = {
  summary: string
  details: {
    objects?: string[]
    texts?: string[]
    scene?: string
    warnings?: string[]
    confidence?: "low" | "medium" | "high"
  }
  latencyMs: number
}

export type VisionEvidence = {
  id: number
  messageId?: string
  imageUrls: string[]
  summary: string
  details?: string
  ts: number
}

export type ToolPlanResult = {
  useWebSearch: boolean
  webSearchQuery?: string
  useVision: boolean
  visionMode?: "current" | "recent"
  visionQuery?: string
  reason?: string
}

export type PluginMessageContext = {
  traceId: string
  settings: BotSettings
  reply: (text: string) => Promise<void>
  askLlm: (text: string, extraContext?: string, history?: ChatMessage[]) => Promise<string>
  planTools: (input: {
    userText: string
    history?: ChatMessage[]
    hasCurrentImages: boolean
    hasRecentVisionEvidence: boolean
    executedTools?: string[]
    contextPreview?: string
  }) => Promise<ToolPlanResult>
  fetchUrl: (url: string) => Promise<WebFetchResult>
  searchWeb: (input: { query: string }) => Promise<WebSearchResult>
  analyzeVision: (input: { query: string; imageUrls: string[] }) => Promise<VisionAnalyzeResult>
  generateImage: (input: {
    prompt: string
    modelId?: string
    referenceImages?: string[]
  }) => Promise<ImageGenerateResult>
  fetchQuotedMessage: () => Promise<OneBotQuotedMessage | undefined>
  forward: (contents: string[]) => Promise<void>
  getRecentHistory: (maxTurns: number) => ChatMessage[]
  appendHistoryTurn: (userText: string, assistantText: string) => void
  appendVisionEvidence: (input: {
    messageId?: string
    imageUrls: string[]
    summary: string
    details?: string
  }) => void
  getRecentVisionEvidences: (limit: number) => VisionEvidence[]
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
