// Turning map files into scenes: uploads the images, creates a scene for each with
// its grid, and for Owlbear Rodeo backups also its fog and tokens. A picture that came
// with its Dungeondraft project file gets the file's data attached as the scene is made
// (design 2.1 A): the data is compiled and uploaded as a sidecar, and the scene starts
// with mapData set, on hold when it didn't line up or the level was unclear.

import { guessGridSize } from "../shared/geometry";
import { randomId } from "../shared/ids";
import { DEFAULT_GRID, LIMITS } from "../shared/sanitize";
import type { ScenePatch } from "../shared/protocol";
import type { Asset, FogItem, Item, Scene, SceneDungeon, SceneMapData, TokenItem } from "../shared/types";
import { importedUnits } from "../shared/units";
import type { GridUnits } from "../shared/units";
import { AttachError, cleanUpSidecars, prepareAttach, uploadSidecar } from "./dd/attach";
import type { AttachReport, VttMeta } from "./dd/extract";
import { dungeonLevelNames, gridSizeFor, readMapFiles, vttName } from "./mapImport";
import { randomId as newBatchId } from "../shared/ids";
import type { MapFile } from "./mapImport";
import type { Uploaded } from "./api";
import { isOb2File, readOb2 } from "./ob2";
import type { RoomClient } from "./room/client";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Sidecar assets created, attached or detached in this tab (by asset id): cleanUpSidecars
 * leaves them alone so this tab's undo still works. The attach dialog adds to it too.
 */
export const touchedSidecars = new Set<string>();

/**
 * A scene for an uploaded map. The grid comes from the map file or its name when
 * they say what it is (scaled to the uploaded image, which may have been shrunk),
 * otherwise it's a guess from the image size. `units`: what one square is (the room's
 * feet or metres).
 */
export function sceneFromMap(
  asset: Asset,
  name: string,
  order: number,
  fogCover: boolean,
  units: GridUnits,
  from?: { map: MapFile; source: { width: number; height: number } },
): Scene {
  const known = from ? gridSizeFor(from.map, asset.width, asset.height, from.source) : null;
  const size = known ?? guessGridSize(asset.width, asset.height);
  const type = (known && from?.map.gridType) || "square";
  const scale = from ? asset.width / (from.map.width ?? from.source.width) : 1;
  // Offsets are only meaningful within one repeat of the grid (hex rows repeat every two).
  const periodX = type === "hex-flat" ? size * Math.sqrt(3) : size;
  const periodY = type === "hex-pointy" ? size * Math.sqrt(3) : size;
  const offset = (v: number | undefined, period: number) =>
    known && v ? round2((((v * scale) % period) + period) % period) : 0;
  return {
    id: randomId(12),
    name,
    order,
    mapAssetId: asset.id,
    width: asset.width,
    height: asset.height,
    background: "#1b1e24",
    grid: {
      ...DEFAULT_GRID,
      ...units,
      type,
      size,
      offsetX: offset(from?.map.offsetX, periodX),
      offsetY: offset(from?.map.offsetY, periodY),
    },
    fogCover,
    createdAt: Date.now(),
  };
}

/**
 * How attaching a scene's Dungeondraft data went: attached and lined up; attached but the fit
 * couldn't be fully checked; lined up by a whole-square shift; or on hold (it didn't line up, or
 * which level the picture shows is unclear). Data that couldn't be attached at all is a note.
 */
export type AttachStatus = "ok" | "unsure" | "shifted" | "hold" | "level";

/** The import report's line for one scene's Dungeondraft data (design 6.1). */
export interface AttachEntry {
  sceneId: string;
  status: AttachStatus;
  /** The line itself; the report adds Check… to every status but "ok". */
  note: string;
  /** The extractor's remarks, for the GM (e.g. terrain that couldn't be read). */
  warnings: string[];
  /**
   * On hold (status "hold" or "level"): the project file and its .dd2vtt's details, still in this
   * tab, so Check… can open the attach dialog on them, with its level list and preview, instead of
   * asking for the file again. Never uploaded.
   */
  dd?: File;
  vtt?: VttMeta;
}

