// The Build tool's input rules that need no board to work out: what X does, how a mouse
// wheel's events become steps and what those steps do, when steps fold into one undo, and
// the controls listed along the bottom. Kept apart from the board so they can be tested.

import type { BuildOptions, ToolId } from "./client";

export type BuildMode = BuildOptions["mode"];

/** Where X (or Back) goes from Build › Select: the tool, and the Build tool's mode as it was. */
export interface SelectReturn {
  tool: ToolId;
  buildMode: BuildMode;
}

/** The Build tool's modes, as the bar names them. */
export const BUILD_MODE_LABELS: Record<BuildMode, string> = {
  building: "Building",
  walls: "Walls",
  doors: "Doors",
  terrain: "Terrain",
  stamps: "Objects",
  select: "Select",
};

/** The tools, named briefly (for "Back to ..."). */
const TOOL_LABELS: Record<ToolId, string> = {
  select: "Move & select",
  draw: "Draw",
  erase: "Eraser",
  fog: "Fog of war",
  build: "Build the map",
  measure: "Measure",
  pointer: "Pointer",
};

export const HEX_TOAST = "Building works on a square grid. Switch this scene to squares in Edit scene.";

/**
 * X, as in Dungeondraft: from anything, Build › Select; from Build › Select, back to exactly
 * where you were (the tool, and the Build tool's mode). Returns what to switch to, a toast to
 * show instead, or null for nothing (not the GM).
 */
export function pressX(s: {
  tool: ToolId;
  mode: BuildMode;
  ret: SelectReturn | null;
  gm: boolean;
  hex: boolean;
}): { tool: ToolId; mode: BuildMode; ret: SelectReturn | null } | { toast: string } | null {
  if (!s.gm) return null;
  if (s.tool === "build" && s.mode === "select") {
    const r = s.ret ?? { tool: "build", buildMode: "stamps" };
    // From another tool, the Build tool keeps the mode it had then (even Select), so the
    // next B lands where you left it.
    return { tool: r.tool, mode: r.buildMode, ret: null };
  }
  if (s.hex) return { toast: HEX_TOAST };
  return { tool: "build", mode: "select", ret: { tool: s.tool, buildMode: s.mode } };
}

/** What Back (and X) in Build › Select goes back to, as the bar names it. */
export function backLabel(ret: SelectReturn | null): string {
  if (!ret) return BUILD_MODE_LABELS.stamps;
  return ret.tool === "build" ? BUILD_MODE_LABELS[ret.buildMode] : TOOL_LABELS[ret.tool];
}

// ---------------------------------------------------------------- the mouse wheel

/** What this device's mouse wheel does over objects in the Build tool (the setting). */
export type WheelPref = "auto" | "always" | "never";

/** One wheel event: dx and dy already scaled to pixels for line and page modes. */
export interface WheelSample {
  deltaMode: number;
  dx: number;
  dy: number;
  /** The older wheelDeltaY (Chrome, Edge, Safari): 120 for each notch of a mouse wheel in the event. */
  wheelDeltaY?: number;
}

/** Events closer together than this are one stream (one flick of a trackpad, one spin of a wheel). */
export const STREAM_GAP_MS = 150;
/** Notches closer together than this count once (a wheel spinning freely). */
export const NOTCH_MIN_MS = 16;
/** At most this many notches count from one event (several that a busy page was sent as one). */
export const NOTCHES_MAX = 6;
/** A smooth stream (a trackpad, a smooth-scrolling mouse) steps once per this many pixels. */
export const SMOOTH_STEP_PX = 40;

/**
 * Turns wheel events into whole steps. A stream is judged by its first event: a trackpad's
 * begin small, so a fast flick later in one doesn't pass for a mouse wheel's notches.
 * Times are the input's own (the event's timeStamp), not when the page got round to it:
 * notches that waited behind a busy moment still count.
 */
export class WheelSteps {
  private last = -Infinity;
  private lastStep = -Infinity;
  private kind: "notch" | "smooth" = "notch";
  private acc = 0;
  /** In a stream of Firefox's lines: the fewest lines one event has held, taken to be a notch. */
  private lineUnit = Infinity;

  constructor(private readonly mac: boolean) {}

  /** Classifies the event by its stream and turns it into whole steps (sign: dy > 0 is +). */
  next(e: WheelSample, now: number): { kind: "notch" | "smooth"; steps: number } {
    const fresh = now - this.last >= STREAM_GAP_MS;
    this.last = now;
    const sign = e.dy > 0 ? 1 : e.dy < 0 ? -1 : 0;
    if (fresh) {
      this.kind = this.classify(e);
      this.lastStep = -Infinity;
      this.acc = 0;
      this.lineUnit = Infinity;
      if (this.kind === "smooth") {
        // The first touch of a smooth scroll is a step at once; the rest go by distance.
        if (sign) this.lastStep = now;
        return { kind: "smooth", steps: sign };
      }
    }
    if (this.kind === "notch") {
      // One step a notch, but never more than one each NOTCH_MIN_MS since the last step, so
      // a wheel spinning freely still counts once however its notches arrive.
      const room = Math.floor((now - this.lastStep) / NOTCH_MIN_MS);
      if (!sign || room < 1) return { kind: "notch", steps: 0 };
      this.lastStep = now;
      return { kind: "notch", steps: sign * Math.min(this.notches(e), room, NOTCHES_MAX) };
    }
    this.acc += e.dy;
    const steps = Math.trunc(this.acc / SMOOTH_STEP_PX);
    this.acc -= steps * SMOOTH_STEP_PX;
    return { kind: "smooth", steps: steps || 0 };
  }

