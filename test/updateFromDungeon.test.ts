import { describe, expect, it, vi } from "vitest";

// The seasons data is compiled against the picture, which needs a browser: here a stand-in
// compiles it, and the upload hands back an id, so the update's handling of Dungeon's map data
// (replaced, the GM's choices kept, the old one deleted) is what's tested.
let sidecars = 0;
vi.mock("../src/client/dd/attach", async (actual) => ({
  ...(await actual<typeof import("../src/client/dd/attach")>()),
  prepareAttach: vi.fn(async () => ({
    report: { levels: [], level: null, placed: true, fit: { verdict: "yes" }, warnings: [], gridPxPerSquare: 128 },
    sidecar: new Blob(["{}"]),
  })),
  uploadSidecar: vi.fn(async () => ({ id: `side${++sidecars}` })),
}));

const { applyDungeonUpdate, detailOf, importFiles, isDungeonScene, noteWidth, planDungeonUpdate, readDungeonFile, unusedAssets, updatePatch, withPairs } = await import("../src/client/importScenes");
const { dungeonLevelNames } = await import("../src/client/mapImport");
const { RoomClient } = await import("../src/client/room/client");
const { DEFAULT_GRID, sanitizeScene } = await import("../src/shared/sanitize");
const { playerScene } = await import("../src/worker/playerView");
const { applyOps, isEmptyOps } = await import("../src/shared/ops");
import type { Asset, DrawingItem, Item, Scene, SceneDungeon } from "../src/shared/types";
import type { ItemOps } from "../src/shared/protocol";
import type { MapFile } from "../src/client/mapImport";

// Update from Dungeon (importScenes.ts): one bring-in's scenes get their levels' new pictures in
// place. Levels are matched by name; a scene showing a picture of the GM's own is left alone; the
// picture is fitted to the scene's squares as measured from the picture it had; the GM's choices
// on the map data stay; the old pictures and data go once nothing uses them, and undo forgets them.

type Fs = { readFileSync(path: string | URL, encoding: "utf8"): string };
const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as Fs;
// Dungeon's three-level fixture: Ground floor, Cellar, Crypt, 36 × 24 squares at 128 pixels.
const FIXTURE = fs.readFileSync(new URL("./fixtures/dungeon-levels.dd2vtt", import.meta.url), "utf8");
type Level = Record<string, any>;
/** The fixture with its levels as given (by name), each its own copy; `texts`: labels added to a level, by its name. */
function fileOf(names: string[], texts: Record<string, Level[]> = {}): File {
  const data = JSON.parse(FIXTURE) as Level;
  const all: Level[] = [data, ...data.dungeon_levels].map((l) => JSON.parse(JSON.stringify({ ...l, dungeon_levels: undefined })));
  const byName = new Map(all.map((l) => [l.dungeon.levelName as string, l]));
  const levels = names.map((n) => {
    const l = JSON.parse(JSON.stringify(byName.get(n) ?? all[0]));
    l.dungeon.levelName = n;
    l.dungeon.texts = [...l.dungeon.texts, ...(texts[n] ?? [])];
    return l;
  });
  const [first, ...rest] = levels;
  return new File([JSON.stringify(rest.length ? { ...first, dungeon_levels: rest } : first)], "Old Keep.dd2vtt", { type: "application/json" });
}

const MAP = "keepkeepkeep";
const BATCH = "batchbatchbb";
const NAMES = ["Ground floor", "Cellar", "Crypt"];

function linked(id: string, index: number, asset: string, extra: Partial<Scene> = {}, link: Partial<SceneDungeon> = {}): Scene {
  return {
    id,
    name: `Keep: ${NAMES[index]}`,
    order: index,
    mapAssetId: asset,
    width: 36 * 128,
    height: 24 * 128,
    background: "#1b1e24",
    grid: { ...DEFAULT_GRID, size: 128 },
    fogCover: true,
    createdAt: 1,
    mapRect: [0, 0, 36, 24],
    mapData: { assetId: `${asset}-data`, forAssetId: asset, from: "dungeon" },
    dungeon: { map: MAP, batch: BATCH, level: NAMES[index], index, levels: NAMES, asset, ...link },
    ...extra,
  };
}