export interface ImportResult {
  scenes: Scene[];
  /** How many of them had their grid in the file (or its name). */
  gridFromFile: number;
  /** Anything that couldn't be brought in, in plain words: a project file's data that couldn't be attached included. */
  notes: string[];
  /** Whether any of it came from an Owlbear Rodeo backup. */
  owlbear: boolean;
  /** One line per scene that got data from its Dungeondraft project file. */
  attach: AttachEntry[];
}

/** What a scene gets from its Dungeondraft project file, once the sidecar is uploaded. */
interface Attached {
  mapData: SceneMapData;
  mapRect?: [number, number, number, number];
  status: AttachStatus;
  report: AttachReport;
}

/**
 * "grown 2 squares on the left and lost 1 square at the top": what a whole-square shift says
 * about the map. x < 0 means it has grown -x squares on the left since the export (extract.ts).
 */
export function describeShift([x, y]: readonly [number, number]): string {
  const squares = (n: number) => `${n} square${n === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (x < 0) parts.push(`grown ${squares(-x)} on the left`);
  if (x > 0) parts.push(`lost ${squares(x)} on the left`);
  if (y < 0) parts.push(`grown ${squares(-y)} at the top`);
  if (y > 0) parts.push(`lost ${squares(y)} at the top`);
  return parts.join(" and ");
}

/** The import report's line for an attachment (design 6.1), by its status. */
export function attachNote(sceneName: string, a: Pick<Attached, "status" | "report">): string {
  const { report, status } = a;
  // A map from Dungeon: its data came with the picture, so it always lines up.
  if (report.placed && (status === "ok" || status === "unsure")) {
    return report.drawn === "winter"
      ? `${sceneName}: map data from Dungeon attached: seasons use its own ground, water and trees.`
      : `${sceneName}: map data from Dungeon attached. It's kept for when green maps get exact seasons; for now their seasons are guessed from the picture.`;
  }
  switch (status) {
    case "ok": {
      const label = report.levels.find((l) => l.key === report.level)?.label;
      const level = report.levels.length > 1 && label ? ` (level ${label})` : "";
      return `${sceneName}: Dungeondraft data attached${level}. It lines up with the picture.`;
    }
    case "unsure":
      return `${sceneName}: Dungeondraft data attached, but it couldn't be fully checked against the picture.`;
    case "shifted":
      return `${sceneName}: the map seems to have ${describeShift(report.shifted ?? [0, 0])} since this export, so it was lined up that way.`;
    case "hold":
      return `${sceneName}: the Dungeondraft data doesn't seem to line up with the picture, so it isn't used yet.`;
    case "level":
      return `${sceneName}: check which level this picture shows.`;
  }
}

/** The status a prepared attachment gets (design 2.2, 2.4). */
function attachStatus(report: AttachReport): Attached["status"] {
  if (report.hold === "level") return "level";
  if (report.hold) return "hold";
  if (report.placed) return "ok";
  if (report.shifted) return "shifted";
  return report.fit.verdict === "yes" ? "ok" : "unsure";
}

/**
 * Attaches an uploaded picture's Dungeondraft project file: compiles the data against the
 * local picture, uploads the sidecar and says what the scene gets. The grid comes from the
 * data for a plain picture (a .dd2vtt already has it). Throws an AttachError (its message is
 * for the GM) or the upload's error.
 */
async function attachProjectFile(
  room: RoomClient,
  d: { asset: Asset; map: MapFile; source: { width: number; height: number } },
  dd: File,
  onProgress?: (text: string) => void,
): Promise<Attached> {
  const { report, sidecar } = await prepareAttach(dd, d.map.image, d.source, { vtt: d.map.vtt, onProgress });
  if (!d.map.vtt) {
    // The exact grid: the picture's pixels a square at its full size (gridSizeFor scales it to the upload).
    d.map.pxPerCell = report.gridPxPerSquare;
    d.map.width = d.source.width;
    d.map.height = d.source.height;
    delete d.map.cols;
    delete d.map.rows;
  }
  onProgress?.(d.map.ddFrom === "dungeon" ? "Saving the map data from Dungeon…" : "Saving the Dungeondraft data…");
  const label = report.levels.find((l) => l.key === report.level)?.label;
  const side = await uploadSidecar(room, sidecar, report.levels.length > 1 && label ? `${d.map.name} · ${label}` : d.map.name);
  touchedSidecars.add(side.id);
  const out: Attached = {
    mapData: {
      assetId: side.id,
      forAssetId: d.asset.id,
      ...(report.hold ? { hold: true } : {}),
      ...(d.map.ddFrom === "dungeon" ? { from: "dungeon" as const } : {}),
    },
    status: attachStatus(report),
    report,
  };
  if (d.map.vtt) out.mapRect = vttRect(d.map.vtt);
  return out;
}

