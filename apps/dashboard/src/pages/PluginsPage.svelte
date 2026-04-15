<script lang="ts">
  import { onMount } from "svelte";
  import type { PluginRuntimeState } from "@bot/shared";
  import { api } from "../lib/api";

  let plugins: PluginRuntimeState[] = [];
  let busyId = "";
  let savingPermId = "";
  let pluginId = "";
  let modulePath = "";
  let message = "";
  const permissionLabels: Array<keyof PluginRuntimeState["permissions"]> = [
    "llm",
    "webFetch",
    "webSearch",
    "visionAnalyze",
    "imageGenerate",
    "replyPrivate",
    "replyGroup",
    "configRead",
    "configWrite"
  ];

  const load = async () => {
    const data = await api.listPlugins();
    plugins = data.plugins;
  };

  onMount(load);

  const act = async (id: string, action: string) => {
    busyId = id;
    try {
      await api.pluginAction(id, action);
      await load();
      message = `${id}: ${action} done`;
    } finally {
      busyId = "";
    }
  };

  const togglePermission = async (
    plugin: PluginRuntimeState,
    perm: keyof PluginRuntimeState["permissions"]
  ) => {
    const next = !plugin.permissions[perm];
    savingPermId = plugin.id;
    try {
      const response = await api.updatePluginPermissions(plugin.id, { [perm]: next });
      if (!response.ok) {
        message = response.error ?? "permission update failed";
        return;
      }
      message = `${plugin.id}: ${perm} -> ${next ? "on" : "off"}`;
      await load();
    } finally {
      savingPermId = "";
    }
  };

  const register = async () => {
    if (!pluginId || !modulePath) {
      message = "pluginId and modulePath are required";
      return;
    }
    const response = await api.registerExternalPlugin(pluginId, modulePath);
    if (!response.ok) {
      message = response.error ?? "register failed";
      return;
    }
    pluginId = "";
    modulePath = "";
    message = "external plugin registered";
    await load();
  };
</script>

<section>
  <h2>Plugins</h2>
  <p class="muted">Built-in and external plugins can be loaded, reloaded, or disabled independently.</p>
  <div class="controls">
    <button on:click={load}>Refresh</button>
    <label>
      Plugin ID
      <input bind:value={pluginId} placeholder="external.example-hello" />
    </label>
    <label>
      Module Path
      <input bind:value={modulePath} placeholder="apps/server/plugins/example-hello.ts" />
    </label>
    <button on:click={register}>Register External Plugin</button>
  </div>
  {#if message}
    <small class="feedback">{message}</small>
  {/if}
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Status</th>
          <th>Permissions</th>
          <th>Error</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {#each plugins as plugin}
          <tr>
            <td><code>{plugin.id}</code></td>
            <td>
              <span class={`state ${plugin.enabled ? (plugin.loaded ? "running" : "enabled") : "disabled"}`}>
                {plugin.enabled ? (plugin.loaded ? "running" : "enabled") : "disabled"}
              </span>
            </td>
            <td>
              <div class="perms">
                {#each permissionLabels as perm}
                  <button
                    class={`perm ${plugin.permissions[perm] ? "on" : "off"}`}
                    disabled={savingPermId === plugin.id}
                    on:click={() => togglePermission(plugin, perm)}
                  >
                    {perm}
                  </button>
                {/each}
              </div>
            </td>
            <td><code>{plugin.lastError ?? "-"}</code></td>
            <td>
              <button on:click={() => act(plugin.id, "reload")} disabled={busyId === plugin.id}
                >Reload</button
              >
              <button
                on:click={() => act(plugin.id, plugin.enabled ? "disable" : "enable")}
                disabled={busyId === plugin.id}
              >
                {plugin.enabled ? "Disable" : "Enable"}
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<style>
  .muted {
    margin: 0;
    color: #667085;
    font-size: 12px;
  }
  .feedback {
    color: #1d4ed8;
    font-weight: 600;
  }
  .controls {
    display: grid;
    gap: 10px;
  }
  .state {
    display: inline-flex;
    border-radius: 999px;
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .state.running {
    color: #067647;
    background: #ecfdf3;
  }
  .state.enabled {
    color: #175cd3;
    background: #eff8ff;
  }
  .state.disabled {
    color: #344054;
    background: #f2f4f7;
  }
  .perms {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .perm {
    border-radius: 999px;
    font-size: 10px;
    line-height: 1;
    padding: 4px 7px;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    border: 1px solid transparent;
    cursor: pointer;
  }
  .perm.on {
    color: #1849a9;
    background: #eff4ff;
    border-color: #c7d7fe;
  }
  .perm.off {
    color: #667085;
    background: #f2f4f7;
    border-color: #eaecf0;
  }
  @media (max-width: 768px) {
    .controls {
      gap: 8px;
    }
    .perms {
      min-width: 220px;
    }
  }
</style>
