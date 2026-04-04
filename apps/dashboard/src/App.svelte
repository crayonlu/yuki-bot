<script lang="ts">
  import { onMount } from "svelte";
  import OverviewPage from "./pages/OverviewPage.svelte";
  import SettingsPage from "./pages/SettingsPage.svelte";
  import PluginsPage from "./pages/PluginsPage.svelte";
  import LogsPage from "./pages/LogsPage.svelte";
  import { api } from "./lib/api";

  type TabId = "overview" | "settings" | "plugins" | "logs";
  let tab: TabId = "overview";
  let health = "checking";
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "settings", label: "Settings" },
    { id: "plugins", label: "Plugins" },
    { id: "logs", label: "Logs" }
  ];

  onMount(async () => {
    try {
      await api.health();
      health = "online";
    } catch {
      health = "offline";
    }
  });
</script>

<main>
  <header class="header-card">
    <div>
      <h1>Bot Dashboard</h1>
      <p>NapCat + server control center</p>
    </div>
    <small class={`status ${health}`}>Server: {health}</small>
  </header>

  <nav class="tabs">
    {#each tabs as item}
      <button class:active={tab === item.id} on:click={() => (tab = item.id)}>
        {item.label}
      </button>
    {/each}
  </nav>

  {#if tab === "overview"}
    <OverviewPage />
  {:else if tab === "settings"}
    <SettingsPage />
  {:else if tab === "plugins"}
    <PluginsPage />
  {:else}
    <LogsPage />
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: Inter, "Segoe UI", Arial, sans-serif;
    background: linear-gradient(180deg, #f4f6fb 0%, #f8f9fc 100%);
    color: #101828;
  }

  main {
    max-width: 1040px;
    margin: 0 auto;
    padding: 28px 20px 36px;
    display: grid;
    gap: 16px;
  }

  .header-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    border: 1px solid #e5e7eb;
    border-radius: 14px;
    background: #ffffff;
    box-shadow: 0 6px 20px rgba(16, 24, 40, 0.05);
  }

  h1 {
    margin: 0;
    font-size: clamp(30px, 5vw, 42px);
    line-height: 1;
    letter-spacing: -0.02em;
  }

  p {
    margin: 8px 0 0;
    color: #667085;
    font-size: 13px;
  }

  .tabs {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  :global(input),
  :global(textarea),
  :global(select) {
    border: 1px solid #d0d5dd;
    border-radius: 8px;
    padding: 9px 10px;
    font-size: 14px;
    background: #fff;
  }

  :global(select) {
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    padding-right: 34px;
    background-image: linear-gradient(45deg, transparent 50%, #667085 50%),
      linear-gradient(135deg, #667085 50%, transparent 50%),
      linear-gradient(to right, #eaecf0, #eaecf0);
    background-position: calc(100% - 16px) calc(50% + 1px), calc(100% - 11px) calc(50% + 1px),
      calc(100% - 32px) 50%;
    background-size: 5px 5px, 5px 5px, 1px 18px;
    background-repeat: no-repeat;
  }

  :global(select:disabled) {
    background-color: #f9fafb;
    color: #98a2b3;
    cursor: not-allowed;
  }

  :global(select option) {
    background: #ffffff;
    color: #101828;
    font-size: 14px;
  }

  :global(select option:checked) {
    background: #eff4ff;
    color: #1849a9;
  }

  :global(textarea) {
    min-height: 100px;
  }

  :global(input:focus),
  :global(textarea:focus),
  :global(select:focus) {
    outline: 2px solid #d1e0ff;
    border-color: #84adff;
  }

  :global(button) {
    background: #fff;
    cursor: pointer;
    border: 1px solid #d0d5dd;
    border-radius: 9px;
    color: #101828;
    padding: 8px 12px;
    font-weight: 600;
    transition: all 0.15s ease;
  }

  :global(button:hover) {
    background: #f9fafb;
    border-color: #b9c0cc;
  }

  :global(button:active) {
    transform: translateY(1px);
  }

  :global(button:disabled) {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .tabs button.active {
    background: #eff4ff;
    border-color: #84adff;
    color: #1849a9;
  }

  :global(section) {
    display: grid;
    gap: 12px;
    background: white;
    border-radius: 14px;
    padding: 18px;
    border: 1px solid #e5e7eb;
    box-shadow: 0 4px 16px rgba(16, 24, 40, 0.04);
  }

  :global(label) {
    display: grid;
    gap: 6px;
    font-size: 12px;
    color: #475467;
    font-weight: 600;
  }

  :global(table) {
    width: 100%;
    border-collapse: collapse;
    background: #fff;
    border: 1px solid #eaecf0;
    border-radius: 12px;
    overflow: hidden;
  }

  :global(.table-wrap) {
    overflow-x: auto;
  }

  :global(th),
  :global(td) {
    text-align: left;
    border-bottom: 1px solid #eaecf0;
    padding: 10px;
    vertical-align: top;
    font-size: 13px;
  }

  :global(th) {
    color: #475467;
    background: #f9fafb;
    font-weight: 700;
  }

  .status {
    border-radius: 999px;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .status.online {
    color: #067647;
    background: #ecfdf3;
    border: 1px solid #abefc6;
  }

  .status.offline {
    color: #b42318;
    background: #fef3f2;
    border: 1px solid #fecdca;
  }

  .status.checking {
    color: #344054;
    background: #f2f4f7;
    border: 1px solid #d0d5dd;
  }

  @media (max-width: 768px) {
    main {
      padding: 18px 12px 22px;
      gap: 12px;
    }

    .header-card {
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
      padding: 14px;
    }

    .tabs {
      gap: 6px;
    }

    .tabs button {
      flex: 1 1 calc(50% - 6px);
      min-width: 120px;
    }

    :global(section) {
      padding: 14px;
      border-radius: 12px;
    }

    :global(th),
    :global(td) {
      font-size: 12px;
      padding: 8px;
      white-space: nowrap;
    }
  }

  @media (max-width: 480px) {
    .tabs button {
      flex-basis: 100%;
    }
  }
</style>