/** A .dd2vtt picture's rectangle in its map, in squares [x, y, w, h]. */
function vttRect(vtt: VttMeta): [number, number, number, number] {
  const r = vtt.resolution;
  return [r.map_origin.x, r.map_origin.y, r.map_size.x, r.map_size.y];
}

/**
 * Makes scenes from map files: images, Universal VTT files and Owlbear Rodeo
 * backups. `name` names the scene when there's just one plain map. `dungeon`: the one file is
 * a map from Dungeon (New scene › From Dungeon), and each scene remembers which map and level it
 * is, for Update from Dungeon.
 */
export async function importFiles(
  room: RoomClient,
  files: File[],
  opts: { name: string; order: number; covered: boolean; onProgress?: (text: string) => void; dungeon?: { map: string; lighting: boolean; name?: string } },
): Promise<ImportResult> {
  const result: ImportResult = { scenes: [], gridFromFile: 0, notes: [], owlbear: false, attach: [] };
  let order = opts.order;
  // Feet or metres, as the room measures (Owlbear scenes bring their own scale).
  const settings = room.state.room?.settings;

  const plain = files.filter((f) => !isOb2File(f));
  if (plain.length) {
    const { maps, errors } = await readMapFiles(plain);
    result.notes.push(...errors);
    const fromDungeon = opts.dungeon && files.length === 1 ? opts.dungeon : null;
    // Its levels' names, before the maps take the map's own name; the scenes brought in now, one batch.
    const levels = fromDungeon && maps.length ? dungeonLevelNames(await files[0].text()) : [];
    const batch = newBatchId(12);
    if (fromDungeon?.name) withMapName(maps, files[0].name, fromDungeon.name);
    opts.onProgress?.("Uploading maps…");
    const done = await room.uploadMaps(maps);
    // A typed name only makes sense for a single map (with its project file, two files); several use their own names.
    // (A map from Dungeon carries its data inside the one file.)
    const single = done.length === 1 && files.length === (done[0].map.dd && !done[0].map.ddFrom ? 2 : 1);
    let attached = 0;
    for (const d of done) {
      const name = single ? opts.name || d.map.name : d.map.name;
      // The project file's data, before the scene is made: part of making it, not an undo step.
      // When it can't be attached the scene is still made, plain, and the report says why (6.1):
      // a line about the file as it is, else the refusal after the scene's name.
      let attach: Attached | null = null;
      if (d.map.dd) {
        try {
          attach = await attachProjectFile(room, d, d.map.dd, opts.onProgress);
          attached++;
        } catch (err) {
          const message =
            err instanceof AttachError
              ? err.message
              : d.map.ddFrom === "dungeon"
                ? `The map data from Dungeon couldn't be saved (${(err as Error).message}). Bring the export in again for exact seasons.`
                : `The Dungeondraft data couldn't be saved (${(err as Error).message}). Attach it again with Edit scene › Map.`;
          result.notes.push(message.startsWith(d.map.dd.name) ? message : `${name}: ${message[0].toLowerCase()}${message.slice(1)}`);
        }
      }
      const fromFile = gridSizeFor(d.map, d.asset.width, d.asset.height, d.source) !== null;
      const scene = sceneFromMap(d.asset, name, order++, opts.covered, importedUnits(d.map.scale, settings), d);
      if (attach) scene.mapData = attach.mapData;
      // The picture's place in its map, from the .dd2vtt, whether or not the data could be attached:
      // so a later attach (Edit scene › Map, or the project file dropped alone) needs no second file (2.1 step 5).
      if (d.map.dd && d.map.vtt) scene.mapRect = vttRect(d.map.vtt);
      if (fromDungeon) {
        const index = maps.indexOf(d.map);
        scene.dungeon = { map: fromDungeon.map, batch, level: levels[index], index, levels, asset: d.asset.id, ...(fromDungeon.lighting ? { lighting: true } : {}) };
      }
      room.createScene(scene);
      result.scenes.push(scene);
      if (fromFile) result.gridFromFile++;
      if (attach) {
        const entry: AttachEntry = { sceneId: scene.id, status: attach.status, note: attachNote(name, attach), warnings: attach.report.warnings };
        if ((attach.status === "hold" || attach.status === "level") && d.map.dd) {
          entry.dd = d.map.dd;
          if (d.map.vtt) entry.vtt = d.map.vtt;
        }
        result.attach.push(entry);
      }
    }
    // Sidecars no scene uses any more (an undone attach in another tab, say) go, once they're old enough.
    if (attached) void cleanUpSidecars(room, touchedSidecars).catch(() => undefined);
  }

  for (const file of files.filter(isOb2File)) {
    result.owlbear = true;
    opts.onProgress?.(`Reading ${file.name}…`);
    let imp;
    try {
      imp = await readOb2(file);
    } catch (err) {
      result.notes.push(`${file.name} ${(err as Error).message}`);
      continue;
    }
    result.notes.push(...imp.notes);
    opts.onProgress?.(`Uploading ${imp.scenes.length} map${imp.scenes.length === 1 ? "" : "s"}…`);
    const done = await room.uploadMaps(imp.scenes.map((s) => s.map));
    const tokenAssets = new Map<string, Asset | null>();
    const owner = room.state.me?.userId ?? "";
    for (const d of done) {
      const src = imp.scenes.find((s) => s.map === d.map)!;
      const scene = sceneFromMap(d.asset, d.map.name, order++, src.fogCover, importedUnits(d.map.scale, settings), d);
      room.createScene(scene);
      result.scenes.push(scene);
      if (gridSizeFor(d.map, d.asset.width, d.asset.height, d.source) !== null) result.gridFromFile++;

      // Everything was measured on the original map image; the upload may have shrunk it.
      const k = d.asset.width / (d.map.width ?? d.source.width);
      const items: Item[] = [];
      src.fog.forEach((f, z) => {
        const fog: FogItem = {
          id: randomId(12),
          sceneId: scene.id,
          kind: "fog",
          z,
          owner,
          mode: f.mode,
          shape: f.shape,
          points: f.points.map((v) => round2(v * k)),
          ...(f.shape === "stroke" ? { width: Math.max(1, round2((f.width ?? 1) * k)) } : {}),
        };
        items.push(fog);
      });
      if (src.tokens.length) opts.onProgress?.(`Uploading token art for ${scene.name}…`);
      let z = 0;
      for (const t of src.tokens) {
        if (!tokenAssets.has(t.image)) {
          const file = await imp.tokenImage(t.image);
          const ext = file?.type.split("/")[1] ?? "png";
          const named = file ? new File([file], `${t.label || "Token"}.${ext}`, { type: file.type }) : null;
          const [asset] = named ? await room.upload([named], "token") : [];
          tokenAssets.set(t.image, asset ?? null);
        }
        const asset = tokenAssets.get(t.image);
        const token: TokenItem = {
          id: randomId(12),
          sceneId: scene.id,
          kind: "token",
          z: z++,
          owner,
          x: round2(t.x * k),
          y: round2(t.y * k),
          size: t.size,
          rotation: t.rotation,
          assetId: asset?.id ?? null,
          color: "#8a8f98",
          label: t.label,
          hidden: t.hidden,
          locked: t.locked,
          rings: [],
          ...(t.prop ? { layer: "prop" as const } : {}),
        };
        items.push(token);
      }
      if (items.length > LIMITS.itemsPerScene) {
        result.notes.push(`"${scene.name}" has more fog shapes and tokens than a scene can hold; some were left out.`);
        items.length = LIMITS.itemsPerScene;
      }
      // Not undoable: it's part of making the scene.
      if (items.length) room.change({ upsert: items }, false);
    }
  }
  return result;
}

