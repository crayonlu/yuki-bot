import type {
  BotSettings,
  OneBotMessageEvent,
  PluginPermissions,
  SettingsPayload
} from "@bot/shared";

export type WebFetchResult = {
  url: string;
  finalUrl: string;
  title?: string;
  summary: string;
  contentText: string;
  contentType: string;
};

export type PluginMessageContext = {
  traceId: string;
  settings: BotSettings;
  reply: (text: string) => Promise<void>;
  askLlm: (text: string, extraContext?: string) => Promise<string>;
  fetchUrl: (url: string) => Promise<WebFetchResult>;
  getSettings: () => BotSettings;
  updateSettings: (payload: SettingsPayload) => BotSettings;
  log: (message: string, data?: Record<string, unknown>) => void;
};

export type BotPlugin = {
  id: string;
  name: string;
  version: string;
  permissions?: Partial<PluginPermissions>;
  onLoad?: () => Promise<void> | void;
  onUnload?: () => Promise<void> | void;
  onMessage?: (
    event: OneBotMessageEvent,
    context: PluginMessageContext
  ) => Promise<void> | void;
};

export type LoadedPlugin = {
  plugin: BotPlugin;
  modulePath: string;
  permissions: PluginPermissions;
  enabled: boolean;
  loaded: boolean;
  lastError?: string;
  updatedAt: number;
};