  /**
   * How many notches an event of a notch stream holds. A busy page is sent the notches that
   * came meanwhile as one event (Chrome adds them up), so there can be more than one.
   */
  private notches(e: WheelSample): number {
    // A Mac speeds a spinning mouse wheel up, so its events' sizes aren't counts of notches.
    if (this.mac) return 1;
    const w = e.wheelDeltaY;
    if (typeof w === "number" && w !== 0 && w % 120 === 0 && e.dx === 0) return Math.abs(w) / 120;
    if (e.deltaMode === 1 && e.dy) {
      const d = Math.abs(e.dy);
      this.lineUnit = Math.min(this.lineUnit, d);
      return Math.max(1, Math.round(d / this.lineUnit));
    }
    return 1;
  }

  private classify(e: WheelSample): "notch" | "smooth" {
    if (e.deltaMode !== 0) return "notch";
    // Windows and Linux mice report 120 a notch here, whatever "lines per notch" is set to.
    const w = e.wheelDeltaY;
    if (!this.mac && typeof w === "number" && w !== 0 && w % 120 === 0 && e.dx === 0) return "notch";
    if (e.dx === 0 && Math.abs(e.dy) >= 40) return "notch";
    return "smooth";
  }
}

/**
 * What a wheel event does. target: what the wheel can turn here ("ghost": the next object
 * in Objects; "selection": the objects selected in Select; null: nothing).
 */
export function wheelIntent(
  e: { ctrl: boolean; meta: boolean; alt: boolean; z: boolean; dx: number; dy: number },
  target: "ghost" | "selection" | null,
  kind: "notch" | "smooth",
  pref: WheelPref,
): "zoom" | "turn" | "fine-turn" | "size" | "default" {
  if (e.ctrl || e.meta) return "zoom";
  if (!target) return "default";
  // Sideways (Shift+wheel, a tilting wheel, a trackpad moving across): the map moves as always.
  if (Math.abs(e.dx) >= Math.abs(e.dy)) return "default";
  if (e.alt) return "size";
  if (e.z) return "fine-turn";
  if (pref === "never") return "default";
  if (pref === "always") return "turn";
  return kind === "notch" ? "turn" : "default";
}

// ---------------------------------------------------------------- undo

/** Steps of turning, sizing or nudging this close together fold into one undo step. */
export const BURST_MS = 700;

/**
 * Whether a new build step may fold into the undo entry on top: the same burst, the same
 * scene, a build step, the last one folded in at most BURST_MS ago, and nothing to redo.
 */
export function canFold(
  top: { sceneId: string | null; steps?: unknown; coalesce?: { key: string; at: number } } | undefined,
  key: string,
  sceneId: string,
  now: number,
  redoEmpty: boolean,
): boolean {
  if (!top || !top.steps || !top.coalesce || !redoEmpty) return false;
  return top.coalesce.key === key && top.sceneId === sceneId && now - top.coalesce.at <= BURST_MS;
}

// ---------------------------------------------------------------- the bars

/** Where Duplicate tries to put the copies, in order: one square right, down, left, up. */
export const DUPLICATE_OFFSETS: readonly { dCol: number; dRow: number }[] = [
  { dCol: 1, dRow: 0 },
  { dCol: 0, dRow: 1 },
  { dCol: -1, dRow: 0 },
  { dCol: 0, dRow: -1 },
];

const QUARTERS = ["", "¼", "½", "¾"];

/** A size in squares as the bar shows it: ½, ¾, 1, 1¼ ... 3. */
export function formatSize(size: number): string {
  const whole = Math.floor(size);
  const q = QUARTERS[Math.round((size - whole) * 4)] ?? "";
  return whole ? `${whole}${q}` : q || "0";
}

export function formatDeg(deg: number): string {
  return `${deg}°`;
}

/** Whether this is a Mac (or an iPad), where the zoom key is ⌘ and wheel notches look smooth. */
export function isMacPlatform(platform: string, userAgent: string): boolean {
  return /Mac|iPhone|iPad|iPod/.test(platform) || /Mac OS X/.test(userAgent);
}

/**
 * What the mouse and keys do in the Build tool with these options, shown along the bottom
 * on a computer (Dungeondraft shows its tool's controls the same way). The strip is one line,
 * cut off at the end, so the way to zoom is always among the first four.
 */
