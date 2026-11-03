// Copied from Dungeon (src/render/props-washroom.ts) by scripts/sync-dungeon-library.mjs, Dungeon 9bae40f. Change it there and run the script again.
import { rr, circle, radial, linear, flame, OUT } from "./propkit";
import { WOODS, METALS, MASONRY, CLAYS, CLOTHS, GLASSES, GOLD, cross, vary, family, shade, ell, poly, fo, cbox, box, disc, plank, drape, glow, stroke, studs, scatter, type C, type Tone, type Variant } from "./propvariants";
import type { PropDef } from "./propkit";

// The washroom for the big library (27 October 2026, at Vern's ask): toilets, privies and
// squat holes, tubs, pools and showers, basins, tanks and boilers, the sauna, laundry, and
// towels and soap. Seen from above with the wall at the top: a toilet's cistern, a basin's
// taps and a bench's back are against it. The baths and washstands of the first libraries
// moved here from Furniture, under the same ids.

const W = "Washroom" as const;
const tone = (light: string, dark: string): Tone => ({ key: "", name: "", light, dark });
const find = (list: Tone[], key: string): Tone => list.find((t) => t.key === key)!;
const metal = (key: string) => find(METALS, key);
const clay = (key: string) => find(CLAYS, key);
const masonry = (key: string) => find(MASONRY, key);
const cloth = (key: string) => find(CLOTHS, key);
const wood = (key: string) => find(WOODS, key);

const WATER = tone("#cfe6f2", "#6a9ab4");
const HOLE = tone("#2a2018", "#0a0806");
const WHITE = tone("#ffffff", "#c8c4bc");
const LINEN = tone("#efe6d0", "#c4b898");
const SOAP = tone("#f6eedc", "#c8b890");
const GLASS = ["#eef6fb", "#9ab8c8"] as const;
const PORCELAIN: Tone = { key: "porcelain", name: "white porcelain", light: "#ffffff", dark: "#c8c4bc" };
const COPPER: Tone = { key: "copper", name: "copper", light: "#e8a070", dark: "#8a4a22" };
const TIN: Tone = { key: "tin", name: "tin", light: "#dde1e6", dark: "#7a808a" };
const LEAD: Tone = { key: "lead", name: "lead", light: "#9aa0a8", dark: "#4a4e56" };
const ENAMELS: Tone[] = [
  { key: "white", name: "white enamel", light: "#ffffff", dark: "#c8c4bc" },
  { key: "cream", name: "cream enamel", light: "#efe2c4", dark: "#bba886" },
  { key: "black", name: "black enamel", light: "#4c4c52", dark: "#18181c" },
  { key: "navy", name: "navy enamel", light: "#3e5e9e", dark: "#1c2c55" },
];
const THREE_WOODS = WOODS.filter((w) => ["honey", "walnut", "ebony"].includes(w.key));
const SAUNA_WOODS = WOODS.filter((w) => ["pale", "honey", "weathered"].includes(w.key));
const TOWELS = ["white", "crimson", "navy", "green", "ochre", "teal"].map((k) => cloth(k));
const OPEN_LIDDED = [vary("open"), vary("lidded")];
const FILL = [vary("empty"), vary("filled")];
const FIRE_LIGHT = { radius: 2, color: "#ffb46a", intensity: 0.5 };

/** Taps on brass, or on silver for something silver. */
const tapsFor = (t: Tone): Tone => metal(t.key === "silver" ? "silver" : "brass");
/** Inside a tub: white enamel inside a painted one, its own metal or glaze otherwise. */
const insideOf = (t: Tone): Tone => (t.key === "black" || t.key === "navy" ? WHITE : t);

/** What's in a tub or basin: water, or (empty) its own inside, lit from the top left. */
function inside(c: C, x: number, y: number, r: number, state: string, t: Tone): CanvasGradient {
  return state === "empty" ? radial(c, x, y, r, shade(t.light, 0.2), t.dark) : radial(c, x, y, r, WATER.light, WATER.dark);
}

/** Suds on bath water: soft white bubbles in an ellipse. */
function suds(c: C, x: number, y: number, rx: number, ry: number, seed: number): void {
  for (const [dx, dy, k] of scatter(18, 1, seed)) {
    circle(c, x + dx * rx, y + dy * ry, 0.025 + k * 0.045);
    c.fillStyle = k > 0.5 ? "rgba(255,255,255,0.95)" : "rgba(232,242,250,0.9)";
    c.fill();
  }
}

/** A hot and a cold tap either side of a spout: across (side by side) or along a tub's end. */
function taps(c: C, x: number, y: number, gap: number, t: Tone, across = true): void {
  const [dx, dy] = across ? [gap, 0] : [0, gap];
  disc(c, x - dx, y - dy, 0.03, t, 0.008);
  disc(c, x + dx, y + dy, 0.03, t, 0.008);
  disc(c, x, y, 0.022, tone(shade(t.light, -0.1), t.dark), 0.008);
}

/** An iron hoop round a cask, tub or bucket. */
function hoop(c: C, x: number, y: number, r: number, w = 0.025): void {
  circle(c, x, y, r);
  c.lineWidth = w;
  c.strokeStyle = "#3c3d43";
  c.stroke();
}

/** A curved handle (an arc of a circle), outlined. */
function handle(c: C, x: number, y: number, r: number, from: number, to: number, t: Tone, w = 0.03): void {
  c.beginPath();
  c.arc(x, y, r, from, to);
  c.lineCap = "round";
  c.lineWidth = w + 0.025;
  c.strokeStyle = OUT;
  c.stroke();
  c.lineWidth = w;
  c.strokeStyle = t.light;
  c.stroke();
}

/** A dark hole, such as a privy's. */
function hole(c: C, x: number, y: number, rx: number, ry: number): void {
  ell(c, x, y, rx, ry);
  fo(c, radial(c, x, y, Math.max(rx, ry), HOLE.light, HOLE.dark), 0.015);
}

