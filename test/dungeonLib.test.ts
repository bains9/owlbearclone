import { describe, expect, it } from "vitest";
import { DUNGEON_MATERIALS, DUNGEON_PROPS } from "../src/shared/dungeonCatalog";
import { PROPS } from "../src/client/dungeonLib/props";
import { MATERIALS } from "../src/client/dungeonLib/textures";

// Dungeon's library, copied in by scripts/sync-dungeon-library.mjs: the copies must match
// Dungeon (when it's on this computer, next to Tabletop), and the catalogue the server uses
// must match the copies.

/** The library's files (as scripts/sync-dungeon-library.mjs picks them). */
const LIBRARY_FILE = /^(noise|color|textures|propkit|propvariants|library|scatter|props(-[a-z]+)?).ts$/;

async function fs() {
  return (await import(/* @vite-ignore */ "node:" + "fs")) as {
    readFileSync(path: URL, encoding: "utf8"): string;
    existsSync(path: URL): boolean;
    readdirSync(path: URL): string[];
  };
}

/** Dungeon's render folder: DUNGEON_DIR (as the sync script takes it), or Dungeon next to Tabletop. */
function dungeonRender(): URL {
  const dir = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.DUNGEON_DIR;
  if (dir) return new URL(`file:///${dir.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/?$/, "/")}src/render/`);
  return new URL("../../dungeon/src/render/", import.meta.url);
}

describe("Dungeon's library in Tabletop", () => {
  it("matches Dungeon's own files, when Dungeon is next to Tabletop", async () => {
    const { readFileSync, existsSync, readdirSync } = await fs();
    const dungeon = dungeonRender();
    if (!existsSync(new URL("props.ts", dungeon))) return; // A clone without Dungeon beside it.
    const files = readdirSync(dungeon).filter((f) => LIBRARY_FILE.test(f)).sort();
    expect(readdirSync(new URL("../src/client/dungeonLib/", import.meta.url)).sort(), "run node scripts/sync-dungeon-library.mjs").toEqual(files);
    for (const f of files) {
      const copy = readFileSync(new URL(`../src/client/dungeonLib/${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
      const source = readFileSync(new URL(f, dungeon), "utf8").replace(/\r\n/g, "\n");
      expect(copy.startsWith(`// Copied from Dungeon (src/render/${f})`), f).toBe(true);
      expect(copy.slice(copy.indexOf("\n") + 1), `${f} differs from Dungeon's: run node scripts/sync-dungeon-library.mjs`).toBe(source);
    }
  });

  it("lists every object in the catalogue, as the drawings have them", () => {
    expect(DUNGEON_PROPS.length).toBe(PROPS.length);
    expect(DUNGEON_PROPS.length).toBeGreaterThanOrEqual(1800);
    const byId = new Map(DUNGEON_PROPS.map((d) => [d.id, d]));
    for (const p of PROPS) expect(byId.get(p.id), p.id).toEqual({ id: p.id, name: p.name, category: p.category, group: p.group, w: p.w, h: p.h, layer: p.layer });
  });

  it("lists every texture in the catalogue", () => {
    expect(DUNGEON_MATERIALS.length).toBe(MATERIALS.length);
    for (const m of MATERIALS) expect(DUNGEON_MATERIALS.find((d) => d.id === m.id), m.id).toEqual({ id: m.id, name: m.name, group: m.group });
  });
});
