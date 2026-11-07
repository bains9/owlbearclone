// The GM clicks a creature's dot in Initiative and it lights up on their map (6 November 2026), for when
// there's a crowd of them. Only the GM's own screen changes: a hidden creature mustn't be given away.
import { describe, expect, it } from "vitest";
import { GUIDE } from "../src/client/guide";
import { placeOfEntry } from "../src/client/initiative";
import type { Item } from "../src/shared/types";

const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then((t) => t.replace(/\r\n/g, "\n"));

const goblin = { id: "goblin000001", kind: "token", sceneId: "here" } as unknown as Item;
const drawing = { id: "line00000001", kind: "drawing", sceneId: "here" } as unknown as Item;
const items = { goblin000001: goblin, line00000001: drawing };
const scenes = { here: { name: "The bridge" }, there: { name: "The keep" } };

describe("where an entry's token is", () => {
  it("here, on the scene being looked at", () => {
    expect(placeOfEntry({ tokenId: "goblin000001" }, items, scenes, "here")).toEqual({ at: "here", token: goblin });
  });

  it("on another scene, by name", () => {
    expect(placeOfEntry({ tokenId: "goblin000001" }, items, scenes, "there")).toEqual({ at: "scene", sceneName: "The bridge" });
    expect(placeOfEntry({ tokenId: "goblin000001" }, items, {}, "there")).toEqual({ at: "scene", sceneName: "another scene" });
  });

  it("gone: deleted, never had one, or not a token", () => {
    expect(placeOfEntry({ tokenId: "deleted00001" }, items, scenes, "here")).toEqual({ at: "gone" });
    expect(placeOfEntry({ tokenId: null }, items, scenes, "here")).toEqual({ at: "gone" });
    expect(placeOfEntry({ tokenId: "line00000001" }, items, scenes, "here")).toEqual({ at: "gone" });
  });
});

describe("on the page", () => {
  it("the dot is a button for the GM alone, and only on a row with a token", async () => {
    const panel = await source("src/client/ui/InitiativePanel.tsx");
    expect(panel).toContain(`{gm && e.tokenId ? (\n                <button class="init-find"`);
    expect(panel).toContain(`onClick={() => find(e)}`);
    // Everyone else's stays a plain dot.
    expect(panel).toContain(`) : (\n                <span class="dot" style={{ background: e.color }} />`);
  });

  it("finding selects it, and gets the panel out of the way on a phone", async () => {
    const panel = await source("src/client/ui/InitiativePanel.tsx");
    const find = panel.slice(panel.indexOf("const find = (e: InitEntry)"), panel.indexOf("const add = (e: Event)"));
    expect(find).toContain("room.select([place.token.id]);");
    expect(find).toContain(`window.matchMedia("(max-width: 760px)").matches) room.setPanel(null)`);
    expect(find).toContain("room.board?.spotlight(place.token) === false");
    expect(find).toContain("isn't on the map any more");
    expect(find).toContain("is on another scene");
  });

  it("sends nothing: the rings are on this screen alone", async () => {
    const board = await source("src/client/room/board.ts");
    const body = board.slice(board.indexOf("spotlight(t: TokenItem): boolean"), board.indexOf("// ---------------------------------------------------------------- rendering"));
    expect(body).toContain(`this.addPing("spotlight", SPOTLIGHT_COLOR, t);`);
    expect(body).not.toContain("sendEph");
    expect(body).not.toContain("submit");
    const panel = await source("src/client/ui/InitiativePanel.tsx");
    const find = panel.slice(panel.indexOf("const find = (e: InitEntry)"), panel.indexOf("const add = (e: Event)"));
    expect(find).not.toContain("initiativeOp");
    expect(find).not.toContain("sendEph");
  });

  it("moves the map only for what's out of view, and not to a hidden one a table display would follow", async () => {
    const board = await source("src/client/room/board.ts");
    const body = board.slice(board.indexOf("spotlight(t: TokenItem): boolean"), board.indexOf("// ---------------------------------------------------------------- rendering"));
    expect(body).toContain("const followed = this.steering && this.room.state.players.some((p) => p.display);");
    expect(body).toContain("const stays = !inView && t.hidden && followed;");
    expect(body).toContain("if (!inView && !stays) this.centerOn(t);");
    expect(body).toContain("return !stays;");
  });

  it("says so in What's new and the guide", () => {
    const news = GUIDE.find((s) => s.id === "whats-new")!;
    const part = news.parts[0];
    expect(part.title).toContain("find a creature");
    expect(part.steps.join(" ")).toContain("coloured dot");
    expect(part.notes.join(" ")).toContain("Only you see it");
    const section = GUIDE.find((s) => s.id === "initiative")!;
    const guide = section.parts.find((p) => p.title === "Find a creature on the map (GM)")!;
    const words = [...guide.steps, ...guide.notes].join(" ");
    for (const phrase of ["coloured dot", "only if it's out of view", "eyes only", "another scene", "table display"]) expect(words).toContain(phrase);
  });
});