const toilets: PropDef[] = [
  ...family({ id: "toilet", name: "Toilet", category: W, group: "Toilets", w: 0.6, h: 0.8, layer: "object" },
    cross([PORCELAIN, clay("cream"), clay("glazed-blue"), metal("brass"), metal("bronze"), metal("silver"), GOLD], OPEN_LIDDED), (c, v) => {
      const t = v.a;
      const seat = wood("honey");
      // The cistern against the wall, its pipe down to the bowl and the flush handle.
      cbox(c, 0, -0.31, 0.46, 0.14, t, 0.03);
      stroke(c, [0, -0.24, 0, -0.12], 0.045, shade(t.dark, -0.2));
      disc(c, 0.17, -0.31, 0.028, tapsFor(t), 0.008);
      ell(c, 0, 0.07, 0.235, 0.3);
      fo(c, radial(c, 0, 0.07, 0.3, t.light, t.dark));
      // The wooden seat, narrower than the bowl so its rim shows: a ring round the water with
      // the lid up against the cistern, or the lid down.
      if (v.b.key === "open") cbox(c, 0, -0.17, 0.3, 0.07, seat, 0.03);
      ell(c, 0, 0.09, 0.15, 0.2);
      fo(c, linear(c, -0.15, -0.1, 0.15, 0.28, seat.light, seat.dark), 0.015);
      if (v.b.key === "open") {
        ell(c, 0, 0.1, 0.095, 0.14);
        fo(c, radial(c, 0, 0.1, 0.14, WATER.light, WATER.dark), 0.012);
      } else disc(c, 0, 0.25, 0.022, tapsFor(t), 0.006);
    }),
  ...family({ id: "urinal", name: "Urinal", category: W, group: "Toilets", w: 0.5, h: 0.4, layer: "object" }, [PORCELAIN, clay("cream"), metal("brass")], (c, v) => {
    // A bowl on the wall: flat against it, rounded below.
    c.beginPath();
    c.ellipse(0, -0.17, 0.21, 0.34, 0, 0, Math.PI);
    c.closePath();
    fo(c, radial(c, 0, -0.05, 0.3, v.light, v.dark));
    c.beginPath();
    c.ellipse(0, -0.15, 0.14, 0.24, 0, 0, Math.PI);
    c.closePath();
    fo(c, radial(c, 0, -0.05, 0.2, shade(v.light, 0.2), shade(v.dark, -0.1)), 0.012);
    for (const x of [-0.03, 0, 0.03]) disc(c, x, 0.02, 0.01, HOLE, 0.004);
    disc(c, 0, -0.15, 0.03, tapsFor(v), 0.008);
  }),
  ...family({ id: "bidet", name: "Bidet", category: W, group: "Toilets", w: 0.5, h: 0.7, layer: "object" }, [PORCELAIN, clay("cream"), metal("brass")], (c, v) => {
    ell(c, 0, 0.04, 0.21, 0.29);
    fo(c, radial(c, 0, 0.04, 0.29, v.light, v.dark));
    ell(c, 0, 0.07, 0.14, 0.21);
    fo(c, radial(c, 0, 0.07, 0.21, shade(v.light, 0.2), shade(v.dark, -0.05)), 0.012);
    disc(c, 0, 0.14, 0.02, HOLE, 0.004);
    taps(c, 0, -0.19, 0.08, tapsFor(v));
  }),
  ...family({ id: "close-stool", name: "Close stool", category: W, group: "Toilets", w: 0.7, h: 0.7, layer: "object" },
    cross(THREE_WOODS, [cloth("crimson"), cloth("navy"), cloth("green")]), (c, v) => {
      // A box with a padded lid, the pot inside: a noble's privy.
      cbox(c, 0, 0, 0.64, 0.64, v.a, 0.05);
      rr(c, -0.25, -0.25, 0.5, 0.5, 0.12);
      fo(c, radial(c, 0, 0, 0.36, v.b.light, v.b.dark), 0.02);
      for (const [x, y] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1], [0, 0]]) disc(c, x, y, 0.018, GOLD, 0.005);
      for (const x of [-0.31, 0.31]) disc(c, x, 0, 0.03, metal("brass"), 0.008);
    }),
  ...family({ id: "chamber-pot", name: "Chamber pot", category: W, group: "Toilets", w: 0.45, h: 0.4, layer: "object" },
    cross([clay("terracotta"), clay("glazed-blue"), clay("cream"), metal("brass"), metal("silver"), GOLD], OPEN_LIDDED), (c, v) => {
      const t = v.a;
      handle(c, 0.13, 0, 0.065, -Math.PI / 2, Math.PI / 2, t);
      disc(c, -0.03, 0, 0.16, t);
      if (v.b.key === "lidded") {
        disc(c, -0.03, 0, 0.13, tone(shade(t.light, 0.15), t.dark), 0.015);
        disc(c, -0.03, 0, 0.03, t, 0.01);
      } else disc(c, -0.03, 0, 0.12, tone(shade(t.light, -0.2), shade(t.dark, -0.35)), 0.012);
    }),
];

const HOLES = [
  { key: "two", name: "two holes", n: 2 },
  { key: "three", name: "three holes", n: 3 },
  { key: "four", name: "four holes", n: 4 },
];
const SQUAT: Tone[] = [...["granite", "marble", "sandstone", "slate"].map((k) => masonry(k)), { ...wood("honey"), key: "wooden", name: "wooden boards" }, PORCELAIN, metal("brass")];

