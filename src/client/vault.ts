// The GM's campaign notes on the page (shared/vault.ts), for each of their vaults: the list, a note,
// a search, and bringing vaults in: from a folder picked in the browser (on any system: a vault's
// own folder, or the folder holding several, each brought in separately), or from Google Drive
// through their vault script. Each vault comes in as its notes in batches, then its pictures, each
// sent only if Table hasn't a copy already (by its checksum), then finished, so notes taken out of
// that vault go from Table too. Handouts and token links go through the room.
import { VAULT_LIMITS, isVaultName, vaultKind, type VaultIndex, type VaultNoteInfo, type VaultSearchHit } from "../shared/vault";
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

/** GM: reads the vaults' list into the room's state. */
export async function loadVault(room: RoomClient): Promise<void> {
  room.store.set({ vault: await call<VaultIndex>("/api/vault") });
}

export async function fetchNote(vault: string, path: string): Promise<string> {
  return (await call<{ body: string }>(`/api/vault/note?vault=${encodeURIComponent(vault)}&path=${encodeURIComponent(path)}`)).body;
}

/** Notes with these words, in one vault or (null) all of them. */
export async function searchVault(q: string, vault: string | null): Promise<VaultSearchHit[]> {
  return call<VaultSearchHit[]>(`/api/vault/search?q=${encodeURIComponent(q)}${vault ? `&vault=${encodeURIComponent(vault)}` : ""}`);
}

interface Picked {
  name: string;
  webkitRelativePath?: string;
}

/**
 * The vaults in a picked folder, each with its files at their places in it: the folder itself when
 * it's a vault (Obsidian's .obsidian folder, or notes, at its top), else each folder in it (named by
 * the folder), as when a GM picks the folder holding all their vaults.
 */
export function vaultsIn<T extends Picked>(files: readonly T[]): Map<string, { path: string; file: T }[]> {
  const parts = files.map((f) => (f.webkitRelativePath || f.name).split("/"));
  const rootIsVault = parts.some((p) => (p.length >= 3 && p[1] === ".obsidian") || (p.length === 2 && /\.md$/i.test(p[1])));
  const out = new Map<string, { path: string; file: T }[]>();
  files.forEach((file, i) => {
    const p = parts[i];
    let vault: string;
    let path: string;
    if (p.length === 1) [vault, path] = ["Vault", p[0]];
    else if (rootIsVault) [vault, path] = [p[0], p.slice(1).join("/")];
    else if (p.length >= 3) [vault, path] = [p[1], p.slice(2).join("/")];
    else return;
    if (!isVaultName(vault)) return;
    out.set(vault, [...(out.get(vault) ?? []), { path, file }]);
  });
  return out;
}

