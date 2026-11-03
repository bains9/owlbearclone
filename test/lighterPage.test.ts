// A lighter page (31 October 2026, Par: "do 1 to 5", the fifth being less to load): Konva without
// what the board never uses; the season code and Dungeon's objects loaded when they're first needed
// rather than with every page; and Dungeon's catalogue kept compactly.
import { describe, expect, it } from "vitest";
import { DUNGEON_PROPS } from "../src/shared/dungeonCatalog";
import type { DungeonStampId } from "../src/shared/terrain";
import { drawDungeonStamp, dungeonObjects, whenDungeonObjects } from "../src/client/room/dungeonStamps";

const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as {
  readFileSync(path: URL, encoding: "utf8"): string;
  statSync(path: URL): { size: number };
};
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** A drawing context that counts what's filled and stroked. */
function counting(): { c: CanvasRenderingContext2D; marks: () => number } {
  let marks = 0;
  const c = new Proxy({} as CanvasRenderingContext2D, {
    get(_, name) {
      if (name === "createRadialGradient" || name === "createLinearGradient") return () => ({ addColorStop: () => undefined });
      return (..._args: unknown[]) => {
        if (name === "fill" || name === "stroke" || name === "fillRect" || name === "strokeRect") marks++;
      };
    },
    set: () => true,
  });
  return { c, marks: () => marks };
}

describe("Konva, as the page has it", () => {
  it("has every shape the board makes", async () => {
    const { default: Konva } = await import("../src/client/konvaLite");
    const board = read("src/client/room/board.ts");
    const made = new Set([...board.matchAll(/new Konva\.([A-Z][A-Za-z]+)/g)].map((m) => m[1]));
    expect(made.size).toBeGreaterThan(5);
    for (const name of made) expect(typeof (Konva as unknown as Record<string, unknown>)[name], name).toBe("function");
    expect(read("vite.config.ts")).toContain('find: /^konva$/, replacement: fileURLToPath(new URL("./src/client/konvaLite.ts", import.meta.url))');
  });
});

describe("the season code", () => {
  it("isn't loaded with the page: only its keys are, and the rest when a page without the worker first needs it", () => {
    for (const file of ["src/client/room/board.ts", "src/client/room/mapData.ts", "src/client/room/seasons.ts", "src/client/ui/ddText.ts"]) {
      const text = read(file);
      expect(text, file).not.toMatch(/^import \{[^}]*\} from "\.\.?\/(room\/)?season(Pixels|Exact)";/m);
    }
    expect(read("src/client/room/seasons.ts")).toContain('loading ??= Promise.all([import("./seasonPixels"), import("./seasonExact")]);');
  });
});

describe("Dungeon's objects", () => {
  it("draw as nothing until they're loaded, which the first one drawn starts, and then as themselves", async () => {
    const id = `d:${DUNGEON_PROPS[0].id}` as DungeonStampId;
    expect(dungeonObjects()).toBeNull();
    const before = counting();
    drawDungeonStamp(before.c, id, null, 0, 0);
    expect(before.marks()).toBe(0);
    await new Promise<void>((done) => whenDungeonObjects(done));
    expect(dungeonObjects()).not.toBeNull();
    const after = counting();
    drawDungeonStamp(after.c, id, null, 0, 0);
    expect(after.marks()).toBeGreaterThan(0);
    // Nothing the page loads up front brings them in with it.
    expect(read("src/client/room/board.ts")).not.toContain('from "../dungeonLib/props"');
    expect(read("src/client/room/dungeonStamps.ts")).toContain('import type * as DungeonProps from "../dungeonLib/props";');
  });

  it("are listed compactly, a line each, by the library script", () => {
    expect(fs.statSync(new URL("../src/shared/dungeonCatalog.ts", import.meta.url)).size).toBeLessThan(170_000);
    expect(read("src/shared/dungeonCatalog.ts")).toContain("export const DUNGEON_PROPS: readonly DungeonPropInfo[] = PROP_LINES.split(");
    expect(read("scripts/sync-dungeon-library.mjs")).toContain("const propLines = props.map(");
  });
});
