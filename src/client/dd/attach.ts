// Attaching a Dungeondraft project file to a scene, on the GM's main thread (design 2.1 to 2.8).
// The picture is decoded here through the canvas path seasons.ts uses and its pixels are
// transferred to the lazy dd worker (ddWorker.ts), which reads the project file itself, parses it,
// picks the level, checks the fit, measures and compiles the sidecar. The raw file is never uploaded.
//
// The worker starts on the first attach or check, takes one message at a time, and stops after a
// minute with nothing to do (a parsed map is big; nothing is kept between messages anyway).
// Every refusal reaches the caller as an AttachError whose message is plain text for the GM (6.1).
// This file imports nothing of the worker's (the parser, the extractor, the season kernels), so
// the page doesn't load them: the few numbers and texts both sides need are kept equal by a test.

import type { Asset } from "../../shared/types";
import type { RoomClient } from "../room/client";
import { uploadBlob } from "../api";
import type { AttachReport, FitResult, PictureSample, VttMeta } from "./extract";
import type { DdWorkerIn, DdWorkerOut } from "./messages";
import { DEFAULT_LIMITS, GRID } from "./model";
import { canUnpack, packPng, unpackPng } from "./pngBox";
import { SECTION, SIDECAR_CAPS, SIDECAR_FORMAT, SIDECAR_HEADER_BYTES, SidecarError, readFormat } from "./sidecar";

/** A refusal to show the GM as it is (plain language, 6.1). */
export class AttachError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachError";
  }
}

/** What the GM is told (6.1). tooBig, unreadable and failed are the worker's DD_TEXT too. */
export const ATTACH_TEXT = {
  tooBig: "That file is too big to read here (over 60 MB).",
  unreadable: "The Dungeondraft data couldn't be read.",
  failed: "Something went wrong reading the map. Try again, or attach it from a desktop browser.",
  noWorker: "This browser can't read Dungeondraft files; try a current desktop browser.",
  stopped: "Reading the Dungeondraft file stopped part way (the browser may have run short of memory). Try again, or use a desktop browser.",
  picture: "This picture couldn't be read.",
  noCanvas: "This browser couldn't read the picture's pixels.",
  noUnpack: "This browser is too old for exact seasons, so they're guessed from the picture.",
  noLoad: "The Dungeondraft data couldn't be loaded. Check the connection and try again.",
  newer: "This scene's Dungeondraft data is newer than this copy of Tabletop: reload to use it.",
} as const;

/** Project files over this many bytes are refused before anything is read (the parser's maxChars, 60 MiB; ddWorker's DD_MAX_FILE_BYTES). */
export const ATTACH_MAX_FILE_BYTES = DEFAULT_LIMITS.maxChars;

/** The picture is decoded at no more than this many pixels a square when the squares are known (ddWorker's DD_MAX_PX_PER_SQUARE). */
const MAX_PX_PER_SQUARE = 32;

/** The worker stops after this long with nothing to do, giving its memory back. */
export const DD_WORKER_IDLE_MS = 60_000;

/**
 * Unreferenced sidecars younger than this are left alone by cleanUpSidecars: another GM tab may
 * have just uploaded one and not yet set it on its scene.
 */
export const SIDECAR_GRACE_MS = 60 * 60 * 1000;

