import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const apiProxyTarget =
  process.env.DASHBOARD_API_PROXY_TARGET ?? "http://localhost:3001";

export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      "/api": apiProxyTarget,
      "/health": apiProxyTarget
    }
  }
});
