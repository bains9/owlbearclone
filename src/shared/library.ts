// The GM's own monsters and NPCs (4 November 2026), and plain token pictures (15 November 2026):
// pictures the GM uploaded and filed under Monsters, NPCs or Tokens, kept once for every room (by
// the Directory, their files in R2 under library/) and listed at the top of those tabs. What the
// GM uploads in Tokens, or drops on the map, goes straight to Your tokens. Placing one in a room copies its picture into that room the
// first time (the room's picture says which entry it's a copy of), so its tokens work as any
// picture's do, for players too. Filing a room's upload copies it into the library, and that room's
// picture leaves its Tokens tab.
import type { Asset } from "./types";

export type Shelf = "monster" | "npc" | "token";

export const SHELVES: readonly Shelf[] = ["monster", "npc", "token"];

export interface LibraryEntry {
  id: string;
  shelf: Shelf;
  name: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: number;
}

/** How many pictures the library keeps, and how many bytes in all. */
export const MAX_LIBRARY = 1500;
export const MAX_LIBRARY_BYTES = 3 * 1024 * 1024 * 1024;
/** How many of a room's pictures one request files at once. */
export const MAX_FILE_AT_ONCE = 200;

/** A library entry's id: as a room picture's. */
export const LIBRARY_ID = /^[A-Za-z0-9]{16}$/;

export function isShelf(v: unknown): v is Shelf {
  return v === "monster" || v === "npc" || v === "token";
}

/** The tab a shelf is listed in. */
export function shelfName(s: Shelf): string {
  return s === "monster" ? "Monsters" : s === "npc" ? "NPCs" : "Tokens";
}

/**
 * A picture the Party made for a character's token in a room (client/party.ts characterAssetName:
 * "Aldwyn · figure 1k3x9", "Aldwyn · picture Ab12Cd34"). The Party makes one in each room it places
 * them in, so it isn't kept for every room.
 */
export function isCharacterPicture(name: string): boolean {
  return / · (?:figure|picture) [\w-]{1,16}$/.test(name);
}

/** What a shelf's pictures are called at the top of its tab. */
export function shelfLabel(s: Shelf): string {
  return s === "monster" ? "Your monsters" : s === "npc" ? "Your NPCs" : "Your tokens";
}

/** Where an entry's picture is kept in R2. */
export function libraryKey(id: string): string {
  return `library/${id}`;
}

/** Where a page gets an entry's picture. */
export function libraryFileUrl(id: string): string {
  return `/api/library/${id}/file`;
}

/**
 * Whether a room's picture is filed in the library (and so listed under Monsters or NPCs, not
 * Tokens): it's a copy of an entry that's still there. Before the library is read (null), any copy
 * counts, so filed pictures don't flash up in Tokens first.
 */
export function isFiled(a: Pick<Asset, "library">, library: readonly Pick<LibraryEntry, "id">[] | null): boolean {
  if (!a.library) return false;
  return library === null || library.some((e) => e.id === a.library);
}
