// Dungeon's maps, for New scene › From Dungeon. Dungeon (dungeon.parhome.ca) keeps the GM's maps
// online; its bridge page (Dungeon's src/bridge/), opened here in a hidden frame, lists them and
// draws one as a Universal VTT file with Dungeon's own code: the very file Dungeon's Export makes.
// It comes back as a File for the usual import (importScenes.ts), so a map is never saved twice:
// it stays where Dungeon keeps it until it's brought into a room. The messages are described in
// Dungeon's src/bridge/bridge.ts. Dungeon lets only this site frame the bridge, and signs itself
// in on the way with the GM's Table sign-in.

import { DUNGEON_URL } from "./dungeonLink";

/** A map in Dungeon, as the bridge lists it. */
export interface DungeonMap {
  id: string;
  name: string;
  /** When Dungeon last saved it (ISO). */
  updated: string;
}

/** When Dungeon last saved a map, in words. */
export function savedWhen(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const min = Math.round((now - t) / 60_000);
  if (min < 1) return "Saved just now";
  if (min < 60) return `Saved ${min} minute${min === 1 ? "" : "s"} ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `Saved ${h} hour${h === 1 ? "" : "s"} ago`;
  return `Saved ${new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** The frame's end of things, as the bridge needs it (a stand-in plays it in the tests). */
export interface BridgeFrame {
  post(message: unknown): void;
  /** Starts hearing the frame's messages; returns how to stop. */
  listen(onMessage: (data: unknown) => void): () => void;
  close(): void;
}

/** Something the bridge couldn't do; signedOut when Dungeon's sign-in ran out (a fresh frame signs in again). */
export class BridgeError extends Error {
  constructor(
    message: string,
    readonly signedOut = false,
  ) {
    super(message);
  }
}

/** Long enough to sign in on the way. */
const READY_MS = 30_000;
const LIST_MS = 30_000;
/** Drawing every level of a big map takes a while. */
const FILE_MS = 5 * 60_000;

interface Waiting {
  resolve(value: unknown): void;
  reject(err: Error): void;
  progress?: (level: number, of: number) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const NO_ANSWER = "Dungeon didn't answer. Check you're signed in as the GM, then try again.";

export class DungeonBridge {
  private next = 1;
  private readonly waiting = new Map<number, Waiting>();
  private readonly ready: Promise<void>;
  private settle!: { ok(): void; fail(err: BridgeError): void };
  private isReady = false;
  private readonly stop: () => void;
  private closed = false;

  constructor(
    private readonly frame: BridgeFrame,
    readyMs = READY_MS,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.settle.fail(new BridgeError(NO_ANSWER)), readyMs);
      this.settle = {
        ok: () => {
          clearTimeout(timer);
          this.isReady = true;
          resolve();
        },
        fail: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
    });
    // Nobody may be waiting yet; a failure is reported when something asks.
    this.ready.catch(() => {});
    this.stop = frame.listen((data) => this.heard(data));
  }

  /** Stops waiting for Dungeon to be ready (its frame loaded something else: a sign-in or error page). */
  giveUp(message = NO_ANSWER): void {
    if (!this.isReady) this.settle.fail(new BridgeError(message));
  }

  /** The GM's maps in Dungeon, newest first. */
  async list(): Promise<DungeonMap[]> {
    return (await this.ask({ dungeon: "list" }, LIST_MS)) as DungeonMap[];
  }

  /**
   * One map as a .dd2vtt File, drawn at `pixelsPerGrid` (no larger than `maxSide` pixels across, the
   * largest picture Table keeps, so it's never shrunk here), every level in it; `lighting`: with
   * Dungeon's lighting painted in, as Table has none of its own.
   */
  async file(
    map: string,
    pixelsPerGrid: number,
    maxSide: number,
    lighting: boolean,
    onProgress?: (level: number, of: number) => void,
  ): Promise<{ file: File; name: string }> {
    return (await this.ask({ dungeon: "file", map, pixelsPerGrid, maxSide, lighting }, FILE_MS, onProgress)) as { file: File; name: string };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.settle.fail(new BridgeError("Stopped."));
    this.stop();
    for (const [, w] of this.waiting) {
      clearTimeout(w.timer);
      w.reject(new BridgeError("Stopped."));
    }
    this.waiting.clear();
    this.frame.close();
  }

  private async ask(message: Record<string, unknown>, ms: number, progress?: Waiting["progress"]): Promise<unknown> {
    await this.ready;
    if (this.closed) throw new BridgeError("Stopped.");
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new BridgeError("Dungeon stopped answering. Try again."));
      }, ms);
      this.waiting.set(id, { resolve, reject, progress, timer });
      this.frame.post({ ...message, id });
    });
  }

  private heard(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const m = data as Record<string, unknown>;
    if (m.dungeon === "ready") return this.settle.ok();
    const w = typeof m.id === "number" ? this.waiting.get(m.id) : undefined;
    if (!w) return;
    if (m.dungeon === "progress") {
      if (typeof m.level === "number" && typeof m.of === "number") w.progress?.(m.level, m.of);
      return;
    }
    let outcome: { value: unknown } | { error: Error };
    if (m.dungeon === "list" && Array.isArray(m.maps)) outcome = { value: cleanList(m.maps) };
    else if (m.dungeon === "file" && m.file instanceof Blob) {
      const file = new File([m.file], fileName(m.name), { type: "application/json" });
      // The map's own name, for the scenes (the file's name has been made safe for a file).
      outcome = { value: { file, name: typeof m.mapName === "string" && m.mapName.trim() ? m.mapName.trim().slice(0, 120) : file.name.replace(/\.dd2vtt$/, "") } };
    }
    else if (m.dungeon === "error") outcome = { error: new BridgeError(typeof m.message === "string" ? m.message.slice(0, 300) : "Dungeon couldn't do that.", m.signedOut === true) };
    else return;
    this.waiting.delete(m.id as number);
    clearTimeout(w.timer);
    if ("error" in outcome) w.reject(outcome.error);
    else w.resolve(outcome.value);
  }
}

