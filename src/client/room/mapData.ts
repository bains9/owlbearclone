// Loading scenes' Dungeondraft sidecars for seasons (design 5.2): fetched once, unpacked and fully
// validated on the main thread, kept for the scenes in play. Failures never throw; they become a
// state the Season notes can explain, and the scene's seasons guess from the picture meanwhile.

import type { SidecarMeta } from "../dd/sidecar";

/**
 * A sidecar's load state. retrying: a network error or 5xx, tried again after 5 s and 30 s;
 * missing: a 404, or the retries failed (tried again on wake()); unreadable: bad magic, CRC or
 * section (not retried this visit); newer: a format this build doesn't know ("Update Tabletop");
 * noDecompress: no DecompressionStream on this device.
 */
export type DataState = "ok" | "loading" | "retrying" | "missing" | "unreadable" | "newer" | "noDecompress";

/**
 * A scene's data state as the board plans it (5.1): none attached, paused (attached to another
 * picture), on hold, a green map (v1), or its sidecar's load state.
 */
export type SceneDataState = "none" | "paused" | "hold" | "green" | DataState;

/** Validated sidecars kept. */
export const SIDECAR_CACHE_SIZE = 4;
/** Waits before each retry after a network error or 5xx, in ms. */
export const SIDECAR_RETRY_MS: readonly number[] = [5000, 30_000];

export type SidecarResult = { ok: true; bytes: Uint8Array; meta: SidecarMeta } | { ok: false; state: DataState };

export class SidecarCache {
  private readonly onChange: (assetId: string) => void;

  /** onChange: a sidecar's state changed (the board re-plans the scene's job). */
  constructor(onChange: (assetId: string) => void) {
    this.onChange = onChange;
  }

  /** Fetches, unpacks and fully validates (decodeSidecar) on the main thread. Never throws. */
  get(roomId: string, assetId: string): Promise<SidecarResult> {
    throw new Error("not implemented: SidecarCache.get");
  }

  state(assetId: string): DataState | undefined {
    throw new Error("not implemented: SidecarCache.state");
  }

  /** A scene change or the page becoming visible again: "missing" entries may be tried again. */
  wake(): void {
    throw new Error("not implemented: SidecarCache.wake");
  }
}
