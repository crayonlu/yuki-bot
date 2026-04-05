import { cors } from "@elysiajs/cors"
import { Elysia } from "elysia"
import type { OneBotWsGateway } from "../adapters/onebot/wsGateway"
import type { ErrorReporter } from "../infra/errorReporter"
import { logRoutes } from "./routes/logs"
import { pluginRoutes } from "./routes/plugins"
import { settingsRoutes } from "./routes/settings"
import type { AppDeps } from "./types"

export const createHttpApp = (
  deps: AppDeps,
  wsGateway: OneBotWsGateway,
  errorReporter: ErrorReporter
) =>
  new Elysia()
    .use(
      cors({
        origin: true,
        methods: ["GET", "POST", "PUT", "OPTIONS"]
      })
    )
    .onError(({ error, path }) => {
      errorReporter.capture(error, { path, stage: "http" })
      const message =
        typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "Unhandled error"
      return {
        ok: false,
        error: message
      }
    })
    .get("/health", () => ({ ok: true, ts: Date.now() }))
    .use(settingsRoutes(deps))
    .use(pluginRoutes(deps))
    .use(logRoutes(deps))
    .ws("/onebot/ws", {
      open(ws) {
        wsGateway.addSocket(ws)
      },
      close(ws) {
        wsGateway.removeSocket(ws)
      },
      async message(_ws, message) {
        await wsGateway.handleRaw(message)
      }
    })
