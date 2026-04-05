import type { LogLevel } from "@bot/shared"
import { Elysia } from "elysia"
import type { AppDeps } from "../types"

export const logRoutes = (deps: AppDeps) =>
  new Elysia({ prefix: "/api" })
    .get("/logs", ({ query }) => {
      const level = typeof query.level === "string" ? (query.level as LogLevel) : undefined
      const source = typeof query.source === "string" ? query.source : undefined
      const traceId = typeof query.traceId === "string" ? query.traceId : undefined
      const keyword = typeof query.keyword === "string" ? query.keyword : undefined
      const policyDenied = query.policyDenied === "1" || query.policyDenied === "true"
      const limitRaw = Number(query.limit)
      const limit = Number.isFinite(limitRaw) ? limitRaw : undefined
      const offsetRaw = Number(query.offset)
      const offset = Number.isFinite(offsetRaw) ? offsetRaw : undefined
      const result = deps.db.queryLogs({
        level,
        source,
        traceId,
        keyword,
        policyDenied,
        limit,
        offset
      })
      return result
    })
    .get("/metrics", () => ({
      uptimeSec: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
      pluginCount: deps.pluginManager.list().length
    }))
