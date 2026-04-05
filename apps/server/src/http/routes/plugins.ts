import { Elysia } from "elysia"
import type { AppDeps } from "../types"

export const pluginRoutes = (deps: AppDeps) =>
  new Elysia({ prefix: "/api/plugins" })
    .get("/", () => ({ plugins: deps.pluginManager.list() }))
    .post("/register", async ({ body }) => {
      const payload = (body ?? {}) as Record<string, unknown>
      const modulePath = typeof payload.modulePath === "string" ? payload.modulePath : ""
      const pluginId = typeof payload.pluginId === "string" ? payload.pluginId : ""
      if (!modulePath || !pluginId) {
        return { ok: false, error: "modulePath and pluginId are required" }
      }
      await deps.pluginManager.registerExternal(modulePath, pluginId)
      return { ok: true }
    })
    .post("/:id/action", async ({ params, body }) => {
      const payload = (body ?? {}) as Record<string, unknown>
      const action = typeof payload.action === "string" ? payload.action : ""
      const id = params.id

      if (action === "load") await deps.pluginManager.load(id)
      else if (action === "unload") await deps.pluginManager.unload(id)
      else if (action === "reload") await deps.pluginManager.reload(id)
      else if (action === "enable") await deps.pluginManager.setEnabled(id, true)
      else if (action === "disable") await deps.pluginManager.setEnabled(id, false)
      else return { ok: false, error: `Unknown action ${action}` }

      return { ok: true, plugins: deps.pluginManager.list() }
    })
    .put("/:id/permissions", async ({ params, body }) => {
      const payload = (body ?? {}) as Record<string, unknown>
      const next = deps.pluginManager.updatePermissions(params.id, {
        llm: typeof payload.llm === "boolean" ? payload.llm : undefined,
        webFetch: typeof payload.webFetch === "boolean" ? payload.webFetch : undefined,
        imageGenerate:
          typeof payload.imageGenerate === "boolean" ? payload.imageGenerate : undefined,
        replyPrivate: typeof payload.replyPrivate === "boolean" ? payload.replyPrivate : undefined,
        replyGroup: typeof payload.replyGroup === "boolean" ? payload.replyGroup : undefined,
        configRead: typeof payload.configRead === "boolean" ? payload.configRead : undefined,
        configWrite: typeof payload.configWrite === "boolean" ? payload.configWrite : undefined
      })
      return { ok: true, plugin: next }
    })
