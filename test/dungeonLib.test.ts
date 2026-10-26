import { describe, expect, it } from "vitest";
import { DUNGEON_MATERIALS, DUNGEON_PROPS } from "../src/shared/dungeonCatalog";
import { PROPS } from "../src/client/dungeonLib/props";
import { MATERIALS } from "../src/client/dungeonLib/textures";

// Dungeon's library, copied in by scripts/sync-dungeon-library.mjs: the copies must match
// Dungeon (when it's on this computer, next to Tabletop), and the catalogue the server uses
// must match the copies.

const FILES = ["noise.ts", "color.ts", "textures.ts", "propkit.ts", "props.ts", "props-more.ts"];

async function fs() {
  return (await import(/* @vite-ignore */ "node:" + "fs")) as {
    readFileSync(path: URL, encoding: "utf8"): string;
    existsSync(path: URL): boolean;
  };
}

describe("Dungeon's library in Tabletop", () => {
  it("matches Dungeon's own files, when Dungeon is next to Tabletop", async () => {
    const { readFileSync, existsSync } = await fs();
    const dungeon = new URL("../../dungeon/src/render/", import.meta.url);
    if (!existsSync(new URL("props.ts", dungeon))) return; // A clone without Dungeon beside it.
    for (const f of FILES) {
      const copy = readFileSync(new URL(`../src/client/dungeonLib/${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
      const source = readFileSync(new URL(f, dungeon), "utf8").replace(/\r\n/g, "\n");
      expect(copy.startsWith(`// Copied from Dungeon (src/render/${f})`), f).toBe(true);
      expect(copy.slice(copy.indexOf("\n") + 1), `${f} differs from Dungeon's: run node scripts/sync-dungeon-library.mjs`).toBe(source);
    }
  });

  it("lists every object in the catalogue, as the drawings have them", () => {
    expect(DUNGEON_PROPS.length).toBe(PROPS.length);
    expect(DUNGEON_PROPS.length).toBeGreaterThanOrEqual(135);
    for (const p of PROPS) {
      const info = DUNGEON_PROPS.find((d) => d.id === p.id);
      expect(info, p.id).toEqual({ id: p.id, name: p.name, category: p.category, w: p.w, h: p.h, layer: p.layer });
    }
  });

  it("lists every texture in the catalogue", () => {
    expect(DUNGEON_MATERIALS.length).toBe(MATERIALS.length);
    for (const m of MATERIALS) expect(DUNGEON_MATERIALS.find((d) => d.id === m.id), m.id).toEqual({ id: m.id, name: m.name, group: m.group });
  });
});
