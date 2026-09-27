import type { Asset, AssetKind, RoomInfo, RoomSummary } from "../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export const api = {
  /** configured: a GM password is set. google: Google sign-in is set up. */
  me: () => call<{ gm: boolean; configured: boolean; google: boolean }>("/api/me"),
  login: (password: string) => call<{ gm: boolean }>("/api/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => call<{ gm: boolean }>("/api/logout", { method: "POST", body: "{}" }),
  listRooms: () => call<RoomSummary[]>("/api/rooms"),
  createRoom: (name: string) => call<RoomInfo>("/api/rooms", { method: "POST", body: JSON.stringify({ name }) }),
  deleteRoom: (id: string) => call<{ deleted: string }>(`/api/rooms/${id}`, { method: "DELETE" }),
};

export function fileUrl(roomId: string, assetId: string): string {
  return `/api/files/${roomId}/${assetId}`;
}

export function roomUrl(roomId: string): string {
  return `${location.origin}/r/${roomId}`;
}

const LIMITS: Record<AssetKind, { maxDim: number; maxBytes: number }> = {
  // Big enough for detailed battle maps, small enough for a phone to hold in memory.
  map: { maxDim: 6144, maxBytes: 12 * 1024 * 1024 },
  token: { maxDim: 1024, maxBytes: 1.5 * 1024 * 1024 },
};

const PASSTHROUGH = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"];

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Shrinks and re-encodes an image when it's larger than needed. Also says how big
 * the original was, so a grid measured on it can be scaled to match.
 */
export async function prepareImage(
  file: Blob,
  kind: AssetKind,
): Promise<{ blob: Blob; width: number; height: number; sourceWidth: number; sourceHeight: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That file isn't an image this browser can read.");
  }
  const { width, height } = bitmap;
  const { maxDim, maxBytes } = LIMITS[kind];
  if (PASSTHROUGH.includes(file.type) && Math.max(width, height) <= maxDim && file.size <= maxBytes) {
    bitmap.close();
    return { blob: file, width, height, sourceWidth: width, sourceHeight: height };
  }
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser couldn't process the image.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  let blob = await canvasToBlob(canvas, "image/webp", 0.88);
  // Older Safari can't encode WebP and silently returns PNG instead.
  if (!blob || blob.type !== "image/webp") {
    blob = await canvasToBlob(canvas, kind === "map" ? "image/jpeg" : "image/png", 0.9);
  }
  if (!blob) throw new Error("This browser couldn't process the image.");
  return { blob, width: w, height: h, sourceWidth: width, sourceHeight: height };
}

/** Uploads image bytes as they are (already prepared, or restored from a backup). */
export async function uploadBlob(
  roomId: string,
  blob: Blob,
  kind: AssetKind,
  name: string,
  width: number,
  height: number,
  uid: string,
): Promise<Asset> {
  const qs = new URLSearchParams({ kind, name: name.slice(0, 60) || "Image", w: String(width), h: String(height) });
  let res: Response;
  try {
    res = await fetch(`/api/rooms/${roomId}/assets?${qs}`, {
      method: "POST",
      headers: { "Content-Type": blob.type || "application/octet-stream", "X-Tabletop-User": uid },
      body: blob,
      credentials: "same-origin",
    });
  } catch {
    throw new Error("Upload failed: couldn't reach the server.");
  }
  const data = (await res.json().catch(() => ({}))) as Asset & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return data;
}

export interface Uploaded {
  asset: Asset;
  /** The size of the image before it was shrunk for upload. */
  source: { width: number; height: number };
}

export async function uploadImage(
  roomId: string,
  file: File,
  kind: AssetKind,
  uid: string,
  name = file.name.replace(/\.[a-z0-9]+$/i, ""),
): Promise<Uploaded> {
  const { blob, width, height, sourceWidth, sourceHeight } = await prepareImage(file, kind);
  const asset = await uploadBlob(roomId, blob, kind, name.slice(0, 60) || "Image", width, height, uid);
  return { asset, source: { width: sourceWidth, height: sourceHeight } };
}
