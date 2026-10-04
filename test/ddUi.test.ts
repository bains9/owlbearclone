// The Dungeondraft data UI's words and decisions (design 6.1), the guide's part on it (6.2), and
// the few numbers the UI keeps equal to the extractor's. The components themselves need a
// browser; everything they decide is in ui/ddText.ts and tested here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXTRACT, EXTRACTOR_VERSION } from "../src/client/dd/extract";
import type { AttachReport, FitResult } from "../src/client/dd/extract";
import type { SidecarMeta } from "../src/client/dd/sidecar";
import { GUIDE } from "../src/client/guide";
import { pairDungeondraft } from "../src/client/mapImport";
import type { SceneDataState } from "../src/client/room/mapData";
import {
  CURRENT_EXTRACTOR,
  DD_UI,
  LEVEL_UNCLEAR,
  NO_PENDING,
  PACK_WARN_SHARE,
  attachChecks,
  bareDefault,
  comparePanels,
  dataNote,
  dataRow,
  dialogTitle,
  drawnDefault,
  fitCheck,
  gridDiffers,
  hasBareTrees,
  hasPackItems,
  hasPending,
  levelWhy,
  localDataState,
  needsAnyway,
  noteText,
  olderExtractor,
  planDrop,
  planSkip,
  sidecarLabel,
  withoutPending,
} from "../src/client/ui/ddText";
import type { Pending } from "../src/client/ui/ddText";