/**
 * Names a Dungeon map's levels after the map's own name ("Keep: Night: Cellar"), not the file's
 * name made from it, which drops what file names can't hold and what reads like a grid size.
 */
export function withMapName(maps: MapFile[], fileName: string, name: string): void {
  const stem = vttName(fileName);
  for (const m of maps) {
    if (m.name === stem) m.name = name;
    else if (m.name.startsWith(`${stem}: `)) m.name = name + m.name.slice(stem.length);
  }
}

/** Whether a scene is still Dungeon's: linked, and showing the picture Dungeon drew for it. */
export function isDungeonScene(s: Scene): s is Scene & { dungeon: SceneDungeon } {
  return !!s.dungeon && s.mapAssetId === s.dungeon.asset;
}

/** What Update from Dungeon will do with one bring-in's scenes, given the map's levels now. */
export interface DungeonPlan {
  /** Each scene, and the level (its place in the new file) whose picture it gets. */
  matched: { scene: Scene & { dungeon: SceneDungeon }; level: number }[];
  /**
   * Scenes left as they are: their level isn't in the map any more, or they show a picture of the
   * GM's own. guess: for one whose level has gone, the new level likeliest to be it renamed (the
   * new one in its old place, or the only one), which the GM can give it instead (withPairs).
   */
  left: { scene: Scene; why: "gone" | "picture"; guess?: number }[];
  /** Levels with no scene: new since (brought in unless the GM says not), or ones whose scene was deleted. */
  unplaced: { level: number; name: string; isNew: boolean }[];
  /** Whether it needs the GM's say: a level gone, moved or new in Dungeon, or a scene left alone. */
  unusual: boolean;
}