const privies: PropDef[] = [
  ...family({ id: "privy-seat", name: "Privy seat", category: W, group: "Privies and latrines", w: 0.9, h: 0.7, layer: "object" }, cross(WOODS, OPEN_LIDDED), (c, v) => {
    // A wooden box seat along the wall, with a hole, or its lid on.
    plank(c, -0.44, -0.34, 0.88, 0.14, v.a, 4701);
    plank(c, -0.44, -0.2, 0.88, 0.53, v.a, 4703);
    if (v.b.key === "open") hole(c, 0, 0.06, 0.15, 0.13);
    else {
      ell(c, 0, 0.06, 0.18, 0.16);
      fo(c, linear(c, -0.18, -0.1, 0.18, 0.22, shade(v.a.light, 0.12), v.a.dark), 0.015);
      disc(c, 0, 0.17, 0.025, metal("iron"), 0.006);
    }
  }),
  ...family({ id: "squat-hole", name: "Squat hole", category: W, group: "Privies and latrines", w: 1, h: 1, layer: "floor" }, SQUAT, (c, v) => {
    if (v.key === "wooden") for (let i = 0; i < 5; i++) plank(c, -0.48 + i * 0.192, -0.48, 0.192, 0.96, v, 4710 + i);
    else if (v.key === "porcelain" || v.key === "brass") {
      // A pan set in the floor.
      rr(c, -0.32, -0.44, 0.64, 0.88, 0.26);
      fo(c, radial(c, 0, 0, 0.5, v.light, v.dark));
      rr(c, -0.27, -0.39, 0.54, 0.78, 0.22);
      fo(c, radial(c, 0, -0.05, 0.45, shade(v.light, 0.15), shade(v.dark, 0.1)), 0.012);
    } else cbox(c, 0, 0, 0.96, 0.96, v, 0.03);
    // Ridged treads for the feet, and the hole towards the back with its slot.
    for (const x of [-0.17, 0.17]) {
      ell(c, x, 0.16, 0.075, 0.15);
      fo(c, radial(c, x, 0.16, 0.15, shade(v.light, -0.05), shade(v.dark, -0.15)), 0.012);
      for (const y of [0.08, 0.14, 0.2, 0.26]) stroke(c, [x - 0.04, y, x + 0.04, y], 0.012, shade(v.dark, -0.3));
    }
    poly(c, [-0.045, -0.12, 0.045, -0.12, 0.06, 0.04, -0.06, 0.04]);
    fo(c, linear(c, 0, -0.12, 0, 0.04, HOLE.dark, shade(v.dark, -0.3)), 0.012);
    hole(c, 0, -0.17, 0.1, 0.12);
  }),
  ...family({ id: "latrine-bench", name: "Latrine bench", category: W, group: "Privies and latrines", w: 1.6, h: 0.7, layer: "object" }, cross(THREE_WOODS, HOLES), (c, v) => {
    const half = v.b.n * 0.4 - 0.02;
    plank(c, -half, -0.33, half * 2, 0.14, v.a, 4720);
    plank(c, -half, -0.19, half * 2, 0.52, v.a, 4721);
    for (let i = 0; i < v.b.n; i++) hole(c, (i + 0.5) * 0.8 - v.b.n * 0.4, 0.06, 0.14, 0.12);
  }, { size: (v) => [v.b.n * 0.8, 0.7] }),
  ...family({ id: "garderobe", name: "Garderobe", category: W, group: "Privies and latrines", w: 1, h: 1, layer: "object" }, MASONRY, (c, v) => {
    // A castle's privy: an alcove in the wall, a plank seat across it over the shaft.
    box(c, -0.5, -0.5, 1, 0.22, v, 0.02);
    box(c, -0.5, -0.28, 0.2, 0.78, v, 0.02);
    box(c, 0.3, -0.28, 0.2, 0.78, v, 0.02);
    plank(c, -0.3, -0.28, 0.6, 0.42, wood("walnut"), 4730);
    hole(c, 0, -0.08, 0.12, 0.11);
  }),
  ...family({ id: "slop-pail", name: "Slop pail", category: W, group: "Privies and latrines", w: 0.45, h: 0.45, layer: "object" }, THREE_WOODS, (c, v) => {
    handle(c, 0, 0, 0.2, Math.PI * 1.15, Math.PI * 1.85, metal("iron"), 0.015);
    disc(c, 0, 0, 0.19, v);
    hoop(c, 0, 0, 0.175);
    disc(c, 0, 0, 0.14, tone(shade(v.light, 0.1), v.dark), 0.015);
    disc(c, 0, 0, 0.03, metal("iron"), 0.008);
  }),
  ...family({ id: "privy-stall", name: "Privy stall", category: W, group: "Privies and latrines", w: 1, h: 1.4, layer: "object" }, THREE_WOODS, (c, v) => {
    // Plank walls on three sides, the seat at the back and the door shut at the front.
    plank(c, -0.5, -0.7, 1, 0.1, v, 4740);
    plank(c, -0.5, -0.6, 0.08, 1.28, v, 4741);
    plank(c, 0.42, -0.6, 0.08, 1.28, v, 4742);
    plank(c, -0.42, -0.6, 0.84, 0.4, tone(shade(v.light, -0.08), v.dark), 4743);
    hole(c, 0, -0.4, 0.13, 0.1);
    plank(c, -0.42, 0.6, 0.84, 0.08, v, 4744);
    disc(c, 0.3, 0.64, 0.025, metal("iron"), 0.006);
  }),
];

const BATH_TONES: (Variant & { tone: Tone })[] = [
  { key: "wooden", name: "wooden", tone: WOODS[1] },
  { key: "copper", name: "copper", tone: { key: "", name: "", light: "#e8a070", dark: "#8a4a22" } },
  { key: "white", name: "white enamel", tone: { key: "", name: "", light: "#ffffff", dark: "#c8c4bc" } },
];