/** Prepares a sidecar for a picture: nothing is uploaded or changed yet. */
export async function prepareAttach(ddFile: File, picture: Blob, picSize: { width: number; height: number },
  opts: {
    vtt?: VttMeta;
    /** The scene's mapRect, in squares [x, y, w, h]. */
    mapRect?: [number, number, number, number];
    /** A level the GM picked (level.key). */
    levelKey?: string;
    /** A whole-square shift to line it up, in squares. */
    shift?: [number, number];
    /** Also bake the Compare pair (exact against guessed). */
    compare?: boolean;
    onProgress?: (s: string) => void;
    /** Cancels it (the dialog closed): the promise rejects with the signal's reason (an AbortError). */
    signal?: AbortSignal;
  }): Promise<{ report: AttachReport; sidecar: Uint8Array; preview: ImageData; compare?: { exact: ImageData; guessed: ImageData } }> {
  if (!(ddFile.size <= ATTACH_MAX_FILE_BYTES)) throw new AttachError(ATTACH_TEXT.tooBig);
  opts.signal?.throwIfAborted();
  opts.onProgress?.("Reading the picture…");
  // At most 32 px a square: decoded that small when the squares are known already (else the
  // worker shrinks it once it has read the map).
  const squaresW = opts.vtt?.resolution.map_size.x ?? opts.mapRect?.[2];
  const pic = await decodePicture(picture, sampleCap(), squaresW);
  opts.signal?.throwIfAborted();
  const msg: DdWorkerIn = {
    t: "prepare", id: 0, file: ddFile, pic, picW: picSize.width, picH: picSize.height,
    vtt: opts.vtt, mapRect: opts.mapRect, levelKey: opts.levelKey, shift: opts.shift, compare: opts.compare,
  };
  const out = await call(msg, [pic.rgba.buffer], opts.onProgress, opts.signal);
  if (out.t === "error") throw new AttachError(out.message);
  if (out.t !== "prepared") throw new AttachError(ATTACH_TEXT.failed);
  const res: { report: AttachReport; sidecar: Uint8Array; preview: ImageData; compare?: { exact: ImageData; guessed: ImageData } } = {
    report: out.report,
    sidecar: out.sidecar,
    preview: imageData(out.preview, out.pw, out.ph),
  };
  if (out.compare) {
    const c = out.compare;
    res.compare = { exact: imageData(c.exact, c.w, c.h), guessed: imageData(c.guessed, c.w, c.h) };
  }
  return res;
}

/** Checks an attached sidecar against a picture (Check..., or Use it with this picture), by the object-centre fit. */
export async function checkAttached(sidecarAssetUrl: string, picture: Blob,
  picSize: { width: number; height: number }): Promise<FitResult | { error: string }> {
  try {
    if (!canUnpack()) return { error: ATTACH_TEXT.noUnpack };
    let res: Response;
    try {
      res = await fetch(sidecarAssetUrl, { credentials: "same-origin" });
    } catch {
      return { error: ATTACH_TEXT.noLoad };
    }
    if (!res.ok) return { error: ATTACH_TEXT.noLoad };
    let bytes: Uint8Array;
    try {
      bytes = await unpackPng(await res.blob());
    } catch (e) {
      if (e instanceof SidecarError) return { error: ATTACH_TEXT.unreadable };
      throw e;
    }
    const format = readFormat(bytes);
    if (format !== null && format > SIDECAR_FORMAT) return { error: ATTACH_TEXT.newer };
    // Without the box's zero padding (decodeSidecar reads the length from the header).
    if (bytes.length >= SIDECAR_HEADER_BYTES) {
      const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
      if (SIDECAR_HEADER_BYTES + len <= bytes.length) bytes = bytes.slice(0, SIDECAR_HEADER_BYTES + len);
    }
    // At most 32 px a square, as the worker fits it: the squares across are in the data's META.
    const pic = await decodePicture(picture, sampleCap(), metaSquaresW(bytes));
    const out = await call({ t: "check", id: 0, sidecar: bytes, pic, picW: picSize.width, picH: picSize.height },
      [bytes.buffer, pic.rgba.buffer]);
    if (out.t === "checked") return out.fit;
    return { error: out.t === "error" ? out.message : ATTACH_TEXT.failed };
  } catch (e) {
    return { error: e instanceof AttachError ? e.message : ATTACH_TEXT.failed };
  }
}