/**
 * Matches one bring-in's scenes to the map's levels now, by name: adding, moving or deleting levels
 * in Dungeon never puts a scene on another floor. Two levels of the same name are told apart by
 * where they were.
 */
export function planDungeonUpdate(batch: Scene[], levels: string[]): DungeonPlan {
  const plan: DungeonPlan = { matched: [], left: [], unplaced: [], unusual: false };
  const used = new Set<number>();
  const known = new Set(batch.flatMap((s) => s.dungeon?.levels ?? []));
  for (const scene of [...batch].sort((a, b) => (a.dungeon?.index ?? 0) - (b.dungeon?.index ?? 0))) {
    if (!isDungeonScene(scene)) {
      plan.left.push({ scene, why: "picture" });
      continue;
    }
    const named = levels.flatMap((n, i) => (n === scene.dungeon.level && !used.has(i) ? [i] : []));
    // A map that had one level (unnamed) and has gained others: its scene is the first level's.
    if (!named.length && scene.dungeon.level === "" && levels.length && !used.has(0)) named.push(0);
    const level = named.includes(scene.dungeon.index) ? scene.dungeon.index : named[0];
    if (level === undefined) {
      plan.left.push({ scene, why: "gone" });
      continue;
    }
    used.add(level);
    plan.matched.push({ scene, level });
  }
  levels.forEach((name, level) => {
    if (!used.has(level)) plan.unplaced.push({ level, name, isNew: !known.has(name) });
  });
  const fresh = plan.unplaced.filter((u) => u.isNew);
  const gone = plan.left.filter((l) => l.why === "gone");
  for (const l of gone) {
    const inPlace = fresh.find((u) => u.level === l.scene.dungeon?.index);
    const guess = inPlace ?? (gone.length === 1 && fresh.length === 1 ? fresh[0] : undefined);
    if (guess && !gone.some((g) => g !== l && g.guess === guess.level)) l.guess = guess.level;
  }
  // A level declined before, or whose scene was deleted here, is no change in Dungeon: no need to ask.
  plan.unusual = plan.left.length > 0 || fresh.length > 0 || plan.matched.some((m) => m.level !== m.scene.dungeon.index);
  return plan;
}

/** The plan with scenes whose level had gone given the levels the GM chose for them (a renamed level, say). */
export function withPairs(plan: DungeonPlan, pairs: ReadonlyMap<string, number>): DungeonPlan {
  const matched = [...plan.matched];
  const left: DungeonPlan["left"] = [];
  const taken = new Set(plan.matched.map((m) => m.level));
  for (const l of plan.left) {
    const level = pairs.get(l.scene.id);
    if (level !== undefined && !taken.has(level) && isDungeonScene(l.scene)) {
      taken.add(level);
      matched.push({ scene: l.scene, level });
    } else {
      left.push(l);
    }
  }
  return { ...plan, matched, left, unplaced: plan.unplaced.filter((u) => !taken.has(u.level)) };
}