/** A stand-in room. Uploads come back at `scale` of their size, as a smaller detail would. */
function fakeRoom(scenes: Scene[], scale = 1, status = "open") {
  const state = {
    scenes: Object.fromEntries(scenes.map((s) => [s.id, s])) as Record<string, Scene>,
    items: {} as Record<string, Item>,
    me: { userId: "@gm" },
    room: { settings: { metric: false } },
    status,
  };
  const deleted: string[] = [];
  const forgotten: string[][] = [];
  /** Every change to items, in order, and whether it could be undone. */
  const changes: { ops: ItemOps; undoable: boolean }[] = [];
  let n = 0;
  const room = {
    state,
    change: (ops: ItemOps, undoable = true) => {
      if (isEmptyOps(ops)) return;
      changes.push({ ops, undoable });
      state.items = applyOps(state.items, ops);
    },
    nextZ: (sceneId: string, kind: string) =>
      Math.max(0, ...Object.values(state.items).filter((i) => i.sceneId === sceneId && i.kind === kind).map((i) => i.z + 1)),
    uploadMaps: async (maps: MapFile[]) =>
      maps.map((map) => {
        const source = { width: 36 * 128, height: 24 * 128 };
        return { asset: { id: `new${++n}`, width: source.width * scale, height: source.height * scale } as Asset, source, map };
      }),
    // Merged as the server does it (sanitizeScene with the scene as it was).
    updateScene: (id: string, patch: Record<string, unknown>) => {
      const next = sanitizeScene({ ...patch, id }, state.scenes[id]);
      if (next) state.scenes[id] = next;
    },
    createScene: (s: Scene) => {
      state.scenes[s.id] = s;
    },
    deleteAsset: (id: string) => deleted.push(id),
    forgetPictures: (ids: ReadonlySet<string>) => forgotten.push([...ids].sort()),
  };
  return { room: room as unknown as InstanceType<typeof RoomClient>, state, deleted, forgotten, changes };
}

async function update(
  scenes: Scene[],
  names: string[],
  opts: { scale?: number; status?: string; bringIn?: number[]; lighting?: boolean; meanwhile?: (state: { scenes: Record<string, Scene> }) => void } = {},
) {
  const r = fakeRoom(scenes, opts.scale, opts.status);
  const drawing = await readDungeonFile(fileOf(names), "Old Keep");
  const plan = planDungeonUpdate(Object.values(r.state.scenes).filter((s) => s.dungeon?.batch === BATCH), drawing.levels);
  opts.meanwhile?.(r.state);
  const result = await applyDungeonUpdate(r.room, plan, drawing, { lighting: opts.lighting ?? false, covered: true, bringIn: new Set(opts.bringIn ?? []) });
  return { ...r, plan, result };
}

