export type LogLevel = "debug" | "info" | "warn" | "error";

export type ProviderPreset = {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
};

export type BotSettings = {
  providerId: string;
  model: string;
  apiBaseUrl: string;
  apiKey: string;
  systemPrompt: string;
  requestTimeoutMs: number;
  pluginTimeoutMs: number;
  webFetchEnabled: boolean;
  webFetchTimeoutMs: number;
  webFetchMaxBytes: number;
  webFetchMaxRedirects: number;
  webFetchMaxUrlsPerMessage: number;
};

export type SettingsPayload = Partial<BotSettings>;

export type OneBotMessageEvent = {
  post_type: "message";
  message_type: "private" | "group";
  user_id: number;
  group_id?: number;
  raw_message: string;
  self_id: number;
  time: number;
};

export type PluginPermissions = {
  llm: boolean;
  webFetch: boolean;
  replyPrivate: boolean;
  replyGroup: boolean;
  configRead: boolean;
  configWrite: boolean;
};

export type PluginRuntimeState = {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  loaded: boolean;
  lastError?: string;
  modulePath: string;
  updatedAt: number;
  permissions: PluginPermissions;
};

export type LogRecord = {
  id: number;
  ts: number;
  level: LogLevel;
  source: string;
  traceId: string;
  message: string;
  data?: string;
};
