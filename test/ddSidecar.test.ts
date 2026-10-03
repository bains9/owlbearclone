// The season sidecar's codec and its PNG box (design 3.3, 6.3 "Sidecar, PNG box and rasteriser"):
// round trips, the exact byte layout, refusals, caps checked before anything is allocated, and a
// fuzz that may only ever end in SidecarError.
import { afterEach, describe, expect, it, vi } from "vitest";
import { crc32 } from "../src/client/crc32";
import { PNG_BOX_MAX_ROWS, PNG_BOX_ROW_BYTES, PNG_BOX_WIDTH, canUnpack, packPng, unpackPng } from "../src/client/dd/pngBox";
import { rasterSidecar } from "../src/client/dd/raster";
import { AR, OR, TR } from "../src/client/dd/roles";
import {
  NO_NAME, OBJ_BYTES, OBJ_FLAG, REACH_N, SECTION, SIDECAR_CAPS, SIDECAR_HEADER_BYTES, SidecarError, decodeSidecar,
  encodeSidecar, readFormat, type ObjectTable, type SeasonSidecar,
} from "../src/client/dd/sidecar";
import { decodePng } from "./helpers/png";

type Zlib = { inflateSync(b: Uint8Array): Uint8Array; deflateSync(b: Uint8Array): Uint8Array };
const zlib = async () => (await import(/* @vite-ignore */ "node:" + "zlib")) as Zlib;

/** A small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function objects(n: number, fill: (i: number) => Partial<Record<keyof ObjectTable, number>> = () => ({})): ObjectTable {
  const o: ObjectTable = {
    n, role: new Uint8Array(n), layer: new Int16Array(n), x: new Int32Array(n), y: new Int32Array(n), rot: new Uint8Array(n),
    flags: new Uint8Array(n), name: new Uint16Array(n).fill(NO_NAME), reach: new Uint16Array(n * REACH_N),
  };
  for (let i = 0; i < n; i++) {
    const f = fill(i);
    o.role[i] = f.role ?? OR.STRUCTURE;
    if (f.layer !== undefined) o.layer[i] = f.layer;
    if (f.x !== undefined) o.x[i] = f.x;
    if (f.y !== undefined) o.y[i] = f.y;
    if (f.rot !== undefined) o.rot[i] = f.rot;
    if (f.flags !== undefined) o.flags[i] = f.flags;
    if (f.name !== undefined) o.name[i] = f.name;
    o.reach.fill(f.reach ?? 64 * 4, i * REACH_N, (i + 1) * REACH_N);
  }
  return o;
}

/** Every section, odd values included (negative coordinates, i16 extremes, padded bitmaps, two ring shapes). */
function sample(): SeasonSidecar {
  const tw = 9, th = 7;
  const w = new Uint8Array(tw * th * 2);
  for (let i = 0; i < w.length; i++) w[i] = (i * 37) & 255;
  const bits = new Uint8Array(Math.ceil((5 * 3) / 8));
  bits[0] = 0b10110101;
  bits[1] = 0b0101101; // 15 bits: the top bit of the last byte is padding (0)
  return {
    meta: {
      rect: [-256, 128, 12800, 8960], squares: [50, 35], extractor: 1, snowShare: 0.8125, packShare: 0.0625,
      packItems: 3, dropped: 2, names: ["vegetation/trees/pine_tree_02", "terrain_snow", "terrain_rocky", "é ünïcode"],
    },
    terrain: { tps: 4, tx0: -4, ty0: 0, tw, th, slots: [{ name: 1, role: TR.SNOW }, { name: NO_NAME, role: TR.KEEP }], w },
    bitmaps: [
      { role: AR.CAVE, layer: -350, step: 64, ox: -32, oy: 32, w: 5, h: 3, bits },
      { role: AR.FLOOR, layer: -32768, step: 256, ox: 0, oy: 0, w: 2, h: 4, bits: new Uint8Array([0xff]) },
    ],
    shapes: [
      { role: AR.WATER, layer: -50, rule: 0, pts: new Int32Array([0, 0, 1600, 0, 1600, 1600, 0, 1600, 400, 400, 800, 400, 800, 800]), ringEnds: new Uint32Array([4, 7]) },
      { role: AR.ROOF, layer: 32767, rule: 1, pts: new Int32Array([-2147483648, 2147483647, 5, 6, 7, 8]), ringEnds: new Uint32Array([3]) },
    ],
    objects: objects(3, (i) => ({
      role: [OR.EVERGREEN, OR.OPAQUE, OR.ROCK][i], layer: [100, -400, 900][i], x: [16 * 300, -5, 2147483647][i], y: [16 * 200, 7, -1][i],
      rot: [0, 64, 255][i], flags: [OBJ_FLAG.MEASURED, 0, OBJ_FLAG.MIRROR | OBJ_FLAG.CAPPED | OBJ_FLAG.TINTED][i],
      name: [0, NO_NAME, 0][i], reach: [100, 65535, 0][i],
    })),
  };
}

