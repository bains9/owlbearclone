// The words and small decisions of the Dungeondraft data UI (design 6.1): the attach dialog's
// checks, the Season box's notes and controls, the scene editor's row and the New scene window's
// pending pairs. Kept apart from the components so they can be tested without a browser. Nothing
// of the extractor is imported here (the page bundle stays without it): the two numbers both
// sides need are kept equal by a test.

import { OR, objectRole } from "../dd/roles";
import type { AttachReport, FitResult, LevelRank } from "../dd/extract";
import type { SidecarMeta } from "../dd/sidecar";
import { describeShift } from "../importScenes";
import type { DungeondraftPairs } from "../mapImport";
import type { SceneDataState } from "../room/mapData";
import { isSnowy } from "../room/seasonExact";

/** Pack items over this share of the area of objects and paths: say so and suggest comparing (extract.ts EXTRACT.packWarn). */
export const PACK_WARN_SHARE = 0.15;
/** The extractor this build attaches with (extract.ts EXTRACTOR_VERSION): older data gets "attach again". */
export const CURRENT_EXTRACTOR = 1;

/** The fixed texts (6.1). */
export const DD_UI = {
  importTitle:
    "Bring in a map made in Dungeondraft as a new scene: pick its export (.dd2vtt or a PNG) and, for exact seasons, its project file (.dungeondraft_map) too. The picture and grid come across; with the project file, seasons know where the snow, water, buildings and trees are instead of guessing.",
  intro:
    "The project file knows exactly where the snow, grass, water, buildings and trees are. With it, seasons change only those, by what they are, instead of guessing from the picture. It must be the same map the picture was exported from.",
  chooseFile: "Choose .dungeondraft_map…",
  levelQuestion: "Which level does this picture show?",
  legend: "hatched: snow · green: grass · ochre: earth · dark blue: water · pale cyan: ice · grey: buildings and roofs · dashed: stays as drawn",
  compareCaption: "Summer, level 2: with the project file (left) and guessed from the picture (right).",
  compareGreen: "A green map: exact seasons for green maps come in a later update, so this is today's guess from the picture.",
  attached: "Dungeondraft data attached: seasons now use the map's own terrain and trees.",
  removed: "Dungeondraft data removed: seasons go back to guessing from the picture. Ctrl+Z puts it back.",
  drawnTitle: "Which season the picture shows. Set from the map's snow; change it if it's wrong.",
  bareTitle: "Dungeondraft's bare trees: on a snowy map they're usually sleeping trees, in a green one dead ones.",
  packsTitle:
    "Things from asset packs (Tabletop can't tell what they are). Leave as drawn: they look the same in every season. Guess from the picture: seasons treat them as they treat a plain picture, guessing trees and snow from their colours.",
  pendingDd: "waiting for its export.",
  pendingPicture: "for exact seasons.",
} as const;

// ---------------------------------------------------------------- the dialog's checks

/** How a check line is marked: fine, a warning, something to look at, or a plain fact. */
export type Mark = "ok" | "warn" | "ask" | "info";

export interface Check {
  mark: Mark;
  text: string;
  /** A control beside the line: "Line it up that way", or the "Set the grid from the map" tick box. */
  action?: "shift" | "grid";
}

/** The level was unclear (2.2: no .dd2vtt winner, several levels left, no clear best fit): the GM is asked to look. */
export const LEVEL_UNCLEAR = "It isn't clear which level this picture shows: check the one picked above against the preview, or pick another.";

const pct = (share: number) => Math.round(share * 100);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The fit's line (2.4): yes, unsure or no. */
export function fitCheck(fit: Pick<FitResult, "verdict">): Check {
  switch (fit.verdict) {
    case "yes":
      return { mark: "ok", text: "Lines up with the picture." };
    case "unsure":
      return { mark: "ask", text: "Couldn't fully check the fit (the trees here all look alike from a little way off). Look at the preview." };
    case "no":
      return { mark: "warn", text: "Doesn't seem to line up: the map may have changed since this picture was exported, or it's another map." };
  }
}

/**
 * The dialog's check list for a prepared attachment (6.1), top to bottom: an unclear level, the
 * fit (and a shift to offer or the one applied), things not in the picture, winter or green,
 * pack items, water that doesn't look like water, the extractor's own remarks, the grid, and a
 * small picture.
 */
