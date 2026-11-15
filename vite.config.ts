import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { readLocal } from "./scripts/local.mjs";

/**
 * This table's own Worker settings: the "wrangler" part of local.jsonc (scripts/local.mjs), a
 * file that is never committed. It's laid over wrangler.jsonc whenever the app is built or run
 * here, so the code itself names no table's address. A setting in it replaces wrangler.jsonc's,
 * and a list (routes, r2_buckets) is added to wrangler.jsonc's. Nothing, on a checkout without
 * the file: the app as wrangler.jsonc alone describes it.
 */
function ownSettings(): Record<string, unknown> | null {
  const local = readLocal(fileURLToPath(new URL(".", import.meta.url)));
  return local && Object.keys(local.wrangler).length ? local.wrangler : null;
}

/**
 * A fingerprint of everything the build is made from: the source, the packages (their exact
 * versions in the lock file), this config and the page. The browser code and the server are
 * built from the same files, so they get the same id (this config is loaded once per build,
 * so a timestamp wouldn't match); a tab whose id differs from the server's is out of date and
 * is told to reload (see src/shared/build.ts).
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
  // A change to any of these can rename the built files without touching src/.
  for (const file of ["package.json", "package-lock.json", "vite.config.ts", "index.html", "look3d.html"]) {
    hash.update(file).update(readFileSync(join(root, file)));
  }
  return hash.digest("base64url").slice(0, 12);
}

const own = ownSettings();

export default defineConfig({
  plugins: [cloudflare(own ? { config: own } : {})],
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  resolve: {
    // Konva without the filters and shapes the board never uses (src/client/konvaLite.ts).
    alias: [{ find: /^konva$/, replacement: fileURLToPath(new URL("./src/client/konvaLite.ts", import.meta.url)) }],
  },
  oxc: {
    jsx: { runtime: "automatic", importSource: "preact" },
  },
  build: {
    chunkSizeWarningLimit: 800,
  },
  environments: {
    // The browser's pages (not the Worker's): the app, and Dungeon's builder's 3D view
    // (look3d.html), which Dungeon frames.
    client: {
      build: {
        rollupOptions: {
          input: {
            main: fileURLToPath(new URL("./index.html", import.meta.url)),
            look3d: fileURLToPath(new URL("./look3d.html", import.meta.url)),
          },
        },
      },
    },
  },
});