const tubs: PropDef[] = [
  ...family({ id: "bath", name: "Bath", category: W, group: "Tubs", w: 1.6, h: 0.9, layer: "object" }, BATH_TONES, (c, v) => {
    rr(c, -0.76, -0.42, 1.52, 0.84, 0.3);
    fo(c, linear(c, -0.7, -0.4, 0.7, 0.4, v.tone.light, v.tone.dark));
    rr(c, -0.64, -0.3, 1.28, 0.6, 0.24);
    fo(c, radial(c, 0, 0, 0.7, "#cfe6f2", "#6a9ab4"), 0.015);
  }),
  ...family({ id: "clawfoot-tub", name: "Clawfoot tub", category: W, group: "Tubs", w: 1.7, h: 0.85, layer: "object" },
    cross([...ENAMELS, COPPER, metal("brass"), metal("silver")], [...FILL, vary("suds", "with suds")]), (c, v) => {
      const t = v.a;
      const feet = tapsFor(t);
      // Claw feet peeking out under the rolled rim.
      for (const x of [-0.6, 0.6]) for (const y of [-0.36, 0.36]) disc(c, x, y, 0.055, feet, 0.012);
      rr(c, -0.8, -0.36, 1.6, 0.72, 0.34);
      fo(c, linear(c, -0.8, -0.36, -0.4, 0.4, t.light, t.dark));
      rr(c, -0.73, -0.29, 1.46, 0.58, 0.28);
      fo(c, linear(c, -0.73, -0.29, -0.4, 0.3, shade(t.light, 0.25), shade(t.light, -0.1)), 0.012);
      rr(c, -0.67, -0.23, 1.34, 0.46, 0.22);
      fo(c, inside(c, 0.05, 0, 0.7, v.b.key, insideOf(t)), 0.015);
      if (v.b.key === "suds") {
        c.save();
        rr(c, -0.67, -0.23, 1.34, 0.46, 0.22);
        c.clip();
        suds(c, 0.05, 0, 0.62, 0.22, 4750);
        c.restore();
      }
      // The taps and spout at the foot end.
      taps(c, -0.7, 0, 0.11, feet, false);
    }),
  ...family({ id: "slipper-bath", name: "Slipper bath", category: W, group: "Tubs", w: 1.6, h: 0.8, layer: "object" },
    cross([ENAMELS[0], ENAMELS[2], COPPER, metal("brass")], FILL), (c, v) => {
      const t = v.a;
      const feet = metal("brass");
      for (const x of [-0.55, 0.55]) for (const y of [-0.34, 0.34]) disc(c, x, y, 0.05, feet, 0.012);
      rr(c, -0.76, -0.34, 1.52, 0.68, 0.32);
      fo(c, linear(c, -0.76, -0.34, -0.4, 0.4, t.light, t.dark));
      rr(c, -0.64, -0.23, 1.2, 0.46, 0.22);
      fo(c, inside(c, -0.05, 0, 0.6, v.b.key, insideOf(t)), 0.015);
      // The high end, curving up behind the bather's back.
      c.beginPath();
      c.ellipse(0.48, 0, 0.28, 0.34, 0, -Math.PI / 2, Math.PI / 2);
      c.ellipse(0.42, 0, 0.16, 0.24, 0, Math.PI / 2, -Math.PI / 2, true);
      c.closePath();
      fo(c, linear(c, 0.4, -0.3, 0.76, 0.3, shade(t.light, 0.2), t.dark), 0.015);
      taps(c, -0.68, 0, 0.1, feet, false);
    }),
  ...family({ id: "hip-bath", name: "Hip bath", category: W, group: "Tubs", w: 0.9, h: 0.8, layer: "object" }, cross([TIN, COPPER, metal("brass")], FILL), (c, v) => {
    const t = v.a;
    ell(c, 0, 0.04, 0.4, 0.34);
    fo(c, radial(c, 0, 0.04, 0.4, t.light, t.dark));
    ell(c, 0, 0.08, 0.3, 0.25);
    fo(c, inside(c, 0, 0.08, 0.3, v.b.key, t), 0.015);
    // The high back, against the wall.
    c.beginPath();
    c.ellipse(0, 0.04, 0.43, 0.37, 0, Math.PI * 1.08, Math.PI * 1.92);
    c.ellipse(0, 0.06, 0.31, 0.26, 0, Math.PI * 1.92, Math.PI * 1.08, true);
    c.closePath();
    fo(c, linear(c, 0, -0.33, 0, -0.1, shade(t.light, 0.2), t.dark), 0.015);
  }),
  ...family({ id: "barrel-tub", name: "Barrel tub", category: W, group: "Tubs", w: 1.1, h: 1.1, layer: "object" }, cross(THREE_WOODS, FILL), (c, v) => {
    const t = v.a;
    disc(c, 0, 0, 0.52, t);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      stroke(c, [Math.cos(a) * 0.43, Math.sin(a) * 0.43, Math.cos(a) * 0.52, Math.sin(a) * 0.52], 0.012, shade(t.dark, -0.3), "butt");
    }
    hoop(c, 0, 0, 0.49);
    circle(c, 0, 0, 0.43);
    fo(c, inside(c, 0, 0, 0.43, v.b.key, tone(shade(t.dark, -0.05), shade(t.dark, -0.35))), 0.015);
  }),
];

const pools: PropDef[] = [
  ...family({ id: "sunken-bath", name: "Sunken bath", category: W, group: "Pools and showers", w: 3, h: 2, layer: "floor" }, cross(MASONRY, [vary("filled"), vary("drained")]), (c, v) => {
    const m = v.a;
    cbox(c, 0, 0, 2.96, 1.96, m, 0.06);
    c.strokeStyle = "rgba(0,0,0,0.18)";
    c.lineWidth = 0.012;
    c.strokeRect(-1.4, -0.9, 2.8, 1.8);
    // The pool, with three steps down at one end.
    cbox(c, 0, 0, 2.56, 1.56, tone(shade(m.light, -0.25), shade(m.dark, -0.35)), 0.04);
    for (let i = 0; i < 3; i++) box(c, -1.28 + i * 0.16, -0.78, 0.16, 1.56, tone(shade(m.light, -0.06 - i * 0.07), shade(m.dark, -0.1 - i * 0.07)), 0.01);
    if (v.b.key === "filled") {
      c.save();
      c.globalAlpha = 0.78;
      rr(c, -1.28, -0.78, 2.56, 1.56, 0.04);
      c.fillStyle = radial(c, 0.3, 0, 1.4, WATER.light, "#4a8aa8");
      c.fill();
      c.restore();
      stroke(c, [0.2, -0.4, 0.7, -0.45], 0.02, "rgba(255,255,255,0.5)");
      stroke(c, [-0.1, 0.35, 0.5, 0.3], 0.02, "rgba(255,255,255,0.4)");
    } else disc(c, 0.6, 0, 0.08, metal("iron"), 0.012);
  }),
  ...family({ id: "plunge-pool", name: "Plunge pool", category: W, group: "Pools and showers", w: 2, h: 2, layer: "floor" }, MASONRY, (c, v) => {
    disc(c, 0, 0, 0.96, v);
    disc(c, 0, 0, 0.76, tone(shade(v.light, -0.25), shade(v.dark, -0.35)), 0.015);
    // Two steps down on the near side, under the water.
    for (const [r0, k] of [[0.76, -0.08], [0.6, -0.16]] as const) {
      c.beginPath();
      c.arc(0, 0, r0, Math.PI * 0.3, Math.PI * 0.7);
      c.arc(0, 0, r0 - 0.16, Math.PI * 0.7, Math.PI * 0.3, true);
      c.closePath();
      fo(c, shade(v.light, k), 0.012);
    }
    c.save();
    c.globalAlpha = 0.78;
    circle(c, 0, 0, 0.76);
    c.fillStyle = radial(c, 0, 0, 0.76, WATER.light, "#4a8aa8");
    c.fill();
    c.restore();
  }),
  ...family({ id: "shower-stall", name: "Shower stall", category: W, group: "Pools and showers", w: 1, h: 1, layer: "object" },
    cross([metal("brass"), metal("iron"), COPPER], [masonry("marble"), masonry("slate")]), (c, v) => {
      const p = v.a;
      const m = v.b;
      cbox(c, 0, 0, 0.96, 0.96, m, 0.04);
      cbox(c, 0, 0.03, 0.8, 0.8, tone(shade(m.light, -0.12), shade(m.dark, -0.15)), 0.03);
      disc(c, 0, 0.12, 0.07, metal("iron"), 0.012);
      for (const d of [-0.03, 0, 0.03]) stroke(c, [d, 0.08, d, 0.16], 0.01, "#1a1a1e");
      // The pipe down the wall, the head and its pull chain.
      stroke(c, [0.3, -0.48, 0.3, -0.3, 0, -0.3, 0, -0.24], 0.035, p.dark);
      disc(c, 0, -0.16, 0.1, p);
      for (const [x, y] of scatter(7, 0.06, 4760)) disc(c, x, -0.16 + y, 0.01, HOLE, 0.004);
      stroke(c, [0.08, -0.1, 0.2, 0.05], 0.01, p.dark);
      disc(c, 0.2, 0.06, 0.025, p, 0.008);
    }),
  ...family({ id: "bucket-shower", name: "Bucket shower", category: W, group: "Pools and showers", w: 0.9, h: 0.9, layer: "object" }, THREE_WOODS, (c, v) => {
    // A slatted floor, the bucket above it and the rope that tips it.
    for (let i = 0; i < 5; i++) plank(c, -0.43 + i * 0.172, -0.43, 0.15, 0.86, v, 4765 + i);
    disc(c, 0, -0.04, 0.22, v);
    hoop(c, 0, -0.04, 0.205);
    disc(c, 0, -0.04, 0.17, WATER, 0.012);
    stroke(c, [0.15, 0.12, 0.33, 0.33], 0.018, "#c8b080");
    disc(c, 0.34, 0.34, 0.03, wood("pale"), 0.008);
  }),
  ...family({ id: "foot-bath", name: "Foot bath", category: W, group: "Pools and showers", w: 0.55, h: 0.45, layer: "object" }, [clay("terracotta"), COPPER, metal("brass")], (c, v) => {
    ell(c, 0, 0, 0.25, 0.19);
    fo(c, radial(c, 0, 0, 0.25, v.light, v.dark));
    ell(c, 0, 0.01, 0.19, 0.14);
    fo(c, radial(c, 0, 0.01, 0.19, WATER.light, WATER.dark), 0.012);
  }),
];