/**
 * The change Update from Dungeon makes to a scene for its level's new picture: the picture and
 * Dungeon's map data, in place. The picture is fitted to the scene's squares, measured from the
 * picture it had (whatever the grid has been set to since), so tokens, fog and drawings stay
 * exactly where they are; the grid, name, fog setting, season and any extended area stay as they
 * are, and so do the GM's choices on the map data (bare trees, what the picture shows, asset packs).
 */
export function updatePatch(
  scene: Scene & { dungeon: SceneDungeon },
  d: Uploaded & { map: MapFile },
  attach: Pick<Attached, "mapData"> | null,
  link: Pick<SceneDungeon, "index" | "levels" | "lighting">,
): Omit<ScenePatch, "id"> {
  const fresh = sceneFromMap(d.asset, scene.name, scene.order, scene.fogCover, { unit: scene.grid.unit, unitName: scene.grid.unitName }, d);
  // World units a square of the map takes on this scene, and a pixel of the new picture.
  const perSquare = scene.mapRect ? scene.width / scene.mapRect[2] : scene.grid.size;
  const k = perSquare / fresh.grid.size;
  const kept = scene.mapData ? { ...(scene.mapData.bare ? { bare: scene.mapData.bare } : {}), ...(scene.mapData.drawn ? { drawn: scene.mapData.drawn } : {}), ...(scene.mapData.packs ? { packs: scene.mapData.packs } : {}) } : {};
  return {
    mapAssetId: d.asset.id,
    width: round2(d.asset.width * k),
    height: round2(d.asset.height * k),
    mapData: attach ? { ...attach.mapData, ...kept } : null,
    mapRect: d.map.vtt ? vttRect(d.map.vtt) : null,
    dungeon: {
      ...scene.dungeon,
      level: link.levels[link.index] ?? scene.dungeon.level,
      index: link.index,
      levels: link.levels,
      asset: d.asset.id,
      ...(link.lighting ? { lighting: true } : { lighting: undefined }),
    },
  };
}

/** The detail to ask Dungeon for: the pixels a square had in the scene's picture, so the new one is as sharp. */
export function detailOf(scene: Scene, assets: Record<string, Asset>): number {
  const asset = scene.mapAssetId ? assets[scene.mapAssetId] : undefined;
  return Math.round(asset && scene.mapRect ? asset.width / scene.mapRect[2] : scene.grid.size);
}

/** Of these pictures and map data, the ones no scene uses any more. */
export function unusedAssets(ids: Iterable<string | null | undefined>, scenes: Iterable<Scene>): string[] {
  const used = new Set<string>();
  for (const s of scenes) {
    if (s.mapAssetId) used.add(s.mapAssetId);
    if (s.mapData) used.add(s.mapData.assetId);
  }
  return [...new Set([...ids].filter((id): id is string => !!id && !used.has(id)))];
}

/** A Dungeon map drawn for an update: its levels as maps, their names, and anything unreadable. */
export interface DungeonDrawing {
  maps: MapFile[];
  levels: string[];
  errors: string[];
}

/** Reads the file Dungeon drew for an update; `name` is the map's own name, for new scenes. */
export async function readDungeonFile(file: File, name?: string): Promise<DungeonDrawing> {
  const { maps, errors } = await readMapFiles([file]);
  const levels = maps.length ? dungeonLevelNames(await file.text()) : [];
  if (name) withMapName(maps, file.name, name);
  return { maps, levels, errors };
}

export interface UpdateResult {
  updated: Scene[];
  added: Scene[];
  notes: string[];
}

/**
 * Update from Dungeon, as planned (planDungeonUpdate): each matched scene gets its level's new
 * picture in place (updatePatch); the levels in `bringIn` come in as new scenes of the same
 * batch. The pictures and map data Dungeon drew for the updated scenes go once no scene uses them,
 * so updating takes no more room than the map itself, and this tab's undo forgets them. A scene
 * deleted meanwhile is skipped.
 */