describe("Update from Dungeon", () => {
  it("gives each scene its own level's new picture, and Dungeon's new map data", async () => {
    const { state, deleted, forgotten, plan, result } = await update([linked("g", 0, "oldG"), linked("c", 1, "oldC"), linked("k", 2, "oldK")], NAMES, { lighting: true });
    expect(plan.unusual).toBe(false);
    expect(result.notes).toEqual([]);
    expect(state.scenes.g).toMatchObject({ mapAssetId: "new1", name: "Keep: Ground floor", width: 4608, height: 3072 });
    expect(state.scenes.c.mapAssetId).toBe("new2");
    expect(state.scenes.k.mapAssetId).toBe("new3");
    expect(state.scenes.g.dungeon).toEqual({ map: MAP, batch: BATCH, level: "Ground floor", index: 0, levels: NAMES, asset: "new1", lighting: true });
    expect(state.scenes.g.mapData).toMatchObject({ forAssetId: "new1", from: "dungeon" });
    expect(deleted.sort()).toEqual(["oldC", "oldC-data", "oldG", "oldG-data", "oldK", "oldK-data"]);
    expect(forgotten).toEqual([["c", "g", "k"]]);
  });

  it("matches levels by name, so a level added in Dungeon doesn't move the scenes below it", async () => {
    const names = ["Ground floor", "Mezzanine", "Cellar", "Crypt"];
    const { state, plan, result } = await update([linked("g", 0, "oldG"), linked("c", 1, "oldC"), linked("k", 2, "oldK")], names, { bringIn: [1] });
    expect(plan.unusual).toBe(true);
    expect(plan.unplaced).toEqual([{ level: 1, name: "Mezzanine", isNew: true }]);
    expect([state.scenes.g, state.scenes.c, state.scenes.k].map((s) => [s.dungeon?.level, s.dungeon?.index, s.mapAssetId])).toEqual([
      ["Ground floor", 0, "new1"],
      ["Cellar", 2, "new3"],
      ["Crypt", 3, "new4"],
    ]);
    expect(result.added.map((s) => [s.name, s.mapAssetId, s.dungeon?.batch, s.dungeon?.level])).toEqual([["Old Keep: Mezzanine", "new2", BATCH, "Mezzanine"]]);
  });

  it("leaves a scene whose level is gone, and keeps its picture", async () => {
    const { state, deleted, plan, result } = await update([linked("g", 0, "oldG"), linked("k", 2, "oldK")], ["Ground floor", "Cellar"]);
    expect(plan.left.map((l) => [l.scene.id, l.why])).toEqual([["k", "gone"]]);
    // The Cellar's scene was deleted here, so it's offered, not brought back by itself.
    expect(plan.unplaced).toEqual([{ level: 1, name: "Cellar", isNew: false }]);
    expect(result.added).toEqual([]);
    expect(state.scenes.k.mapAssetId).toBe("oldK");
    expect(result.notes).toEqual(['Keep: Crypt: Dungeon\'s map has no level called "Crypt" any more, so the scene stays as it was.']);
    expect(deleted).not.toContain("oldK");
  });

  it("never touches, or deletes, a picture the GM put on a scene", async () => {
    const own = linked("g", 0, "oldG", { mapAssetId: "gmsOwnPainting", mapData: undefined });
    expect(isDungeonScene(own)).toBe(false);
    const { state, deleted, result } = await update([own, linked("c", 1, "oldC")], NAMES);
    expect(state.scenes.g.mapAssetId).toBe("gmsOwnPainting");
    expect(deleted).not.toContain("gmsOwnPainting");
    expect(state.scenes.c.mapAssetId).not.toBe("oldC");
    expect(result.notes).toContain("Keep: Ground floor shows a picture of your own, so it was left as it is.");
  });

  it("fits the new picture to the squares the scene had, and leaves the grid as the GM set it", async () => {
    // Re-gridded by hand (5-ft squares on a 10-ft map), and hex: the picture still measures 128 a square.
    const grid = { ...DEFAULT_GRID, type: "hex-flat" as const, size: 64, offsetX: 7 };
    const { state } = await update([linked("g", 0, "oldG", { grid })], ["Ground floor", "Cellar"], { scale: 100 / 128 });
    expect(state.scenes.g.mapAssetId).toBe("new1");
    expect([state.scenes.g.width, state.scenes.g.height]).toEqual([4608, 3072]);
    expect(state.scenes.g.grid).toEqual(grid);
  });

  it("asks Dungeon for the detail the picture had, not the grid's", () => {
    const scene = linked("g", 0, "oldG", { grid: { ...DEFAULT_GRID, size: 64 } });
    expect(detailOf(scene, { oldG: { id: "oldG", width: 36 * 150 } as Asset })).toBe(150);
    expect(detailOf(scene, {})).toBe(64);
  });

  it("keeps the GM's choices on the map data", async () => {
    const mapData = { assetId: "oldG-data", forAssetId: "oldG", from: "dungeon" as const, drawn: "winter" as const, bare: "leaf" as const, packs: "guess" as const };
    const { state } = await update([linked("g", 0, "oldG", { mapData })], ["Ground floor", "Cellar"]);
    expect(state.scenes.g.mapData).toMatchObject({ forAssetId: "new1", from: "dungeon", drawn: "winter", bare: "leaf", packs: "guess" });
  });

  it("skips a scene deleted while Dungeon drew, keeping its picture", async () => {
    const { deleted, result } = await update([linked("g", 0, "oldG"), linked("c", 1, "oldC")], NAMES, { meanwhile: (s) => delete s.scenes.c });
    expect(result.updated.map((s) => s.id)).toEqual(["g"]);
    expect(deleted).not.toContain("oldC");
  });

  it("keeps the old pictures when Tabletop isn't connected, and says so", async () => {
    const { state, deleted, result } = await update([linked("g", 0, "oldG")], ["Ground floor", "Cellar"], { status: "reconnecting" });
    expect(state.scenes.g.mapAssetId).toBe("new1");
    expect(deleted).toEqual([]);
    expect(result.notes).toEqual(["Tabletop wasn't connected, so the old pictures were kept. Delete them from Uploaded maps if you like."]);
  });

  it("keeps a picture another scene still uses", async () => {
    const copy: Scene = { ...linked("x", 0, "oldG"), dungeon: undefined };
    const { state, deleted } = await update([linked("g", 0, "oldG"), copy], ["Ground floor", "Cellar"]);
    expect(state.scenes.g.mapAssetId).toBe("new1");
    // The copy still shows the old picture, with its data.
    expect(deleted).toEqual([]);
  });

  it("matches a one-level map's scene to the first level once the map has more", async () => {
    const one = linked("o", 0, "oldO", {}, { level: "", levels: [""] });
    const { state, plan } = await update([one], ["Ground floor", "Cellar"]);
    expect(plan.matched.map((m) => [m.scene.id, m.level])).toEqual([["o", 0]]);
    // From now on it's known by its level's name, so reordering the levels later can't mix it up.
    expect(state.scenes.o.dungeon).toMatchObject({ level: "Ground floor", index: 0, levels: ["Ground floor", "Cellar"] });
  });

  it("guesses that a level gone and a new one in its place are the same level renamed, and the GM can pair them", async () => {
    const r = fakeRoom([linked("g", 0, "oldG"), linked("c", 1, "oldC")]);
    const drawing = await readDungeonFile(fileOf(["Ground floor", "Wine cellar"]), "Old Keep");
    const plan = planDungeonUpdate(Object.values(r.state.scenes), drawing.levels);
    expect(plan.left.map((l) => [l.scene.id, l.why, l.guess])).toEqual([["c", "gone", 1]]);
    const paired = withPairs(plan, new Map([["c", 1]]));
    expect(paired.left).toEqual([]);
    expect(paired.unplaced).toEqual([]);
    const result = await applyDungeonUpdate(r.room, paired, drawing, { lighting: false, covered: true, bringIn: new Set() });
    expect(result.added).toEqual([]);
    expect(r.state.scenes.c.dungeon).toMatchObject({ level: "Wine cellar", index: 1 });
    expect(r.deleted).toContain("oldC");
  });

  it("doesn't stop to ask about a level whose scene was deleted here, when nothing changed in Dungeon", async () => {
    const r = fakeRoom([linked("g", 0, "oldG"), linked("k", 2, "oldK")]);
    const drawing = await readDungeonFile(fileOf(NAMES), "Old Keep");
    const plan = planDungeonUpdate(Object.values(r.state.scenes), drawing.levels);
    expect(plan.unplaced).toEqual([{ level: 1, name: "Cellar", isNew: false }]);
    expect(plan.unusual).toBe(false);
  });

  it("deletes what it uploaded for a scene that went while Dungeon drew", async () => {
    const { deleted } = await update([linked("g", 0, "oldG"), linked("c", 1, "oldC")], NAMES, { meanwhile: (s) => delete s.scenes.c });
    expect(deleted).toContain("new2");
    expect(deleted).not.toContain("new1");
  });

  it("finds levels' names in Dungeon's map data, and the pictures nothing uses", async () => {
    expect(dungeonLevelNames(await fileOf(["Ground floor", "Cellar"]).text())).toEqual(["Ground floor", "Cellar"]);
    const single = JSON.parse(await fileOf(["Ground floor"]).text());
    delete single.dungeon.levelName;
    expect(dungeonLevelNames(JSON.stringify(single))).toEqual([""]);
    const scenes = [linked("a", 0, "p1"), linked("b", 1, "p2", { mapData: undefined })];
    expect(unusedAssets(["p1", "p3", "p1-data", "d2", null, undefined, "p3"], scenes)).toEqual(["p3", "d2"]);
  });

  it("makes no change to the grid", async () => {
    const [map] = (await readDungeonFile(fileOf(["Ground floor"]))).maps;
    const scene = linked("g", 0, "old") as Scene & { dungeon: SceneDungeon };
    const patch = updatePatch(scene, { asset: { id: "n", width: 2304, height: 1536 } as Asset, source: { width: 4608, height: 3072 }, map }, null, { index: 0, levels: NAMES });
    expect(patch).toMatchObject({ mapAssetId: "n", width: 4608, height: 3072, mapData: null, mapRect: [0, 0, 36, 24] });
    expect(patch).not.toHaveProperty("grid");
  });
});