const basins: PropDef[] = [
  ...family({ id: "washstand", name: "Washstand", category: W, group: "Basins and washstands", w: 0.7, h: 0.5, layer: "object" }, WOODS, (c, v) => {
    box(c, -0.33, -0.23, 0.66, 0.46, v, 0.04);
    disc(c, 0, 0, 0.17, { key: "", name: "", light: "#ffffff", dark: "#b8c4cc" });
    disc(c, 0, 0, 0.11, { key: "", name: "", light: "#cfe6f2", dark: "#7aa4bc" }, 0.01);
  }),
  ...family({ id: "pedestal-basin", name: "Pedestal basin", category: W, group: "Basins and washstands", w: 0.6, h: 0.5, layer: "object" },
    [PORCELAIN, clay("cream"), clay("glazed-blue"), masonry("marble"), metal("brass"), COPPER], (c, v) => {
      c.beginPath();
      c.moveTo(-0.28, -0.23);
      c.lineTo(0.28, -0.23);
      c.bezierCurveTo(0.32, 0.1, 0.2, 0.23, 0, 0.23);
      c.bezierCurveTo(-0.2, 0.23, -0.32, 0.1, -0.28, -0.23);
      c.closePath();
      fo(c, radial(c, 0, 0, 0.32, v.light, v.dark));
      ell(c, 0, 0.03, 0.18, 0.14);
      fo(c, radial(c, 0, 0.03, 0.18, shade(v.light, 0.25), shade(v.dark, -0.05)), 0.012);
      disc(c, 0, 0.06, 0.018, HOLE, 0.004);
      taps(c, 0, -0.17, 0.11, tapsFor(v));
    }),
  ...family({ id: "basin-ewer", name: "Basin and ewer", category: W, group: "Basins and washstands", w: 0.5, h: 0.5, layer: "object" },
    [clay("terracotta"), clay("glazed-blue"), clay("glazed-green"), clay("cream"), metal("brass"), metal("silver"), GOLD], (c, v) => {
      disc(c, -0.04, 0.04, 0.2, v);
      disc(c, -0.04, 0.04, 0.15, WATER, 0.012);
      // The ewer stood in it: handle, spout, body and neck.
      handle(c, 0.17, -0.09, 0.045, -Math.PI / 2, Math.PI / 2, v, 0.02);
      poly(c, [0.03, -0.14, -0.06, -0.2, 0.05, -0.08]);
      fo(c, v.dark, 0.012);
      disc(c, 0.09, -0.09, 0.1, v);
      disc(c, 0.09, -0.09, 0.045, tone(shade(v.dark, -0.2), shade(v.dark, -0.5)), 0.01);
    }),
  ...family({ id: "wall-basin", name: "Wall basin", category: W, group: "Basins and washstands", w: 0.5, h: 0.35, layer: "object" }, [PORCELAIN, clay("cream"), metal("brass"), COPPER], (c, v) => {
    c.beginPath();
    c.ellipse(0, -0.16, 0.23, 0.31, 0, 0, Math.PI);
    c.closePath();
    fo(c, radial(c, 0, -0.05, 0.3, v.light, v.dark));
    c.beginPath();
    c.ellipse(0, -0.14, 0.16, 0.22, 0, 0, Math.PI);
    c.closePath();
    fo(c, radial(c, 0, -0.05, 0.2, shade(v.light, 0.25), shade(v.dark, -0.05)), 0.012);
    disc(c, 0, -0.1, 0.025, tapsFor(v), 0.008);
  }),
  ...family({ id: "basin-stand", name: "Basin stand", category: W, group: "Basins and washstands", w: 0.55, h: 0.55, layer: "object" }, METALS, (c, v) => {
    // Three legs splayed out under the bowl.
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
      stroke(c, [0, 0, Math.cos(a) * 0.24, Math.sin(a) * 0.24], 0.035, v.dark);
      disc(c, Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0.025, v, 0.008);
    }
    disc(c, 0, 0, 0.17, v);
    disc(c, 0, 0, 0.12, WATER, 0.012);
  }),
  ...family({ id: "wash-trough", name: "Wash trough", category: W, group: "Basins and washstands", w: 2.4, h: 0.7, layer: "object" },
    [masonry("granite"), masonry("sandstone"), masonry("slate"), wood("honey"), wood("walnut")], (c, v) => {
      if (WOODS.includes(v)) plank(c, -1.18, -0.31, 2.36, 0.62, v, 4770);
      else cbox(c, 0, 0, 2.36, 0.62, v, 0.05);
      rr(c, -1.06, -0.19, 2.12, 0.4, 0.07);
      fo(c, radial(c, 0, 0, 1.1, WATER.light, WATER.dark), 0.015);
      // Spouts along the wall.
      for (const x of [-0.7, 0, 0.7]) {
        stroke(c, [x, -0.31, x, -0.16], 0.04, metal("iron").dark);
        disc(c, x, -0.29, 0.035, metal("iron"), 0.008);
      }
    }),
  ...family({ id: "vanity", name: "Vanity", category: W, group: "Basins and washstands", w: 1.2, h: 0.55, layer: "object" }, WOODS, (c, v) => {
    // A wooden top with a basin let into it, a mirror along the wall and a few bottles.
    plank(c, -0.58, -0.26, 1.16, 0.52, v, 4775);
    rr(c, -0.42, -0.27, 0.84, 0.07, 0.02);
    fo(c, linear(c, -0.42, 0, 0.42, 0, GLASS[0], GLASS[1]), 0.012);
    ell(c, 0.15, 0.05, 0.2, 0.15);
    fo(c, radial(c, 0.15, 0.05, 0.2, WHITE.light, WHITE.dark), 0.015);
    ell(c, 0.15, 0.06, 0.14, 0.1);
    fo(c, radial(c, 0.15, 0.06, 0.14, "#ffffff", "#dde4ea"), 0.01);
    disc(c, 0.15, -0.13, 0.028, metal("brass"), 0.008);
    for (const [x, g] of [[-0.44, 0], [-0.34, 3], [-0.25, 4]] as const) disc(c, x, -0.02, 0.035, GLASSES[g], 0.01);
  }),
  ...family({ id: "pump-sink", name: "Sink with a pump", category: W, group: "Basins and washstands", w: 0.8, h: 0.55, layer: "object" },
    cross([masonry("granite"), masonry("slate")], [metal("iron"), metal("brass")]), (c, v) => {
      const m = v.a;
      const p = v.b;
      cbox(c, 0, 0.02, 0.78, 0.5, m, 0.04);
      rr(c, -0.3, -0.1, 0.62, 0.3, 0.06);
      fo(c, radial(c, 0, 0.05, 0.35, shade(m.light, -0.2), shade(m.dark, -0.3)), 0.015);
      disc(c, 0.12, 0.08, 0.02, HOLE, 0.004);
      // The pump at the back: its barrel, spout over the sink and handle.
      stroke(c, [-0.22, -0.18, -0.22, -0.05], 0.045, p.dark);
      disc(c, -0.22, -0.18, 0.065, p);
      stroke(c, [-0.18, -0.2, 0.18, -0.22], 0.03, p.dark);
      disc(c, 0.18, -0.22, 0.025, p, 0.008);
    }),
];

