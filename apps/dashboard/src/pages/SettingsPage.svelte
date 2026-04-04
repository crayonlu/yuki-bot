<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import type { BotSettings, ProviderPreset } from "@bot/shared";

  let settings: BotSettings | null = null;
  let providers: ProviderPreset[] = [];
  let saving = false;
  let message = "";
  let providerOpen = false;

  onMount(async () => {
    const data = await api.getSettings();
    settings = data.settings;
    providers = data.providers;
  });

  const save = async () => {
    if (!settings) return;
    saving = true;
    try {
      const response = await api.updateSettings(settings);
      settings = response.settings;
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
  };

  const selectProvider = (providerId: string) => {
    if (!settings) return;
    settings.providerId = providerId;
    providerOpen = false;
    onProviderChange();
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
      <input bind:value={settings.model} placeholder="gpt-4o-mini" />
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
      Request Timeout (ms)
      <input type="number" min="1000" step="1000" bind:value={settings.requestTimeoutMs} />
    </label>
    <label>
      Plugin Timeout (ms)
      <input type="number" min="100" step="100" bind:value={settings.pluginTimeoutMs} />
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
  @media (max-width: 768px) {
    button {
      width: 100%;
    }
  }
</style>