describe("undo after an update", () => {
  function client(scene: Scene) {
    const room = new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });
    room.store.set({
      me: { connId: "c1", userId: "@gm", name: "GM", color: "#ff0000", role: "gm" },
      scenes: { [scene.id]: scene },
      viewSceneId: scene.id,
      activeSceneId: scene.id,
      items: {},
    });
    return room;
  }

  it("brings the link back with the picture when a picture swap is undone", () => {
    const room = client(linked("scene1", 0, "map1"));
    room.changeScene("scene1", { mapAssetId: "mine" }, {});
    expect(room.state.scenes.scene1.dungeon ?? null).toBeNull();
    room.undo();
    expect(room.state.scenes.scene1).toMatchObject({ mapAssetId: "map1", dungeon: { asset: "map1" } });
  });

  it("drops a step that was only the old picture, so Ctrl+Z doesn't do nothing", () => {
    const room = client(linked("scene1", 0, "map1"));
    room.changeScene("scene1", { width: 5000 }, {});
    room.forgetPictures(new Set(["scene1"]));
    expect(room.state.canUndo).toBe(false);
  });

  it("still undoes the fog, but never puts back the picture that was deleted", () => {
    const room = new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });
    const scene = linked("scene1", 0, "map1", { fogCover: false });
    room.store.set({
      me: { connId: "c1", userId: "@gm", name: "GM", color: "#ff0000", role: "gm" },
      scenes: { scene1: scene },
      viewSceneId: "scene1",
      activeSceneId: "scene1",
      items: {},
    });
    room.resetFog("scene1", true);
    // The update: a new picture, then undo told to forget the old one.
    room.updateScene("scene1", { mapAssetId: "map2", width: 2000 });
    room.forgetPictures(new Set(["scene1"]));
    room.undo();
    expect(room.state.scenes.scene1).toMatchObject({ mapAssetId: "map2", width: 2000, fogCover: false });
  });
});

