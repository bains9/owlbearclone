// Asset references and what Seasons may infer from them.
//
// Policy (Par): items from asset packs are OPAQUE. We never open, read or reproduce pack
// files, and we do not interpret a pack item beyond "its area stays as drawn" — whatever its
// file name says and whatever its allow_3rd_party_mapping_software_to_read flag is. Only
// Dungeondraft's own default assets (res://textures/...) are classified by name, in roles.ts.

import type { AssetRef, AssetPack } from "./model";

export function parseAssetRef(v: unknown, packs: Map<string, AssetPack>): AssetRef | null {
  if (typeof v !== "string" || v.length === 0 || v.length > 1024) return null;
  const path = v;
  if (path.startsWith("res://packs/")) {
    const id = path.split("/")[3] ?? "";
    const pack = packs.get(id);
    return { path, source: "pack", packId: id, packReadable: pack ? pack.allowThirdParty : false, segments: [] };
  }
  if (path.startsWith("res://textures/")) {
    const rest = path.slice("res://textures/".length).replace(/\.[a-z0-9]+$/i, "");
    const segments = rest.split("/").filter((s) => s.length > 0);
    // "res://textures/../packs/<id>/..." would reach a pack's file through a default-looking path:
    // anything that isn't a plain relative path is not trusted as a default asset.
    if (segments.some((s) => s === "." || s === ".." || /[\\:]/.test(s))) return { path, source: "unknown", segments: [] };
    return { path, source: "default", segments: segments.slice(0, 12) };
  }
  if (path.startsWith("res://")) return { path, source: "unknown", segments: [] };
  // Embedded textures (world.embedded) are referenced by key.
  return { path, source: "embedded", segments: [] };
}

export function assetName(a: AssetRef | null): string {
  if (!a) return "";
  if (a.source !== "default") return "";
  return a.segments[a.segments.length - 1] ?? "";
}
