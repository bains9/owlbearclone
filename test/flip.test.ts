import { describe, expect, it } from "vitest";
import { GUIDE } from "../src/client/guide";
import { inverseOps } from "../src/shared/ops";
import { sanitizeItem, sanitizeSet } from "../src/shared/sanitize";
import type { Item, TokenItem } from "../src/shared/types";

// Flipping a token: its picture mirrored left to right, so it faces the other way (Par: "a flip
// for tokens to get mirror ... in case I want my token facing the other way").

const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const token = { id: "tok1", sceneId: "scene1", kind: "token", x: 10, y: 10, size: 1, assetId: "asset1", color: "#ff0000", label: "Nancael" };

describe("a flipped token", () => {
  it("keeps being flipped, and isn't marked when it isn't", () => {
    expect((sanitizeItem({ ...token, flipped: true }, "@gm") as TokenItem).flipped).toBe(true);
    expect((sanitizeItem({ ...token, flipped: "yes" }, "@gm") as TokenItem).flipped).toBeUndefined();
    expect("flipped" in (sanitizeItem({ ...token, flipped: false }, "@gm") as TokenItem)).toBe(false);
  });

  it("can be flipped and flipped back, but a compass can't be flipped", () => {
    const item = sanitizeItem(token, "@gm") as Item;
    expect(sanitizeSet(item, { flipped: true })).toEqual({ flipped: true });
    expect(sanitizeSet(item, { flipped: false })).toEqual({ flipped: false });
    expect(sanitizeSet(item, { flipped: "yes" })).toBeNull();
    const compass = sanitizeItem({ ...token, assetId: null, art: "compass" }, "@gm") as Item;
    expect(sanitizeSet(compass, { flipped: true })).toBeNull();
  });

  it("is undone back to facing the way it did", () => {
    const item = sanitizeItem(token, "@gm") as Item;
    expect(inverseOps({ [item.id]: item }, { patch: [{ id: item.id, set: { flipped: true } }] })).toEqual({ patch: [{ id: item.id, set: { flipped: false } }] });
  });

  it("is flipped from the token's bar, the picture only, and is in What's new", async () => {
    const bar = await source("src/client/ui/SelectionBar.tsx");
    expect(bar).toContain('aria-label="Flip"');
    expect(bar).toContain("patch({ flipped: !t.flipped })");
    expect(await source("src/client/room/board.ts")).toContain("scaleX: flip");
    expect(GUIDE[0].parts[12].title).toBe("Flip a token to face the other way (29 October 2026)");
    expect(GUIDE[0].parts[12].steps.join(" ")).toContain("**Flip**");
  });
});