export function attachChecks(report: AttachReport, scene: { gridSize: number }): Check[] {
  const out: Check[] = [];
  if (report.hold === "level") out.push({ mark: "ask", text: LEVEL_UNCLEAR });
  const fit = report.fit;
  if (report.shifted && fit.verdict === "yes") {
    out.push({ mark: "ok", text: `The map seems to have ${describeShift(report.shifted)} since this export, so it was lined up that way.` });
  } else if (report.shifted) {
    // The GM's own "Line it up that way" (extract.ts keeps an automatic shift only on "yes"): the
    // fit at the moved placement still has its say, and no further shift is offered from there.
    out.push(fitCheck(fit));
    out.push({ mark: "info", text: `Lined up as if the map had ${describeShift(report.shifted)} since this export.` });
  } else {
    out.push(fitCheck(fit));
    if (fit.verdict === "no" && fit.shiftSq && (fit.shiftSq[0] || fit.shiftSq[1])) {
      out.push({ mark: "ask", text: `The map seems to have ${describeShift(fit.shiftSq)} since this export.`, action: "shift" });
    }
  }
  if (report.dropped > 0) {
    out.push({
      mark: "info",
      text: `${report.dropped} of the ${plural(report.objects, "thing")} in the file aren't in the picture (moved or deleted after exporting?). They're ignored.`,
    });
  }
  if (report.drawn === "winter") {
    out.push({
      mark: "info",
      text: `Snow covers ${pct(report.snowShare)}% of the open ground, so this is a winter map: Spring, Summer and Autumn melt it, and Winter adds to it.`,
    });
  } else {
    out.push({
      mark: "info",
      text: "A green map. Exact seasons for green maps come in a later update; until then they're guessed from the picture, and this data is kept for then.",
    });
  }
  if (report.packItems > 0 || report.packPaths > 0) {
    if (report.packShare >= PACK_WARN_SHARE) {
      out.push({
        mark: "warn",
        text: `A lot of this map comes from asset packs (${pct(report.packShare)}% of its objects and paths), and those stay as drawn. Compare before attaching.`,
      });
    } else {
      const what = [report.packItems > 0 ? plural(report.packItems, "thing") : "", report.packPaths > 0 ? plural(report.packPaths, "path") : ""]
        .filter(Boolean)
        .join(" and ");
      const names = report.packNames.length ? ` (${report.packNames.join(", ")})` : "";
      out.push({ mark: "info", text: `${what} come${report.packItems + report.packPaths === 1 ? "s" : ""} from asset packs${names}: they stay as drawn in every season.` });
    }
  }
  const kept = report.water.filter((w) => w === "KEEP").length;
  if (kept > 0) {
    out.push({
      mark: "info",
      text: kept === report.water.length
        ? "The water in this map doesn't look like water in the picture, so it stays as drawn."
        : "Some of the water in this map doesn't look like water in the picture, so it stays as drawn.",
    });
  }
  for (const w of report.warnings) out.push({ mark: "info", text: w });
  if (gridDiffers(report, scene.gridSize)) {
    out.push({ mark: "ask", text: `The grid is ${roundPx(scene.gridSize)} px a square, but the map says ${roundPx(report.gridPxPerSquare)}.`, action: "grid" });
  }
  if (report.lowRes) {
    out.push({ mark: "info", text: "This picture is small for the map (under 16 px a square on this device), so bare trees are sized from typical sizes." });
  }
  return out;
}

/** Whether the scene's grid is off the map's by more than half a pixel a square (the dialog then offers to set it). */
export function gridDiffers(report: Pick<AttachReport, "gridPxPerSquare">, gridSize: number): boolean {
  return Number.isFinite(report.gridPxPerSquare) && report.gridPxPerSquare > 0 && Math.abs(report.gridPxPerSquare - gridSize) > 0.5;
}

function roundPx(px: number): string {
  return String(Math.round(px * 10) / 10);
}

/** Attach anyway, after a warning. */
export function needsAnyway(checks: readonly Check[]): boolean {
  return checks.some((c) => c.mark === "warn");
}

/** Why the worker ranked a level where it did, in the GM's words (2.2). */
export function levelWhy(why: LevelRank["why"]): string {
  switch (why) {
    case "vtt":
      return "its doors and lights match the export";
    case "ground":
      return "the only level with ground";
    case "objects":
      return "its trees and rocks line up best";
    case "current":
      return "open when the map was last saved";
    case "only":
      return "the only level";
  }
}