function empty(): SeasonSidecar {
  return {
    meta: { rect: [0, 0, 256, 256], squares: [1, 1], extractor: 7, snowShare: 0, packShare: 0, packItems: 0, dropped: 0, names: [] },
    terrain: null, bitmaps: [], shapes: [], objects: objects(0),
  };
}

/** Rewrites the payload length and CRC after the payload has been changed. */
function reseal<T extends Uint8Array>(b: T): T {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  dv.setUint32(8, b.length - SIDECAR_HEADER_BYTES, true);
  dv.setUint32(12, crc32(b.subarray(SIDECAR_HEADER_BYTES)), true);
  return b;
}

/** A sidecar of the given sections after META (each a tag and its body), sealed. */
function craft(sections: Array<[number, Uint8Array]>, meta = empty().meta): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const all: Array<[number, Uint8Array]> = [[SECTION.META, json], ...sections];
  let n = SIDECAR_HEADER_BYTES;
  for (const [, body] of all) n += 5 + body.length;
  const out = new Uint8Array(n);
  const dv = new DataView(out.buffer);
  out.set([0x54, 0x54, 0x53, 0x44]);
  dv.setUint16(4, 1, true);
  dv.setUint16(6, meta.extractor, true);
  let p = SIDECAR_HEADER_BYTES;
  for (const [tag, body] of all) {
    out[p] = tag;
    dv.setUint32(p + 1, body.length, true);
    out.set(body, p + 5);
    p += 5 + body.length;
  }
  return reseal(out);
}

function body(n: number, write: (dv: DataView) => void): Uint8Array {
  const b = new Uint8Array(n);
  write(new DataView(b.buffer));
  return b;
}

const refuses = (b: Uint8Array, message?: RegExp) => {
  expect(() => decodeSidecar(b)).toThrow(SidecarError);
  if (message) expect(() => decodeSidecar(b)).toThrow(message);
};

