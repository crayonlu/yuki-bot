<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import type { BotSettings, ImageModelConfig, ProviderPreset } from "@bot/shared";

  let settings: BotSettings | null = null;
  let providers: ProviderPreset[] = [];
  let saving = false;
  let message = "";
  let providerOpen = false;
  let imageModelRows: ImageModelConfig[] = [];
  let remoteModels: Array<{ id: string; displayName: string }> = [];
  let loadingModels = false;

  onMount(async () => {
    const data = await api.getSettings();
    settings = data.settings;
    providers = data.providers;
    imageModelRows = data.settings.imageModelConfigs.map((item) => ({ ...item }));
    if (imageModelRows.length === 0) {
      imageModelRows = [{ id: "seedream-5.0-lite", endpoint: "" }];
    }
    await loadRemoteModels();
  });

  const loadRemoteModels = async () => {
    const current = settings;
    if (!current) return;
    loadingModels = true;
    try {
      const result = await api.listRemoteModels({
        apiBaseUrl: current.apiBaseUrl,
        apiKey: current.apiKey
      });
      if (!result.ok) {
        message = result.error ?? "Load models failed";
        return;
      }
      remoteModels = result.models.map((item) => ({
        id: item.id,
        displayName: item.displayName
      }));
      if (!remoteModels.some((item) => item.id === current.model) && remoteModels[0]) {
        current.model = remoteModels[0].id;
      }
    } catch (error) {
      message = error instanceof Error ? error.message : "Load models failed";
    } finally {
      loadingModels = false;
    }
  };

  const looksLikeHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim());

  const applyImageRowsToSettings = () => {
    const current = settings;
    if (!current) return false;
    const deduped = new Map<string, ImageModelConfig>();
    for (const row of imageModelRows) {
      const id = row.id.trim();
      const endpoint = row.endpoint.trim();
      if (!id && !endpoint) continue;
      if (!id || !endpoint) {
        message = "Image model id and endpoint are both required";
        return false;
      }
      if (!looksLikeHttpUrl(endpoint)) {
        message = `Invalid endpoint for ${id}`;
        return false;
      }
      deduped.set(id, { id, endpoint });
    }
    const nextRows = [...deduped.values()];
    if (nextRows.length === 0) {
      message = "At least one image model is required";
      return false;
    }
    current.imageModelConfigs = nextRows;
    if (!nextRows.some((item) => item.id === current.defaultImageModel)) {
      current.defaultImageModel = nextRows[0].id;
    }
    return true;
  };

  const save = async () => {
    if (!settings) return;
    if (!applyImageRowsToSettings()) return;
    saving = true;
    try {
      const response = await api.updateSettings(settings);
      settings = response.settings;
      imageModelRows = response.settings.imageModelConfigs.map((item: ImageModelConfig) => ({
        ...item
      }));
      message = "Saved";
    } catch (error) {
      message = error instanceof Error ? error.message : "Save failed";
    } finally {
      saving = false;
    }
  };

  const onProviderChange = () => {
    if (!settings) return;
    const selected = providers.find((provider) => provider.id === settings?.providerId);
    if (!selected) return;
    settings.apiBaseUrl = selected.baseUrl;
    if (!settings.model.trim()) {
      settings.model = selected.models[0] ?? settings.model;
    }
    void loadRemoteModels();
  };

  const selectProvider = (providerId: string) => {
    if (!settings) return;
    settings.providerId = providerId;
    providerOpen = false;
    onProviderChange();
  };

  const addImageModel = () => {
    imageModelRows = [...imageModelRows, { id: "", endpoint: "" }];
  };

  const removeImageModel = (index: number) => {
    imageModelRows = imageModelRows.filter((_, i) => i !== index);
  };

  $: selectedProviderLabel =
    providers.find((provider) => provider.id === settings?.providerId)?.name ?? "Select provider";
</script>

