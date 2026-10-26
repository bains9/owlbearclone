// Dungeon's built-in objects (dungeon.parhome.ca) as Build tool objects: ids "d:<dungeon id>",
// drawn by Dungeon's own drawings (src/client/dungeonLib/, copied by
// scripts/sync-dungeon-library.mjs) into the unit square drawStamp promises, with the longer
// side filling it, and clipped to it as Dungeon clips them to their box.
//
// Dungeon's drawings are detailed (a tree takes about 0.3 ms, five times one of Tabletop's), so
// each is drawn once for each look and size into a sprite, and the map draws the sprites. They
// sit on a few big sheets, because Chrome keeps small canvases off the GPU and uploads them
// again every time they're drawn. Sizes go up in steps of two, 32 to 256 pixels for the whole
// object; bigger than that, an object as drawn comes straight from its drawing (only a few fit
// on screen then) and a seasonal one from its 256-pixel sprite. A sheet nothing has been drawn
// from for half a minute is let go.
//
// A seasonal look (dungeonSeasons.ts) is drawn through a pen that hands every fill and stroke
// to up to three canvases at once: the picture, its colours changed; where snow can lie; and
// where its leaves are, for blossom. Snow and blossom are dots kept to those masks, so they
// follow the object's own shape.

import type { DungeonStampId } from "../../shared/terrain";
import type { SeasonLook } from "../../shared/types";
import type { PropDef } from "../dungeonLib/propkit";
import { prop } from "../dungeonLib/props";
import type { StampLook } from "./buildArt";
import {
  ERASE,
  blossomDots,
  dungeonLook,
  dungeonSeasonal,
  leafInk,
  parseColour,
  snowDots,
  snowInk,
  type Dot,
  type DungeonLook,
  type Ink,
  type InkResult,
} from "./dungeonSeasons";

/** Whether a Dungeon object looks different in a season. */
export function dungeonHasSeasonalArt(id: DungeonStampId, look: SeasonLook): boolean {
  return dungeonSeasonal(id, look);
}

// ---------------------------------------------------------------- the pen

type Loose = Record<PropertyKey, unknown>;
type Method = (...args: unknown[]) => unknown;

/** One canvas a pen draws on: the picture (its colours changed by `ink`), or a mask. */
interface PenTarget {
  c: CanvasRenderingContext2D;
  /** Null: everything as given. */
  ink: Ink | null;
  /** A mask takes one verdict for a whole gradient; the picture keeps the gradient, its stops recoloured. */
  mask: boolean;
  /**
   * Strokes this much as wide, a little towards the top left: snow along a bare branch's top,
   * leaving its dark edges (as on Tabletop's own bare tree).
   */
  thinStrokes?: number;
}

/** A gradient as the drawing asks for it, made again on each canvas with that canvas's colours. */
class PenGradient {
  readonly stops: Array<[number, string]> = [];
  constructor(
    readonly radial: boolean,
    readonly args: number[],
  ) {}
  addColorStop(offset: number, colour: string): void {
    this.stops.push([offset, colour]);
  }
}

function gradientOn(c: CanvasRenderingContext2D, g: PenGradient, colour: (css: string) => string): CanvasGradient {
  const [a, b, d, e, f, h] = g.args;
  const out = g.radial ? c.createRadialGradient(a, b, d, e, f, h) : c.createLinearGradient(a, b, d, e);
  for (const [offset, css] of g.stops) out.addColorStop(offset, colour(css));
  return out;
}

function styleFor(t: PenTarget, style: unknown, kind: "fill" | "stroke", salt: number): InkResult | CanvasGradient | CanvasPattern {
  if (typeof style === "string") return t.ink ? t.ink(style, kind, salt, false) : style;
  // A pattern (none of Dungeon's objects uses one yet) goes on the picture as it is, and counts as solid on a mask.
  if (!(style instanceof PenGradient)) return t.mask ? (kind === "fill" ? "#fff" : null) : (style as CanvasPattern);
  const ink = t.ink;
  if (!ink) return gradientOn(t.c, style, (css) => css);
  if (t.mask) {
    // Rubbing out (a flame's glow) wins; otherwise the most opaque stop decides.
    let best: InkResult = null;
    let most = -1;
    for (const [, css] of style.stops) {
      const v = ink(css, kind, salt, true);
      if (v === ERASE) return ERASE;
      const a = parseColour(css)?.[3] ?? 0;
      if (a > most) {
        most = a;
        best = v;
      }
    }
    return best;
  }
  let gone = false;
  const g = gradientOn(t.c, style, (css) => {
    const v = ink(css, kind, salt, true);
    if (v === null || v === ERASE) gone = true;
    return typeof v === "string" && v !== ERASE ? v : "rgba(0,0,0,0)";
  });
  return gone ? null : g;
}

