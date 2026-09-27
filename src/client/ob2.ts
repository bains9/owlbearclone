// Reading an Owlbear Rodeo 2.0 backup (.ob2), so a DM can bring their scenes over:
// each scene's map image, its grid, its fog (the base cover and every cut or added
// shape) and its tokens. Walls, lights, drawings and text aren't brought in.
//
// An .ob2 is a zip: manifest.json lists the exported assets; each scene's contents
// are a JSON document (items keyed by id); images are stored as files. Owlbear's
// scenes are an unbounded canvas in "world" units, D per grid cell; a map image is
// placed on it with its own pixels-per-cell (d), anchor point, position, rotation
// and scale. Everything here is converted into that map image's pixels, which is
// what a scene is measured in here.

import { LIMITS } from "../shared/sanitize";
import { simplify } from "../shared/geometry";
import type { GridType } from "../shared/types";
import type { MapFile } from "./mapImport";
import { nameFromFile } from "./mapImport";
import { openZip, readEntry, readText } from "./zip";
import type { ZipEntry } from "./zip";

export interface ImportedFog {
  mode: "hide" | "reveal";
  /** poly: a filled outline. stroke: a line of fog `width` wide. */
  shape: "poly" | "stroke";
  /** In the map image's pixels, as recorded in the file. */
  points: number[];
  width?: number;
}

export interface ImportedToken {
  /** Zip path of the token's image. */
  image: string;
  /** Centre, in the map image's pixels. */
  x: number;
  y: number;
  /** Size in grid cells. */
  size: number;
  rotation: number;
  label: string;
  hidden: boolean;
  locked: boolean;
  prop: boolean;
}

export interface ImportedScene {
  map: MapFile;
  fogCover: boolean;
  fog: ImportedFog[];
  tokens: ImportedToken[];
}

export interface Ob2Import {
  scenes: ImportedScene[];
  /** Token images by zip path, read when asked for. */
  tokenImage(path: string): Promise<File | null>;
  /** Things that weren't brought in, and why, in plain words. */
  notes: string[];
}

