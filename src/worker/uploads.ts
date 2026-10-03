// What an upload must be, by kind: kept apart from the request handling so tests can
// check it without the Workers runtime.

import type { AssetKind, Role } from "../shared/types";

export const MAX_UPLOAD_BYTES: Record<AssetKind, number> = {
  map: 30 * 1024 * 1024,
  token: 5 * 1024 * 1024,
  // A sidecar's payload is capped at 8 MiB; the rest is room for its PNG box when the
  // browser can't compress it (stored deflate blocks and a filter byte a row).
  mapdata: 9 * 1024 * 1024,
};

/** The kind named in an upload's query, or null for anything else. */
export function uploadKind(v: string | null): AssetKind | null {
  return v === "map" || v === "token" || v === "mapdata" ? v : null;
}

/** Whether this role may upload this kind: players only tokens, and only when the GM allows it. */
export function kindAllowed(role: Role, kind: AssetKind, playersCanAddTokens: boolean): boolean {
  return role === "gm" || (kind === "token" && playersCanAddTokens);
}

/** Identifies the image type from its first bytes, so a file is served as what it really is. */
export function sniffImage(b: Uint8Array): string | null {
  const at = (offset: number, text: string) =>
    b.length >= offset + text.length && [...text].every((ch, i) => b[offset + i] === ch.charCodeAt(0));
  if (b[0] === 0x89 && at(1, "PNG")) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (at(0, "GIF87a") || at(0, "GIF89a")) return "image/gif";
  if (at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  if (at(4, "ftyp") && (at(8, "avif") || at(8, "avis"))) return "image/avif";
  return null;
}

/**
 * The type to store an upload of this kind as, from its first bytes, or the reason it can't be
 * stored (answered with 415). Dungeondraft data is always a PNG made by Tabletop.
 */
export function uploadType(kind: AssetKind, head: Uint8Array): { mime: string } | { refusal: string } {
  const mime = sniffImage(head);
  if (kind === "mapdata") {
    if (mime === "image/png") return { mime };
    return { refusal: "Dungeondraft data can only be uploaded as a PNG made by Tabletop." };
  }
  return mime ? { mime } : { refusal: "Only PNG, JPEG, WebP, GIF or AVIF images can be uploaded." };
}