{#if settings}
  <section>
    <h2>Settings</h2>
    <p class="muted">Configure model provider, request limits and runtime behavior.</p>
    <label>
      Provider
      <div class="custom-select">
        <button
          type="button"
          class="select-trigger"
          on:click|stopPropagation={() => (providerOpen = !providerOpen)}
          aria-expanded={providerOpen}
        >
          <span>{selectedProviderLabel}</span>
          <span class:arrow-open={providerOpen} class="arrow">▾</span>
        </button>
        {#if providerOpen}
          <div class="options">
            {#each providers as provider}
              <button
                type="button"
                class={`option ${settings.providerId === provider.id ? "active" : ""}`}
                on:click|stopPropagation={() => selectProvider(provider.id)}
              >
                {provider.name}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </label>
    <label>
      Model
      <div class="model-row">
        <select bind:value={settings.model}>
          {#if remoteModels.length === 0}
            <option value={settings.model}>{settings.model || "No models loaded"}</option>
          {:else}
            {#each remoteModels as model}
              <option value={model.id}>{model.displayName} ({model.id})</option>
            {/each}
          {/if}
        </select>
        <button type="button" on:click={loadRemoteModels} disabled={loadingModels}>
          {loadingModels ? "Loading..." : "Refresh"}
        </button>
      </div>
      <input bind:value={settings.model} placeholder="Custom model id (optional)" />
    </label>
    <label>
      API Base URL
      <input bind:value={settings.apiBaseUrl} />
    </label>
    <label>
      API Key
      <input type="password" bind:value={settings.apiKey} />
    </label>
    <label>
      Default Image Model
      <select bind:value={settings.defaultImageModel}>
        {#each imageModelRows as row}
          {#if row.id.trim()}
            <option value={row.id.trim()}>{row.id.trim()}</option>
          {/if}
        {/each}
      </select>
    </label>
    <div class="image-models">
      <span class="title">Image Model Endpoints</span>
      {#each imageModelRows as row, index}
        <div class="image-row">
          <input bind:value={row.id} placeholder="Model ID (e.g. seedream-5.0-lite)" />
          <input bind:value={row.endpoint} placeholder="Endpoint URL" />
          <button type="button" on:click={() => removeImageModel(index)}>Remove</button>
        </div>
      {/each}
      <button type="button" on:click={addImageModel}>Add Image Model</button>
    </div>
    <label>
      Request Timeout (ms)
      <input type="number" min="1000" step="1000" bind:value={settings.requestTimeoutMs} />
    </label>
    <label>
      Plugin Timeout (ms)
      <input type="number" min="100" step="100" bind:value={settings.pluginTimeoutMs} />
    </label>
    <label>
      Memory Max Turns
      <input type="number" min="1" max="50" step="1" bind:value={settings.memoryMaxTurns} />
    </label>
    <label>
      Reset Command
      <input bind:value={settings.chatResetCommand} placeholder="/clean" />
    </label>
    <label class="switch-row">
      <span>Web Fetch Enabled</span>
      <input type="checkbox" bind:checked={settings.webFetchEnabled} />
    </label>
    <label>
      Web Fetch Timeout (ms)
      <input type="number" min="1000" step="1000" bind:value={settings.webFetchTimeoutMs} />
    </label>
    <label>
      Web Fetch Max Bytes
      <input type="number" min="10000" step="10000" bind:value={settings.webFetchMaxBytes} />
    </label>
    <label>
      Web Fetch Max Redirects
      <input
        type="number"
        min="0"
        max="10"
        step="1"
        bind:value={settings.webFetchMaxRedirects}
      />
    </label>
    <label>
      Web Fetch Max URLs Per Message
      <input
        type="number"
        min="1"
        max="100"
        step="1"
        bind:value={settings.webFetchMaxUrlsPerMessage}
      />
    </label>
    <label class="switch-row">
      <span>Web Search Enabled</span>
      <input type="checkbox" bind:checked={settings.webSearchEnabled} />
    </label>
    <label>
      Web Search Timeout (ms)
      <input type="number" min="1000" step="1000" bind:value={settings.webSearchTimeoutMs} />
    </label>
    <label>
      Web Search Max Calls Per Message
      <input
        type="number"
        min="1"
        max="10"
        step="1"
        bind:value={settings.webSearchMaxCallsPerMessage}
      />
    </label>
    <label>
      Web Search Count Per Call
      <input type="number" min="1" max="50" step="1" bind:value={settings.webSearchCountPerCall} />
    </label>
    <label>
      Web Search Freshness
      <select bind:value={settings.webSearchFreshness}>
        <option value="noLimit">noLimit</option>
        <option value="oneDay">oneDay</option>
        <option value="oneWeek">oneWeek</option>
        <option value="oneMonth">oneMonth</option>
        <option value="oneYear">oneYear</option>
      </select>
    </label>
    <label class="switch-row">
      <span>Web Search Summary</span>
      <input type="checkbox" bind:checked={settings.webSearchSummary} />
    </label>
    <label class="switch-row">
      <span>Vision Enabled</span>
      <input type="checkbox" bind:checked={settings.visionEnabled} />
    </label>
    <label>
      Vision Model
      <input bind:value={settings.visionModel} placeholder="e.g. qwen/qwen2.5-vl-72b-instruct" />
    </label>
    <label>
      Vision Detail
      <select bind:value={settings.visionDetail}>
        <option value="auto">auto</option>
        <option value="low">low</option>
        <option value="high">high</option>
      </select>
    </label>
    <label>
      Vision Summary Max Chars
      <input type="number" min="100" max="4000" step="50" bind:value={settings.visionSummaryMaxChars} />
    </label>
    <label>
      Vision Evidence Lookback
      <input type="number" min="1" max="10" step="1" bind:value={settings.visionEvidenceLookback} />
    </label>
    <label>
      System Prompt
      <textarea rows="6" bind:value={settings.systemPrompt}></textarea>
    </label>
    <button on:click={save} disabled={saving}>
      {saving ? "Saving..." : "Save"}
    </button>
    {#if message}
      <small class="feedback">{message}</small>
    {/if}
  </section>
{:else}
  <p>Loading settings...</p>
{/if}

<svelte:window on:click={() => (providerOpen = false)} />

<style>
  .muted {
    margin: 0;
    color: #667085;
    font-size: 12px;
  }
  .feedback {
    color: #067647;
    font-weight: 600;
  }
  .custom-select {
    position: relative;
  }
  .select-trigger {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .arrow {
    transition: transform 0.15s ease;
  }
  .arrow-open {
    transform: rotate(180deg);
  }
  .options {
    position: absolute;
    z-index: 20;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    background: #fff;
    border: 1px solid #d0d5dd;
    border-radius: 10px;
    padding: 6px;
    display: grid;
    gap: 4px;
    box-shadow: 0 12px 24px rgba(16, 24, 40, 0.12);
  }
  .option {
    width: 100%;
    text-align: left;
    border-radius: 8px;
    border: 1px solid transparent;
    padding: 8px 10px;
  }
  .option.active {
    background: #eff4ff;
    border-color: #c7d7fe;
    color: #1849a9;
  }
  .switch-row {
    grid-template-columns: 1fr auto;
    align-items: center;
  }
  .switch-row input[type="checkbox"] {
    width: 18px;
    height: 18px;
  }
  .image-models {
    display: grid;
    gap: 8px;
  }
  .image-models .title {
    font-size: 12px;
    color: #475467;
    font-weight: 600;
  }
  .image-row {
    display: grid;
    grid-template-columns: 1fr 1.5fr auto;
    gap: 8px;
  }
  .model-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
  }
  @media (max-width: 768px) {
    button {
      width: 100%;
    }
    .model-row {
      grid-template-columns: 1fr;
    }
    .image-row {
      grid-template-columns: 1fr;
    }
  }
</style>
