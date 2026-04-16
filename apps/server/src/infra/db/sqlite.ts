import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type {
  BotSettings,
  ChatMessage,
  LogLevel,
  LogRecord,
  PluginPermissions,
  PluginRuntimeState
} from "@bot/shared"
import { BUILTIN_IMAGE_CONFIGS } from "../../domain/image/presets"

const DEFAULT_SETTINGS: BotSettings = {
  providerId: "openai",
  model: "gpt-4o-mini",
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  systemPrompt: "You are a helpful QQ assistant.",
  requestTimeoutMs: 30000,
  pluginTimeoutMs: 120000,
  memoryMaxTurns: 16,
  chatResetCommand: "/clean",
  imageModelConfigs: BUILTIN_IMAGE_CONFIGS.map((item) => ({ ...item })),
  defaultImageModel: "seedream-5.0-lite",
  webFetchEnabled: true,
  webFetchTimeoutMs: 12000,
  webFetchMaxBytes: 800000,
  webFetchMaxRedirects: 3,
  webFetchMaxUrlsPerMessage: 20,
  webSearchEnabled: true,
  webSearchProviders: ["serper", "tavily", "serpapi"],
  webSearchSerperApiKey: "",
  webSearchTavilyApiKey: "",
  webSearchSerpApiKey: "",
  webSearchTimeoutMs: 10000,
  webSearchMaxCallsPerMessage: 3,
  webSearchCountPerCall: 10,
  webSearchFreshness: "noLimit",
  webSearchSummary: true,
  visionEnabled: true,
  visionModel: "qwen/qwen2.5-vl-72b-instruct",
  visionDetail: "auto",
  visionSummaryMaxChars: 800,
  visionEvidenceLookback: 3
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

export class BotDatabase {
  private db: Database

  constructor(filePath: string) {
    const absolute = resolve(filePath)
    mkdirSync(dirname(absolute), { recursive: true })
    this.db = new Database(absolute)
    this.migrate()
    this.seedDefaults()
  }

  private migrate() {
    this.db.run("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    this.db.run(
      "CREATE TABLE IF NOT EXISTS plugins (id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL, module_path TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, last_error TEXT, updated_at INTEGER NOT NULL)"
    )
    this.ensureColumnExists("plugins", "permissions", "TEXT")
    this.db.run(
      "CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, level TEXT NOT NULL, source TEXT NOT NULL, trace_id TEXT NOT NULL, message TEXT NOT NULL, data TEXT)"
    )
    this.db.run(
      "CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_key TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, ts INTEGER NOT NULL)"
    )
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_key, id DESC)"
    )
    this.db.run(
      "CREATE TABLE IF NOT EXISTS vision_evidences (id INTEGER PRIMARY KEY AUTOINCREMENT, session_key TEXT NOT NULL, message_id TEXT, image_urls TEXT NOT NULL, summary TEXT NOT NULL, details TEXT, ts INTEGER NOT NULL)"
    )
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_vision_evidences_session_id ON vision_evidences(session_key, id DESC)"
    )
  }

  private ensureColumnExists(table: string, column: string, type: string) {
    const columns = this.db.query(`PRAGMA table_info(${table})`).all() as {
      name: string
    }[]
    if (!columns.some((item) => item.name === column)) {
      this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    }
  }

  private seedDefaults() {
    const insertSetting = this.db.prepare(
      "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
    )
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      insertSetting.run(key, JSON.stringify(value))
    }
  }

  getSettings(): BotSettings {
    const rows = this.db.query("SELECT key, value FROM settings").all() as {
      key: keyof BotSettings
      value: string
    }[]
    const current = { ...DEFAULT_SETTINGS }
    for (const row of rows) {
      try {
        current[row.key] = JSON.parse(row.value) as never
      } catch {}
    }
    return current
  }

  updateSettings(partial: Partial<BotSettings>): BotSettings {
    const upsert = this.db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    )
    for (const [key, value] of Object.entries(partial)) {
      upsert.run(key, JSON.stringify(value))
    }
    return this.getSettings()
  }

  upsertPlugin(state: PluginRuntimeState): void {
    this.db
      .prepare(
        "INSERT INTO plugins (id, name, version, module_path, enabled, last_error, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, version=excluded.version, module_path=excluded.module_path, enabled=excluded.enabled, last_error=excluded.last_error, updated_at=excluded.updated_at"
      )
      .run(
        state.id,
        state.name,
        state.version,
        state.modulePath,
        state.enabled ? 1 : 0,
        state.lastError ?? null,
        state.updatedAt
      )
    this.db
      .prepare("UPDATE plugins SET permissions=? WHERE id=?")
      .run(JSON.stringify(state.permissions), state.id)
  }

  listPlugins(): PluginRuntimeState[] {
    const rows = this.db
      .query(
        "SELECT id, name, version, module_path, enabled, last_error, updated_at, permissions FROM plugins ORDER BY id ASC"
      )
      .all() as {
      id: string
      name: string
      version: string
      module_path: string
      enabled: number
      last_error: string | null
      updated_at: number
      permissions: string | null
    }[]

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      version: row.version,
      modulePath: row.module_path,
      enabled: row.enabled === 1,
      loaded: false,
      lastError: row.last_error ?? undefined,
      updatedAt: row.updated_at,
      permissions: this.parsePermissions(row.permissions)
    }))
  }

  private parsePermissions(raw: string | null): PluginPermissions {
    if (!raw) return { ...DEFAULT_PLUGIN_PERMISSIONS }
    try {
      const parsed = JSON.parse(raw) as Partial<PluginPermissions>
      return {
        llm: !!parsed.llm,
        webFetch: !!parsed.webFetch,
        webSearch: !!parsed.webSearch,
        visionAnalyze: !!parsed.visionAnalyze,
        imageGenerate: !!parsed.imageGenerate,
        replyPrivate: !!parsed.replyPrivate,
        replyGroup: !!parsed.replyGroup,
        configRead: !!parsed.configRead,
        configWrite: !!parsed.configWrite
      }
    } catch {
      return { ...DEFAULT_PLUGIN_PERMISSIONS }
    }
  }

  setPluginEnabled(id: string, enabled: boolean): void {
    this.db
      .prepare("UPDATE plugins SET enabled=?, updated_at=? WHERE id=?")
      .run(enabled ? 1 : 0, Date.now(), id)
  }

  setPluginError(id: string, lastError?: string): void {
    this.db
      .prepare("UPDATE plugins SET last_error=?, updated_at=? WHERE id=?")
      .run(lastError ?? null, Date.now(), id)
  }

  setPluginPermissions(id: string, permissions: PluginPermissions): void {
    this.db
      .prepare("UPDATE plugins SET permissions=?, updated_at=? WHERE id=?")
      .run(JSON.stringify(permissions), Date.now(), id)
  }

  insertLog(
    level: LogLevel,
    source: string,
    traceId: string,
    message: string,
    data?: string
  ): void {
    this.db
      .prepare(
        "INSERT INTO logs (ts, level, source, trace_id, message, data) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(Date.now(), level, source, traceId, message, data ?? null)
  }

  queryLogs(filters: {
    level?: LogLevel
    source?: string
    traceId?: string
    limit?: number
    offset?: number
    keyword?: string
    policyDenied?: boolean
  }): { logs: LogRecord[]; hasMore: boolean; nextOffset: number } {
    const clauses: string[] = []
    const values: (string | number)[] = []
    if (filters.level) {
      clauses.push("level = ?")
      values.push(filters.level)
    }
    if (filters.source) {
      clauses.push("source = ?")
      values.push(filters.source)
    }
    if (filters.traceId) {
      clauses.push("trace_id = ?")
      values.push(filters.traceId)
    }
    if (filters.keyword) {
      clauses.push("(message LIKE ? OR data LIKE ? OR source LIKE ?)")
      const pattern = `%${filters.keyword}%`
      values.push(pattern, pattern, pattern)
    }
    if (filters.policyDenied) {
      clauses.push('data LIKE \'%"code":"policy_denied"%\'')
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""
    const limit = Math.min(filters.limit ?? 50, 200)
    const offset = Math.max(filters.offset ?? 0, 0)
    values.push(limit + 1)
    values.push(offset)
    const rows = this.db
      .query(
        `SELECT id, ts, level, source, trace_id, message, data FROM logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
      )
      .all(...values) as {
      id: number
      ts: number
      level: LogLevel
      source: string
      trace_id: string
      message: string
      data: string | null
    }[]
    const hasMore = rows.length > limit
    const sliced = hasMore ? rows.slice(0, limit) : rows
    const logs = sliced.map((row) => ({
      id: row.id,
      ts: row.ts,
      level: row.level,
      source: row.source,
      traceId: row.trace_id,
      message: row.message,
      data: row.data ?? undefined
    }))
    return {
      logs,
      hasMore,
      nextOffset: offset + logs.length
    }
  }

  listLogs(filters: {
    level?: LogLevel
    source?: string
    traceId?: string
    limit?: number
  }): LogRecord[] {
    return this.queryLogs(filters).logs
  }

  appendSessionMessage(sessionKey: string, role: ChatMessage["role"], content: string): void {
    this.db
      .prepare("INSERT INTO chat_messages (session_key, role, content, ts) VALUES (?, ?, ?, ?)")
      .run(sessionKey, role, content, Date.now())
  }

  listSessionMessages(sessionKey: string, limit: number): ChatMessage[] {
    const safeLimit = Math.max(1, Math.min(limit, 200))
    const rows = this.db
      .prepare(
        "SELECT role, content FROM chat_messages WHERE session_key = ? ORDER BY id DESC LIMIT ?"
      )
      .all(sessionKey, safeLimit) as { role: string; content: string }[]

    return rows.reverse().map((row) => ({
      role: row.role === "assistant" ? "assistant" : "user",
      content: row.content
    }))
  }

  clearSessionMessages(sessionKey: string): void {
    this.db.prepare("DELETE FROM chat_messages WHERE session_key = ?").run(sessionKey)
  }

  appendVisionEvidence(input: {
    sessionKey: string
    messageId?: string
    imageUrls: string[]
    summary: string
    details?: string
  }): void {
    this.db
      .prepare(
        "INSERT INTO vision_evidences (session_key, message_id, image_urls, summary, details, ts) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        input.sessionKey,
        input.messageId ?? null,
        JSON.stringify(input.imageUrls),
        input.summary,
        input.details ?? null,
        Date.now()
      )
  }

  listVisionEvidences(
    sessionKey: string,
    limit: number
  ): Array<{
    id: number
    messageId?: string
    imageUrls: string[]
    summary: string
    details?: string
    ts: number
  }> {
    const safeLimit = Math.max(1, Math.min(limit, 20))
    const rows = this.db
      .prepare(
        "SELECT id, message_id, image_urls, summary, details, ts FROM vision_evidences WHERE session_key = ? ORDER BY id DESC LIMIT ?"
      )
      .all(sessionKey, safeLimit) as Array<{
      id: number
      message_id: string | null
      image_urls: string
      summary: string
      details: string | null
      ts: number
    }>
    return rows.map((row) => {
      let imageUrls: string[] = []
      try {
        const parsed = JSON.parse(row.image_urls) as unknown
        if (Array.isArray(parsed)) {
          imageUrls = parsed.filter((item): item is string => typeof item === "string")
        }
      } catch {}
      return {
        id: row.id,
        messageId: row.message_id ?? undefined,
        imageUrls,
        summary: row.summary,
        details: row.details ?? undefined,
        ts: row.ts
      }
    })
  }

  clearVisionEvidences(sessionKey: string): void {
    this.db.prepare("DELETE FROM vision_evidences WHERE session_key = ?").run(sessionKey)
  }
}

export const defaultSettings = DEFAULT_SETTINGS
