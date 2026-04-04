<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";

  type Metrics = {
    uptimeSec: number;
    pluginCount: number;
    memory: {
      rss: number;
      heapUsed: number;
      heapTotal: number;
    };
  };

  let metrics: Metrics | null = null;
  let loading = true;

  const fmtMb = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MB`;
  const fmtUptime = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}h ${m}m ${s}s`;
  };

  const refresh = async () => {
    loading = true;
    metrics = await api.metrics();
    loading = false;
  };

  onMount(() => {
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  });
</script>

<section>
  <h2>Overview</h2>
  <p class="muted">Auto refresh every 15s. Manual refresh is always available.</p>
  <button on:click={refresh} disabled={loading}>
    {loading ? "Refreshing..." : "Refresh Metrics"}
  </button>

  {#if metrics}
    <div class="grid">
      <article>
        <h3>Uptime</h3>
        <strong>{fmtUptime(metrics.uptimeSec)}</strong>
      </article>
      <article>
        <h3>Plugins</h3>
        <strong>{metrics.pluginCount}</strong>
      </article>
      <article>
        <h3>RSS</h3>
        <strong>{fmtMb(metrics.memory.rss)}</strong>
      </article>
      <article>
        <h3>Heap Used</h3>
        <strong>{fmtMb(metrics.memory.heapUsed)}</strong>
      </article>
    </div>
  {/if}
</section>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  article {
    border: 1px solid #ececec;
    border-radius: 10px;
    padding: 12px;
  }
  h3 {
    margin: 0 0 8px 0;
    font-size: 14px;
    color: #666;
  }
  .muted {
    margin: 0;
    color: #667085;
    font-size: 12px;
  }
  @media (max-width: 768px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
