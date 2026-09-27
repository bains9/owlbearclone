import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [cloudflare()],
  oxc: {
    jsx: { runtime: "automatic", importSource: "preact" },
  },
  build: {
    chunkSizeWarningLimit: 800,
  },
});
