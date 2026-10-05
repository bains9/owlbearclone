// Turning map files into scenes: uploads the images, creates a scene for each with
// its grid, and for Owlbear Rodeo backups also its fog and tokens. A picture that came
// with its Dungeondraft project file gets the file's data attached as the scene is made
// (design 2.1 A): the data is compiled and uploaded as a sidecar, and the scene starts
// with mapData set, on hold when it didn't line up or the level was unclear.

import { guessGridSize } from "../shared/geometry";
import { randomId } from "../shared/ids";
import { DEFAULT_GRID, LIMITS } from "../shared/sanitize";
import type { Asset, FogItem, Item, Scene, SceneMapData, TokenItem } from "../shared/types";
import { importedUnits } from "../shared/units";
import type { GridUnits } from "../shared/units";
import { AttachError, cleanUpSidecars, prepareAttach, uploadSidecar } from "./dd/attach";
import type { AttachReport, VttMeta } from "./dd/extract";
import { gridSizeFor, readMapFiles } from "./mapImport";
import type { MapFile } from "./mapImport";
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
  onProgress?.("Saving the Dungeondraft data…");
  const label = report.levels.find((l) => l.key === report.level)?.label;
  const side = await uploadSidecar(room, sidecar, report.levels.length > 1 && label ? `${d.map.name} · ${label}` : d.map.name);
  touchedSidecars.add(side.id);
  const out: Attached = {
    mapData: { assetId: side.id, forAssetId: d.asset.id, ...(report.hold ? { hold: true } : {}) },
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
 * backups. `name` names the scene when there's just one plain map.
 */
export async function importFiles(
  room: RoomClient,
  files: File[],
  opts: { name: string; order: number; covered: boolean; onProgress?: (text: string) => void },
): Promise<ImportResult> {
  const result: ImportResult = { scenes: [], gridFromFile: 0, notes: [], owlbear: false, attach: [] };
  let order = opts.order;
  // Feet or metres, as the room measures (Owlbear scenes bring their own scale).
  const settings = room.state.room?.settings;

  const plain = files.filter((f) => !isOb2File(f));
  if (plain.length) {
    const { maps, errors } = await readMapFiles(plain);
    result.notes.push(...errors);
    opts.onProgress?.("Uploading maps…");
    const done = await room.uploadMaps(maps);
    // A typed name only makes sense for a single map (with its project file, two files); several use their own names.
    const single = done.length === 1 && files.length === (done[0].map.dd ? 2 : 1);
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
          const message = err instanceof AttachError ? err.message : `The Dungeondraft data couldn't be saved (${(err as Error).message}). Attach it again with Edit scene › Map.`;
          result.notes.push(message.startsWith(d.map.dd.name) ? message : `${name}: ${message[0].toLowerCase()}${message.slice(1)}`);
        }
      }
      const fromFile = gridSizeFor(d.map, d.asset.width, d.asset.height, d.source) !== null;
      const scene = sceneFromMap(d.asset, name, order++, opts.covered, importedUnits(d.map.scale, settings), d);
      if (attach) scene.mapData = attach.mapData;
      // The picture's place in its map, from the .dd2vtt, whether or not the data could be attached:
      // so a later attach (Edit scene › Map, or the project file dropped alone) needs no second file (2.1 step 5).
      if (d.map.dd && d.map.vtt) scene.mapRect = vttRect(d.map.vtt);
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
