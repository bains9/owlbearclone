// The GM's campaign notes on the page (shared/vault.ts): their list, a note, a search, and bringing
// the vault in from its folder (picked in the browser, on any system): the notes in batches, then
// the pictures, each sent only if Table hasn't a copy already (by its checksum), then finished, so
// notes taken out of the vault go from Table too. Handouts and token links go through the room.
import { VAULT_LIMITS, vaultKind, type VaultIndex, type VaultNoteInfo, type VaultSearchHit } from "../shared/vault";
import type { RoomClient } from "./room/client";

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

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** GM: reads the vault's list into the room's state. */
export async function loadVault(room: RoomClient): Promise<void> {
  room.store.set({ vault: await call<VaultIndex>("/api/vault") });
}

export async function fetchNote(path: string): Promise<string> {
  return (await call<{ body: string }>(`/api/vault/note?path=${encodeURIComponent(path)}`)).body;
}

export async function searchVault(q: string): Promise<VaultSearchHit[]> {
  return call<VaultSearchHit[]>(`/api/vault/search?q=${encodeURIComponent(q)}`);
}

/** A file picked from the vault's folder, with its place in the vault (the folder's own name taken off). */
export function vaultPlace(file: { name: string; webkitRelativePath?: string }): string {
  const rel = file.webkitRelativePath || file.name;
  const parts = rel.split("/");
  return (parts.length > 1 ? parts.slice(1) : parts).join("/");
}

async function sha256(data: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * GM: brings the vault in from its folder's files, saying how it's going. What's in Table already
 * is replaced: notes taken out of the vault go. Notes past the limit, and pictures too big, are left
 * out (the result says how many).
 */
export async function importVault(room: RoomClient, picked: File[], say: (text: string) => void): Promise<{ notes: number; files: number; skipped: number }> {
  const notes: { path: string; file: File }[] = [];
  const pictures: { path: string; file: File }[] = [];
  let skipped = 0;
  for (const file of picked) {
    const path = vaultPlace(file);
    const kind = vaultKind(path);
    if (kind === "note") notes.push({ path, file });
    else if (kind === "picture") {
      if (file.size > VAULT_LIMITS.fileBytes) skipped++;
      else pictures.push({ path, file });
    }
  }
  if (!notes.length) throw new Error("That folder has no notes in it. Pick the folder Obsidian opens as your vault.");
  if (notes.length > VAULT_LIMITS.notes) {
    skipped += notes.length - VAULT_LIMITS.notes;
    notes.length = VAULT_LIMITS.notes;
  }
  const { import: id } = await call<{ import: string }>("/api/vault/import", { method: "POST" });
  // The notes, a batch at a time.
  let batch: { path: string; body: string }[] = [];
  let bytes = 0;
  let sent = 0;
  const flush = async () => {
    if (!batch.length) return;
    await call("/api/vault/import/notes", post({ import: id, notes: batch }));
    sent += batch.length;
    say(`Bringing in your notes: ${sent} of ${notes.length}…`);
    batch = [];
    bytes = 0;
  };
  for (const n of notes) {
    const body = (await n.file.text()).slice(0, VAULT_LIMITS.noteBytes);
    if (batch.length >= VAULT_LIMITS.batchNotes || bytes + body.length > VAULT_LIMITS.batchBytes) await flush();
    batch.push({ path: n.path, body });
    bytes += body.length + n.path.length;
  }
  await flush();
  // The pictures: their checksums first, then only those Table hasn't got.
  const infos: { path: string; hash: string; bytes: number; file: File }[] = [];
  for (let i = 0; i < pictures.length; i++) {
    if (i % 20 === 0) say(`Looking at your pictures: ${i} of ${pictures.length}…`);
    const p = pictures[i];
    infos.push({ path: p.path, hash: await sha256(await p.file.arrayBuffer()), bytes: p.file.size, file: p.file });
  }
  const missing = new Set<string>();
  for (let i = 0; i < infos.length; i += 300) {
    const chunk = infos.slice(i, i + 300).map(({ path, hash, bytes: b }) => ({ path, hash, bytes: b }));
    const reply = await call<{ missing: string[] }>("/api/vault/import/files", post({ import: id, files: chunk }));
    for (const h of reply.missing) missing.add(h);
  }
  const sending = infos.filter((x) => missing.has(x.hash));
  for (let i = 0; i < sending.length; i++) {
    const x = sending[i];
    say(`Sending your pictures: ${i + 1} of ${sending.length}…`);
    const qs = new URLSearchParams({ import: id, path: x.path });
    try {
      await call(`/api/vault/import/file/${x.hash}?${qs}`, { method: "PUT", body: x.file });
    } catch {
      // A picture Table can't take (a kind it doesn't show): left out.
      skipped++;
    }
  }
  const done = await call<{ notes: number; files: number }>("/api/vault/import/finish", post({ import: id }));
  await loadVault(room);
  return { ...done, skipped };
}

/** GM: takes the whole vault out of Table. */
export async function clearVault(room: RoomClient): Promise<void> {
  await call("/api/vault", { method: "DELETE" });
  room.store.set({ vault: { notes: [], files: [], importedAt: null }, noteOpen: null });
}

/** The folders of a vault's notes, as Obsidian's file list shows them: folders first, then notes. */
export interface Folder {
  name: string;
  path: string;
  folders: Folder[];
  notes: VaultNoteInfo[];
}

export function noteTree(notes: readonly VaultNoteInfo[]): Folder {
  const root: Folder = { name: "", path: "", folders: [], notes: [] };
  for (const n of notes) {
    const parts = n.path.split("/");
    let at = root;
    for (const part of parts.slice(0, -1)) {
      let next = at.folders.find((f) => f.name === part);
      if (!next) {
        next = { name: part, path: at.path ? `${at.path}/${part}` : part, folders: [], notes: [] };
        at.folders.push(next);
      }
      at = next;
    }
    at.notes.push(n);
  }
  const sort = (f: Folder) => {
    f.folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    f.notes.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    f.folders.forEach(sort);
  };
  sort(root);
  return root;
}

/** GM: the vault script's address in Google Drive (scripts/vault-drive.gs), or null. */
export async function loadDriveSource(): Promise<string | null> {
  return (await call<{ source: string | null }>("/api/vault/drive")).source;
}

/** GM: keeps the vault script's address (it's asked once, to see that it works); null forgets it. */
export async function setDriveSource(source: string | null): Promise<string | null> {
  return (await call<{ source: string | null }>("/api/vault/drive", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source }) })).source;
}

