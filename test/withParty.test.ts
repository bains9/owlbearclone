// NPCs that travel with the party (the ask, 22 November 2026: "the ability to add NPC tokens to the
// map moves"). The GM marks a token of theirs that isn't a character's, and Take the party here and
// the levels' Up and Down take it along with the characters' tokens, hidden or a prop as it may be.
import { describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { canTravel, inParty, partyOn, takeParty } from "../src/client/levels";
import { RoomClient } from "../src/client/room/client";
import { inverseOps } from "../src/shared/ops";
import { canCreate, canPatch, canReplace } from "../src/shared/permissions";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER, sanitizeItem, sanitizeSet } from "../src/shared/sanitize";
import type { Item, Player, Scene, TokenItem } from "../src/shared/types";

const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const token = (id: string, sceneId: string, over: Partial<TokenItem> = {}): TokenItem => ({
  id,
  sceneId,
  kind: "token",
  z: 1,
  owner: GM_OWNER,
  x: 175,
  y: 225,
  size: 1,
  rotation: 0,
  assetId: null,
  color: "#d62f2f",
  label: id,
  hidden: false,
  locked: false,
  rings: [],
  ...over,
});
const scene = (id: string): Scene => ({
  id,
  name: id,
  order: 0,
  mapAssetId: null,
  width: 1000,
  height: 1000,
  background: "#000000",
  grid: { ...DEFAULT_GRID, size: 50, offsetX: 0, offsetY: 0 },
  fogCover: false,
  createdAt: 0,
});
const gm = { userId: GM_OWNER, role: "gm" as const };
const player = { userId: "player1abcdef", role: "player" as const };
const settings = { ...DEFAULT_SETTINGS, playersMoveAll: true, playersCanAddTokens: true };