/** The sidecar asset's name: the scene's, with the level when the map has several ("Waterfall · Ground"). */
export function sidecarLabel(sceneName: string, report: Pick<AttachReport, "levels" | "level">): string {
  const label = report.levels.find((l) => l.key === report.level)?.label;
  return report.levels.length > 1 && label ? `${sceneName} · ${label}` : sceneName;
}

/** The dialog's title. */
export function dialogTitle(sceneName: string): string {
  return `Dungeondraft data for "${sceneName}"`;
}

/**
 * Compare's panels (2.7): the exact bake beside today's guess, or, on a green map, the guess
 * alone (exact green seasons come later, so the worker's "exact" bake is the same picture).
 */
export function comparePanels(report: Pick<AttachReport, "drawn">): { which: "exact" | "guessed"; alt: string }[] {
  const guessed = { which: "guessed" as const, alt: "Summer, guessed from the picture" };
  if (report.drawn === "green") return [guessed];
  return [{ which: "exact", alt: "Summer, with the project file" }, guessed];
}

// ---------------------------------------------------------------- the Season box

/** What a note's link does. */
export type NoteAction = "attach" | "remove" | "check" | "use" | "reattach";

/** A note: text with links in it, e.g. "Made in Dungeondraft? [Attach its project file] for exact seasons." */
export type NotePart = string | { label: string; action: NoteAction };

const LINK = {
  attach: { label: "Attach its project file", action: "attach" },
  remove: { label: "Remove", action: "remove" },
  check: { label: "Check…", action: "check" },
  use: { label: "Use it with this picture", action: "use" },
  again: { label: "Attach again…", action: "reattach" },
} as const satisfies Record<string, NotePart>;

/**
 * The Season box's note on a scene's Dungeondraft data (6.1), by its state on this device. The
 * data is in use while its sidecar loads ("loading"), so that reads as "ok". Null: nothing to say
 * (no map picture to attach to). hasMap: whether the scene has a picture now; data without one
 * is paused and can only be removed.
 */
export function dataNote(state: SceneDataState, opts: { hasMap: boolean; olderExtractor?: boolean }): NotePart[] | null {
  switch (state) {
    case "none":
      return opts.hasMap ? ["Made in Dungeondraft? ", LINK.attach, " for exact seasons."] : null;
    case "ok":
    case "loading":
      return opts.olderExtractor
        ? ["Exact seasons from Dungeondraft data. Attach the project file again to use the latest improvements. ", LINK.again, " ", LINK.remove]
        : ["Exact seasons from Dungeondraft data. ", LINK.remove];
    case "green":
      return ["Dungeondraft data is attached. Exact seasons for green maps come in a later update; for now they're guessed from the picture. ", LINK.remove];
    case "paused":
      // No picture now (removed in the scene editor): nothing to use the data with until one is back.
      if (!opts.hasMap) return ["This scene has no map picture now; its Dungeondraft data is kept for the picture it was attached to. ", LINK.remove];
      return ["The map picture has changed since the Dungeondraft data was attached, so seasons guess from the picture. ", LINK.use, " ", LINK.remove];
    case "hold":
      return ["The Dungeondraft data didn't seem to line up with this picture, so seasons guess from the picture. ", LINK.check, " ", LINK.remove];
    case "retrying":
      return ["The Dungeondraft data couldn't be loaded on this device, so seasons guess from the picture for now."];
    case "missing":
      return ["The Dungeondraft data couldn't be loaded on this device, so seasons guess from the picture for now. ", LINK.again];
    case "unreadable":
      return ["The Dungeondraft data couldn't be read on this device, so seasons guess from the picture. ", LINK.again];
    case "newer":
      return ["This scene's Dungeondraft data is newer than this copy of Tabletop: reload to use it."];
    case "noDecompress":
      return ["This browser is too old for exact seasons, so they're guessed from the picture."];
  }
}

/** The note as one line (for tests and titles). */
export function noteText(parts: readonly NotePart[]): string {
  return parts.map((p) => (typeof p === "string" ? p : p.label)).join("");
}

/**
 * A scene's data state before the board has published one for it (a scene not looked at yet):
 * the same first steps the board takes, with the load still to come.
 */
