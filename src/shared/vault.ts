// The GM's campaign notes (4 November 2026): their Obsidian vaults (Vern keeps several), each brought
// into Table from their own computer (any system: Vern's is Ubuntu) by picking its folder, or the
// folder holding them all, or from Google Drive; kept for every room, each vault by its folder's
// name (the Directory keeps the notes, R2 the pictures, by their checksum so an unchanged one isn't
// sent again), read only by the GM. A note, or the part of one the GM picks, can be shown to the
// players as a handout; a token can be linked to a note (kept by its room, for the GM only).

export interface VaultNoteInfo {
  /** The vault it's in: its folder's name. */
  vault: string;
  /** Where it is in the vault, as Obsidian has it: "Factions/Red Tide.md". */
  path: string;
  title: string;
  size: number;
}

export interface VaultFileInfo {
  /** Where a picture is in the vault: "Attachments/Hilda.png". */
  path: string;
  /** Its SHA-256, hex: the name its copy is kept under. */
  hash: string;
  mime: string;
  bytes: number;
}

export interface VaultSummary {
  name: string;
  /** When it was last brought in (null: never). */
  importedAt: number | null;
  notes: number;
}

export interface VaultIndex {
  vaults: VaultSummary[];
  notes: VaultNoteInfo[];
  files: (VaultFileInfo & { vault: string })[];
}

export interface VaultSearchHit {
  vault: string;
  path: string;
  title: string;
  /** A line or two of the note around what was found. */
  snippet: string;
}

/** A note, or part of one, the GM showed the players (kept by the room). */
export interface Handout {
  id: string;
  title: string;
  /** Its HTML as the GM's page made it; every page cleans it again before showing it. */
  html: string;
  at: number;
}

export const VAULT_LIMITS = {
  notes: 6000,
  noteBytes: 400_000,
  files: 6000,
  fileBytes: 15 * 1024 * 1024,
  fileTotal: 3 * 1024 * 1024 * 1024,
  /** A batch of notes sent at once: this many, or this many bytes, whichever comes first. */
  batchNotes: 150,
  batchBytes: 1_500_000,
  /** Vaults kept at once. */
  vaults: 30,
  handouts: 40,
  handoutBytes: 120_000,
  /** All of a room's handouts together (the oldest go first past it). */
  handoutsBytes: 1_400_000,
  /** Tokens linked to notes, a room. */
  tokenNotes: 3000,
  title: 160,
  path: 400,
} as const;

/** The pictures a vault's notes can show (the kinds browsers show, sniffed by their bytes). */
export const VAULT_PICTURES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export const VAULT_HASH = /^[0-9a-f]{64}$/;

/** A path inside the vault, as the GM's page sends it: relative, no way out of it, nothing odd. */
export function isVaultPath(v: unknown): v is string {
  if (typeof v !== "string" || !v || v.length > VAULT_LIMITS.path) return false;
  if (v.startsWith("/") || v.includes("\\") || /[\u0000-\u001f\u007f]/.test(v)) return false;
  return v.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** A vault's name, its folder's: words, no slashes or bars, not hidden. */
export function isVaultName(v: unknown): v is string {
  return typeof v === "string" && v.length >= 1 && v.length <= 80 && v.trim() === v && !/[/\\|\u0000-\u001f\u007f]/.test(v) && !v.startsWith(".");
}

/** A note named across vaults (a token's link, the note open): "Eastport|Factions/Red Tide.md". */
export function noteRef(vault: string, path: string): string {
  return `${vault}|${path}`;
}

export function parseNoteRef(ref: unknown): { vault: string; path: string } | null {
  if (typeof ref !== "string") return null;
  const at = ref.indexOf("|");
  const vault = ref.slice(0, at);
  const path = ref.slice(at + 1);
  return at > 0 && isVaultName(vault) && isVaultPath(path) ? { vault, path } : null;
}

/** A note's title: its file's name without ".md". */
export function noteTitle(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

/** Whether a path in the vault is something to bring in: a note or a picture, not Obsidian's own settings or its bin. */
export function vaultKind(path: string): "note" | "picture" | null {
  if (path.split("/").some((part) => part.startsWith("."))) return null;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md") return "note";
  return VAULT_PICTURES[ext] ? "picture" : null;
}

export function vaultFileKey(hash: string): string {
  return `vault/${hash}`;
}

export function vaultFileUrl(hash: string): string {
  return `/api/vault/file/${hash}`;
}