const tanks: PropDef[] = [
  ...family({ id: "cistern", name: "Cistern", category: W, group: "Tanks and boilers", w: 1, h: 1, layer: "object" },
    cross([{ ...wood("honey"), key: "wooden", name: "wooden" }, COPPER, LEAD], [vary("open"), vary("lidded")]), (c, v) => {
      const t = v.a;
      const wooden = t.key === "wooden";
      if (wooden) plank(c, -0.48, -0.48, 0.96, 0.96, t, 4780);
      else cbox(c, 0, 0, 0.96, 0.96, t, 0.04);
      if (v.b.key === "open") {
        rr(c, -0.4, -0.4, 0.8, 0.8, 0.03);
        fo(c, radial(c, 0, 0, 0.6, WATER.light, "#3a7a98"), 0.015);
      } else if (wooden) for (let i = 0; i < 4; i++) plank(c, -0.42 + i * 0.21, -0.42, 0.2, 0.84, tone(shade(t.light, 0.08), t.dark), 4781 + i);
      else {
        cbox(c, 0, 0, 0.8, 0.8, tone(shade(t.light, 0.1), t.dark), 0.03);
        cbox(c, 0.18, 0.18, 0.26, 0.26, t, 0.02);
        disc(c, 0.18, 0.18, 0.04, t, 0.01);
      }
      if (!wooden) {
        studs(c, -0.44, -0.44, 0.44, -0.44, 7, 0.014, t);
        studs(c, -0.44, 0.44, 0.44, 0.44, 7, 0.014, t);
      }
    }),
  ...family({ id: "water-boiler", name: "Water boiler", category: W, group: "Tanks and boilers", w: 0.9, h: 0.9, layer: "object" }, [COPPER, metal("iron"), metal("brass")], (c, v) => {
    // A brick firebox with its door glowing, and the boiler on top.
    cbox(c, 0, 0, 0.86, 0.86, tone("#a8583a", "#5a2a18"), 0.04);
    for (const y of [-0.2, 0, 0.2]) stroke(c, [-0.43, y, 0.43, y], 0.008, "rgba(30,15,8,0.45)");
    glow(c, 0, 0.38, 0.3, "255,150,60", 0.5);
    rr(c, -0.12, 0.3, 0.24, 0.12, 0.02);
    fo(c, "#1a0e08", 0.012);
    flame(c, 0, 0.37, 0.04);
    disc(c, 0, -0.05, 0.32, v);
    disc(c, 0, -0.05, 0.2, tone(shade(v.light, 0.15), v.dark), 0.015);
    disc(c, 0, -0.05, 0.035, v, 0.008);
    stroke(c, [0.31, -0.05, 0.43, -0.05], 0.04, v.dark);
  }, { light: FIRE_LIGHT }),
];

const TIERS = [
  { key: "one", name: "one tier", n: 1 },
  { key: "two", name: "two tiers", n: 2 },
  { key: "three", name: "three tiers", n: 3 },
];