/** packPng, then uploads the box as a "mapdata" asset named `label` (e.g. "waterfall · Ground"). */
export async function uploadSidecar(room: RoomClient, sidecar: Uint8Array, label: string): Promise<Asset> {
  const { blob, width, height } = await packPng(sidecar);
  const asset = await uploadBlob(room.roomId, blob, "mapdata", label, width, height, room.profileInfo.uid);
  // At once, as picture uploads do, so the clean-up and the Library know it before the server says so.
  room.store.set((s) => ({ assets: { ...s.assets, [asset.id]: asset } }));
  return asset;
}

/**
 * Deletes "mapdata" assets no scene refers to, except those created, attached or detached in this
 * session (so this tab's undo still works). Returns how many were deleted.
 * Only a GM's tab deletes anything, and only while connected (so the scenes it sees are the
 * room's); and never a sidecar uploaded within SIDECAR_GRACE_MS (another tab's attach on its way).
 */
export async function cleanUpSidecars(room: RoomClient, touchedThisSession: ReadonlySet<string>): Promise<number> {
  const s = room.state;
  if (room.display || !room.isGm || s.status !== "open" || !s.room) return 0;
  const used = new Set<string>();
  for (const sc of Object.values(s.scenes)) if (sc.mapData) used.add(sc.mapData.assetId);
  const now = Date.now();
  let n = 0;
  for (const a of Object.values(s.assets)) {
    if (a.kind !== "mapdata" || used.has(a.id) || touchedThisSession.has(a.id)) continue;
    if (!(now - a.createdAt >= SIDECAR_GRACE_MS)) continue;
    room.deleteAsset(a.id);
    n++;
  }
  return n;
}

/** A sidecar section's header: a tag byte and a u32 length (sidecar.ts). */
const SECTION_HEAD = 5;

/**
 * The squares across a sidecar's picture shows (its META.rect's width), read cheaply without
 * decoding the rest, or undefined when it can't be read that way (the worker checks it all).
 */
export function metaSquaresW(bytes: Uint8Array): number | undefined {
  if (readFormat(bytes) === null) return undefined;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = Math.min(bytes.length, SIDECAR_HEADER_BYTES + dv.getUint32(8, true));
  for (let p = SIDECAR_HEADER_BYTES; p + SECTION_HEAD <= end;) {
    const len = dv.getUint32(p + 1, true), body = p + SECTION_HEAD;
    if (len > end - body) return undefined;
    if (bytes[p] === SECTION.META) {
      if (len > SIDECAR_CAPS.metaBytes) return undefined;
      try {
        const r = (JSON.parse(new TextDecoder().decode(bytes.subarray(body, body + len))) as { rect?: unknown }).rect;
        const w = Array.isArray(r) && r.length === 4 ? (Number(r[2]) - Number(r[0])) / GRID : NaN;
        return Number.isFinite(w) && w > 0 ? w : undefined;
      } catch {
        return undefined;
      }
    }
    p = body + len;
  }
  return undefined;
}

// ---------------------------------------------------------------- the picture

/** The longest side the picture is sampled at (2.1): 4096 px on a desktop with deviceMemory 4 or more, else 2048. */
export function sampleCap(): number {
  const nav = (typeof navigator === "undefined" ? {} : navigator) as Navigator & { deviceMemory?: number };
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return !coarse && (nav.deviceMemory ?? 0) >= 4 ? 4096 : 2048;
}

/**
 * The picture's pixels, read as seasons.ts reads a map (drawn into a canvas with the smoothest
 * downscale, see-through parts kept): at most `cap` px on the long side, and at most
 * MAX_PX_PER_SQUARE a square when the squares across are known.
 */
