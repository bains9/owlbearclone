// Attaching a Dungeondraft project file to a scene, on the GM's main thread (design 2.1 to 2.8).
// The picture is decoded here through the canvas path seasons.ts uses and its pixels are
// transferred to the lazy dd worker (ddWorker.ts), which reads the project file itself, parses it,
// picks the level, checks the fit, measures and compiles the sidecar. The raw file is never uploaded.

import type { Asset } from "../../shared/types";
import type { RoomClient } from "../room/client";
import type { AttachReport, FitResult, VttMeta } from "./extract";

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
  }): Promise<{ report: AttachReport; sidecar: Uint8Array; preview: ImageData; compare?: { exact: ImageData; guessed: ImageData } }> {
  throw new Error("not implemented: prepareAttach");
}

/** Checks an attached sidecar against a picture (Check..., or Use it with this picture), by the object-centre fit. */
export async function checkAttached(sidecarAssetUrl: string, picture: Blob,
  picSize: { width: number; height: number }): Promise<FitResult | { error: string }> {
  throw new Error("not implemented: checkAttached");
}

/** packPng, then uploads the box as a "mapdata" asset named `label` (e.g. "waterfall · Ground"). */
export async function uploadSidecar(room: RoomClient, sidecar: Uint8Array, label: string): Promise<Asset> {
  throw new Error("not implemented: uploadSidecar");
}

/**
 * Deletes "mapdata" assets no scene refers to, except those created, attached or detached in this
 * session (so this tab's undo still works). Returns how many were deleted.
 */
export async function cleanUpSidecars(room: RoomClient, touchedThisSession: ReadonlySet<string>): Promise<number> {
  throw new Error("not implemented: cleanUpSidecars");
}
