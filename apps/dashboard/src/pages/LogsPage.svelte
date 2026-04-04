<script lang="ts">
  import { onMount } from "svelte";
  import type { LogRecord } from "@bot/shared";
  import { api } from "../lib/api";

  let logs: LogRecord[] = [];
  let traceId = "";
  let level: "" | "debug" | "info" | "warn" | "error" = "";
  let keyword = "";
  let policyDeniedOnly = false;
  let loading = false;
  let hasMore = false;
  let nextOffset = 0;
  let copied = "";

  const load = async (append = false) => {
    loading = true;
    const data = await api.listLogs({
      limit: 50,
      offset: append ? nextOffset : 0,
      traceId,
      level,
      keyword,
      policyDenied: policyDeniedOnly
    });
    logs = append ? [...logs, ...data.logs] : data.logs;
    hasMore = data.hasMore;
    nextOffset = data.nextOffset;
    loading = false;
  };

  const applyFilters = async () => {
    nextOffset = 0;
    await load(false);
  };

  const copyText = async (text: string, hint: string) => {
    await navigator.clipboard.writeText(text);
    copied = hint;
    setTimeout(() => {
      if (copied === hint) copied = "";
    }, 1200);
  };

  onMount(load);
</script>

<section>
  <h2>Logs</h2>
  <p class="muted">Filter by trace id and level. Click copy to share exact trace quickly.</p>
  <div class="filters">
    <label>
      Trace ID
      <input bind:value={traceId} placeholder="Paste traceId to filter" />
    </label>
    <label>
      Keyword
      <input bind:value={keyword} placeholder="message/source/data contains..." />
    </label>
    <label>
      Level
      <select bind:value={level}>
        <option value="">all</option>
        <option value="debug">debug</option>
        <option value="info">info</option>
        <option value="warn">warn</option>
        <option value="error">error</option>
      </select>
    </label>
  </div>
  <div class="toolbar">
    <button on:click={applyFilters} disabled={loading}>
      {loading ? "Loading..." : "Apply Filters"}
    </button>
    <button
      class={policyDeniedOnly ? "is-on" : ""}
      on:click={async () => {
        policyDeniedOnly = !policyDeniedOnly;
        await applyFilters();
      }}
      disabled={loading}
    >
      {policyDeniedOnly ? "Policy Denied: ON" : "Policy Denied: OFF"}
    </button>
    {#if copied}
      <small class="feedback">{copied}</small>
    {/if}
  </div>
  <div class="log-list">
    {#each logs as item}
      <article>
        <header>
          <div class="meta">
            <strong class={`level ${item.level}`}>{item.level.toUpperCase()}</strong>
            {#if item.data?.includes('"code":"policy_denied"')}
              <span class="policy">policy_denied</span>
            {/if}
            <span class="source">{item.source}</span>
            <code>{item.traceId}</code>
          </div>
          <button class="copy" on:click={() => copyText(item.traceId, "traceId copied")}>
            Copy Trace
          </button>
        </header>
        <p>{item.message}</p>
        {#if item.data}
          <pre>{item.data}</pre>
        {/if}
      </article>
    {/each}
  </div>
  {#if hasMore}
    <button class="load-more" on:click={() => load(true)} disabled={loading}>
      {loading ? "Loading..." : "Load More"}
    </button>
  {/if}
</section>

<style>
  .muted {
    margin: 0;
    color: #667085;
    font-size: 12px;
  }
  .filters {
    display: grid;
    gap: 10px;
    grid-template-columns: 1fr 1fr 180px;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .feedback {
    color: #175cd3;
    font-weight: 600;
    font-size: 12px;
  }
  .is-on {
    background: #eef4ff;
    border-color: #b2ccff;
    color: #1d4ed8;
  }
  .load-more {
    justify-self: start;
  }
  .log-list {
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  article {
    border: 1px solid #eaecf0;
    border-radius: 10px;
    padding: 12px;
    background: #fff;
    min-width: 0;
  }
  header {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
    font-size: 12px;
  }
  .meta {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    min-width: 0;
  }
  .meta code {
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .source {
    color: #475467;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  p {
    margin: 10px 0 0;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  pre {
    background: #f9fafb;
    border: 1px solid #eaecf0;
    border-radius: 8px;
    padding: 10px;
    overflow-x: auto;
    max-height: 260px;
  }
  .copy {
    padding: 4px 8px;
    font-size: 11px;
    width: auto;
    flex-shrink: 0;
  }
  .level {
    border-radius: 999px;
    padding: 2px 8px;
  }
  .level.debug {
    background: #f2f4f7;
    color: #475467;
  }
  .level.info {
    background: #eff8ff;
    color: #175cd3;
  }
  .level.warn {
    background: #fffaeb;
    color: #b54708;
  }
  .level.error {
    background: #fef3f2;
    color: #b42318;
  }
  .policy {
    border-radius: 999px;
    padding: 2px 8px;
    background: #fff1f3;
    color: #9f1239;
    font-size: 11px;
    font-weight: 700;
  }
  @media (max-width: 768px) {
    .filters {
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .toolbar {
      align-items: stretch;
    }
    .toolbar :global(button) {
      width: 100%;
    }
    header {
      flex-direction: column;
      align-items: stretch;
      gap: 10px;
    }
    .meta {
      gap: 6px;
    }
    .source {
      max-width: 100%;
    }
    .copy {
      width: 100%;
    }
    article {
      padding: 10px;
    }
    pre {
      font-size: 12px;
      max-height: 220px;
      white-space: pre-wrap;
      word-break: break-word;
    }
  }
</style>