const sauna: PropDef[] = [
  ...family({ id: "sauna-bench", name: "Sauna bench", category: W, group: "Sauna", w: 2, h: 0.5, layer: "object" }, cross(SAUNA_WOODS, TIERS), (c, v) => {
    // Slatted tiers, the highest against the wall, each lower one darker with a shadow under its edge.
    const h = 0.45 * v.b.n + 0.05;
    for (let i = 0; i < v.b.n; i++) {
      const y = -h / 2 + 0.025 + i * 0.45;
      const t = tone(shade(v.a.light, -0.12 * i), shade(v.a.dark, -0.12 * i));
      cbox(c, 0, y + 0.21, 1.98, 0.42, tone(shade(v.a.dark, -0.35 - 0.1 * i), shade(v.a.dark, -0.55 - 0.1 * i)), 0.02);
      for (let s = 0; s < 3; s++) plank(c, -0.96, y + 0.015 + s * 0.13, 1.92, 0.11, t, 4790 + i * 3 + s);
    }
  }, { size: (v) => [2, 0.45 * v.b.n + 0.05] }),
  ...family({ id: "sauna-stove", name: "Sauna stove", category: W, group: "Sauna", w: 0.8, h: 0.8, layer: "object" }, METALS.slice(0, 3), (c, v) => {
    // A metal box heaped with hot lumps to throw water on.
    cbox(c, 0, 0, 0.74, 0.74, v, 0.06);
    cbox(c, 0, -0.02, 0.58, 0.58, tone(shade(v.dark, -0.2), shade(v.dark, -0.5)), 0.04);
    for (const [x, y, k] of scatter(16, 0.22, 4795)) disc(c, x, y - 0.02, 0.055 + k * 0.03, tone("#a8a6a0", "#5e5c58"), 0.01);
    glow(c, 0, 0.36, 0.22, "255,140,60", 0.45);
  }, { light: FIRE_LIGHT }),
  ...family({ id: "sauna-bucket", name: "Sauna bucket and ladle", category: W, group: "Sauna", w: 0.5, h: 0.5, layer: "object" }, SAUNA_WOODS, (c, v) => {
    disc(c, -0.04, 0.04, 0.18, v);
    hoop(c, -0.04, 0.04, 0.165);
    disc(c, -0.04, 0.04, 0.14, WATER, 0.012);
    stroke(c, [0, 0, 0.2, -0.2], 0.035, shade(v.dark, -0.1));
    disc(c, -0.02, 0.03, 0.06, tone(shade(v.light, 0.1), v.dark), 0.01);
  }),
];

const laundry: PropDef[] = [
  ...family({ id: "washboard-tub", name: "Washtub and washboard", category: W, group: "Laundry", w: 0.9, h: 0.9, layer: "object" }, THREE_WOODS, (c, v) => {
    disc(c, 0, 0.02, 0.42, v);
    hoop(c, 0, 0.02, 0.39);
    circle(c, 0, 0.02, 0.34);
    fo(c, radial(c, 0, 0.02, 0.34, WATER.light, WATER.dark), 0.015);
    c.save();
    circle(c, 0, 0.02, 0.34);
    c.clip();
    suds(c, 0, 0.1, 0.3, 0.2, 4801);
    c.restore();
    // The washboard leant against the side: its frame and ridged tin face.
    plank(c, -0.13, -0.44, 0.26, 0.5, v, 4802);
    box(c, -0.09, -0.36, 0.18, 0.34, TIN, 0.01);
    for (let i = 0; i < 7; i++) stroke(c, [-0.08, -0.33 + i * 0.045, 0.08, -0.33 + i * 0.045], 0.01, shade(TIN.dark, -0.2));
  }),
  ...family({ id: "mangle", name: "Mangle", category: W, group: "Laundry", w: 0.9, h: 0.6, layer: "object" }, THREE_WOODS, (c, v) => {
    const iron = metal("iron");
    for (const x of [-0.38, 0.32]) cbox(c, x, 0, 0.1, 0.56, v, 0.02);
    for (const y of [-0.08, 0.08]) {
      rr(c, -0.33, y - 0.065, 0.65, 0.13, 0.06);
      fo(c, linear(c, 0, y - 0.065, 0, y + 0.065, iron.light, iron.dark), 0.015);
    }
    // The crank wheel and its handle.
    disc(c, 0.36, 0, 0.08, iron);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + 0.4;
      stroke(c, [0.36, 0, 0.36 + Math.cos(a) * 0.07, Math.sin(a) * 0.07], 0.012, iron.dark);
    }
    stroke(c, [0.36, 0, 0.42, 0.22], 0.025, v.dark);
  }),
  ...family({ id: "drying-rack", name: "Drying rack", category: W, group: "Laundry", w: 1.2, h: 0.5, layer: "object" },
    cross(THREE_WOODS, [vary("bare"), vary("linens", "hung with linens")]), (c, v) => {
      for (const y of [-0.15, 0, 0.15]) stroke(c, [-0.55, y, 0.55, y], 0.03, shade(v.a.dark, -0.1));
      if (v.b.key === "linens") {
        drape(c, -0.5, -0.21, 0.42, 0.13, cloth("white"), 4811);
        drape(c, -0.02, -0.06, 0.5, 0.13, LINEN, 4812);
        drape(c, -0.4, 0.09, 0.36, 0.13, cloth("navy"), 4813);
      }
      for (const x of [-0.56, 0.56]) cbox(c, x, 0, 0.06, 0.46, v.a, 0.02);
    }),
  ...family({ id: "clothesline", name: "Clothesline", category: W, group: "Laundry", w: 3, h: 0.5, layer: "object" },
    [vary("linens", "hung with linens"), vary("clothes", "hung with clothes"), vary("towels", "hung with towels")], (c, v) => {
      stroke(c, [-1.4, 0, 1.4, 0], 0.014, "#d8d0b8");
      const hung: [number, number, Tone][] =
        v.key === "linens" ? [[-1.25, 0.6, cloth("white")], [-0.55, 0.6, LINEN], [0.15, 0.55, cloth("white")], [0.82, 0.5, tone("#e8eef4", "#b4c0cc")]]
        : v.key === "clothes" ? [[-1.25, 0.3, cloth("navy")], [-0.85, 0.36, cloth("crimson")], [-0.4, 0.26, cloth("ochre")], [-0.05, 0.4, cloth("white")], [0.45, 0.3, cloth("green")], [0.85, 0.34, cloth("violet")]]
        : [[-1.2, 0.42, cloth("white")], [-0.7, 0.42, cloth("teal")], [-0.2, 0.42, cloth("crimson")], [0.3, 0.42, cloth("white")], [0.8, 0.42, cloth("navy")]];
      for (const [x, w, t] of hung) {
        drape(c, x, -0.04, w, 0.24, t, 4820 + Math.round(x * 10));
        if (v.key === "towels") for (const y of [0.02, 0.15]) stroke(c, [x + 0.02, y, x + w - 0.02, y], 0.02, shade(t.light, t.key === "white" ? -0.25 : 0.3));
        for (const px of [x + 0.05, x + w - 0.05]) disc(c, px, 0, 0.018, wood("pale"), 0.006);
      }
      for (const x of [-1.43, 1.43]) disc(c, x, 0, 0.06, wood("weathered"));
    }),
];

