import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

/**
 * A fingerprint of the source. The browser code and the server are built from the same
 * files, so they get the same id (this config is loaded once per build, so a timestamp
 * wouldn't match); a tab whose id differs from the server's is out of date and is told
 * to reload (see src/shared/build.ts).
 */
function buildId(): string {
  const root = fileURLToPath(new URL(".", import.meta.url));
  const hash = createHash("sha256");
  const add = (dir: string) => {
    const entries = readdirSync(join(root, dir), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      const path = `${dir}/${e.name}`;
      if (e.isDirectory()) add(path);
      else hash.update(path).update(readFileSync(join(root, path)));
    }
  };
  add("src");
  hash.update(readFileSync(join(root, "package.json")));
  return hash.digest("base64url").slice(0, 12);
}

export default defineConfig({
  plugins: [cloudflare()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  oxc: {
    jsx: { runtime: "automatic", importSource: "preact" },
  },
  build: {
    chunkSizeWarningLimit: 800,
  },
});
