// Room backups: one .zip file holding room.json (scenes, tokens, drawings, fog,
// notes, image details) and every uploaded image. Written and read entirely in the
// browser, uncompressed (images are compressed already).

import { randomId } from "../shared/ids";
import { terrainId } from "../shared/terrain";
import type { Asset, Item, RoomSettings, Scene, SceneMapData } from "../shared/types";
import { fileUrl, uploadBlob } from "./api";
import { crc32 } from "./crc32";
import type { RoomClient } from "./room/client";

interface BackupFile {
  format: "tabletop-backup";
  version: 1;
  exportedAt: number;
  room: { name: string; settings: RoomSettings };
  scenes: Scene[];
  items: Item[];
  assets: Asset[];
}

// ---------------------------------------------------------------- a minimal zip (store only)

export function makeZip(entries: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint32(14, crc, true);
    local.setUint32(18, e.data.length, true);
    local.setUint32(22, e.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, e.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, e.data.length, true);
    cd.setUint32(24, e.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + e.data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: "application/zip" });
}

export function readZip(buf: ArrayBuffer): Map<string, Uint8Array> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const dec = new TextDecoder();
  // Find the end-of-central-directory record (no comment is written, but allow one).
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That isn't a backup file.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("The backup file is damaged.");
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0) throw new Error("This backup wasn't made by Tabletop (it's compressed).");
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    out.set(name, bytes.subarray(start, start + size));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---------------------------------------------------------------- export / import

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Downloads the whole room (GM only: the GM's client holds every scene and image). */
export async function exportRoom(room: RoomClient, onProgress: (text: string) => void): Promise<void> {
  const s = room.state;
  if (!s.room) return;
  const assets = Object.values(s.assets);
  const entries: { name: string; data: Uint8Array }[] = [];
  let i = 0;
  for (const a of assets) {
    onProgress(`Fetching images ${++i} of ${assets.length}…`);
    const res = await fetch(fileUrl(room.roomId, a.id));
    if (!res.ok) continue;
    entries.push({ name: `files/${a.id}`, data: new Uint8Array(await res.arrayBuffer()) });
  }
  const backup: BackupFile = {
    format: "tabletop-backup",
    version: 1,
    exportedAt: Date.now(),
    room: { name: s.room.name, settings: s.room.settings },
    scenes: Object.values(s.scenes),
    items: Object.values(s.items),
    assets: assets.filter((a) => entries.some((e) => e.name === `files/${a.id}`)),
  };
  entries.unshift({ name: "room.json", data: new TextEncoder().encode(JSON.stringify(backup)) });
  onProgress("Packing…");
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const safe = s.room.name.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-") || "room";
  download(makeZip(entries), `${safe}-${day}.tabletop.zip`);
}

/**
 * A scene's Dungeondraft data under the restored ids of its sidecar and of the picture it was
 * lined up with. Dropped when either wasn't restored: seasons then guess from the picture.
 */
export function remapMapData(
  md: SceneMapData | undefined,
  assetIds: ReadonlyMap<string, string>,
): SceneMapData | undefined {
  if (!md) return undefined;
  const assetId = assetIds.get(md.assetId);
  const forAssetId = assetIds.get(md.forAssetId);
  return assetId && forAssetId ? { ...md, assetId, forAssetId } : undefined;
}

/**
 * Adds a backup's scenes (with their maps, tokens, drawings, notes and fog) to this
 * room as new scenes. Nothing already in the room is changed.
 */
export async function importBackup(room: RoomClient, file: File, onProgress: (text: string) => void): Promise<string> {
  const files = readZip(await file.arrayBuffer());
  const json = files.get("room.json");
  if (!json) throw new Error("That isn't a Tabletop backup (no room.json).");
  const backup = JSON.parse(new TextDecoder().decode(json)) as BackupFile;
  if (backup.format !== "tabletop-backup" || backup.version !== 1) throw new Error("That isn't a Tabletop backup.");

  // Images first, each under a new id.
  const assetIds = new Map<string, string>();
  let i = 0;
  for (const a of backup.assets) {
    const data = files.get(`files/${a.id}`);
    if (!data) continue;
    onProgress(`Uploading images ${++i} of ${backup.assets.length}…`);
    const uploaded = await uploadBlob(room.roomId, new Blob([data as BlobPart], { type: a.mime }), a.kind, a.name, a.width, a.height, room.profileInfo.uid);
    assetIds.set(a.id, uploaded.id);
    room.store.set((st) => ({ assets: { ...st.assets, [uploaded.id]: uploaded } }));
  }

  // Scenes, placed after the room's existing ones.
  onProgress("Adding scenes…");
  const sceneIds = new Map<string, string>();
  const firstOrder = Math.max(0, ...Object.values(room.state.scenes).map((sc) => sc.order + 1));
  const scenes = [...backup.scenes].sort((a, b) => a.order - b.order);
  scenes.forEach((sc, n) => {
    const id = randomId(12);
    sceneIds.set(sc.id, id);
    // The picture's rectangle in its Dungeondraft map is copied as it is.
    const { mapData, ...rest } = sc;
    const md = remapMapData(mapData, assetIds);
    room.createScene({
      ...rest,
      id,
      order: firstOrder + n,
      mapAssetId: sc.mapAssetId ? (assetIds.get(sc.mapAssetId) ?? null) : null,
      createdAt: Date.now(),
      ...(md ? { mapData: md } : {}),
    });
  });

  // Everything on them, under new ids.
  const items: Item[] = [];
  for (const it of backup.items) {
    const sceneId = sceneIds.get(it.sceneId);
    if (!sceneId) continue;
    // A built map's chunks have ids made from their scene and place; the rest get new random ones.
    const id = it.kind === "terrain" && !it.hidden ? terrainId(sceneId, it.cx, it.cy) : randomId(12);
    const copy = { ...it, id, sceneId } as Item;
    if (copy.kind === "token" && copy.assetId) copy.assetId = assetIds.get(copy.assetId) ?? null;
    items.push(copy);
  }
  if (items.length) room.change({ upsert: items }, false);
  return `Restored ${scenes.length} scene${scenes.length === 1 ? "" : "s"} and ${assetIds.size} image${assetIds.size === 1 ? "" : "s"} from “${backup.room.name}”.`;
}