const towels: PropDef[] = [
  ...family({ id: "towel-rail", name: "Towel rail", category: W, group: "Towels, soap and mirrors", w: 0.8, h: 0.3, layer: "object" },
    cross([wood("honey"), wood("walnut"), metal("brass"), metal("silver")], [vary("white", "white towels"), vary("coloured", "coloured towels")]), (c, v) => {
      stroke(c, [-0.36, -0.1, 0.36, -0.1], 0.035, v.a.dark);
      for (const x of [-0.37, 0.37]) disc(c, x, -0.1, 0.035, v.a, 0.01);
      const [a, b] = v.b.key === "white" ? [cloth("white"), LINEN] : [cloth("crimson"), cloth("teal")];
      drape(c, -0.32, -0.12, 0.3, 0.24, a, 4831);
      drape(c, 0.03, -0.12, 0.28, 0.24, b, 4832);
    }),
  ...family({ id: "towel-stack", name: "Folded towels", category: W, group: "Towels, soap and mirrors", w: 0.45, h: 0.4, layer: "object" }, TOWELS, (c, v) => {
    for (let i = 0; i < 3; i++) {
      const x = -0.19 + i * 0.012;
      const y = -0.17 + i * 0.03;
      rr(c, x, y, 0.36, 0.28, 0.04);
      fo(c, linear(c, x, y, x + 0.36, y + 0.28, shade(v.light, -0.1 + i * 0.06), v.dark), 0.015);
    }
    stroke(c, [-0.15, -0.0, 0.18, -0.0], 0.012, shade(v.dark, -0.2));
  }),
  ...family({ id: "soap-dish", name: "Soap dish", category: W, group: "Towels, soap and mirrors", w: 0.35, h: 0.3, layer: "object" },
    [clay("cream"), clay("glazed-blue"), metal("brass"), metal("silver")], (c, v) => {
      ell(c, 0, 0, 0.15, 0.11);
      fo(c, radial(c, 0, 0, 0.15, v.light, v.dark), 0.015);
      rr(c, -0.075, -0.045, 0.15, 0.09, 0.035);
      fo(c, radial(c, 0, 0, 0.1, SOAP.light, SOAP.dark), 0.01);
    }),
  ...family({ id: "bath-oils", name: "Bath oils", category: W, group: "Towels, soap and mirrors", w: 0.5, h: 0.35, layer: "object" }, GLASSES, (c, v) => {
    plank(c, -0.23, -0.15, 0.46, 0.3, wood("walnut"), 4840);
    for (const [x, r] of [[-0.14, 0.05], [-0.02, 0.06], [0.1, 0.045], [0.18, 0.035]]) {
      disc(c, x, 0, r, v, 0.01);
      disc(c, x, 0, r * 0.4, tone("#c8a070", "#8a6040"), 0.006);
    }
  }),
  ...family({ id: "wall-mirror", name: "Wall mirror", category: W, group: "Towels, soap and mirrors", w: 0.8, h: 0.2, layer: "object" },
    [metal("brass"), metal("silver"), GOLD, wood("honey"), wood("walnut")], (c, v) => {
      rr(c, -0.38, -0.07, 0.76, 0.12, 0.03);
      fo(c, linear(c, -0.38, 0, 0.38, 0, v.light, v.dark), 0.015);
      rr(c, -0.33, -0.04, 0.66, 0.06, 0.02);
      fo(c, linear(c, -0.33, 0, 0.33, 0, GLASS[0], GLASS[1]), 0.01);
    }),
  ...family({ id: "shaving-stand", name: "Shaving stand", category: W, group: "Towels, soap and mirrors", w: 0.45, h: 0.45, layer: "object" },
    [metal("brass"), metal("silver"), metal("iron")], (c, v) => {
      // A tray with a lather bowl, a brush, a razor and a hand mirror.
      disc(c, 0, 0, 0.2, v);
      disc(c, -0.06, -0.05, 0.08, WHITE, 0.012);
      disc(c, -0.06, -0.05, 0.06, tone("#ffffff", "#e2eaf0"), 0.006);
      disc(c, 0.08, 0.06, 0.045, tone("#e2d4b4", "#8a7450"), 0.01);
      stroke(c, [-0.02, 0.13, 0.04, 0.02], 0.022, "#d8dce2");
      disc(c, 0.09, -0.09, 0.045, tone(GLASS[0], GLASS[1]), 0.01);
    }),
  ...family({ id: "bath-mat", name: "Bath mat", category: W, group: "Towels, soap and mirrors", w: 1, h: 0.6, layer: "floor" }, TOWELS, (c, v) => {
    rr(c, -0.46, -0.27, 0.92, 0.54, 0.05);
    fo(c, linear(c, -0.46, -0.27, 0.46, 0.27, v.light, v.dark), 0.015);
    for (let i = 0; i < 9; i++) stroke(c, [-0.4 + i * 0.1, -0.22, -0.4 + i * 0.1, 0.22], 0.02, shade(v.light, v.key === "white" ? -0.12 : 0.18));
    // A fringe at each end.
    for (const x of [-0.47, 0.47]) for (let j = 0; j < 8; j++) {
      const y = -0.24 + j * 0.068;
      stroke(c, [x, y, x + (x < 0 ? -0.025 : 0.025), y], 0.012, v.light);
    }
  }),
  ...family({ id: "bath-stool", name: "Bath stool", category: W, group: "Towels, soap and mirrors", w: 0.45, h: 0.45, layer: "object" }, THREE_WOODS, (c, v) => {
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3 + 0.5;
      disc(c, Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.04, tone(shade(v.dark, -0.1), shade(v.dark, -0.3)), 0.01);
    }
    disc(c, 0, 0, 0.17, v);
    circle(c, 0, 0, 0.11);
    c.lineWidth = 0.01;
    c.strokeStyle = "rgba(40,24,12,0.35)";
    c.stroke();
  }),
];

export const WASHROOM_PROPS: PropDef[] = [...toilets, ...privies, ...tubs, ...pools, ...basins, ...tanks, ...sauna, ...laundry, ...towels];