export function buildHints(
  o: BuildOptions,
  sel: { objects: number; doors: number },
  env: { mac: boolean; wheel: WheelPref; backLabel: string },
): [string, string][] {
  const mod = env.mac ? "⌘" : "Ctrl";
  const pan: [string, string] = ["Space+drag", "pan"];
  const zoom: [string, string] = [`${mod}+wheel`, "zoom"];
  const select: [string, string] = ["X", "select"];
  const turns = env.wheel !== "never";
  switch (o.mode) {
    case "building":
    case "terrain": {
      const erase = o.floor[o.mode] === "erase";
      const out: [string, string][] = [["Drag", erase ? "erase" : o.mode === "building" ? "room" : "paint"]];
      if (!erase) out.push(["Alt+drag", o.mode === "building" ? "cut out" : "take away"]);
      if (o.shape[o.mode] === "brush") out.push(["[ ]", "brush size"]);
      return [...out, pan, zoom, select];
    }
    case "walls": {
      const remove = o.wallMode === "remove";
      const out: [string, string][] = [
        ["Drag", remove ? "remove" : "walls"],
        ["Click corners", remove ? "remove between" : "walls between"],
        ["Dbl-click, right-click, Enter", "finish"],
        ["Backspace", "undo corner"],
      ];
      if (!remove) out.push(["Alt", "remove"]);
      return [...out, select];
    }
    case "doors":
      return [
        ["Click a wall", o.doorStyle === "open" ? "opening" : o.doorStyle === "secret" ? "secret door" : "door"],
        ["Click it again, or Alt+click", "take it away"],
        pan,
        zoom,
        select,
      ];
    case "stamps":
      if (o.stampMode === "remove") return [["Click an object", "remove"], pan, zoom, select];
      return turns
        ? [
            ["Click", "place"],
            ["Wheel", "turn 15°"],
            ["Alt+wheel", "size"],
            zoom,
            ["Right-click", "turn 90°"],
            ["Z+wheel", "turn 5°"],
            ["Alt+click", "remove"],
            select,
          ]
        : [
            ["Click", "place"],
            ["Z+wheel", "turn 5°"],
            ["Alt+wheel", "size"],
            ["Wheel", "zoom"],
            ["Right-click", "turn 90°"],
            ["[ ]", "turn 15°"],
            ["Alt+click", "remove"],
            select,
          ];
    case "select": {
      const back: [string, string] = ["X", `back to ${env.backLabel}`];
      if (sel.objects) {
        return [
          ["Drag", "move"],
          turns ? ["Wheel", "turn 15°"] : ["Z+wheel", "turn 5°"],
          ["Alt+wheel", "size"],
          turns ? zoom : ["Wheel", "zoom"],
          turns ? ["Right-click", "turn 90°"] : ["[ ]", "turn 15°"],
          ["Arrows", "nudge"],
          ["Del", "delete"],
          [`${mod}+D`, "duplicate"],
          [`${mod}+C, ${mod}+V`, "copy, paste"],
          ["Esc", "deselect"],
        ];
      }
      if (sel.doors) return [["Del", "remove door"], ["Esc", "deselect"], ["Wheel", "zoom"], back];
      return [
        ["Click", "select"],
        ["Shift+click", "add"],
        ["Drag", "box"],
        ["Wheel", "zoom"],
        pan,
        [`${mod}+V`, "paste"],
        back,
      ];
    }
  }
}

/** The same, briefly, for a touch screen. */
export const TOUCH_HINTS: Record<BuildMode, string> = {
  building: "Drag to paint a room.",
  terrain: "Drag to paint.",
  walls: "Drag along grid lines, or tap one.",
  doors: "Tap a wall.",
  stamps: "Tap to place. To move, turn or delete objects, use Select.",
  select: "Tap an object or door to select it. Drag a selected object to move it; drag elsewhere to select with a box.",
};

/** What Build › Select's bar says is selected: "Nothing selected", "1 object", "2 objects, 1 door". */
export function selectionStatus(sel: { objects: number; doors: number }): string {
  const parts: string[] = [];
  if (sel.objects) parts.push(`${sel.objects} object${sel.objects === 1 ? "" : "s"}`);
  if (sel.doors) parts.push(`${sel.doors} door${sel.doors === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : "Nothing selected";
}

/** What the Build tool says when something can't be done. */
export const BUILD_TOASTS = {
  full: "That part of the map has as many objects as it can hold (64 in each 16 by 16 squares).",
  samePlace: "There's already one exactly like it there.",
  samePaste: "Pasting there would put copies exactly on top of the same objects. Point somewhere else and paste again.",
  samePasteMiddle:
    "Pasting there would put copies exactly on top of the same objects. Move the map so the middle of the screen is where they go, then paste again.",
  noRoom: "There's no room next to them for copies.",
  tooBig: "Those objects don't fit on this scene.",
  nothingToPaste: "Nothing to paste: select objects and press Ctrl+C first.",
  pasteMode: "To paste objects, press X for Select first.",
  doorDrag: "Doors can't be moved: delete this one and place a new one with Doors.",
  tooMany: "That's too many to copy at once: 256 objects at most.",
  copied: (n: number) => `Copied ${n} object${n === 1 ? "" : "s"}.`,
};