async function sha256(data: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Brought {
  vaults: string[];
  notes: number;
  files: number;
  skipped: number;
}

/** Brings one vault in from its files: what's in Table of that vault is replaced. */
async function importOne(vault: string, entries: { path: string; file: File }[], say: (text: string) => void): Promise<Omit<Brought, "vaults">> {
  const notes: { path: string; file: File }[] = [];
  const pictures: { path: string; file: File }[] = [];
  let skipped = 0;
  for (const e of entries) {
    const kind = vaultKind(e.path);
    if (kind === "note") notes.push(e);
    else if (kind === "picture") {
      if (e.file.size > VAULT_LIMITS.fileBytes) skipped++;
      else pictures.push(e);
    }
  }
  if (notes.length > VAULT_LIMITS.notes) {
    skipped += notes.length - VAULT_LIMITS.notes;
    notes.length = VAULT_LIMITS.notes;
  }
  const { import: id } = await call<{ import: string }>("/api/vault/import", post({ vault }));
  let batch: { path: string; body: string }[] = [];
  let bytes = 0;
  let sent = 0;
  const flush = async () => {
    if (!batch.length) return;
    await call("/api/vault/import/notes", post({ vault, import: id, notes: batch }));
    sent += batch.length;
    say(`${vault}: bringing in your notes, ${sent} of ${notes.length}…`);
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
    if (i % 20 === 0) say(`${vault}: looking at your pictures, ${i} of ${pictures.length}…`);
    const p = pictures[i];
    infos.push({ path: p.path, hash: await sha256(await p.file.arrayBuffer()), bytes: p.file.size, file: p.file });
  }
  const missing = new Set<string>();
  for (let i = 0; i < infos.length; i += 300) {
    const chunk = infos.slice(i, i + 300).map(({ path, hash, bytes: b }) => ({ path, hash, bytes: b }));
    const reply = await call<{ missing: string[] }>("/api/vault/import/files", post({ vault, import: id, files: chunk }));
    for (const h of reply.missing) missing.add(h);
  }
  const sending = infos.filter((x) => missing.has(x.hash));
  for (let i = 0; i < sending.length; i++) {
    const x = sending[i];
    say(`${vault}: sending your pictures, ${i + 1} of ${sending.length}…`);
    const qs = new URLSearchParams({ vault, import: id, path: x.path });
    try {
      await call(`/api/vault/import/file/${x.hash}?${qs}`, { method: "PUT", body: x.file });
    } catch {
      // A picture Table can't take (a kind it doesn't show): left out.
      skipped++;
    }
  }
  const done = await call<{ notes: number; files: number }>("/api/vault/import/finish", post({ vault, import: id }));
  return { ...done, skipped };
}

/**
 * GM: brings vaults in from a picked folder (one vault's, or the folder holding several), saying how
 * it's going. Each vault found replaces what's in Table of it; other vaults are left as they are.
 */
export async function importVault(room: RoomClient, picked: File[], say: (text: string) => void): Promise<Brought> {
  const found = [...vaultsIn(picked)].filter(([, entries]) => entries.some((e) => vaultKind(e.path) === "note"));
  if (!found.length) throw new Error("That folder has no notes in it. Pick your vault's folder, or the folder holding your vaults.");
  const total: Brought = { vaults: [], notes: 0, files: 0, skipped: 0 };
  for (const [vault, entries] of found) {
    const r = await importOne(vault, entries, say);
    total.vaults.push(vault);
    total.notes += r.notes;
    total.files += r.files;
    total.skipped += r.skipped;
  }
  await loadVault(room);
  return total;
}

/** GM: takes one vault (or with null, all of them) out of Table. */
export async function clearVault(room: RoomClient, vault: string | null): Promise<void> {
  await call(`/api/vault${vault ? `?vault=${encodeURIComponent(vault)}` : ""}`, { method: "DELETE" });
  const open = room.state.noteOpen;
  if (!vault || open?.startsWith(`${vault}|`)) room.store.set({ noteOpen: null });
  await loadVault(room);
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
 * GM: brings the vaults in from Google Drive through their script, one after another: each vault's
 * notes in batches, then its pictures a few at a time (those unchanged since they were last fetched
 * aren't fetched again), then finished, so notes taken out of a vault go from Table too.
 */
export async function syncFromDrive(room: RoomClient, say: (text: string) => void): Promise<Brought> {
  say("Asking Google Drive what's in your vaults…");
  const { vaults } = await call<{ vaults: { name: string; notes: string[]; files: { path: string; modified: number; bytes: number }[] }[] }>("/api/vault/drive/list", { method: "POST" });
  const total: Brought = { vaults: [], notes: 0, files: 0, skipped: 0 };
  for (const v of vaults) {
    const { import: id } = await call<{ import: string }>("/api/vault/import", post({ vault: v.name }));
    for (let i = 0; i < v.notes.length; i += 100) {
      await call("/api/vault/drive/notes", post({ vault: v.name, import: id, paths: v.notes.slice(i, i + 100) }));
      say(`${v.name}: bringing in your notes from Google Drive, ${Math.min(i + 100, v.notes.length)} of ${v.notes.length}…`);
    }
    for (let i = 0; i < v.files.length; i += 8) {
      const r = await call<{ fetched: number; skipped: number }>("/api/vault/drive/files", post({ vault: v.name, import: id, files: v.files.slice(i, i + 8) }));
      total.skipped += r.skipped;
      say(`${v.name}: your pictures, ${Math.min(i + 8, v.files.length)} of ${v.files.length}…`);
    }
    const done = await call<{ notes: number; files: number }>("/api/vault/import/finish", post({ vault: v.name, import: id }));
    total.vaults.push(v.name);
    total.notes += done.notes;
    total.files += done.files;
  }
  await loadVault(room);
  return total;
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