describe("a scene's link to Dungeon", () => {
  const base = linked("aaaaaaaaaaaa", 1, "bbbbbbbbbbbb");
  const link = base.dungeon!;

  it("is kept when it's well made, and only with the picture it names", () => {
    expect(sanitizeScene(base)?.dungeon).toEqual(link);
    expect(sanitizeScene({ ...base, mapAssetId: "cccccccccccc" })?.dungeon).toBeUndefined();
    for (const bad of [{ ...link, map: "../x" }, { ...link, batch: 1 }, { ...link, index: -1 }, { ...link, levels: "Cellar" }, { ...link, asset: "!" }, "keep"]) {
      expect(sanitizeScene({ ...base, dungeon: bad })?.dungeon, JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("ends when the picture changes or it's taken off, and stays through other changes", () => {
    const existing = sanitizeScene(base)!;
    expect(sanitizeScene({ id: base.id, name: "Renamed" }, existing)?.dungeon).toEqual(link);
    expect(sanitizeScene({ id: base.id, mapAssetId: "cccccccccccc" }, existing)?.dungeon).toBeUndefined();
    expect(sanitizeScene({ id: base.id, dungeon: null }, existing)?.dungeon).toBeUndefined();
    // Update from Dungeon brings its own with the new picture.
    expect(sanitizeScene({ id: base.id, mapAssetId: "cccccccccccc", dungeon: { ...link, asset: "cccccccccccc" } }, existing)?.dungeon?.asset).toBe("cccccccccccc");
  });

  it("isn't sent to players", () => {
    expect(playerScene(base)).not.toHaveProperty("dungeon");
  });
});

// ---------------------------------------------------------------- labels only the GM sees

// Dungeon's "Only the GM sees this" on a label leaves it out of the picture; Table makes it a note
// only the GM sees (a hidden text drawing), linked to its label by Dungeon's id for it, so Update
// from Dungeon changes, adds and removes notes rather than adding copies.

const gmLabel = (id: string, text: string, x: number, y: number, more: Level = {}): Level => ({ id, x, y, text, size: 0.5, color: "#ffd0d0", font: "serif", rot: 0, gmOnly: true, ...more });
const ASSASSIN = gmLabel("assassin0001", "An assassin waits in the cupboard", 10, 6);
const TRAP = gmLabel("trapdoor0001", "The third flagstone is a trap", 20, 12, { size: 0.4, color: "#a0e0ff" });
const GHOST = gmLabel("ghost0000001", "A ghost wakes at midnight", 5, 20);

/** A room the Old Keep was brought into from Dungeon (New scene, From Dungeon), its levels' labels as given. */
async function broughtIn(texts: Record<string, Level[]>, dungeon = true) {
  const r = fakeRoom([]);
  await importFiles(r.room, [fileOf(NAMES, texts)], { name: "", order: 0, covered: true, ...(dungeon ? { dungeon: { map: MAP, lighting: false, name: "Old Keep" } } : {}) });
  return r;
}

/** Update from Dungeon on that room, the map's labels now as given. */
async function updated(r: ReturnType<typeof fakeRoom>, texts: Record<string, Level[]>) {
  const drawing = await readDungeonFile(fileOf(NAMES, texts), "Old Keep");
  const batch = Object.values(r.state.scenes)[0].dungeon!.batch;
  const plan = planDungeonUpdate(Object.values(r.state.scenes).filter((s) => s.dungeon?.batch === batch), drawing.levels);
  return applyDungeonUpdate(r.room, plan, drawing, { lighting: false, covered: true, bringIn: new Set() });
}

const notesIn = (r: ReturnType<typeof fakeRoom>) => Object.values(r.state.items).filter((i): i is DrawingItem => i.kind === "drawing" && i.shape === "text");
const levelScene = (r: ReturnType<typeof fakeRoom>, name: string) => Object.values(r.state.scenes).find((s) => s.name.endsWith(name))!;
const noteFor = (r: ReturnType<typeof fakeRoom>, label: string) => {
  for (const s of Object.values(r.state.scenes)) {
    const l = s.dungeon?.notes?.find((n) => n.id === label);
    if (l) return r.state.items[l.item] as DrawingItem | undefined;
  }
  return undefined;
};

describe("Labels only the GM sees, from Dungeon", () => {
  it("come in as notes only the GM sees, on their own level's scene, where they are, in their colour and size", async () => {
    const r = await broughtIn({ "Ground floor": [ASSASSIN], Cellar: [TRAP] });
    const notes = notesIn(r);
    // Only those two: the labels everyone sees ("Great Hall" and the rest) are in the picture already.
    expect(notes.map((n) => n.text).sort()).toEqual([ASSASSIN.text, TRAP.text].sort());
    expect(notes.every((n) => n.hidden === true && n.fill === false && n.owner === "@gm")).toBe(true);
    const ground = levelScene(r, "Ground floor");
    const note = noteFor(r, "assassin0001")!;
    expect(note.sceneId).toBe(ground.id);
    expect(note).toMatchObject({ color: "#ffd0d0", width: 64 }); // half a square, 128 scene units a square
    // Centred where Dungeon centres the label: (10, 6) squares.
    expect(note.points[0] + noteWidth(note.text!, 64) / 2).toBeCloseTo(1280, 1);
    expect(note.points[1] + (64 * 1.2) / 2).toBeCloseTo(768, 1);
    expect(noteFor(r, "trapdoor0001")).toMatchObject({ sceneId: levelScene(r, "Cellar").id, color: "#a0e0ff", width: 51.2 });
    // Each scene's link says which label is which note; the crypt has none.
    expect(ground.dungeon!.notes).toEqual([{ id: "assassin0001", item: note.id }]);
    expect(levelScene(r, "Crypt").dungeon).not.toHaveProperty("notes");
    // Part of making the scenes, not a step to undo.
    expect(r.changes.length).toBeGreaterThan(0);
    expect(r.changes.every((c) => !c.undoable)).toBe(true);
  });

  it("stay in step on Update from Dungeon: changed, added and removed, with no copies", async () => {
    const r = await broughtIn({ "Ground floor": [ASSASSIN], Cellar: [TRAP] });
    const before = noteFor(r, "assassin0001")!;
    const moved = { ...ASSASSIN, x: 12, y: 7, text: "The assassin has moved to the larder", color: "#ff8080", size: 0.6 };
    const result = await updated(r, { "Ground floor": [moved], Crypt: [GHOST] });
    expect(result.updated).toHaveLength(3);
    const after = noteFor(r, "assassin0001")!;
    // The same note, changed to match.
    expect(after.id).toBe(before.id);
    expect(after).toMatchObject({ text: moved.text, color: "#ff8080", width: 76.8, hidden: true });
    expect(after.points[0] + noteWidth(moved.text, 76.8) / 2).toBeCloseTo(1536, 1);
    // The trap's label went from Dungeon, so its note went; the ghost's is new, on the crypt.
    expect(noteFor(r, "trapdoor0001")).toBeUndefined();
    expect(levelScene(r, "Cellar").dungeon).not.toHaveProperty("notes");
    expect(noteFor(r, "ghost0000001")).toMatchObject({ sceneId: levelScene(r, "Crypt").id, text: GHOST.text, hidden: true });
    expect(notesIn(r)).toHaveLength(2);

    // Again with nothing changed in Dungeon: nothing changes, and still no copies.
    const made = r.changes.length;
    await updated(r, { "Ground floor": [moved], Crypt: [GHOST] });
    expect(r.changes.length).toBe(made);
    expect(notesIn(r)).toHaveLength(2);
    expect(r.changes.every((c) => !c.undoable)).toBe(true);
  });

  it("keep the GM's choices: one shown to players stays shown, one deleted here stays deleted, and the GM's own notes are left alone", async () => {
    const r = await broughtIn({ "Ground floor": [ASSASSIN, TRAP] });
    const shown = noteFor(r, "assassin0001")!;
    const gone = noteFor(r, "trapdoor0001")!;
    const ground = levelScene(r, "Ground floor");
    const mine: DrawingItem = { id: "mynote000001", sceneId: ground.id, kind: "drawing", z: 9, owner: "@gm", shape: "text", points: [1, 1], color: "#ffffff", width: 30, fill: false, text: "My own note", hidden: true };
    r.room.change({ patch: [{ id: shown.id, set: { hidden: false } }], delete: [gone.id], upsert: [mine] });
    await updated(r, { "Ground floor": [{ ...ASSASSIN, text: "The assassin is gone" }, TRAP] });
    expect(r.state.items[shown.id]).toMatchObject({ text: "The assassin is gone", hidden: false });
    expect(r.state.items[gone.id]).toBeUndefined();
    expect(notesIn(r).map((n) => n.text).sort()).toEqual(["My own note", "The assassin is gone"]);
    // The deleted one's label is still remembered, so it isn't brought back next time either...
    expect(levelScene(r, "Ground floor").dungeon!.notes!.map((l) => l.id).sort()).toEqual(["assassin0001", "trapdoor0001"]);
    // ...until its label goes from Dungeon. A label unticked there (in the picture now) takes its note away.
    await updated(r, { "Ground floor": [{ ...ASSASSIN, gmOnly: undefined }] });
    expect(levelScene(r, "Ground floor").dungeon).not.toHaveProperty("notes");
    expect(notesIn(r).map((n) => n.text)).toEqual(["My own note"]);
  });

  it("aren't there for a map from before (none of its labels is the GM's), and come in from a dropped file too, unlinked", async () => {
    const old = await broughtIn({});
    expect(notesIn(old)).toEqual([]);
    expect(Object.values(old.state.scenes).every((s) => !s.dungeon?.notes)).toBe(true);
    // A .dd2vtt from Dungeon dropped onto the map: hidden notes all the same, with nothing to update them by.
    const dropped = await broughtIn({ Cellar: [TRAP] }, false);
    expect(notesIn(dropped)).toMatchObject([{ text: TRAP.text, hidden: true }]);
    expect(Object.values(dropped.state.scenes).every((s) => !s.dungeon)).toBe(true);
  });

  it("are never sent to players with the scene: its link to Dungeon, notes and all, is the GM's", async () => {
    const r = await broughtIn({ "Ground floor": [ASSASSIN] });
    const ground = levelScene(r, "Ground floor");
    expect(ground.dungeon!.notes).toHaveLength(1);
    expect(JSON.stringify(playerScene(ground))).not.toContain("assassin0001");
    expect(playerScene(ground)).not.toHaveProperty("dungeon");
  });
});
