import type { BotSettings, LogRecord, PluginRuntimeState, ProviderPreset } from "@bot/shared";

export const api = {
  async health() {
    return fetch("/health").then((r) => r.json());
  },
  async getSettings(): Promise<{ settings: BotSettings; providers: ProviderPreset[] }> {
    return fetch("/api/settings").then((r) => r.json());
  },
  async updateSettings(payload: Partial<BotSettings>) {
    return fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then((r) => r.json());
  },
  async listPlugins(): Promise<{ plugins: PluginRuntimeState[] }> {
    return fetch("/api/plugins").then((r) => r.json());
  },
  async pluginAction(id: string, action: string) {
    return fetch(`/api/plugins/${id}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    }).then((r) => r.json());
  },
  async registerExternalPlugin(pluginId: string, modulePath: string) {
    return fetch("/api/plugins/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pluginId, modulePath })
    }).then((r) => r.json());
  },
  async updatePluginPermissions(
    pluginId: string,
    permissions: Partial<PluginRuntimeState["permissions"]>
  ) {
    return fetch(`/api/plugins/${pluginId}/permissions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(permissions)
    }).then((r) => r.json());
  },
  async listLogs(filters?: {
    level?: "debug" | "info" | "warn" | "error" | "";
    traceId?: string;
    keyword?: string;
    policyDenied?: boolean;
    offset?: number;
    limit?: number;
  }): Promise<{ logs: LogRecord[]; hasMore: boolean; nextOffset: number }> {
    const params = new URLSearchParams();
    params.set("limit", String(filters?.limit ?? 200));
    params.set("offset", String(filters?.offset ?? 0));
    if (filters?.level) params.set("level", filters.level);
    if (filters?.traceId) params.set("traceId", filters.traceId);
    if (filters?.keyword) params.set("keyword", filters.keyword);
    if (filters?.policyDenied) params.set("policyDenied", "1");
    return fetch(`/api/logs?${params.toString()}`).then((r) => r.json());
  },
  async metrics() {
    return fetch("/api/metrics").then((r) => r.json());
  }
};