async function decodePicture(picture: Blob, cap: number, squaresW?: number): Promise<PictureSample> {
  const url = URL.createObjectURL(picture);
  try {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new AttachError(ATTACH_TEXT.picture);
    }
    const nw = img.naturalWidth, nh = img.naturalHeight;
    if (!(nw > 0 && nh > 0)) throw new AttachError(ATTACH_TEXT.picture);
    let k = Math.min(1, cap / Math.max(nw, nh));
    if (squaresW !== undefined && squaresW > 0) k = Math.min(k, (MAX_PX_PER_SQUARE * squaresW) / nw);
    const w = Math.max(1, Math.round(nw * k)), h = Math.max(1, Math.round(nh * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    try {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx || canvas.width !== w || canvas.height !== h) throw new AttachError(ATTACH_TEXT.noCanvas);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, nw, nh, 0, 0, w, h);
      return { rgba: ctx.getImageData(0, 0, w, h).data, w, h };
    } finally {
      // Its memory back at once (iOS is slow to otherwise).
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

function imageData(px: Uint8ClampedArray, w: number, h: number): ImageData {
  return new ImageData(px as Uint8ClampedArray<ArrayBuffer>, w, h);
}

// ---------------------------------------------------------------- the worker

interface Call {
  resolve(m: DdWorkerOut): void;
  reject(e: unknown): void;
  progress?: (s: string) => void;
}

let worker: Worker | null = null;
/** Whether the current worker has said anything yet (one that fails before then can't run here). */
let heard = false;
let idle: ReturnType<typeof setTimeout> | undefined;
let nextId = 1;
const calls = new Map<number, Call>();

/** The worker, started on first use. */
function ddWorker(): Worker {
  if (worker) return worker;
  if (typeof Worker !== "function") throw new AttachError(ATTACH_TEXT.noWorker);
  let w: Worker;
  try {
    w = new Worker(new URL("./ddWorker.ts", import.meta.url), { type: "module" });
  } catch {
    throw new AttachError(ATTACH_TEXT.noWorker);
  }
  heard = false;
  w.onmessage = (e: MessageEvent<DdWorkerOut>) => {
    if (worker !== w) return;
    heard = true;
    const m = e.data;
    const c = calls.get(m.id);
    if (!c) return;
    if (m.t === "progress") {
      c.progress?.(m.text);
      return;
    }
    calls.delete(m.id);
    c.resolve(m);
    if (calls.size === 0) idleSoon();
  };
  w.onerror = (e: Event) => {
    e.preventDefault?.();
    if (worker === w) stop(heard ? ATTACH_TEXT.stopped : ATTACH_TEXT.noWorker);
  };
  worker = w;
  return w;
}

/** Stops the worker; calls still waiting are refused with `message`. */
function stop(message: string): void {
  clearTimeout(idle);
  worker?.terminate();
  worker = null;
  const waiting = [...calls.values()];
  calls.clear();
  for (const c of waiting) c.reject(new AttachError(message));
}

function idleSoon(): void {
  clearTimeout(idle);
  idle = setTimeout(() => {
    if (calls.size === 0) stop(ATTACH_TEXT.failed);
  }, DD_WORKER_IDLE_MS);
}

/** Sends one message (its id set here) and waits for its answer; progress lines go to `progress`. */
function call(msg: DdWorkerIn, transfer: Transferable[], progress?: (s: string) => void, signal?: AbortSignal): Promise<DdWorkerOut> {
  signal?.throwIfAborted();
  const w = ddWorker();
  clearTimeout(idle);
  const id = nextId++;
  return new Promise<DdWorkerOut>((resolve, reject) => {
    const onAbort = () => {
      if (!calls.delete(id)) return;
      reject(signal!.reason);
      // The work can't be interrupted, only thrown away with the worker, when nothing else waits on it.
      if (worker === w) {
        if (calls.size === 0) stop(ATTACH_TEXT.failed);
      }
    };
    const done = () => signal?.removeEventListener("abort", onAbort);
    calls.set(id, {
      resolve: (m) => { done(); resolve(m); },
      reject: (e) => { done(); reject(e); },
      progress,
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      w.postMessage({ ...msg, id }, transfer);
    } catch (e) {
      calls.delete(id);
      done();
      reject(e);
    }
  });
}