export function localDataState(scene: { mapAssetId: string | null; mapData?: { forAssetId: string; hold?: true } }): SceneDataState {
  const md = scene.mapData;
  if (!md) return "none";
  if (md.forAssetId !== scene.mapAssetId) return "paused";
  if (md.hold) return "hold";
  return "loading";
}

/** The season the map is drawn in, when the GM hasn't said (4.2). */
export function drawnDefault(meta: SidecarMeta): "winter" | "green" {
  return isSnowy(meta) ? "winter" : "green";
}

/** What bare trees do when the GM hasn't said (4.3): leaf on a snowy map, dead on a green one. */
export function bareDefault(drawn: "winter" | "green"): "leaf" | "dead" {
  return drawn === "winter" ? "leaf" : "dead";
}

/** Whether the data has bare trees (dead_tree and the like), so the Bare trees control is worth showing. */
export function hasBareTrees(meta: Pick<SidecarMeta, "names">): boolean {
  return meta.names.some((n) => objectRole(n) === OR.BARE);
}

/** Whether the data has asset-pack items, so Par's pack control is worth showing. */
export function hasPackItems(meta: Pick<SidecarMeta, "packItems">): boolean {
  return meta.packItems > 0;
}

/** Data made by an older extractor than this build's: "Attach the project file again". */
export function olderExtractor(meta: Pick<SidecarMeta, "extractor">): boolean {
  return meta.extractor < CURRENT_EXTRACTOR;
}

// ---------------------------------------------------------------- the scene editor's row

/** "waterfall · Ground · 71 things", with how it stands when it isn't in use. */
export function dataRow(assetName: string | undefined, things: number | undefined, state: SceneDataState): string {
  const parts = [assetName ?? "Dungeondraft data"];
  if (things !== undefined) parts.push(plural(things, "thing"));
  const row = parts.join(" · ");
  if (state === "paused") return `${row} (for another picture)`;
  if (state === "hold") return `${row} (not in use yet)`;
  return row;
}

// ---------------------------------------------------------------- the New scene window's pending pairs

/** Files the New scene window holds for their other half (2.1 A). */
export interface Pending {
  /** Project files waiting for their export. */
  dds: File[];
  /** Pictures waiting for their project file. */
  pictures: File[];
}

export const NO_PENDING: Pending = { dds: [], pictures: [] };

/**
 * What a drop or pick in the New scene window does with its pending files and the new ones,
 * once they're paired together: `now` goes to the import, `pending` waits. Pairs and anything
 * that isn't a picture or project file (an Owlbear backup) go now. A project file with no
 * picture waits. Pictures left without a project file wait only while project files are about
 * (in this batch or already waiting): a plain picture brought in by itself makes its scene at
 * once, as always.
 */
export function planDrop(pending: Pending, files: File[], paired: DungeondraftPairs): { now: File[]; pending: Pending } {
  const all = [...pending.dds, ...pending.pictures, ...files];
  const inPairs = new Set<File>();
  for (const p of paired.pairs) {
    inPairs.add(p.picture);
    inPairs.add(p.dd);
  }
  const lone = new Set(paired.lone);
  const free = new Set(paired.pictures);
  const ddAbout = paired.pairs.length > 0 || lone.size > 0;
  const now: File[] = [];
  const waitPictures: File[] = [];
  for (const f of all) {
    if (inPairs.has(f)) now.push(f);
    else if (lone.has(f)) continue;
    else if (free.has(f)) (ddAbout ? waitPictures : now).push(f);
    else now.push(f);
  }
  return { now, pending: { dds: all.filter((f) => lone.has(f)), pictures: waitPictures } };
}

/** Whether anything is waiting. */
export function hasPending(p: Pending): boolean {
  return p.dds.length > 0 || p.pictures.length > 0;
}

/** The pending files without one (skipped, or brought in alone). */
export function withoutPending(p: Pending, f: File): Pending {
  return { dds: p.dds.filter((x) => x !== f), pictures: p.pictures.filter((x) => x !== f) };
}

/**
 * A pending picture skipped past its project file: it goes to the import as it is, and leaves
 * the pending list, which decides whether the window stays open afterwards (planDrop's shape, so
 * the window handles both the same way).
 */
export function planSkip(pending: Pending, f: File): { now: File[]; pending: Pending } {
  return { now: [f], pending: withoutPending(pending, f) };
}