/**
 * GM: brings the vault in from Google Drive through their script: its notes in batches, then its
 * pictures a few at a time (those unchanged since they were last fetched aren't fetched again),
 * then finished, so notes taken out of the vault go from Table too.
 */
export async function syncFromDrive(room: RoomClient, say: (text: string) => void): Promise<{ notes: number; files: number; skipped: number }> {
  say("Asking Google Drive what's in your vault…");
  const start = await call<{ import: string; notes: string[]; files: { path: string; modified: number; bytes: number }[] }>("/api/vault/drive/start", { method: "POST" });
  for (let i = 0; i < start.notes.length; i += 100) {
    await call("/api/vault/drive/notes", post({ import: start.import, paths: start.notes.slice(i, i + 100) }));
    say(`Bringing in your notes from Google Drive: ${Math.min(i + 100, start.notes.length)} of ${start.notes.length}…`);
  }
  let skipped = 0;
  for (let i = 0; i < start.files.length; i += 8) {
    const r = await call<{ fetched: number; skipped: number }>("/api/vault/drive/files", post({ import: start.import, files: start.files.slice(i, i + 8) }));
    skipped += r.skipped;
    say(`Your pictures: ${Math.min(i + 8, start.files.length)} of ${start.files.length}…`);
  }
  const done = await call<{ notes: number; files: number }>("/api/vault/import/finish", post({ import: start.import }));
  await loadVault(room);
  return { ...done, skipped };
}