describe("encodeSidecar / decodeSidecar", () => {
  it("round-trips every section exactly", () => {
    const s = sample();
    const b = encodeSidecar(s);
    expect(decodeSidecar(b)).toEqual(s);
    expect(encodeSidecar(decodeSidecar(b))).toEqual(b);
    expect(decodeSidecar(encodeSidecar(empty()))).toEqual(empty());
  });

  it("writes the header of 3.3", () => {
    const b = encodeSidecar(sample());
    const dv = new DataView(b.buffer);
    expect(String.fromCharCode(...b.subarray(0, 4))).toBe("TTSD");
    expect(readFormat(b)).toBe(1);
    expect(dv.getUint16(6, true)).toBe(1);
    expect(dv.getUint32(8, true)).toBe(b.length - SIDECAR_HEADER_BYTES);
    expect(dv.getUint32(12, true)).toBe(crc32(b.subarray(SIDECAR_HEADER_BYTES)));
  });

  it("lays OBJS out as arrays, 47 bytes an object", () => {
    const s = empty();
    s.objects = objects(2, (i) => ({ role: OR.ROCK, layer: -2 + i, x: 1000 + i, y: -7, rot: 3, flags: 8, reach: 40 + i }));
    const b = encodeSidecar(s);
    const empty0 = encodeSidecar(empty());
    expect(b.length - empty0.length).toBe(2 * OBJ_BYTES);
    const at = b.length - (4 + 2 * OBJ_BYTES);
    const dv = new DataView(b.buffer);
    expect(b[at - 5]).toBe(SECTION.OBJS);
    expect(dv.getUint32(at - 4, true)).toBe(4 + 2 * OBJ_BYTES);
    expect(dv.getUint32(at, true)).toBe(2);
    expect([...b.subarray(at + 4, at + 6)]).toEqual([OR.ROCK, OR.ROCK]);
    expect(dv.getInt16(at + 6, true)).toBe(-2);
    expect(dv.getInt32(at + 10, true)).toBe(1000);
    expect(dv.getUint16(at + 4 + 15 * 2, true)).toBe(40);
    expect(dv.getUint16(at + 4 + 15 * 2 + 32, true)).toBe(41);
  });

  it("copies what it decodes: the input can be reused or transferred afterwards", async () => {
    const b = encodeSidecar(sample());
    const s = decodeSidecar(b);
    b.fill(0);
    expect(s).toEqual(sample());
    // A Node Buffer too, whose slice() is a view (a script reading the file with fs).
    const { Buffer } = (await import(/* @vite-ignore */ "node:" + "buffer")) as { Buffer: { from(b: Uint8Array): Uint8Array } };
    const buf = Buffer.from(encodeSidecar(sample()));
    const fromBuf = decodeSidecar(buf);
    expect(fromBuf.terrain?.w.buffer).not.toBe(buf.buffer);
    expect(fromBuf.bitmaps[0].bits.buffer).not.toBe(buf.buffer);
    buf.fill(0);
    expect(fromBuf).toEqual(sample());
  });

  it("ignores whatever follows the payload (the PNG box's padding)", () => {
    const b = encodeSidecar(sample());
    const padded = new Uint8Array(b.length + 1000);
    padded.set(b);
    expect(decodeSidecar(padded)).toEqual(sample());
    expect(decodeSidecar(padded.subarray(0, b.length + 1))).toEqual(sample());
  });

  it("skips unknown sections by their length", () => {
    const b = encodeSidecar(empty());
    const extra = new Uint8Array(b.length + 8);
    extra.set(b);
    extra[b.length] = 99;
    new DataView(extra.buffer).setUint32(b.length + 1, 3, true);
    expect(decodeSidecar(reseal(extra))).toEqual(empty());
  });

  it("refuses what isn't a sidecar of this format, or whose CRC fails", () => {
    const b = encodeSidecar(sample());
    refuses(new Uint8Array(15));
    refuses(b.subarray(0, b.length - 1), /cut off/);
    const magic = b.slice();
    magic[0] = 0x55;
    refuses(magic, /not a sidecar/);
    const newer = b.slice();
    newer[4] = 2;
    refuses(newer, /format 2/);
    expect(readFormat(newer)).toBe(2);
    const flipped = b.slice();
    flipped[b.length - 1] ^= 1;
    refuses(flipped, /CRC/);
    const extractor = b.slice();
    extractor[6] = 9;
    refuses(extractor, /extractor/);
  });

  it("refuses repeated or missing sections and lengths that disagree", () => {
    const meta = new TextEncoder().encode(JSON.stringify(empty().meta));
    refuses(craft([[SECTION.META, meta]]), /two META/);
    const noMeta = craft([]);
    noMeta[SIDECAR_HEADER_BYTES] = 77; // META's tag, now unknown
    refuses(reseal(noMeta), /no META/);
    const objs = body(4, () => {});
    refuses(craft([[SECTION.OBJS, objs], [SECTION.OBJS, objs]]), /two OBJS/);
    refuses(craft([[SECTION.OBJS, body(5, () => {})]]), /OBJS's length/);
    const cut = craft([[SECTION.OBJS, objs]]);
    refuses(reseal(cut.subarray(0, cut.length - 2).slice()), /past the payload/);
    refuses(reseal(cut.subarray(0, cut.length - 6).slice()), /header is cut off/);
  });

  it("refuses bad META", () => {
    const bad = (patch: Record<string, unknown>) => craft([], { ...empty().meta, ...patch } as SeasonSidecar["meta"]);
    refuses(bad({ rect: [0, 0, 0, 10] }), /rect/);
    refuses(bad({ rect: [0, 0, 0.5, 10] }), /rect/); // under a world unit: pixels would overflow
    refuses(bad({ rect: [0, 0, 1e300, 10] }), /rect/);
    refuses(bad({ rect: [0, 0, "1", 10] }), /rect/);
    refuses(bad({ squares: [0, 1] }), /squares/);
    refuses(bad({ snowShare: 1.5 }), /shares/);
    refuses(bad({ dropped: -1 }), /counts/);
    refuses(bad({ names: ["a", ""] }), /name/);
    refuses(bad({ names: ["x".repeat(121)] }), /name/);
    const notJson = craft([]);
    notJson[SIDECAR_HEADER_BYTES + 5] = 0x7b + 1;
    refuses(reseal(notJson), /JSON/);
    const nan = craft([]);
    const text = new TextDecoder().decode(nan.subarray(SIDECAR_HEADER_BYTES + 5));
    const swapped = new TextEncoder().encode(text.replace('"snowShare":0', '"snowShare":NaN'));
    const nanB = new Uint8Array(SIDECAR_HEADER_BYTES + 5 + swapped.length);
    nanB.set(nan.subarray(0, SIDECAR_HEADER_BYTES + 1));
    new DataView(nanB.buffer).setUint32(SIDECAR_HEADER_BYTES + 1, swapped.length, true);
    nanB.set(swapped, SIDECAR_HEADER_BYTES + 5);
    refuses(reseal(nanB), /JSON/);
  });

  it("refuses out-of-range values in every section", () => {
    const s = sample();
    const b = encodeSidecar(s);
    const find = (tag: number, nth = 0): number => {
      const dv = new DataView(b.buffer);
      let seen = 0;
      for (let p = SIDECAR_HEADER_BYTES; p < b.length; p += 5 + dv.getUint32(p + 1, true)) {
        if (b[p] === tag && seen++ === nth) return p + 5;
      }
      throw new Error("no section");
    };
    const poke = (at: number, v: number, message: RegExp) => {
      const c = b.slice();
      c[at] = v;
      refuses(reseal(c), message);
    };
    const terr = find(SECTION.TERR);
    poke(terr, 3, /texels a square/);
    poke(terr + 14 + 2, 99, /terrain role/);
    poke(terr + 14, 4, /outside META.names/); // slot 0's name: 4 of 4 names
    const bits = find(SECTION.BITS);
    poke(bits, 0, /area role/);
    poke(bits + 17 + 1, 0xff, /past its size/);
    poke(bits + 3, 0, /step/);
    const shap = find(SECTION.SHAP);
    poke(shap + 3, 2, /fill rule/);
    poke(shap, 13, /area role/);
    const objs = find(SECTION.OBJS) + 4;
    poke(objs, 0, /object role/);
    poke(objs + 12 * 3, 16, /unknown flags/);
    poke(objs + 13 * 3 + 2 * 2, 9, /outside META.names/);
  });

  it("refuses sections whose own fields disagree with their length, or are empty", () => {
    const terr = (tw: number, th: number, ns: number, extra = 0) => body(14 + 3 * ns + tw * th * ns + extra, (v) => {
      v.setUint8(0, 4);
      v.setUint16(9, tw, true);
      v.setUint16(11, th, true);
      v.setUint8(13, ns);
      for (let i = 0; i < ns; i++) { v.setUint16(14 + 3 * i, NO_NAME, true); v.setUint8(14 + 3 * i + 2, TR.SNOW); }
    });
    expect(decodeSidecar(craft([[SECTION.TERR, terr(2, 3, 2)]])).terrain?.w.length).toBe(12);
    refuses(craft([[SECTION.TERR, terr(2, 3, 2, 1)]]), /TERR's length disagrees/);
    refuses(craft([[SECTION.TERR, terr(2, 3, 2, -1)]]), /TERR's length disagrees/);
    refuses(craft([[SECTION.TERR, terr(0, 3, 1)]]), /TERR is empty/);
    refuses(craft([[SECTION.TERR, terr(2, 0, 1)]]), /TERR is empty/);
    refuses(craft([[SECTION.TERR, terr(2, 3, 0)]]), /TERR is empty/);
    refuses(craft([[SECTION.TERR, body(13, () => {})]]), /TERR is cut off/);
    // SHAP: role WATER, rule 0, then rings of (count, points).
    const shap = (rings: number[], extra = 0) => {
      const n = rings.reduce((a, r) => a + 4 + 8 * r, 0);
      return body(8 + n + extra, (v) => {
        v.setUint8(0, AR.WATER);
        v.setUint32(4, rings.length, true);
        let q = 8;
        for (const r of rings) { v.setUint32(q, r, true); q += 4 + 8 * r; }
      });
    };
    expect(decodeSidecar(craft([[SECTION.SHAP, shap([3, 4])]])).shapes[0].ringEnds).toEqual(new Uint32Array([3, 7]));
    refuses(craft([[SECTION.SHAP, shap([3], 4)]]), /SHAP's length disagrees/);
    refuses(craft([[SECTION.SHAP, shap([3], 3)]]), /SHAP's length disagrees|cut off/);
    refuses(craft([[SECTION.SHAP, shap([])]]), /SHAP has no rings/);
    refuses(craft([[SECTION.SHAP, shap([3, 0])]]), /SHAP has an empty ring/);
    refuses(craft([[SECTION.SHAP, body(7, () => {})]]), /SHAP is cut off/);
    // BITS: role CAVE, step 64, w x h.
    const bits = (w: number, h: number) => body(17 + Math.ceil((w * h) / 8), (v) => {
      v.setUint8(0, AR.CAVE);
      v.setUint16(3, 64, true);
      v.setUint16(13, w, true);
      v.setUint16(15, h, true);
    });
    expect(decodeSidecar(craft([[SECTION.BITS, bits(3, 5)]])).bitmaps[0].bits.length).toBe(2);
    refuses(craft([[SECTION.BITS, bits(0, 5)]]), /BITS is empty/);
    refuses(craft([[SECTION.BITS, bits(5, 0)]]), /BITS is empty/);
    refuses(craft([[SECTION.BITS, body(16, () => {})]]), /BITS is cut off/);
  });

  it("refuses META over 16 KiB even when its JSON is fine, and shares out of range", () => {
    const names = Array.from({ length: 150 }, (_, i) => `vegetation/trees/${String(i).padStart(4, "0")}_${"x".repeat(95)}`);
    const big = { ...empty().meta, names };
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeGreaterThan(SIDECAR_CAPS.metaBytes);
    refuses(craft([], big), /META is over 16 KiB/);
    expect(decodeSidecar(craft([], { ...big, names: names.slice(0, 120) })).meta.names.length).toBe(120);
    const bad = (patch: Record<string, unknown>) => craft([], { ...empty().meta, ...patch } as SeasonSidecar["meta"]);
    refuses(bad({ packShare: 1.5 }), /shares/);
    refuses(bad({ packShare: -0.01 }), /shares/);
    refuses(bad({ snowShare: -0.01 }), /shares/);
    refuses(bad({ packItems: 1.5 }), /counts/);
  });

  it("refuses more than 20,000 SHAP sections as it finds them, before reading any", () => {
    // Empty SHAP sections: refused for their number in the first pass, before the second pass
    // would find the first one cut off.
    const many: Array<[number, Uint8Array]> = [];
    for (let i = 0; i <= SIDECAR_CAPS.rings; i++) many.push([SECTION.SHAP, new Uint8Array(0)]);
    refuses(craft(many), /more than 20,000 rings/);
    refuses(craft(many.slice(0, 3)), /SHAP is cut off/);
  });

  it("refuses oversized counts from the header and section heads alone, before allocating", () => {
    // Each crafted section claims a huge count but carries only its head: the count is refused
    // from the head (a decoder that allocated first would ask for gigabytes here).
    const t0 = performance.now();
    refuses(craft([[SECTION.OBJS, body(4, (v) => v.setUint32(0, 0xffffffff, true))]]), /more than 20,000 objects/);
    refuses(craft([[SECTION.OBJS, body(4, (v) => v.setUint32(0, SIDECAR_CAPS.objects + 1, true))]]), /more than 20,000 objects/);
    refuses(craft([[SECTION.SHAP, body(8, (v) => { v.setUint8(0, AR.WATER); v.setUint32(4, 0xffffffff, true); })]]), /20,000 rings/);
    refuses(craft([[SECTION.SHAP, body(12, (v) => { v.setUint8(0, AR.WATER); v.setUint32(4, 1, true); v.setUint32(8, 0xffffffff, true); })]]), /400,000 shape points/);
    refuses(craft([[SECTION.SHAP, body(12, (v) => { v.setUint8(0, AR.WATER); v.setUint32(4, 1, true); v.setUint32(8, 1000, true); })]]), /points are cut off/);
    refuses(craft([[SECTION.TERR, body(14, (v) => { v.setUint8(0, 4); v.setUint16(9, 65535, true); v.setUint16(11, 65535, true); v.setUint8(13, 255); })]]), /over 6 MiB/);
    refuses(craft([[SECTION.BITS, body(17, (v) => { v.setUint8(0, AR.CAVE); v.setUint16(3, 64, true); v.setUint16(13, 65535, true); v.setUint16(15, 65535, true); })]]), /over 4 Mbit/);
    const many: Array<[number, Uint8Array]> = [];
    for (let i = 0; i < 17; i++) many.push([SECTION.BITS, body(18, (v) => { v.setUint8(0, AR.CAVE); v.setUint16(3, 64, true); v.setUint16(13, 1, true); v.setUint16(15, 1, true); })]);
    refuses(craft(many), /more than 16 bitmaps/);
    const big = new Uint8Array(SIDECAR_HEADER_BYTES);
    big.set([0x54, 0x54, 0x53, 0x44, 1, 0, 1, 0]);
    new DataView(big.buffer).setUint32(8, SIDECAR_CAPS.bytes + 1, true);
    refuses(big, /over 8 MiB/);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it("refuses to encode what breaks a cap or the layout", () => {
    const bad = (change: (s: SeasonSidecar) => void, message: RegExp) => {
      const s = sample();
      change(s);
      expect(() => encodeSidecar(s)).toThrow(SidecarError);
      expect(() => encodeSidecar(s)).toThrow(message);
    };
    bad((s) => { s.objects = objects(SIDECAR_CAPS.objects + 1); }, /20,000 objects/);
    bad((s) => { s.meta.names = Array.from({ length: SIDECAR_CAPS.names + 1 }, () => "x"); }, /2,000 names/);
    bad((s) => { s.meta.names = Array.from({ length: 200 }, () => "x".repeat(100)); }, /16 KiB/);
    bad((s) => { s.meta.rect[2] = Number.NaN; }, /rect/);
    bad((s) => { s.objects.role[0] = 0; }, /object role/);
    bad((s) => { s.objects.name[1] = 4; }, /outside META.names/);
    bad((s) => { s.objects.reach = new Uint16Array(3); }, /arrays/);
    bad((s) => { s.bitmaps[0].bits[1] |= 0x80; }, /past its size/);
    bad((s) => { s.bitmaps = Array.from({ length: 17 }, () => s.bitmaps[1]); }, /16 bitmaps/);
    bad((s) => { s.shapes[0].ringEnds = new Uint32Array([4, 4, 7]); }, /empty ring/);
    bad((s) => { s.shapes[0].ringEnds = new Uint32Array([4, 6]); }, /disagree/);
    bad((s) => { s.shapes[0].rule = 2 as 0; }, /fill rule/);
    bad((s) => { s.shapes = [{ ...s.shapes[0], pts: new Int32Array(2 * 400_001), ringEnds: new Uint32Array([400_001]) }]; }, /400,000/);
    bad((s) => { if (s.terrain) s.terrain.tps = 3 as 4; }, /texels/);
    bad((s) => { if (s.terrain) s.terrain.w = new Uint8Array(5); }, /planes disagree/);
    bad((s) => { if (s.terrain) s.terrain.slots[0].role = 0 as 1; }, /terrain role/);
    expect(() => encodeSidecar({} as SeasonSidecar)).toThrow(SidecarError);
  });

  it("fuzz: 2,000 truncations and bit flips only ever throw SidecarError", () => {
    const base = encodeSidecar(sample());
    const rand = rng(20260930);
    let refused = 0, accepted = 0;
    for (let i = 0; i < 2000; i++) {
      let b = base.slice();
      const mode = i % 4;
      if (mode === 0) {
        b = b.slice(0, Math.floor(rand() * b.length)); // raw truncation
      } else if (mode === 1) {
        for (let f = 1 + Math.floor(rand() * 4); f > 0; f--) b[Math.floor(rand() * b.length)] ^= 1 << Math.floor(rand() * 8);
      } else if (mode === 2) {
        // Flips in the payload with the CRC made right again: the section checks must hold alone.
        for (let f = 1 + Math.floor(rand() * 3); f > 0; f--) {
          b[SIDECAR_HEADER_BYTES + Math.floor(rand() * (b.length - SIDECAR_HEADER_BYTES))] ^= 1 << Math.floor(rand() * 8);
        }
        reseal(b);
      } else {
        b = reseal(b.slice(0, SIDECAR_HEADER_BYTES + Math.floor(rand() * (b.length - SIDECAR_HEADER_BYTES)))); // a sealed cut
      }
      try {
        const s = decodeSidecar(b);
        accepted++;
        rasterSidecar(s, { w: 24, h: 17 }); // whatever passes must rasterise
      } catch (e) {
        if (!(e instanceof SidecarError)) throw new Error(`case ${i} (mode ${mode}) threw ${String(e)}`);
        refused++;
      }
    }
    expect(refused + accepted).toBe(2000);
    expect(refused).toBeGreaterThan(1500);
  });
});

describe("PNG box", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const chunks = (png: Uint8Array): Array<{ type: string; at: number; len: number }> => {
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const out: Array<{ type: string; at: number; len: number }> = [];
    for (let p = 8; p < png.length; p += 12 + dv.getUint32(p)) {
      out.push({ type: String.fromCharCode(...png.subarray(p + 4, p + 8)), at: p, len: dv.getUint32(p) });
    }
    return out;
  };
  /** A PNG of the given chunks (type, data), CRCs right. */
  const build = (parts: Array<[string, Uint8Array]>): Uint8Array => {
    let n = 8;
    for (const [, d] of parts) n += 12 + d.length;
    const out = new Uint8Array(n);
    const dv = new DataView(out.buffer);
    out.set([137, 80, 78, 71, 13, 10, 26, 10]);
    let p = 8;
    for (const [type, d] of parts) {
      dv.setUint32(p, d.length);
      for (let i = 0; i < 4; i++) out[p + 4 + i] = type.charCodeAt(i);
      out.set(d, p + 8);
      dv.setUint32(p + 8 + d.length, crc32(out.subarray(p + 4, p + 8 + d.length)));
      p += 12 + d.length;
    }
    return out;
  };
  const ihdr = (w: number, h: number, depth = 8, type = 2, interlace = 0) => {
    const d = new Uint8Array(13);
    const v = new DataView(d.buffer);
    v.setUint32(0, w);
    v.setUint32(4, h);
    d.set([depth, type, 0, 0, interlace], 8);
    return d;
  };
  /** Filtered rows of the given bytes (filter 0 unless said), deflated by node. */
  const idat = async (bytes: Uint8Array, rows: number, filter = 0) => {
    const raw = new Uint8Array(rows * (PNG_BOX_ROW_BYTES + 1));
    for (let r = 0; r < rows; r++) {
      raw[r * (PNG_BOX_ROW_BYTES + 1)] = r === rows - 1 ? filter : 0;
      raw.set(bytes.subarray(r * PNG_BOX_ROW_BYTES, (r + 1) * PNG_BOX_ROW_BYTES), r * (PNG_BOX_ROW_BYTES + 1) + 1);
    }
    return (await zlib()).deflateSync(raw);
  };
  const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

  it("can unpack here (Node has DecompressionStream)", () => {
    expect(canUnpack()).toBe(true);
  });

  it("round-trips sidecar bytes, zero-padded to whole rows", async () => {
    for (const s of [sample(), empty()]) {
      const b = encodeSidecar(s);
      const { blob, width, height } = await packPng(b);
      expect(blob.type).toBe("image/png");
      expect(width).toBe(PNG_BOX_WIDTH);
      expect(height).toBe(Math.ceil(b.length / PNG_BOX_ROW_BYTES));
      const out = await unpackPng(blob);
      expect(out.length).toBe(height * PNG_BOX_ROW_BYTES);
      expect(out.subarray(0, b.length)).toEqual(b);
      expect(out.subarray(b.length).every((v) => v === 0)).toBe(true);
      expect(decodeSidecar(out)).toEqual(s);
    }
  });

  it("round-trips several rows, and an empty payload", async () => {
    const rand = rng(7);
    const b = new Uint8Array(PNG_BOX_ROW_BYTES * 3 + 5).map(() => Math.floor(rand() * 256));
    const { blob, height } = await packPng(b);
    expect(height).toBe(4);
    expect((await unpackPng(await bytesOf(blob))).subarray(0, b.length)).toEqual(b);
    const none = await packPng(new Uint8Array(0));
    expect(none.height).toBe(1);
    expect(await unpackPng(none.blob)).toEqual(new Uint8Array(PNG_BOX_ROW_BYTES));
  });

  it("is a plain RGB PNG of IHDR, IDAT and IEND that any decoder reads as the same bytes", async () => {
    const b = encodeSidecar(sample());
    const png = await bytesOf((await packPng(b)).blob);
    expect(chunks(png).map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect([...png.subarray(16 + 8, 16 + 13)]).toEqual([8, 2, 0, 0, 0]);
    const img = decodePng(png, await zlib());
    expect(img.w).toBe(PNG_BOX_WIDTH);
    const rgb = new Uint8Array(img.w * img.h * 3);
    for (let i = 0; i < img.w * img.h; i++) rgb.set(img.px.subarray(i * 4, i * 4 + 3), i * 3);
    expect(rgb.subarray(0, b.length)).toEqual(b);
  });

  it("falls back to stored deflate blocks without CompressionStream, and still round-trips", async () => {
    const rand = rng(11);
    const b = new Uint8Array(200_000).map(() => Math.floor(rand() * 256)); // several 64 KiB blocks
    vi.stubGlobal("CompressionStream", undefined);
    const png = await bytesOf((await packPng(b)).blob);
    vi.unstubAllGlobals();
    const c = chunks(png)[1];
    expect([png[c.at + 8], png[c.at + 9]]).toEqual([0x78, 0x01]);
    expect(png[c.at + 10]).toBe(0); // first block: stored, not final
    expect((await unpackPng(png)).subarray(0, b.length)).toEqual(b);
    expect(decodePng(png, await zlib()).w).toBe(PNG_BOX_WIDTH);
  });

  it("refuses a PNG bigger than the biggest box before reading it", async () => {
    // The biggest box's rows stored uncompressed, their deflate block heads, and room for the chunks.
    const rowsRaw = PNG_BOX_MAX_ROWS * (PNG_BOX_ROW_BYTES + 1);
    const max = rowsRaw + 5 * Math.ceil(rowsRaw / 65535) + 4096;
    await expect(unpackPng(new Uint8Array(max + 1))).rejects.toThrow(/too big/);
    await expect(unpackPng(new Blob([new Uint8Array(max + 1)]))).rejects.toThrow(/too big/);
    await expect(unpackPng(new Uint8Array(max))).rejects.toThrow(/Not a PNG/);
  });

  it("stops inflating as soon as the pixels overflow their rows (a zip bomb costs little)", async () => {
    const Real = DecompressionStream;
    let inflated = 0;
    class Counting {
      readonly writable: WritableStream<Uint8Array>;
      readonly readable: ReadableStream<Uint8Array>;
      constructor(format: CompressionFormat) {
        const d = new Real(format);
        this.writable = d.writable as WritableStream<Uint8Array>;
        this.readable = d.readable.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(c, ctl) {
            inflated += c.length;
            ctl.enqueue(c);
          },
        }));
      }
    }
    vi.stubGlobal("DecompressionStream", Counting);
    const bomb = (await zlib()).deflateSync(new Uint8Array(64 << 20)); // 64 MiB of zeros in about 64 KB
    const png = build([["IHDR", ihdr(512, 1)], ["IDAT", bomb], ["IEND", new Uint8Array(0)]]);
    await expect(unpackPng(png)).rejects.toThrow(/wrong size/);
    expect(inflated).toBeGreaterThan(PNG_BOX_ROW_BYTES);
    expect(inflated).toBeLessThan(4 << 20);
  });

  it("refuses to unpack without DecompressionStream", async () => {
    const png = (await packPng(encodeSidecar(empty()))).blob;
    vi.stubGlobal("DecompressionStream", undefined);
    expect(canUnpack()).toBe(false);
    await expect(unpackPng(png)).rejects.toThrow(SidecarError);
  });

  it("refuses anything but the exact layout", async () => {
    const b = encodeSidecar(sample());
    const rows = Math.ceil(b.length / PNG_BOX_ROW_BYTES);
    const z = await idat(b, rows);
    const ok = build([["IHDR", ihdr(512, rows)], ["IDAT", z], ["IEND", new Uint8Array(0)]]);
    expect((await unpackPng(ok)).subarray(0, b.length)).toEqual(b);
    // Two IDAT chunks are one stream.
    const split = build([["IHDR", ihdr(512, rows)], ["IDAT", z.subarray(0, 10)], ["IDAT", z.subarray(10)], ["IEND", new Uint8Array(0)]]);
    expect((await unpackPng(split)).subarray(0, b.length)).toEqual(b);

    const no = async (png: Uint8Array, message?: RegExp) => {
      await expect(unpackPng(png)).rejects.toThrow(SidecarError);
      if (message) await expect(unpackPng(png)).rejects.toThrow(message);
    };
    const end: [string, Uint8Array] = ["IEND", new Uint8Array(0)];
    await no(build([["IHDR", ihdr(511, rows)], ["IDAT", z], end]), /not a sidecar box/);
    await no(build([["IHDR", ihdr(512, rows, 8, 6)], ["IDAT", z], end]), /not a sidecar box/);
    await no(build([["IHDR", ihdr(512, rows, 16)], ["IDAT", z], end]), /not a sidecar box/);
    await no(build([["IHDR", ihdr(512, rows, 8, 2, 1)], ["IDAT", z], end]), /not a sidecar box/);
    for (const at of [10, 11]) {
      // Compression method or filter method other than 0.
      const odd = ihdr(512, rows);
      odd[at] = 1;
      await no(build([["IHDR", odd], ["IDAT", z], end]), /not a sidecar box/);
    }
    await no(build([["IHDR", ihdr(512, PNG_BOX_MAX_ROWS + 1)], ["IDAT", z], end]), /not a sidecar box/);
    await no(build([["IHDR", ihdr(512, 0)], ["IDAT", z], end]), /not a sidecar box/);
    await no(build([["IHDR", ihdr(512, rows)], ["IDAT", await idat(b, rows, 1)], end]), /row filter/);
    // Extra chunks that would change the pixels in an ordinary decoder, and harmless ones alike.
    await no(build([["IHDR", ihdr(512, rows)], ["gAMA", new Uint8Array([0, 0, 0xb1, 0x8f])], ["IDAT", z], end]), /extra chunk/);
    await no(build([["IHDR", ihdr(512, rows)], ["sRGB", new Uint8Array([0])], ["IDAT", z], end]), /extra chunk/);
    await no(build([["IHDR", ihdr(512, rows)], ["tRNS", new Uint8Array(6)], ["IDAT", z], end]), /extra chunk/);
    await no(build([["IHDR", ihdr(512, rows)], ["IDAT", z], ["tEXt", new Uint8Array([65, 0, 66])], end]), /extra chunk|out of place/);
    await no(build([["IDAT", z], ["IHDR", ihdr(512, rows)], end]), /out of place/);
    await no(build([["IHDR", ihdr(512, rows)], end]), /out of place/);
    await no(build([["IHDR", ihdr(512, rows)], ["IDAT", z]]), /no IEND/);
    // Pixels that don't fill the rows, or overflow them (a "zip bomb" is cut off at the size).
    await no(build([["IHDR", ihdr(512, rows + 1)], ["IDAT", z], end]), /wrong size/);
    await no(build([["IHDR", ihdr(512, rows)], ["IDAT", await idat(new Uint8Array(PNG_BOX_ROW_BYTES * (rows + 50)), rows + 50)], end]), /wrong size/);
    await no(build([["IHDR", ihdr(512, rows)], ["IDAT", z.subarray(0, z.length - 9)], end]));
    const trailing = new Uint8Array(ok.length + 1);
    trailing.set(ok);
    await no(trailing, /after IEND/);
    // A whole chunk after IEND, even a second IEND, is refused too.
    await no(build([["IHDR", ihdr(512, rows)], ["IDAT", z], end, end]), /after IEND/);
    await no(build([["IHDR", ihdr(512, rows)], ["IDAT", z], end, ["IDAT", z]]), /after IEND/);
    const damaged = ok.slice();
    damaged[40] ^= 4;
    await no(damaged, /damaged/);
    await no(ok.subarray(0, 30), /cut off/);
    await no(new Uint8Array([1, 2, 3]), /Not a PNG/);
  });
});
