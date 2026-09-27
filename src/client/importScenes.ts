// Turning map files into scenes: uploads the images, creates a scene for each with
// its grid, and for Owlbear Rodeo backups also its fog and tokens.

import { guessGridSize } from "../shared/geometry";
import { randomId } from "../shared/ids";
import { DEFAULT_GRID, LIMITS } from "../shared/sanitize";
import type { Asset, FogItem, Item, Scene, TokenItem } from "../shared/types";
import { gridSizeFor, readMapFiles } from "./mapImport";
import type { MapFile } from "./mapImport";
import { isOb2File, readOb2 } from "./ob2";
import type { RoomClient } from "./room/client";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A scene for an uploaded map. The grid comes from the map file or its name when
 * they say what it is (scaled to the uploaded image, which may have been shrunk),
 * otherwise it's a guess from the image size.
 */
export function sceneFromMap(
  asset: Asset,
  name: string,
  order: number,
  fogCover: boolean,
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
      type,
      size,
      offsetX: offset(from?.map.offsetX, periodX),
      offsetY: offset(from?.map.offsetY, periodY),
    },
    fogCover,
    createdAt: Date.now(),
  };
}

export interface ImportResult {
  scenes: Scene[];
  /** How many of them had their grid in the file (or its name). */
  gridFromFile: number;
  /** Anything that couldn't be brought in, in plain words. */
  notes: string[];
  /** Whether any of it came from an Owlbear Rodeo backup. */
  owlbear: boolean;
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
  const result: ImportResult = { scenes: [], gridFromFile: 0, notes: [], owlbear: false };
  let order = opts.order;

  const plain = files.filter((f) => !isOb2File(f));
  if (plain.length) {
    const { maps, errors } = await readMapFiles(plain);
    result.notes.push(...errors);
    opts.onProgress?.("Uploading maps…");
    const done = await room.uploadMaps(maps);
    for (const d of done) {
      const fromFile = gridSizeFor(d.map, d.asset.width, d.asset.height, d.source) !== null;
      // A typed name only makes sense for a single map; several use their own names.
      const name = done.length === 1 && files.length === 1 ? opts.name || d.map.name : d.map.name;
      const scene = sceneFromMap(d.asset, name, order++, opts.covered, d);
      room.createScene(scene);
      result.scenes.push(scene);
      if (fromFile) result.gridFromFile++;
    }
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
      const scene = sceneFromMap(d.asset, d.map.name, order++, src.fogCover, d);
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