/**
 * A stand-in for a 2D context that draws on every target at once, each in its own colours.
 * It passes every other call and setting straight through, so it covers whatever Dungeon's
 * drawings use; fill and stroke styles (and gradients) are its own, kept across save/restore.
 */
function pen(targets: PenTarget[]): CanvasRenderingContext2D {
  const first = targets[0].c as unknown as Loose;
  let fill: unknown = "#000";
  let stroke: unknown = "#000";
  let fillSalt = 0;
  let strokeSalt = 0;
  let salts = 0;
  const saved: Array<[unknown, unknown, number, number]> = [];
  const paint = (kind: "fill" | "stroke", method: string, args: unknown[]) => {
    const style = kind === "fill" ? fill : stroke;
    const salt = kind === "fill" ? fillSalt : strokeSalt;
    for (const t of targets) {
      const v = styleFor(t, style, kind, salt);
      if (v === null) continue;
      const c = t.c;
      const call = () => ((c as unknown as Loose)[method] as Method).apply(c, args);
      if (v === ERASE) {
        c.save();
        c.globalCompositeOperation = "destination-out";
        if (kind === "fill") c.fillStyle = "#000";
        else c.strokeStyle = "#000";
        call();
        c.restore();
      } else if (kind === "stroke" && t.thinStrokes) {
        c.save();
        const w = c.lineWidth;
        c.translate(-w * 0.2, -w * 0.2);
        c.lineWidth = w * t.thinStrokes;
        c.strokeStyle = v;
        call();
        c.restore();
      } else {
        if (kind === "fill") c.fillStyle = v;
        else c.strokeStyle = v;
        call();
      }
    }
  };
  const all =
    (name: PropertyKey) =>
    (...args: unknown[]) => {
      let out: unknown;
      for (const t of targets) out = ((t.c as unknown as Loose)[name] as Method).apply(t.c, args);
      return out;
    };
  return new Proxy({} as CanvasRenderingContext2D, {
    get(_, name) {
      switch (name) {
        case "fill":
        case "stroke":
          return (...a: unknown[]) => paint(name, name, a);
        case "fillRect":
          return (...a: unknown[]) => paint("fill", name, a);
        case "strokeRect":
          return (...a: unknown[]) => paint("stroke", name, a);
        case "createRadialGradient":
          return (...a: number[]) => new PenGradient(true, a);
        case "createLinearGradient":
          return (...a: number[]) => new PenGradient(false, a);
        case "fillStyle":
          return fill;
        case "strokeStyle":
          return stroke;
        case "save":
          return () => {
            saved.push([fill, stroke, fillSalt, strokeSalt]);
            all("save")();
          };
        case "restore":
          return () => {
            const top = saved.pop();
            if (top) [fill, stroke, fillSalt, strokeSalt] = top;
            all("restore")();
          };
      }
      const v = first[name];
      return typeof v === "function" ? all(name) : v;
    },
    set(_, name, v) {
      if (name === "fillStyle") {
        fill = v;
        fillSalt = ++salts;
      } else if (name === "strokeStyle") {
        stroke = v;
        strokeSalt = ++salts;
      } else {
        for (const t of targets) (t.c as unknown as Loose)[name] = v;
      }
      return true;
    },
  });
}

// ---------------------------------------------------------------- drawing

/** Draws a Dungeon drawing into the unit square under c's transform, clipped to it, as Dungeon draws it into its box. */
function drawInUnit(c: CanvasRenderingContext2D, def: PropDef, ink: Ink | null = null): void {
  c.save();
  c.beginPath();
  c.rect(-0.5, -0.5, 1, 1);
  c.clip();
  const k = 1 / Math.max(def.w, def.h);
  c.scale(k, k);
  def.draw(ink ? pen([{ c, ink, mask: false }]) : c);
  c.restore();
}