export async function applyDungeonUpdate(
  room: RoomClient,
  plan: DungeonPlan,
  drawing: DungeonDrawing,
  opts: { lighting: boolean; covered: boolean; bringIn: ReadonlySet<number>; onProgress?: (text: string) => void },
): Promise<UpdateResult> {
  const result: UpdateResult = { updated: [], added: [], notes: [] };
  const { maps, levels } = drawing;
  const first = plan.matched[0]?.scene.dungeon ?? plan.left.find((l) => l.scene.dungeon)?.scene.dungeon;
  if (!first) return result;
  const wanted = new Set([...plan.matched.map((m) => m.level), ...[...opts.bringIn].filter((l) => l < maps.length)]);
  opts.onProgress?.("Uploading the new pictures…");
  const done = await room.uploadMaps(maps.filter((_, i) => wanted.has(i)));
  const old: string[] = [];
  // Everything uploaded now, so what no scene ends up using (its scene went meanwhile) goes too.
  const fresh: string[] = done.map((d) => d.asset.id);
  const updated = new Set<string>();
  let order = Math.max(0, ...Object.values(room.state.scenes).map((s) => s.order + 1));
  const settings = room.state.room?.settings;
  const link = { levels, ...(opts.lighting ? { lighting: true } : {}) };
  for (const d of done) {
    const level = maps.indexOf(d.map);
    let attach: Attached | null = null;
    if (d.map.dd) {
      try {
        attach = await attachProjectFile(room, d, d.map.dd, opts.onProgress);
        fresh.push(attach.mapData.assetId);
      } catch (err) {
        result.notes.push(`${d.map.name}: the map data from Dungeon couldn't be saved (${(err as Error).message}), so its seasons are guessed from the picture.`);
      }
    }
    for (const m of plan.matched.filter((x) => x.level === level)) {
      // Read again: it may have changed, or gone, while Dungeon drew.
      const now = room.state.scenes[m.scene.id];
      if (!now || !isDungeonScene(now)) {
        if (now) result.notes.push(`${now.name} got a picture of your own meanwhile, so it was left as it is.`);
        continue;
      }
      old.push(now.mapAssetId!);
      // Its map data only if it's Dungeon's, for this picture: never anything the GM attached.
      if (now.mapData?.from === "dungeon" && now.mapData.forAssetId === now.mapAssetId) old.push(now.mapData.assetId);
      room.updateScene(now.id, updatePatch(now, d, attach, { ...link, index: level }));
      updated.add(now.id);
      result.updated.push(room.state.scenes[now.id] ?? now);
    }
    if (opts.bringIn.has(level)) {
      const scene = sceneFromMap(d.asset, d.map.name, order++, opts.covered, importedUnits(d.map.scale, settings), d);
      if (attach) scene.mapData = attach.mapData;
      if (d.map.vtt) scene.mapRect = vttRect(d.map.vtt);
      scene.dungeon = { map: first.map, batch: first.batch, level: levels[level], index: level, levels, asset: d.asset.id, ...(opts.lighting ? { lighting: true } : {}) };
      room.createScene(scene);
      result.added.push(scene);
    }
  }
  const brought = new Set(done.map((d) => maps.indexOf(d.map)));
  for (const m of plan.matched) if (!brought.has(m.level)) result.notes.push(`${m.scene.name}: its new picture couldn't be uploaded, so the scene stays as it was. Update again to try once more.`);
  for (const level of opts.bringIn) if (level < maps.length && !brought.has(level)) result.notes.push(`${maps[level].name}: its picture couldn't be uploaded, so it didn't come in.`);
  for (const l of plan.left) {
    result.notes.push(
      l.why === "gone"
        ? `${l.scene.name}: Dungeon's map has no level called "${l.scene.dungeon?.level}" any more, so the scene stays as it was.`
        : `${l.scene.name} shows a picture of your own, so it was left as it is.`,
    );
  }
  // The old pictures and data, once nothing uses them: updating doesn't pile up copies. Undo here
  // forgets them first, so it can't put a deleted picture back.
  if (updated.size) room.forgetPictures(updated);
  const gone = unusedAssets([...old, ...fresh], Object.values(room.state.scenes));
  if (room.state.status === "open") {
    for (const id of gone) {
      touchedSidecars.delete(id);
      room.deleteAsset(id);
    }
  } else if (gone.length) {
    result.notes.push("Tabletop wasn't connected, so the old pictures were kept. Delete them from Uploaded maps if you like.");
  }
  return result;
}