/** A source file's text (Node's fs, which the tests' types leave out). */
async function source(path: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

const fit = (verdict: FitResult["verdict"], extra: Partial<FitResult> = {}): FitResult => ({
  verdict, lead: verdict === "yes" ? 2.5 : verdict === "unsure" ? 1.4 : 0.8, sharp: 1.2, best: [0, 0], objects: 71, ...extra,
});

/** Waterfall-like: one level, lined up, a winter map, no packs. */
function report(extra: Partial<AttachReport> = {}): AttachReport {
  return {
    levels: [{ key: "0", label: "Ground", terrainOn: true, why: "only" }],
    level: "0",
    fit: fit("yes"),
    hold: null,
    gridPxPerSquare: 72,
    snowShare: 0.81,
    drawn: "winter",
    packItems: 0,
    packPaths: 0,
    packShare: 0,
    packNames: [],
    dropped: 0,
    objects: 71,
    water: ["WATER", "WATER"],
    lowRes: false,
    warnings: [],
    ...extra,
  };
}

const meta = (extra: Partial<SidecarMeta> = {}): SidecarMeta => ({
  rect: [0, 0, 12800, 8960], squares: [50, 35], extractor: EXTRACTOR_VERSION, snowShare: 0.81, packShare: 0, packItems: 0, dropped: 0,
  names: ["vegetation/trees/pine_tree_02", "terrain_snow"], ...extra,
});

describe("numbers the UI keeps equal to the extractor's", () => {
  it("warns about pack items at the extractor's share, and knows the extractor it attaches with", () => {
    expect(PACK_WARN_SHARE).toBe(EXTRACT.packWarn);
    expect(CURRENT_EXTRACTOR).toBe(EXTRACTOR_VERSION);
  });
});

describe("the attach dialog's checks (6.1)", () => {
  it("says it lines up, and asks or warns otherwise, in 6.1's words", () => {
    expect(fitCheck(fit("yes"))).toEqual({ mark: "ok", text: "Lines up with the picture." });
    expect(fitCheck(fit("unsure"))).toEqual({
      mark: "ask",
      text: "Couldn't fully check the fit (the trees here all look alike from a little way off). Look at the preview.",
    });
    expect(fitCheck(fit("no"))).toEqual({
      mark: "warn",
      text: "Doesn't seem to line up: the map may have changed since this picture was exported, or it's another map.",
    });
  });

  it("lists the fit, the winter line and nothing else for a clean winter map at the scene's grid", () => {
    const checks = attachChecks(report(), { gridSize: 72 });
    expect(checks.map((c) => c.text)).toEqual([
      "Lines up with the picture.",
      "Snow covers 81% of the open ground, so this is a winter map: Spring, Summer and Autumn melt it, and Winter adds to it.",
    ]);
    expect(needsAnyway(checks)).toBe(false);
  });

  it("offers to line a shifted map up, and says so once it was", () => {
    const before = attachChecks(report({ fit: fit("no", { shiftSq: [-2, 0] }) }), { gridSize: 72 });
    expect(before[0].mark).toBe("warn");
    expect(before[1]).toEqual({ mark: "ask", text: "The map seems to have grown 2 squares on the left since this export.", action: "shift" });
    expect(needsAnyway(before)).toBe(true);
    const after = attachChecks(report({ fit: fit("yes"), shifted: [-2, 0] }), { gridSize: 72 });
    expect(after[0]).toEqual({ mark: "ok", text: "The map seems to have grown 2 squares on the left since this export, so it was lined up that way." });
    expect(after.some((c) => c.action === "shift")).toBe(false);
    // A "no" with no whole-square shift to offer gets no shift line.
    const none = attachChecks(report({ fit: fit("no", { shiftSq: [0, 0] }) }), { gridSize: 72 });
    expect(none.filter((c) => c.action === "shift")).toEqual([]);
  });

  it("keeps the fit's say after the GM's own Line it up, when the moved placement still doesn't fit", () => {
    // extract.ts reports the GM's shift whatever the fit says (only an automatic one needs "yes").
    for (const verdict of ["no", "unsure"] as const) {
      const checks = attachChecks(report({ fit: fit(verdict, { shiftSq: [-2, 0] }), shifted: [-2, 0] }), { gridSize: 72 });
      expect(checks[0]).toEqual(fitCheck(fit(verdict)));
      expect(checks[1]).toEqual({ mark: "info", text: "Lined up as if the map had grown 2 squares on the left since this export." });
      expect(checks.some((c) => c.mark === "ok")).toBe(false);
      // No shift on a shift: the fit's warning stands, and the button reads Attach anyway on "no".
      expect(checks.some((c) => c.action === "shift")).toBe(false);
      expect(needsAnyway(checks)).toBe(verdict === "no");
    }
  });

  it("asks the GM to check the level when the worker couldn't pick one (2.2), and not once it's clear", () => {
    const two = [{ key: "1", label: "Ground", terrainOn: true, why: "current" as const }, { key: "0", label: "Roof", terrainOn: false, why: "objects" as const }];
    const unclear = attachChecks(report({ levels: two, level: "1", hold: "level" }), { gridSize: 72 });
    expect(unclear[0]).toEqual({ mark: "ask", text: LEVEL_UNCLEAR });
    expect(LEVEL_UNCLEAR).toBe("It isn't clear which level this picture shows: check the one picked above against the preview, or pick another.");
    expect(unclear[1]).toEqual(fitCheck(fit("yes")));
    // Asked, not warned: Attach stays plain (the GM is looking at the preview).
    expect(needsAnyway(unclear)).toBe(false);
    // The GM's pick (or a .dd2vtt winner) clears the hold, and a fit hold is the fit's own warning.
    expect(attachChecks(report({ levels: two, level: "1", hold: null }), { gridSize: 72 }).some((c) => c.text === LEVEL_UNCLEAR)).toBe(false);
    expect(attachChecks(report({ fit: fit("no"), hold: "fit" }), { gridSize: 72 }).some((c) => c.text === LEVEL_UNCLEAR)).toBe(false);
  });

  it("compares two bakes on a winter map, and shows only the guess on a green one (2.7)", () => {
    expect(comparePanels(report())).toEqual([
      { which: "exact", alt: "Summer, with the project file" },
      { which: "guessed", alt: "Summer, guessed from the picture" },
    ]);
    expect(comparePanels(report({ drawn: "green", snowShare: 0.02 }))).toEqual([{ which: "guessed", alt: "Summer, guessed from the picture" }]);
    expect(DD_UI.compareGreen).toBe("A green map: exact seasons for green maps come in a later update, so this is today's guess from the picture.");
  });

  it("counts the things not in the picture", () => {
    const checks = attachChecks(report({ dropped: 8 }), { gridSize: 72 });
    expect(checks.map((c) => c.text)).toContain(
      "8 of the 71 things in the file aren't in the picture (moved or deleted after exporting?). They're ignored.",
    );
    expect(attachChecks(report({ dropped: 1, objects: 1 }), { gridSize: 72 }).map((c) => c.text)).toContain(
      "1 of the 1 thing in the file aren't in the picture (moved or deleted after exporting?). They're ignored.",
    );
  });

  it("tells a green map its exact seasons come later, and keeps the data", () => {
    const checks = attachChecks(report({ drawn: "green", snowShare: 0.02 }), { gridSize: 72 });
    expect(checks.map((c) => c.text)).toContain(
      "A green map. Exact seasons for green maps come in a later update; until then they're guessed from the picture, and this data is kept for then.",
    );
    expect(checks.some((c) => /winter map/.test(c.text))).toBe(false);
  });

  it("names the packs, and over the share warns and suggests comparing", () => {
    const few = attachChecks(report({ packItems: 3, packPaths: 2, packShare: 0.06, packNames: ["Icewind Dale"] }), { gridSize: 72 });
    expect(few.map((c) => c.text)).toContain("3 things and 2 paths come from asset packs (Icewind Dale): they stay as drawn in every season.");
    expect(needsAnyway(few)).toBe(false);
    const one = attachChecks(report({ packItems: 1, packShare: 0.01, packNames: [] }), { gridSize: 72 });
    expect(one.map((c) => c.text)).toContain("1 thing comes from asset packs: they stay as drawn in every season.");
    const paths = attachChecks(report({ packPaths: 2, packShare: 0.05, packNames: ["A", "B"] }), { gridSize: 72 });
    expect(paths.map((c) => c.text)).toContain("2 paths come from asset packs (A, B): they stay as drawn in every season.");
    const many = attachChecks(report({ packItems: 30, packPaths: 4, packShare: 0.23, packNames: ["Icewind Dale"] }), { gridSize: 72 });
    const warn = many.find((c) => /asset packs/.test(c.text));
    expect(warn).toEqual({
      mark: "warn",
      text: "A lot of this map comes from asset packs (23% of its objects and paths), and those stay as drawn. Compare before attaching.",
    });
    expect(needsAnyway(many)).toBe(true);
    // Exactly at the share counts as a lot.
    expect(attachChecks(report({ packItems: 1, packShare: PACK_WARN_SHARE }), { gridSize: 72 }).some((c) => c.mark === "warn")).toBe(true);
    // No pack items: no line.
    expect(attachChecks(report(), { gridSize: 72 }).some((c) => /asset pack/.test(c.text))).toBe(false);
  });

  it("says when the water doesn't look like water, all of it or some", () => {
    expect(attachChecks(report({ water: ["KEEP"] }), { gridSize: 72 }).map((c) => c.text)).toContain(
      "The water in this map doesn't look like water in the picture, so it stays as drawn.",
    );
    expect(attachChecks(report({ water: ["WATER", "KEEP", "ICE"] }), { gridSize: 72 }).map((c) => c.text)).toContain(
      "Some of the water in this map doesn't look like water in the picture, so it stays as drawn.",
    );
    expect(attachChecks(report({ water: [] }), { gridSize: 72 }).some((c) => /water/.test(c.text))).toBe(false);
  });

  it("passes the extractor's remarks on as they are", () => {
    const text = "Most of this map's ground comes from an asset pack, so seasons leave it as drawn.";
    const checks = attachChecks(report({ warnings: [text] }), { gridSize: 72 });
    expect(checks.find((c) => c.text === text)?.mark).toBe("info");
  });

  it("offers to set the grid when the map's differs, and not for half a pixel", () => {
    const off = attachChecks(report({ gridPxPerSquare: 108 }), { gridSize: 70 });
    expect(off.find((c) => c.action === "grid")).toEqual({ mark: "ask", text: "The grid is 70 px a square, but the map says 108.", action: "grid" });
    expect(gridDiffers(report({ gridPxPerSquare: 108 }), 70)).toBe(true);
    expect(gridDiffers(report({ gridPxPerSquare: 72.4 }), 72)).toBe(false);
    expect(gridDiffers(report({ gridPxPerSquare: 72.6 }), 72)).toBe(true);
    expect(attachChecks(report({ gridPxPerSquare: 72.3 }), { gridSize: 72 }).some((c) => c.action === "grid")).toBe(false);
    expect(attachChecks(report({ gridPxPerSquare: 36.25 }), { gridSize: 70 })[2].text).toBe("The grid is 70 px a square, but the map says 36.3.");
  });

  it("says when the picture is small for the map", () => {
    const checks = attachChecks(report({ lowRes: true }), { gridSize: 72 });
    expect(checks.at(-1)).toEqual({
      mark: "info",
      text: "This picture is small for the map (under 16 px a square on this device), so bare trees are sized from typical sizes.",
    });
  });

  it("explains each level's place in the GM's words, and names the sidecar by the scene and its level", () => {
    expect(levelWhy("vtt")).toBe("its doors and lights match the export");
    expect(levelWhy("ground")).toBe("the only level with ground");
    expect(levelWhy("objects")).toBe("its trees and rocks line up best");
    expect(levelWhy("current")).toBe("open when the map was last saved");
    expect(levelWhy("only")).toBe("the only level");
    expect(sidecarLabel("Waterfall", report())).toBe("Waterfall");
    const two = report({
      levels: [{ key: "1", label: "Ground", terrainOn: true, why: "vtt" }, { key: "0", label: "Roof", terrainOn: false, why: "ground" }],
      level: "1",
    });
    expect(sidecarLabel("Pelcs", two)).toBe("Pelcs · Ground");
    expect(sidecarLabel("Pelcs", { ...two, level: "0" })).toBe("Pelcs · Roof");
    expect(dialogTitle("Waterfall")).toBe('Dungeondraft data for "Waterfall"');
  });
});

describe("the Season box's note, by the data's state on this device (6.1)", () => {
  const text = (state: SceneDataState, opts = { hasMap: true }) => {
    const n = dataNote(state, opts);
    return n ? noteText(n) : null;
  };
  const links = (state: SceneDataState, opts: { hasMap: boolean; olderExtractor?: boolean } = { hasMap: true }) =>
    (dataNote(state, opts) ?? []).filter((p) => typeof p !== "string").map((p) => (typeof p === "string" ? "" : `${p.label}=${p.action}`));

  it("asks for the project file when the scene has a picture and no data, and nothing without a picture", () => {
    expect(text("none")).toBe("Made in Dungeondraft? Attach its project file for exact seasons.");
    expect(links("none")).toEqual(["Attach its project file=attach"]);
    expect(dataNote("none", { hasMap: false })).toBeNull();
  });

  it("treats data still loading like data in use", () => {
    expect(text("ok")).toBe("Exact seasons from Dungeondraft data. Remove");
    expect(text("loading")).toBe(text("ok"));
    expect(links("ok")).toEqual(["Remove=remove"]);
  });

  it("asks for a re-attach when the data is from an older extractor", () => {
    expect(text("ok", { hasMap: true, olderExtractor: true } as never)).toBe(
      "Exact seasons from Dungeondraft data. Attach the project file again to use the latest improvements. Attach again… Remove",
    );
    expect(links("ok", { hasMap: true, olderExtractor: true })).toEqual(["Attach again…=reattach", "Remove=remove"]);
    expect(olderExtractor(meta({ extractor: EXTRACTOR_VERSION - 1 }))).toBe(true);
    expect(olderExtractor(meta())).toBe(false);
  });

  it("has every other state's line, with its links", () => {
    expect(text("green")).toBe(
      "Dungeondraft data is attached. Exact seasons for green maps come in a later update; for now they're guessed from the picture. Remove",
    );
    expect(text("paused")).toBe(
      "The map picture has changed since the Dungeondraft data was attached, so seasons guess from the picture. Use it with this picture Remove",
    );
    expect(links("paused")).toEqual(["Use it with this picture=use", "Remove=remove"]);
    // The picture was removed: nothing to use the data with, so only Remove (the dialog would have nothing to open on).
    expect(text("paused", { hasMap: false })).toBe("This scene has no map picture now; its Dungeondraft data is kept for the picture it was attached to. Remove");
    expect(links("paused", { hasMap: false })).toEqual(["Remove=remove"]);
    expect(text("hold")).toBe("The Dungeondraft data didn't seem to line up with this picture, so seasons guess from the picture. Check… Remove");
    expect(links("hold")).toEqual(["Check…=check", "Remove=remove"]);
    expect(text("retrying")).toBe("The Dungeondraft data couldn't be loaded on this device, so seasons guess from the picture for now.");
    expect(links("retrying")).toEqual([]);
    expect(text("missing")).toBe("The Dungeondraft data couldn't be loaded on this device, so seasons guess from the picture for now. Attach again…");
    expect(links("missing")).toEqual(["Attach again…=reattach"]);
    expect(text("unreadable")).toBe("The Dungeondraft data couldn't be read on this device, so seasons guess from the picture. Attach again…");
    expect(text("newer")).toBe("This scene's Dungeondraft data is newer than this copy of Tabletop: reload to use it.");
    expect(text("noDecompress")).toBe("This browser is too old for exact seasons, so they're guessed from the picture.");
  });

  it("never claims a plain picture melts: the melting lines belong to data", () => {
    for (const state of ["none", "retrying", "missing", "unreadable", "newer", "noDecompress", "paused", "hold"] as const) {
      expect(text(state) ?? "").not.toMatch(/melt/);
    }
  });

  it("works out a scene's state before the board has published one", () => {
    expect(localDataState({ mapAssetId: "p1" })).toBe("none");
    expect(localDataState({ mapAssetId: "p1", mapData: { forAssetId: "p0" } })).toBe("paused");
    expect(localDataState({ mapAssetId: "p1", mapData: { forAssetId: "p1", hold: true } })).toBe("hold");
    expect(localDataState({ mapAssetId: "p1", mapData: { forAssetId: "p1" } })).toBe("loading");
    expect(localDataState({ mapAssetId: null, mapData: { forAssetId: "p1" } })).toBe("paused");
  });
});

describe("the Season box's controls", () => {
  it("reads the map's season from its snow, and bare trees from that", () => {
    expect(drawnDefault(meta({ snowShare: 0.81 }))).toBe("winter");
    expect(drawnDefault(meta({ snowShare: 0.5 }))).toBe("winter");
    expect(drawnDefault(meta({ snowShare: 0.49 }))).toBe("green");
    expect(bareDefault("winter")).toBe("leaf");
    expect(bareDefault("green")).toBe("dead");
  });

  it("shows Bare trees only when the data has bare trees, and Par's pack option only with pack items", () => {
    expect(hasBareTrees(meta())).toBe(false);
    expect(hasBareTrees(meta({ names: ["vegetation/trees/dead_tree_01", "terrain_grass"] }))).toBe(true);
    expect(hasBareTrees(meta({ names: [] }))).toBe(false);
    expect(hasPackItems(meta())).toBe(false);
    expect(hasPackItems(meta({ packItems: 3 }))).toBe(true);
  });

  it("names the pack option as Par asked, and says what it does without jargon", () => {
    expect(DD_UI.packsTitle).toMatch(/Leave as drawn/);
    expect(DD_UI.packsTitle).toMatch(/Guess from the picture/);
    expect(DD_UI.packsTitle).not.toMatch(/sidecar|raster|kernel|mask/i);
    expect(DD_UI.drawnTitle).toBe("Which season the picture shows. Set from the map's snow; change it if it's wrong.");
    expect(DD_UI.bareTitle).toBe("Dungeondraft's bare trees: on a snowy map they're usually sleeping trees, in a green one dead ones.");
  });
});

describe("the scene editor's row and the toasts", () => {
  it("shows the data's name, how many things, and how it stands", () => {
    expect(dataRow("waterfall · Ground", 71, "ok")).toBe("waterfall · Ground · 71 things");
    expect(dataRow("waterfall · Ground", 71, "loading")).toBe("waterfall · Ground · 71 things");
    expect(dataRow("hut", 1, "ok")).toBe("hut · 1 thing");
    expect(dataRow(undefined, undefined, "ok")).toBe("Dungeondraft data");
    expect(dataRow("waterfall", 71, "paused")).toBe("waterfall · 71 things (for another picture)");
    expect(dataRow("waterfall", undefined, "hold")).toBe("waterfall (not in use yet)");
  });

  it("has 6.1's toasts and the Toolbar's title", () => {
    expect(DD_UI.attached).toBe("Dungeondraft data attached: seasons now use the map's own terrain and trees.");
    expect(DD_UI.removed).toBe("Dungeondraft data removed: seasons go back to guessing from the picture. Ctrl+Z puts it back.");
    expect(DD_UI.importTitle).toBe(
      "Bring in a map made in Dungeondraft as a new scene: pick its export (.dd2vtt or a PNG) and, for exact seasons, its project file (.dungeondraft_map) too. The picture and grid come across; with the project file, seasons know where the snow, water, buildings and trees are instead of guessing.",
    );
  });
});

describe("the New scene window's pending pair (2.1 A)", () => {
  const img = (name: string, width = 3600, height = 2520) => new File([`${width}x${height}`], name, { type: "image/png" });
  const ddText = (w: number, h: number) =>
    `{\n\t"header": {\n\t\t"creation_build": "1.2.0.1 opulent kirin",\n\t\t"asset_manifest": []\n\t},\n\t"world": {\n\t\t"format": 3,\n\t\t"width": ${w},\n\t\t"height": ${h},\n\t\t"levels": {}\n\t}\n}`;
  const dd = (name: string, w = 50, h = 35) => new File([ddText(w, h)], name);
  const ob2 = new File(["{}"], "backup.ob2");
  const plan = async (pending: Pending, files: File[]) => planDrop(pending, files, await pairDungeondraft([...pending.dds, ...pending.pictures, ...files]));

  beforeEach(() => {
    vi.stubGlobal("createImageBitmap", async (f: File) => {
      const m = /^(\d+)x(\d+)$/.exec(await f.text());
      if (!m) throw new Error("not an image");
      return { width: Number(m[1]), height: Number(m[2]), close() {} };
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("brings a plain picture, or an Owlbear backup, in at once, as always", async () => {
    const crypt = img("Crypt.png");
    const p = await plan(NO_PENDING, [crypt, ob2]);
    expect(p.now).toEqual([crypt, ob2]);
    expect(p.pending).toEqual(NO_PENDING);
    expect(hasPending(p.pending)).toBe(false);
  });

  it("holds a lone project file for its export, and brings nothing in meanwhile", async () => {
    const w = dd("waterfall.dungeondraft_map");
    const p = await plan(NO_PENDING, [w]);
    expect(p.now).toEqual([]);
    expect(p.pending).toEqual({ dds: [w], pictures: [] });
  });

  it("completes the pair with the next drop, in either order", async () => {
    const w = dd("waterfall.dungeondraft_map");
    const png = img("waterfall.png");
    const second = await plan({ dds: [w], pictures: [] }, [png]);
    expect(second.now).toEqual([w, png]);
    expect(second.pending).toEqual(NO_PENDING);
    // A picture waiting for its project file (left over from a batch with one) is completed too.
    const other = await plan({ dds: [], pictures: [png] }, [w]);
    expect(other.now).toEqual([png, w]);
    expect(other.pending).toEqual(NO_PENDING);
  });

  it("brings pairs in now and holds what's left, when project files are about", async () => {
    const tavern = dd("Tavern.dungeondraft_map", 30, 20);
    const tavernPng = img("Tavern.png", 2160, 1440);
    const crypt = img("Crypt.png", 2000, 1000);
    const cave = img("Cave.png", 1000, 1000);
    const kdir = dd("Kdir.dungeondraft_map", 48, 27);
    const p = await plan(NO_PENDING, [tavern, tavernPng, crypt, cave, kdir]);
    // Neither free picture fits Kdir's shape (rule 3), so all three wait.
    expect(p.now).toEqual([tavern, tavernPng]);
    expect(p.pending).toEqual({ dds: [kdir], pictures: [crypt, cave] });
    // One free picture with one project file left pairs by rule 2 (the only picture), whatever its size.
    const r = await plan(NO_PENDING, [tavern, tavernPng, crypt, kdir]);
    expect(r.now).toEqual([tavern, tavernPng, crypt, kdir]);
    expect(r.pending).toEqual(NO_PENDING);
    // The backup never waits.
    const q = await plan(NO_PENDING, [kdir, ob2]);
    expect(q.now).toEqual([ob2]);
    expect(q.pending).toEqual({ dds: [kdir], pictures: [] });
  });

  it("takes a pending file out when it's skipped", () => {
    const w = dd("waterfall.dungeondraft_map");
    const png = img("waterfall.png");
    const pending: Pending = { dds: [w], pictures: [png] };
    expect(withoutPending(pending, w)).toEqual({ dds: [], pictures: [png] });
    expect(withoutPending(pending, png)).toEqual({ dds: [w], pictures: [] });
    expect(hasPending(withoutPending(withoutPending(pending, w), png))).toBe(false);
  });

  it("brings a skipped picture in as it is, and the window closes behind the last one", () => {
    const w = dd("waterfall.dungeondraft_map");
    const png = img("waterfall.png");
    const crypt = img("Crypt.png");
    // The last pending file: nothing waits afterwards, so the window closes once its scene is made.
    const last = planSkip({ dds: [], pictures: [png] }, png);
    expect(last.now).toEqual([png]);
    expect(last.pending).toEqual(NO_PENDING);
    expect(hasPending(last.pending)).toBe(false);
    // Others still waiting keep the window open; the skipped picture isn't paired with them.
    const some = planSkip({ dds: [w], pictures: [png, crypt] }, png);
    expect(some.now).toEqual([png]);
    expect(some.pending).toEqual({ dds: [w], pictures: [crypt] });
    expect(hasPending(some.pending)).toBe(true);
  });

  it("has 6.1's pending texts", () => {
    expect(`waterfall.dungeondraft_map: ${DD_UI.pendingDd}`).toBe("waterfall.dungeondraft_map: waiting for its export.");
    expect(`waterfall.png: Add its project file… ${DD_UI.pendingPicture}`).toBe("waterfall.png: Add its project file… for exact seasons.");
  });
});

describe("the components carry the texts and controls the design names", () => {
  it("Toolbar: the 6.1 title, and no accept filter on the picker (iOS greys the project file out otherwise)", async () => {
    const bar = await source("../src/client/ui/Toolbar.tsx");
    const fn = bar.slice(bar.indexOf("function ImportDungeondraft"), bar.indexOf("function BuildOptions"));
    expect(fn).toContain("title={DD_UI.importTitle}");
    expect(fn).not.toMatch(/accept=/);
    expect(bar).not.toContain("MAP_FILE_ACCEPT");
  });

  it("New scene: the import-kinds item, pending rows and the report's Check…, decided through the tested planners", async () => {
    const panel = await source("../src/client/ui/ScenesPanel.tsx");
    expect(panel).toContain("<strong>Dungeondraft project files</strong> (.dungeondraft_map), with their export: seasons then use the map's own");
    expect(panel).toContain("terrain, water, buildings and trees.");
    expect(panel).toContain("Check…");
    expect(panel).toContain("Choose the export…");
    expect(panel).toContain("Add its project file…");
    expect(panel).toContain("Skip");
    // A drop and a Skip both go through the planners tested above, so what waits (and whether the
    // window stays open) is decided the same way, from the plan.
    expect(panel).toContain("planDrop(pending, files,");
    expect(panel).toContain("planSkip(pending, files[0])");
    expect(panel).toContain("hasPending(plan.pending)");
  });

  it("SeasonPicker: the notes, the three controls with Par's names, and no grid note with data in use", async () => {
    const picker = await source("../src/client/ui/SeasonPicker.tsx");
    expect(picker).toContain("This map is drawn in");
    expect(picker).toContain("Bare trees");
    expect(picker).toContain("Come into leaf");
    expect(picker).toContain("Stay dead");
    expect(picker).toContain("Asset-pack items");
    expect(picker).toContain("Leave as drawn");
    expect(picker).toContain("Guess from the picture");
    expect(picker).toContain("Snow drifts and leaves are sized by the grid: set the grid first if it's off.");
    // The note and its links come from dataNote, which the tests above cover.
    expect(picker).toContain("dataNote(props.state, { hasMap: !!s.mapAssetId");
  });

  it("the dialog: file row, level question, views, Attach anyway, and the sidecar bookkeeping", async () => {
    const dialog = await source("../src/client/ui/AttachDungeondraft.tsx");
    expect(dialog).toContain("DD_UI.chooseFile");
    expect(dialog).toContain("DD_UI.levelQuestion");
    for (const v of ["Overlay", "Picture only", "Compare", "Attach anyway", "Attach"]) expect(dialog).toContain(`"${v}"`);
    expect(dialog).toContain("Line it up that way");
    expect(dialog).toContain("Set the grid from the map");
    // The checks, the button's word and Compare's panels are the tested functions' (attachChecks, needsAnyway, comparePanels).
    expect(dialog).toContain("attachChecks(report, { gridSize: s.grid.size })");
    expect(dialog).toContain("needsAnyway(checks)");
    expect(dialog).toContain("comparePanels(report)");
    expect(dialog).toContain("touchedSidecars.add(side.id)");
    expect(dialog).toContain("cleanUpSidecars(room, touchedSidecars)");
    const room = await source("../src/client/ui/RoomPage.tsx");
    expect(room).toContain("<AttachDDDialog />");
    expect(room).toContain("useRoomState((s) => s.attachDD)");
    const lib = await source("../src/client/ui/LibraryPanel.tsx");
    expect(lib).toContain("cleanUpSidecars(room, touchedSidecars)");
  });
});

describe("the guide (6.2)", () => {
  const parts = GUIDE.flatMap((s) => s.parts);
  const part = (title: string) => {
    const p = parts.find((x) => x.title === title);
    if (!p) throw new Error(`no guide part "${title}"`);
    return p;
  };
  const whatsNew = GUIDE.find((s) => s.id === "whats-new")!;
  const seasons = GUIDE.find((s) => s.id === "seasons")!;

  it("leads What's new with the exact seasons entry, dated with the intro", () => {
    expect(whatsNew.parts[0].title).toBe("Exact seasons from Dungeondraft files (4 October 2026)");
    expect(whatsNew.intro).toContain("4 October 2026");
    expect(whatsNew.parts[1].title).toBe("Dungeondraft project files explained (30 September 2026)");
  });

  it("has the Seasons part with 6.2's steps and notes, adjusted for Par's pack option", () => {
    const p = part("Exact seasons for Dungeondraft maps");
    expect(seasons.parts).toContain(p);
    expect(p.steps).toHaveLength(3);
    expect(p.steps[0]).toMatch(/save the map.*export it/);
    expect(p.steps[1]).toMatch(/\*\*New scene\*\* window waits for the second/);
    expect(p.steps[1]).toMatch(/\*\*Attach…\*\*/);
    expect(p.steps[2]).toMatch(/\*\*Compare\*\*.*\*\*Attach\*\*/);
    const notes = p.notes.join("\n");
    expect(notes).toMatch(/melts only where it's painted/);
    expect(notes).toMatch(/pines stay green in autumn/);
    expect(notes).toMatch(/export it again and attach it again/);
    expect(notes).toMatch(/\*\*Guess from the picture\*\* under \*\*Asset-pack items\*\*/);
    expect(notes).toMatch(/\*\*Leave as drawn\*\* is the default/);
    expect(notes).toMatch(/\*\*Bare trees\*\*/);
    expect(notes).toMatch(/\*\*This map is drawn in\*\*/);
    expect(notes).toMatch(/winter maps now; green maps follow/);
    expect(notes).toMatch(/never uploaded/);
    expect(notes).toMatch(/\*\*Use it with this picture\*\*/);
  });

  it("no longer says a project file only gets a message, and sends people to the new part", () => {
    const all = parts.flatMap((p) => [...p.steps, ...p.notes]).join("\n");
    expect(all).not.toMatch(/asks for the export/);
    expect(all).not.toMatch(/gets a message asking for its Universal VTT export/);
    expect(all).not.toMatch(/Bring in the export, not the map you save/);
    expect(all).not.toMatch(/If you bring in the project file, Tabletop says so/);
    for (const title of ["Coming from Dungeondraft", "Dungeondraft and other Universal VTT files", "Drop or paste picture files onto the map", "Change the map"]) {
      expect(part(title).notes.join("\n")).toMatch(/Dungeondraft data|Exact seasons for Dungeondraft maps|project file/);
    }
    expect(part("Coming from Dungeondraft").notes.join("\n")).toMatch(/Keep the \.dungeondraft_map file/);
  });

  it("never claims a plain picture melts: melting is a campfire's, or Dungeondraft data's", () => {
    for (const p of parts) {
      for (const text of [...p.steps, ...p.notes]) {
        if (!/melt/.test(text)) continue;
        expect([p.title, text]).toSatisfy(([, t]: [string, string]) => /campfire|Dungeondraft|project file/.test(t));
      }
    }
  });

  it("uses the names the app shows", async () => {
    const picker = await source("../src/client/ui/SeasonPicker.tsx");
    const panel = await source("../src/client/ui/ScenesPanel.tsx");
    const p = part("Exact seasons for Dungeondraft maps");
    const bold = [...p.notes.join("\n").matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]);
    for (const b of ["Guess from the picture", "Asset-pack items", "Leave as drawn", "Bare trees", "This map is drawn in", "Use it with this picture"]) {
      expect(bold).toContain(b);
    }
    for (const b of ["Guess from the picture", "Asset-pack items", "Leave as drawn", "Bare trees", "This map is drawn in"]) expect(picker).toContain(b);
    expect(panel).toContain("Dungeondraft data:");
    expect(panel).toContain("Attach…");
    expect(panel).toContain("Change…");
  });
});