/** Sprite sizes, in pixels for the whole object. */
const BUCKETS = [32, 64, 128, 256] as const;
const BIGGEST = BUCKETS[BUCKETS.length - 1];
/** Empty pixels round each sprite on its sheet, so smoothing never takes in a neighbour. */
const PAD = 2;
const IDLE_MS = 30_000;

interface Sheet {
  canvas: HTMLCanvasElement;
  c: CanvasRenderingContext2D;
  bucket: number;
  cols: number;
  next: number;
  used: number;
}
interface Sprite {
  sheet: Sheet;
  x: number;
  y: number;
}

const sheets: Sheet[] = [];
const sprites = new Map<string, Sprite>();
let swept = 0;

function newCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const el = document.createElement("canvas");
  el.width = w;
  el.height = h;
  return el;
}

/** Room for one more sprite of this size: on a sheet with room left, or a new sheet. */
function room(bucket: number, now: number): Sprite | null {
  const cell = bucket + 2 * PAD;
  let sheet = sheets.find((s) => s.bucket === bucket && s.next < s.cols * s.cols);
  if (!sheet) {
    const side = bucket <= 64 ? 1024 : 2048;
    const canvas = newCanvas(side, side);
    const c = canvas?.getContext("2d");
    if (!canvas || !c) return null;
    sheet = { canvas, c, bucket, cols: Math.floor(side / cell), next: 0, used: now };
    sheets.push(sheet);
  }
  const i = sheet.next++;
  return { sheet, x: (i % sheet.cols) * cell + PAD, y: Math.floor(i / sheet.cols) * cell + PAD };
}

/** Lets go of sheets nothing has been drawn from for a while, and their sprites. */
function sweep(now: number): void {
  for (let i = sheets.length - 1; i >= 0; i--) {
    const s = sheets[i];
    if (now - s.used < IDLE_MS) continue;
    sheets.splice(i, 1);
    for (const [k, sp] of sprites) if (sp.sheet === s) sprites.delete(k);
    // Gives its memory back now rather than whenever it's collected.
    s.canvas.width = 0;
    s.canvas.height = 0;
  }
}

/** Canvases a seasonal sprite is put together on, kept for the next one. */
const scratch: HTMLCanvasElement[] = [];

/** Scratch canvas i, cleared, size by size, with its transform on the unit square. */
function scratchContext(i: number, size: number): CanvasRenderingContext2D | null {
  const canvas = scratch[i] ?? newCanvas(size, size);
  if (!canvas) return null;
  scratch[i] = canvas;
  // Setting the size clears it, even to the same size.
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext("2d");
  c?.setTransform(size, 0, 0, size, size / 2, size / 2);
  return c;
}

function dots(c: CanvasRenderingContext2D, list: Dot[], colour: (i: number) => string, dx = 0, dy = 0): void {
  list.forEach((d, i) => {
    c.globalAlpha = d.a;
    c.fillStyle = colour(i);
    c.beginPath();
    c.arc(d.x + dx, d.y + dy, d.r, 0, Math.PI * 2);
    c.fill();
  });
  c.globalAlpha = 1;
}

/** Keeps what's on `layer` only where `mask` (a scratch canvas of the same size) is, then lays it on `onto`. */
function maskedOnto(layer: CanvasRenderingContext2D, mask: CanvasRenderingContext2D, onto: CanvasRenderingContext2D): void {
  layer.save();
  layer.setTransform(1, 0, 0, 1, 0, 0);
  layer.globalCompositeOperation = "destination-in";
  layer.drawImage(mask.canvas, 0, 0);
  layer.restore();
  onto.save();
  onto.setTransform(1, 0, 0, 1, 0, 0);
  onto.drawImage(layer.canvas, 0, 0);
  onto.restore();
}