describe("a token that travels with the party", () => {
  it("is kept marked, and isn't marked when it isn't", () => {
    const plain = { id: "tok1", sceneId: "scene1", kind: "token", x: 10, y: 10, size: 1, color: "#ff0000", label: "Guide" };
    expect((sanitizeItem({ ...plain, withParty: true }, GM_OWNER) as TokenItem).withParty).toBe(true);
    expect((sanitizeItem({ ...plain, withParty: "yes" }, GM_OWNER) as TokenItem).withParty).toBeUndefined();
    expect("withParty" in (sanitizeItem({ ...plain, withParty: false }, GM_OWNER) as TokenItem)).toBe(false);
    // A compass never travels.
    expect("withParty" in (sanitizeItem({ ...plain, art: "compass", withParty: true }, GM_OWNER) as TokenItem)).toBe(false);
  });

  it("can be marked and unmarked, but a compass can't, and it's undone back to how it was", () => {
    const item = sanitizeItem({ id: "tok1", sceneId: "scene1", kind: "token", x: 10, y: 10 }, GM_OWNER) as Item;
    expect(sanitizeSet(item, { withParty: true })).toEqual({ withParty: true });
    expect(sanitizeSet(item, { withParty: false })).toEqual({ withParty: false });
    expect(sanitizeSet(item, { withParty: 1 })).toBeNull();
    const compass = sanitizeItem({ id: "c1", sceneId: "scene1", kind: "token", x: 10, y: 10, art: "compass" }, GM_OWNER) as Item;
    expect(sanitizeSet(compass, { withParty: true })).toBeNull();
    expect(inverseOps({ [item.id]: item }, { patch: [{ id: item.id, set: { withParty: true } }] })).toEqual({ patch: [{ id: item.id, set: { withParty: false } }] });
  });

  it("is marked by the GM only", () => {
    const npc = token("npc", "Town12345678");
    expect(canPatch(npc, { withParty: true }, gm, settings)).toBe(true);
    // Players who may move every token still can't mark one, put one down marked, or undo their way to it.
    expect(canPatch(npc, { withParty: true }, player, settings)).toBe(false);
    expect(canPatch(npc, { x: 300 }, player, settings)).toBe(true);
    expect(canCreate(token("mine", "Town12345678", { owner: player.userId, withParty: true }), player, settings)).toBe(false);
    expect(canReplace(npc, { ...npc, withParty: true }, player, settings)).toBe(false);
    expect(canReplace({ ...npc, withParty: true }, { ...npc, withParty: true, x: 300 }, player, settings)).toBe(true);
  });

  it("is offered on the GM's tokens that aren't already the party's", () => {
    expect(canTravel(token("npc", "Town12345678"))).toBe(true);
    expect(canTravel(token("cart", "Town12345678", { layer: "prop", hidden: true }))).toBe(true);
    expect(canTravel(token("hero", "Town12345678", { character: "1SheetAbcdefghij" }))).toBe(false);
    expect(canTravel(token("pc", "Town12345678", { owner: player.userId }))).toBe(false);
    expect(canTravel(token("n", "Town12345678", { art: "compass", layer: "prop" }))).toBe(false);
  });

  it("goes with the party, hidden or a prop, and the rest stay", () => {
    const items = {
      hero: token("hero", "Town12345678", { character: "1SheetAbcdefghij" }),
      pc: token("pc", "Town12345678", { owner: player.userId }),
      guide: token("guide", "Town12345678", { withParty: true }),
      spy: token("spy", "Town12345678", { withParty: true, hidden: true }),
      cart: token("cart", "Town12345678", { withParty: true, layer: "prop" }),
      orc: token("orc", "Town12345678"),
      hiddenOrc: token("hiddenOrc", "Town12345678", { hidden: true }),
      away: token("away", "Keep12345678", { withParty: true }),
    };
    expect(partyOn(items, "Town12345678", []).map((t) => t.id)).toEqual(["hero", "pc", "guide", "spy", "cart"]);
    expect(inParty(items.orc)).toBe(false);
    // Selected tokens on a level still go instead.
    expect(partyOn(items, "Town12345678", ["orc"]).map((t) => t.id)).toEqual(["orc"]);
  });

  it("is taken to another map with the characters, and arrives selected with them", () => {
    const room = new RoomClient("AbCdEf123456", { uid: GM_OWNER, name: "GM", color: "#ff0000" });
    const me: Player = { connId: "c1", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm" };
    const town = scene("Town12345678");
    const keep = scene("Keep12345678");
    const hero = token("hero", town.id, { character: "1SheetAbcdefghij", x: 175, y: 225 });
    const guide = token("guide", town.id, { withParty: true, x: 225, y: 225 });
    room.store.set({
      me,
      room: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS } },
      scenes: { [town.id]: town, [keep.id]: keep },
      viewSceneId: keep.id,
      activeSceneId: town.id,
      items: { hero, guide, orc: token("orc", town.id, { x: 500, y: 500 }) },
      selection: [],
    });
    const change = vi.spyOn(room, "change").mockImplementation(() => {});
    vi.spyOn(room, "activateScene").mockImplementation(() => {});
    expect(takeParty(room, town, keep, { at: { x: 512, y: 340 }, snap: true })).toBe(2);
    expect(change).toHaveBeenCalledWith({
      upsert: [
        { ...hero, sceneId: keep.id, x: 525, y: 325 },
        { ...guide, sceneId: keep.id, x: 575, y: 325 },
      ],
    });
    expect(room.state.selection).toEqual(["hero", "guide"]);
  });

  it("is marked from the token's bar, for one or several, by the GM", async () => {
    const bar = await source("src/client/ui/SelectionBar.tsx");
    expect(bar).toContain('aria-label="Travel with the party"');
    expect(bar).toContain("{canTravel(t) && (");
    expect(bar).toContain("patch({ withParty: !t.withParty })");
    expect(bar).toContain("<TravelButton tokens={tokens} />");
    expect(bar).toContain("set: { withParty: !all }");
  });
});

describe("in the guide", () => {
  const news = GUIDE.find((s) => s.id === "whats-new")!;
  const all = (id: string) => JSON.stringify(GUIDE.find((s) => s.id === id));

  it("leads What's new, and says how in Scenes and on the selection bar", () => {
    expect(news.intro).toContain("The latest updates came out on 22 November 2026.");
    expect(news.parts[1].title).toBe("GM: NPCs that travel with the party (22 November 2026)");
    const entry = JSON.stringify(news.parts[1]);
    expect(entry).toContain("**Travel with the party**");
    expect(entry).toContain("A hidden token goes along hidden");
    const scenes = all("scenes");
    expect(scenes).toContain("unless you mark them to travel with the party");
    expect(scenes).not.toContain("put one down on the new map to bring it along");
    expect(scenes).toContain("any token you've marked **Travel with the party**");
    expect(all("finding-your-way-around")).toContain("the footprints button, **Travel with the party**");
  });
});
