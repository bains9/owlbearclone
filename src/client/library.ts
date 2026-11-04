// The GM's own monsters and NPCs on the page (shared/library.ts): read when the GM opens Tokens &
// images, kept in the room's state, and changed through the Worker (worker/libraryRoutes.ts).
// Placing one puts a token in the room like a built-in monster's: named after its picture
// (numbered when the scene has one already), hidden if Add hidden is ticked, and joining the
// initiative list as the GM's creatures do. The room gets its own copy of the picture the first time.
import type { Point } from "../shared/geometry";
import { MAX_FILE_AT_ONCE, shelfName, type LibraryEntry, type Shelf } from "../shared/library";
import type { Asset, TokenItem } from "../shared/types";
import { prepareImage } from "./api";
import { monsterLabel } from "./monsters/monsters";
import { loadAddHidden } from "./monsters/place";
import type { RoomClient } from "./room/client";

/** What one of the GM's own pictures dragged from its list carries: its id, and Add hidden as the list showed. */
export const LIBRARY_DRAG_TYPE = "application/x-tabletop-library";

export interface LibraryDrag {
  id: string;
  hidden: boolean;
}

export function libraryDragData(id: string, hidden: boolean): string {
  return JSON.stringify({ id, hidden } satisfies LibraryDrag);
}

export function readLibraryDrag(data: string | undefined): LibraryDrag | null {
  if (!data) return null;
  try {
    const v = JSON.parse(data) as Partial<LibraryDrag> | null;
    if (v && typeof v.id === "string" && v.id) return { id: v.id, hidden: v.hidden === true };
  } catch {
    // Not ours.
  }
  return null;
}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, credentials: "same-origin" });
  } catch {
    throw new Error("Couldn't reach the server.");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `That didn't work (${res.status}).`);
  return data;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** The entries a filter's words all start a word of (as the Monsters search does). */
export function filterEntries(list: readonly LibraryEntry[], query: string): LibraryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...list];
  return list.filter((e) => {
    const own = e.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return words.every((w) => own.some((o) => o.startsWith(w)));
  });
}

/** GM: reads the library into the room's state. */
export async function loadLibrary(room: RoomClient): Promise<void> {
  room.store.set({ library: await call<LibraryEntry[]>("/api/library") });
}

/** Changes one entry in the room's state (null: takes it out). */
function setEntry(room: RoomClient, id: string, next: LibraryEntry | null): void {
  const list = room.state.library ?? [];
  room.store.set({ library: next ? list.map((e) => (e.id === id ? next : e)) : list.filter((e) => e.id !== id) });
}

/** GM: uploads pictures straight into Monsters or NPCs, saying why any didn't go. */
export async function uploadToLibrary(room: RoomClient, files: File[], shelf: Shelf): Promise<void> {
  room.store.set((s) => ({ uploading: s.uploading + files.length }));
  for (const file of files) {
    try {
      const { blob, width, height } = await prepareImage(file, "token");
      const name = file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || "Image";
      const qs = new URLSearchParams({ shelf, name, w: String(width), h: String(height) });
      const entry = await call<LibraryEntry>(`/api/library?${qs}`, { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob });
      room.store.set((s) => ({ library: [entry, ...(s.library ?? [])] }));
    } catch (err) {
      room.toast(`${file.name}: ${(err as Error).message}`, "error");
    } finally {
      room.store.set((s) => ({ uploading: s.uploading - 1 }));
    }
  }
}

/**
 * GM: files this room's uploads under Monsters or NPCs, for every room: they leave this room's
 * Tokens. A few at a time (the Worker copies each picture); the toast says how many went.
 */
export async function fileInLibrary(room: RoomClient, assetIds: string[], shelf: Shelf): Promise<number> {
  let filed = 0;
  room.store.set((s) => ({ uploading: s.uploading + 1 }));
  try {
    for (let i = 0; i < assetIds.length; i += MAX_FILE_AT_ONCE) {
      const reply = await call<{ filed: number; library: LibraryEntry[] }>("/api/library/from-room", jsonInit("POST", { room: room.roomId, assets: assetIds.slice(i, i + MAX_FILE_AT_ONCE), shelf }));
      filed += reply.filed;
      room.store.set({ library: reply.library });
    }
  } catch (err) {
    room.toast(filed ? `${filed} moved, then: ${(err as Error).message}` : (err as Error).message, "error");
    return filed;
  } finally {
    room.store.set((s) => ({ uploading: s.uploading - 1 }));
  }
  room.toast(`${filed} moved to ${shelfName(shelf)}, for every room.`);
  return filed;
}

/** GM: renames one of their monsters or NPCs (tokens placed from then on take the new name). */
export async function renameEntry(room: RoomClient, e: LibraryEntry, name: string): Promise<void> {
  setEntry(room, e.id, await call<LibraryEntry>(`/api/library/${e.id}`, jsonInit("PATCH", { name })));
}

/** GM: moves one to the other tab. */
export async function shelveEntry(room: RoomClient, e: LibraryEntry, shelf: Shelf): Promise<void> {
  setEntry(room, e.id, await call<LibraryEntry>(`/api/library/${e.id}`, jsonInit("PATCH", { shelf })));
}

/** GM: takes one out of the library, for every room. Tokens on maps stay; this room's copy goes back to its Tokens. */
export async function removeEntry(room: RoomClient, e: LibraryEntry): Promise<void> {
  await call<{ ok: true }>(`/api/library/${e.id}`, { method: "DELETE" });
  setEntry(room, e.id, null);
}

/** Copies being made, by room and entry, so a second click waits for the first. */
const making = new Map<string, Promise<Asset>>();

/** This room's copy of an entry's picture, made the first time. */
function roomCopy(room: RoomClient, entryId: string): Promise<Asset> {
  const have = Object.values(room.state.assets).find((a) => a.library === entryId);
  if (have) return Promise.resolve(have);
  const key = `${room.roomId}|${entryId}`;
  let job = making.get(key);
  if (!job) {
    job = call<Asset>(`/api/rooms/${room.roomId}/library/${entryId}`, { method: "POST" })
      .then((asset) => {
        room.store.set((s) => ({ assets: { ...s.assets, [asset.id]: asset } }));
        return asset;
      })
      .finally(() => making.delete(key));
    making.set(key, job);
  }
  return job;
}

/**
 * GM: puts one of their monsters or NPCs on the scene in view, at `at` (dropped there; with
 * `free`, Alt held, not snapped) or in the middle of the view. If the GM moves to another scene
 * while its picture is copied, it isn't placed: placing it again is at once.
 */
export async function placeFromLibrary(room: RoomClient, entryId: string, at?: Point, hidden = loadAddHidden(), free = false): Promise<TokenItem | null> {
  if (!room.isGm) return null;
  const sceneId = room.state.viewSceneId;
  try {
    if (!room.state.library) await loadLibrary(room);
    const entry = room.state.library?.find((e) => e.id === entryId);
    if (!entry) return null;
    const asset = await roomCopy(room, entryId);
    const scene = room.viewScene;
    if (!scene) return null;
    if (scene.id !== sceneId) {
      room.toast(`${entry.name} is ready. You moved to another scene, so place it again here.`);
      return null;
    }
    const taken = Object.values(room.state.items)
      .filter((i): i is TokenItem => i.kind === "token" && i.sceneId === scene.id)
      .map((t) => t.label);
    return room.addToken({ assetId: asset.id, label: monsterLabel(entry.name, taken), hidden }, at, free);
  } catch (err) {
    room.toast((err as Error).message, "error");
    return null;
  }
}
