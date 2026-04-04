import { resolve, extname } from "node:path";
import { watch } from "node:fs";
import type { PluginManager } from "./pluginManager";

const VALID_EXTENSIONS = new Set([".js", ".ts", ".mjs"]);

export const setupPluginHotReload = (
  pluginDir: string,
  pluginManager: PluginManager
) => {
  const watcher = watch(pluginDir, async (_eventType, filename) => {
    if (!filename) return;
    const ext = extname(filename);
    if (!VALID_EXTENSIONS.has(ext)) return;

    const candidateId = filename.replace(ext, "");
    const pluginId = `external.${candidateId}`;
    const modulePath = resolve(pluginDir, filename);
    try {
      const states = pluginManager.list();
      const exists = states.some((item) => item.id === pluginId);
      if (exists) {
        await pluginManager.reload(pluginId);
      } else {
        await pluginManager.ensureExternalPlugin(pluginId, modulePath);
      }
    } catch {
      // Errors are already captured in plugin manager logs.
    }
  });
  return watcher;
};