/** A seasonal look put together on scratch canvases (the picture is scratch 0), or null without a DOM. */
function seasonalPicture(def: PropDef, look: DungeonLook, size: number): HTMLCanvasElement | null {
  const drawn = prop(look.draw) ?? def;
  const picture = scratchContext(0, size);
  if (!picture) return null;
  const snowMask = look.snow ? scratchContext(1, size) : null;
  const leafMask = look.blossom ? scratchContext(2, size) : null;
  const targets: PenTarget[] = [{ c: picture, ink: look.ink, mask: false }];
  if (snowMask) targets.push({ c: snowMask, ink: snowInk(!!def.light, look.snowOnStrokes), mask: true, thinStrokes: look.snowOnStrokes ? 0.45 : undefined });
  if (leafMask) targets.push({ c: leafMask, ink: leafInk(), mask: true });
  const k = 1 / Math.max(drawn.w, drawn.h);
  for (const t of targets) {
    t.c.save();
    t.c.beginPath();
    t.c.rect(-0.5, -0.5, 1, 1);
    t.c.clip();
    t.c.scale(k, k);
  }
  drawn.draw(pen(targets));
  for (const t of targets) t.c.restore();
  if (leafMask && look.blossom) {
    const layer = scratchContext(3, size)!;
    const colours = look.blossom.colours;
    dots(layer, blossomDots(look.natural, look.blossom.perSquare, look.seed), (i) => colours[i % colours.length]);
    maskedOnto(layer, leafMask, picture);
  }
  if (snowMask && look.snow) {
    const layer = scratchContext(3, size)!;
    const { sheet, dots: flakes } = snowDots(look.natural, look.snow, look.seed);
    if (sheet) {
      layer.fillStyle = `rgba(244,247,252,${sheet})`;
      layer.fillRect(-0.5, -0.5, 1, 1);
    }
    // A blue-grey edge on each flake's shaded side, then the snow.
    const off = 0.012 / look.natural;
    dots(layer, flakes, () => "#c3cfdd", off, off);
    dots(layer, flakes, () => "#f4f7fc");
    maskedOnto(layer, snowMask, picture);
  }
  return picture.canvas;
}

function makeSprite(def: PropDef, look: DungeonLook | null, bucket: number, now: number): Sprite | null {
  const at = room(bucket, now);
  if (!at) return null;
  const c = at.sheet.c;
  const plain = () => {
    c.save();
    c.setTransform(bucket, 0, 0, bucket, at.x + bucket / 2, at.y + bucket / 2);
    drawInUnit(c, def);
    c.restore();
  };
  if (!look) {
    plain();
    return at;
  }
  // A drawing the pen can't follow (a later Dungeon using something new) shows as drawn, not as a hole in the map.
  let picture: HTMLCanvasElement | null = null;
  try {
    picture = seasonalPicture(def, look, bucket);
  } catch (e) {
    console.warn(`Dungeon object ${def.id} couldn't be drawn in its season`, e);
  }
  if (picture) {
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(picture, at.x, at.y);
    c.restore();
  } else plain();
  return at;
}

/** Draws a Dungeon object into the unit square centred on the origin, as drawStamp does, in its season. */
export function drawDungeonStamp(c: CanvasRenderingContext2D, id: DungeonStampId, look: StampLook | null, _turns: number, _fine: number): void {
  const def = prop(id.slice(2));
  if (!def) return;
  const seasonal = look ? dungeonLook(id, look, !!def.light) : null;
  if (typeof c.getTransform !== "function" || typeof document === "undefined") {
    drawInUnit(c, def, seasonal?.ink ?? null);
    return;
  }
  const t = c.getTransform();
  const px = Math.hypot(t.a, t.b);
  if (!seasonal && px > BIGGEST) {
    drawInUnit(c, def);
    return;
  }
  const bucket = BUCKETS.find((b) => b >= px) ?? BIGGEST;
  const key = `${bucket}|${id}|${seasonal?.key ?? ""}`;
  const now = performance.now();
  let sprite = sprites.get(key);
  if (!sprite) {
    const made = makeSprite(def, seasonal, bucket, now);
    if (!made) {
      drawInUnit(c, def, seasonal?.ink ?? null);
      return;
    }
    sprite = made;
    sprites.set(key, sprite);
  }
  sprite.sheet.used = now;
  if (now - swept > 5000) {
    swept = now;
    sweep(now);
  }
  c.save();
  c.imageSmoothingEnabled = true;
  c.drawImage(sprite.sheet.canvas, sprite.x, sprite.y, bucket, bucket, -0.5, -0.5, 1, 1);
  c.restore();
}