/** Only well-formed entries, names kept short. */
function cleanList(raw: unknown[]): DungeonMap[] {
  const out: DungeonMap[] = [];
  for (const r of raw) {
    const e = r as Partial<DungeonMap> | null;
    if (!e || typeof e.id !== "string" || !/^[A-Za-z0-9]{12}$/.test(e.id)) continue;
    out.push({ id: e.id, name: typeof e.name === "string" && e.name.trim() ? e.name.trim().slice(0, 120) : "Untitled map", updated: typeof e.updated === "string" ? e.updated : "" });
  }
  return out;
}

/** The file's name, which names the scenes: Dungeon's, ending .dd2vtt so it's read as Universal VTT. */
function fileName(raw: unknown): string {
  const stem = (typeof raw === "string" ? raw : "").replace(/\.dd2vtt$/i, "").replace(/[\\/]+/g, "-").trim().slice(0, 100) || "Map from Dungeon";
  return `${stem}.dd2vtt`;
}

/**
 * Runs fn with the bridge in holder, opening one if need be. When it fails, the bridge is let go, so
 * the next try starts in a fresh frame (Dungeon slow to load, say); when Dungeon's sign-in had run
 * out, it tries once more at once in a fresh frame, which signs in again on its way.
 */
export async function withBridge<T>(
  holder: { current: DungeonBridge | null },
  fn: (b: DungeonBridge) => Promise<T>,
  open: () => DungeonBridge = openDungeonBridge,
): Promise<T> {
  const fresh = () => {
    holder.current?.close();
    return (holder.current = open());
  };
  const letGo = () => {
    holder.current?.close();
    holder.current = null;
  };
  try {
    return await fn(holder.current ?? fresh());
  } catch (e) {
    if (!(e instanceof BridgeError && e.signedOut)) {
      letGo();
      throw e;
    }
    try {
      return await fn(fresh());
    } catch (again) {
      letGo();
      throw again;
    }
  }
}

/** The bridge in a hidden frame on this page. */
export function openDungeonBridge(): DungeonBridge {
  const origin = new URL(DUNGEON_URL).origin;
  const frame = document.createElement("iframe");
  frame.src = new URL("/bridge", DUNGEON_URL).toString();
  frame.title = "Dungeon";
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  // Just out of sight. Browsers slow a frame like this's timers and give it no animation frames, so
  // nothing on the bridge's way may wait on either (Dungeon's drawing and Export don't).
  Object.assign(frame.style, { position: "fixed", left: "-10px", top: "-10px", width: "1px", height: "1px", opacity: "0", border: "0", pointerEvents: "none" });
  document.body.append(frame);
  const bridge = new DungeonBridge({
    post: (message) => frame.contentWindow?.postMessage(message, origin),
    listen: (onMessage) => {
      const heard = (e: MessageEvent) => {
        if (e.source === frame.contentWindow && e.origin === origin) onMessage(e.data);
      };
      window.addEventListener("message", heard);
      return () => window.removeEventListener("message", heard);
    },
    close: () => frame.remove(),
  });
  // The bridge says it's ready before its page has finished loading. A page that loads and stays
  // silent is something else (a sign-in or error page, or a refused frame): no need to wait on.
  frame.addEventListener("load", () => setTimeout(() => bridge.giveUp(), 4000));
  return bridge;
}