type Pt = { x: number; y: number };
type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const pt = (v: unknown, fallback: Pt): Pt => {
  const o = obj(v);
  return { x: num(o.x, fallback.x), y: num(o.y, fallback.y) };
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function isOb2File(f: File): boolean {
  return /\.ob2$/i.test(f.name);
}

const GRID_TYPES: Record<string, GridType> = { SQUARE: "square", HEX_VERTICAL: "hex-pointy", HEX_HORIZONTAL: "hex-flat" };
const TOKEN_LAYERS = new Set(["CHARACTER", "MOUNT", "PROP"]);
const MIME_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

function mimeFor(path: string, declared: string): string {
  if (/^image\//.test(declared)) return declared;
  return MIME_BY_EXT[path.split(".").pop()?.toLowerCase() ?? ""] ?? "image/png";
}

/** World point -> pixel on an image placed like an Owlbear image item. */
function imageTransform(item: Obj, worldDpi: number): { toImage: (w: Pt) => Pt; toWorld: (p: Pt) => Pt; d: number } {
  const grid = obj(item.grid);
  const d = num(grid.dpi, worldDpi) || worldDpi;
  const O = pt(grid.offset, { x: 0, y: 0 });
  const P = pt(item.position, { x: 0, y: 0 });
  const s = pt(item.scale, { x: 1, y: 1 });
  const a = (num(item.rotation, 0) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const k = worldDpi / d;
  return {
    d,
    toImage: (w) => {
      const dx = w.x - P.x;
      const dy = w.y - P.y;
      const rx = dx * cos + dy * sin;
      const ry = -dx * sin + dy * cos;
      return { x: O.x + rx / (k * (s.x || 1)), y: O.y + ry / (k * (s.y || 1)) };
    },
    toWorld: (p) => {
      const lx = (p.x - O.x) * k * s.x;
      const ly = (p.y - O.y) * k * s.y;
      return { x: P.x + lx * cos - ly * sin, y: P.y + lx * sin + ly * cos };
    },
  };
}

/** An item's local point -> world (translate, rotate, scale, as Owlbear does). */
function itemToWorld(item: Obj): (p: Pt) => Pt {
  const P = pt(item.position, { x: 0, y: 0 });
  const s = pt(item.scale, { x: 1, y: 1 });
  const a = (num(item.rotation, 0) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return (p) => {
    const lx = p.x * s.x;
    const ly = p.y * s.y;
    return { x: P.x + lx * cos - ly * sin, y: P.y + lx * sin + ly * cos };
  };
}

// ---------------------------------------------------------------- shapes

function ellipse(w: number, h: number, n = 32): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push({ x: (w / 2) * Math.cos(t), y: (h / 2) * Math.sin(t) });
  }
  return out;
}

function shapeOutline(item: Obj): Pt[] | null {
  const w = num(item.width, 0);
  const h = num(item.height, 0);
  if (!w || !h) return null;
  switch (item.shapeType) {
    case "RECTANGLE":
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
    case "CIRCLE":
      return ellipse(w, h);
    case "TRIANGLE":
      return [
        { x: 0, y: 0 },
        { x: w / 2, y: h },
        { x: -w / 2, y: h },
      ];
    case "HEXAGON": {
      const r = Math.min(Math.abs(w), Math.abs(h)) / 2;
      const out: Pt[] = [];
      for (let i = 0; i < 6; i++) {
        const t = -Math.PI / 2 + (i * Math.PI) / 3;
        out.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
      }
      return out;
    }
    default:
      return null;
  }
}

const STEPS = 8;

/** A path's outlines, with curves flattened: [0 x y] move, [1 x y] line, [2 ...] quad, [3 ...] conic, [4 ...] cubic, [5] close. */
export function pathContours(commands: unknown): Pt[][] {
  if (!Array.isArray(commands)) return [];
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let pen: Pt = { x: 0, y: 0 };
  let start: Pt = pen;
  const finish = () => {
    if (cur.length >= 3) out.push(cur);
    cur = [];
  };
  for (const c of commands) {
    if (!Array.isArray(c)) continue;
    const v = c.map((x) => num(x, 0));
    switch (v[0]) {
      case 0:
        finish();
        pen = start = { x: v[1], y: v[2] };
        cur.push(pen);
        break;
      case 1:
        if (!cur.length) cur.push(pen);
        pen = { x: v[1], y: v[2] };
        cur.push(pen);
        break;
      case 2:
      case 3: {
        if (!cur.length) cur.push(pen);
        const p0 = pen;
        const p1 = { x: v[1], y: v[2] };
        const p2 = { x: v[3], y: v[4] };
        const wgt = v[0] === 3 ? v[5] || 1 : 1;
        for (let i = 1; i <= STEPS; i++) {
          const t = i / STEPS;
          const a = (1 - t) * (1 - t);
          const b = 2 * wgt * t * (1 - t);
          const e = t * t;
          const den = a + b + e;
          cur.push({ x: (a * p0.x + b * p1.x + e * p2.x) / den, y: (a * p0.y + b * p1.y + e * p2.y) / den });
        }
        pen = p2;
        break;
      }
      case 4: {
        if (!cur.length) cur.push(pen);
        const p0 = pen;
        const p1 = { x: v[1], y: v[2] };
        const p2 = { x: v[3], y: v[4] };
        const p3 = { x: v[5], y: v[6] };
        for (let i = 1; i <= STEPS; i++) {
          const t = i / STEPS;
          const u = 1 - t;
          cur.push({
            x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
            y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
          });
        }
        pen = p3;
        break;
      }
      case 5:
        finish();
        pen = start;
        break;
    }
  }
  finish();
  return out;
}

function inside(p: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

function signedArea(c: Pt[]): number {
  let a = 0;
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) a += c[j].x * c[i].y - c[i].x * c[j].y;
  return a / 2;
}

/** The outline running one way round or the other (sign of its area: 1 or -1). */
function orient(c: Pt[], sign: number): Pt[] {
  return Math.sign(signedArea(c)) === sign ? c : [...c].reverse();
}

/**
 * The areas an Owlbear fog item fills, each as a single outline for a non-zero
 * fill. Its holes are joined to it by a bridge that goes out and comes back, and
 * run the other way round, so they stay empty. A hole only means the item doesn't
 * paint there: it never clears fog that something else put there.
 */
export function filledRegions(contours: Pt[][], rule: "nonzero" | "evenodd"): Pt[][] {
  const cs = contours.filter((c) => c.length >= 3 && Math.abs(signedArea(c)) > 1e-9);
  const area = cs.map(signedArea);
  // Each contour's parent: the smallest other contour it lies inside.
  const parent = cs.map((c, i) => {
    let best = -1;
    for (let j = 0; j < cs.length; j++) {
      if (j === i || Math.abs(area[j]) <= Math.abs(area[i]) || !inside(c[0], cs[j])) continue;
      if (best < 0 || Math.abs(area[j]) < Math.abs(area[best])) best = j;
    }
    return best;
  });
  const filled = cs.map((_, i) => {
    if (rule === "evenodd") {
      let depth = 0;
      for (let p = parent[i]; p >= 0; p = parent[p]) depth++;
      return depth % 2 === 0;
    }
    let winding = 0;
    for (let p = i; p >= 0; p = parent[p]) winding += Math.sign(area[p]);
    return winding !== 0;
  });
  const isOuter = cs.map((_, i) => filled[i] && (parent[i] < 0 || !filled[parent[i]]));
  const outerOf = (i: number) => {
    let p = parent[i];
    while (p >= 0 && !isOuter[p]) p = parent[p];
    return p;
  };
  const out: Pt[][] = [];
  cs.forEach((c, o) => {
    if (!isOuter[o]) return;
    const ring = orient(c, 1);
    const pts = [...ring];
    cs.forEach((h, i) => {
      if (filled[i] || parent[i] < 0 || !filled[parent[i]] || outerOf(i) !== o) return;
      const hole = orient(h, -1);
      pts.push(ring[0], ...hole, hole[0], ring[0]);
    });
    out.push(pts);
  });
  return out;
}

/** An Owlbear fog item's outlines in its own coordinates, and whether each is a closed loop. */
function fogOutlines(item: Obj): { contours: Pt[][]; closed: boolean } {
  const style = obj(item.style);
  switch (item.type) {
    case "SHAPE": {
      const o = shapeOutline(item);
      return { contours: o ? [o] : [], closed: true };
    }
    case "CURVE": {
      const pts = Array.isArray(item.points) ? item.points.map((p) => pt(p, { x: 0, y: 0 })) : [];
      return { contours: pts.length >= 2 ? [pts] : [], closed: num(style.fillOpacity, 1) > 0 || style.closed === true };
    }
    case "PATH":
      return { contours: pathContours(item.commands), closed: true };
    case "LINE":
      return { contours: [[pt(item.startPosition, { x: 0, y: 0 }), pt(item.endPosition, { x: 0, y: 0 })]], closed: false };
    default:
      return { contours: [], closed: false };
  }
}

const flat = (c: Pt[]): number[] => c.flatMap((p) => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]);

/** Keeps a point list within what a fog shape may hold. */
function fitPoints(points: number[]): number[] {
  let out = points;
  let tol = 0.5;
  while (out.length > LIMITS.pointNumbers && tol < 1e6) {
    out = simplify(points, tol);
    tol *= 2;
  }
  return out;
}

/** Contours simplified together until they fit in one fog shape. */
function fitContours(contours: Pt[][]): Pt[][] {
  // Each hole costs a few extra points for its bridge.
  const size = (cs: Pt[][]) => cs.reduce((n, c) => n + c.length * 2, 0) + cs.length * 8;
  let tol = 0.5;
  let out = contours;
  while (size(out) > LIMITS.pointNumbers && tol < 1e6) {
    out = contours.map((c) => {
      const s = simplify(flat(c), tol);
      const pts: Pt[] = [];
      for (let i = 0; i + 1 < s.length; i += 2) pts.push({ x: s[i], y: s[i + 1] });
      return pts.length >= 3 ? pts : c.slice(0, 3);
    });
    tol *= 2;
  }
  return out;
}

// ---------------------------------------------------------------- reading

interface Asset {
  type?: unknown;
  name?: unknown;
  path?: unknown;
  metadata?: unknown;
}

async function sceneFromDoc(
  doc: Obj,
  name: string,
  zip: Map<string, ZipEntry>,
  notes: string[],
): Promise<ImportedScene | null> {
  const items = Object.values(obj(doc.items)).map(obj);
  const docGrid = obj(doc.grid);
  const D = num(docGrid.dpi, 150) > 0 ? num(docGrid.dpi, 150) : 150;
  const maps = items.filter((i) => i.type === "IMAGE" && i.layer === "MAP");
  if (!maps.length) {
    notes.push(`"${name}" has no map image, so it wasn't brought in.`);
    return null;
  }
  // Several map images: the one covering most of the scene.
  const area = (i: Obj) => {
    const img = obj(i.image);
    const s = pt(i.scale, { x: 1, y: 1 });
    const d = num(obj(i.grid).dpi, D) || D;
    return Math.abs((num(img.width, 0) * s.x * num(img.height, 0) * s.y) / (d * d));
  };
  const M = maps.reduce((a, b) => (area(b) > area(a) ? b : a));
  if (maps.length > 1) notes.push(`"${name}" has ${maps.length} map images; only the biggest was brought in.`);
  const image = obj(M.image);
  const url = str(image.url);
  const entry = zip.get(url);
  if (!entry) {
    notes.push(`"${name}": its map image isn't in the file. In Owlbear, export again with the map image ticked as well as the scene.`);
    return null;
  }
  if (/^video\//.test(str(image.mime)) || /\.(mp4|webm)$/i.test(url)) {
    notes.push(`"${name}" has a video map, which can't be used here.`);
    return null;
  }
  const W = num(image.width, 0);
  const H = num(image.height, 0);
  const bytes = await readEntry(entry);
  const mime = mimeFor(url, str(image.mime));
  const file = new File([bytes as BlobPart], `${name}.${mime.split("/")[1] === "jpeg" ? "jpg" : mime.split("/")[1]}`, { type: mime });

  const t = imageTransform(M, D);
  const s = pt(M.scale, { x: 1, y: 1 });
  const rotation = ((num(M.rotation, 0) % 360) + 360) % 360;
  const type = GRID_TYPES[str(docGrid.type) || "SQUARE"];
  const map: MapFile = { name, image: file, width: W || undefined, height: H || undefined };
  const square = rotation === 0 && Math.abs(Math.abs(s.x) - Math.abs(s.y)) < 1e-6 * Math.max(1, Math.abs(s.x));
  if (!type) {
    notes.push(`"${name}" uses an isometric grid, which isn't supported: it has a square grid here for now.`);
  } else if (!square) {
    notes.push(`"${name}": the map is rotated or stretched in Owlbear, so its grid was guessed. Check it with Edit scene.`);
  } else {
    const size = t.d / Math.abs(s.x);
    map.pxPerCell = size;
    map.gridType = type;
    // Where the grid's lines (or, for hexes, the first cell's centre) fall on the image.
    const r = D / Math.sqrt(3);
    const anchor = type === "hex-pointy" ? { x: D / 2, y: r } : type === "hex-flat" ? { x: r, y: D / 2 } : { x: 0, y: 0 };
    const p = t.toImage(anchor);
    map.offsetX = p.x;
    map.offsetY = p.y;
  }

  // Fog, in the order Owlbear draws it: by zIndex, then oldest first, then by id.
  const when = (v: unknown) => (typeof v === "number" ? v : Date.parse(str(v)) || 0);
  const fogItems = items
    .filter((i) => i.layer === "FOG" && ["SHAPE", "CURVE", "PATH", "LINE"].includes(str(i.type)))
    .sort(
      (a, b) =>
        num(a.zIndex, 0) - num(b.zIndex, 0) ||
        when(a.lastModified) - when(b.lastModified) ||
        str(a.id).localeCompare(str(b.id)),
    );
  // Owlbear also draws every fog shape's outline, this wide, with the same effect.
  const outlineWorld = Math.max(0, num(obj(obj(doc.fog).style).strokeWidth, 5));
  const pxPerWorld = t.d / (D * Math.abs(s.x || 1));
  const fog: ImportedFog[] = [];
  for (const f of fogItems) {
    const toWorld = itemToWorld(f);
    const fs = pt(f.scale, { x: 1, y: 1 });
    // visible: false is a Cut: it clears fog.
    const mode = f.visible === false ? "reveal" : "hide";
    const { contours, closed } = fogOutlines(f);
    const mapped = contours.map((c) => c.map((q) => t.toImage(toWorld(q))));
    if (mapped.some((c) => c.some((p) => Math.abs(p.x) > LIMITS.coord || Math.abs(p.y) > LIMITS.coord))) continue;
    const fills = f.type !== "LINE" && closed && num(obj(f.style).fillOpacity, 1) > 0;
    if (fills) {
      const rule = f.type === "PATH" && str(f.fillRule) !== "nonzero" ? "evenodd" : "nonzero";
      for (const region of filledRegions(fitContours(mapped), rule)) {
        fog.push({ mode, shape: "poly", points: flat(region) });
      }
    }
    const width = outlineWorld * Math.max(Math.abs(fs.x), Math.abs(fs.y)) * pxPerWorld;
    if (width >= 0.5) {
      for (const c of mapped) {
        const line = closed && c.length >= 3 ? [...c, c[0]] : c;
        if (line.length < 2) continue;
        fog.push({
          mode,
          shape: "stroke",
          points: fitPoints(flat(line)),
          width: Math.min(LIMITS.brushMax, Math.max(1, Math.round(width * 100) / 100)),
        });
      }
    }
  }

  // Tokens whose images came in the file.
  const tokens: ImportedToken[] = [];
  let missingArt = 0;
  for (const i of items) {
    if (i.type !== "IMAGE" || !TOKEN_LAYERS.has(str(i.layer))) continue;
    const img = obj(i.image);
    const path = str(img.url);
    if (!zip.has(path) || /\.(mp4|webm)$/i.test(path)) {
      missingArt++;
      continue;
    }
    const ti = imageTransform(i, D);
    const ts = pt(i.scale, { x: 1, y: 1 });
    const iw = num(img.width, 0);
    const ih = num(img.height, 0);
    const centre = t.toImage(ti.toWorld({ x: iw / 2, y: ih / 2 }));
    const cells = (Math.max(iw * Math.abs(ts.x), ih * Math.abs(ts.y)) / ti.d) || 1;
    const size = Math.min(LIMITS.tokenSizeMax, Math.max(LIMITS.tokenSizeMin, Math.round(cells * 100) / 100));
    const text = str(obj(i.text).plainText).trim();
    tokens.push({
      image: path,
      x: Math.round(centre.x * 100) / 100,
      y: Math.round(centre.y * 100) / 100,
      size,
      rotation: ((num(i.rotation, 0) % 360) + 360) % 360,
      label: (text || str(i.name).trim()).slice(0, LIMITS.label),
      hidden: i.visible === false,
      locked: i.locked === true,
      prop: i.layer === "PROP",
    });
  }
  if (missingArt) {
    notes.push(`"${name}": ${missingArt} token${missingArt === 1 ? "" : "s"} left out because their images weren't in the file.`);
  }
  const other = items.filter((i) => i.layer === "DRAWING" || i.layer === "TEXT" || i.layer === "NOTE").length;
  if (other) notes.push(`"${name}": ${other} drawing${other === 1 ? "" : "s"} and text item${other === 1 ? "" : "s"} weren't brought in.`);

  return { map, fogCover: obj(doc.fog).filled === true, fog, tokens };
}

/** Reads an Owlbear Rodeo 2.0 backup. Throws (with a message to show) if it isn't one. */
export async function readOb2(file: File): Promise<Ob2Import> {
  let zip: Map<string, ZipEntry>;
  try {
    zip = openZip(await file.arrayBuffer());
  } catch (err) {
    throw new Error((err as Error).message);
  }
  const manifestEntry = zip.get("manifest.json");
  if (!manifestEntry) throw new Error("isn't an Owlbear Rodeo backup (there's no manifest in it).");
  let manifest: Obj;
  try {
    manifest = obj(JSON.parse(await readText(manifestEntry)));
  } catch {
    throw new Error("has a manifest that couldn't be read.");
  }
  const assets = Object.values(obj(manifest.assets)).map((a) => a as Asset);
  const notes: string[] = [];
  const scenes: ImportedScene[] = [];
  const usedMaps = new Set<string>();

  for (const a of assets.filter((x) => x.type === "SCENE")) {
    const name = str(a.name).trim().slice(0, 60) || "Scene";
    const docPath = str(obj(a.metadata).doc);
    const entry = zip.get(docPath);
    if (!entry) {
      notes.push(`"${name}": its scene data wasn't in the file.`);
      continue;
    }
    let doc: Obj;
    try {
      doc = obj(JSON.parse(await readText(entry)));
    } catch {
      notes.push(`"${name}": its scene data couldn't be read.`);
      continue;
    }
    const scene = await sceneFromDoc(doc, name, zip, notes);
    if (scene) {
      scenes.push(scene);
      for (const i of Object.values(obj(doc.items)).map(obj)) {
        if (i.layer === "MAP") usedMaps.add(str(obj(i.image).url));
      }
    }
  }

  // Map images exported on their own (no scene): a scene each, with the grid saved on the map.
  for (const a of assets) {
    if (a.type !== "IMAGE" || !str(a.path).startsWith("images/maps/")) continue;
    const meta = obj(a.metadata);
    const img = obj(meta.image);
    const url = str(img.url);
    const entry = zip.get(url);
    if (!entry || usedMaps.has(url) || /\.(mp4|webm)$/i.test(url)) continue;
    const name = str(a.name).trim().slice(0, 60) || nameFromFile(url);
    const grid = obj(meta.grid);
    const dpi = num(grid.dpi, 0);
    const offset = pt(grid.offset, { x: 0, y: 0 });
    const mime = mimeFor(url, str(img.mime));
    const bytes = await readEntry(entry);
    scenes.push({
      map: {
        name,
        image: new File([bytes as BlobPart], `${name}.${mime.split("/")[1] === "jpeg" ? "jpg" : mime.split("/")[1]}`, { type: mime }),
        width: num(img.width, 0) || undefined,
        height: num(img.height, 0) || undefined,
        ...(dpi > 0 ? { pxPerCell: dpi, offsetX: offset.x, offsetY: offset.y, gridType: "square" as const } : {}),
      },
      fogCover: false,
      fog: [],
      tokens: [],
    });
  }
  if (!scenes.length && !notes.length) notes.push(`${file.name} has no scenes or maps in it.`);

  return {
    scenes,
    notes,
    tokenImage: async (path) => {
      const e = zip.get(path);
      if (!e) return null;
      const mime = mimeFor(path, "");
      return new File([(await readEntry(e)) as BlobPart], path.split("/").pop() ?? "token", { type: mime });
    },
  };
}
