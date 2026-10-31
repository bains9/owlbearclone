import { describe, expect, it } from "vitest";
import { GUIDE } from "../src/client/guide";
import { drawFx, fxDuration, seeded, type FxPlay } from "../src/client/room/spellfx";
import { FX_COLOR, FX_GROUPS, FX_LOOKS, SPELL_FX, cleanFx, isFxLook, spellFx } from "../src/shared/spellfx";
import type { FxLook } from "../src/shared/spellfx";

const good = { k: "fx", sceneId: "scene1", look: "orb", a: [10.126, 20], b: [300, 200], r: 0, seed: 77 };

describe("the spells and their looks", () => {
  it("names each spell once, each with a look the board can play and the size its cast needs", () => {
    const names = SPELL_FX.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const s of SPELL_FX) {
      expect(isFxLook(s.look), s.name).toBe(true);
      const cast = FX_LOOKS[s.look].cast;
      if (cast === "burst" || cast === "strike" || cast === "cone") expect(s.size, s.name).toBeGreaterThan(0);
      if (cast === "cone") expect(s.spread, s.name).toBeGreaterThan(0);
      if (s.color) expect(FX_COLOR.test(s.color), s.name).toBe(true);
    }
    expect(spellFx("Magic Missile")?.look).toBe("force-darts");
    expect(spellFx("Fireball (not yet)")).toBeUndefined();
  });

  it("puts every spell in one of the picker's groups", () => {
    for (const s of SPELL_FX) expect(FX_GROUPS.filter((g) => g.casts.includes(FX_LOOKS[s.look].cast))).toHaveLength(1);
  });

  it("has the sheets' sizes for the party's spells", () => {
    expect(spellFx("Frost Hands")).toMatchObject({ size: 2, spread: 120 });
    expect(spellFx("Cloudburst")?.size).toBe(5);
    expect(spellFx("Earthmaw")?.size).toBe(2.5);
    expect(spellFx("Call lightning")?.size).toBe(3);
  });
});

describe("a spell effect, as the Room passes it on", () => {
  it("keeps what it knows, tidied", () => {
    const fx = cleanFx({ ...good, color: "#FF5AD0", spread: 60, extra: "x" })!;
    expect(fx).toEqual({ k: "fx", sceneId: "scene1", look: "orb", a: [10.13, 20], b: [300, 200], r: 0, spread: 60, color: "#FF5AD0", seed: 77 });
  });

  it("drops one it doesn't know, or off any map", () => {
    expect(cleanFx({ ...good, look: "fireball" })).toBeNull();
    expect(cleanFx({ ...good, look: "toString" })).toBeNull();
    expect(cleanFx({ ...good, a: [1, 2, 3] })).toBeNull();
    expect(cleanFx({ ...good, b: [1, Infinity] })).toBeNull();
    expect(cleanFx({ ...good, a: [5_000_000, 0] })).toBeNull();
    expect(cleanFx({ ...good, r: -1 })).toBeNull();
    expect(cleanFx({ ...good, seed: 1.5 })).toBeNull();
    expect(cleanFx(null)).toBeNull();
  });

  it("leaves out a colour or a width it can't use", () => {
    const fx = cleanFx({ ...good, color: "red", spread: 400 })!;
    expect("color" in fx || "spread" in fx).toBe(false);
  });
});

/** A canvas that draws nothing but notes what was asked of it. */
function fakeCanvas() {
  const calls: string[] = [];
  const gradient = { addColorStop: () => {} };
  const c = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === "createRadialGradient" || key === "createLinearGradient") return () => gradient;
        return (..._args: unknown[]) => {
          calls.push(key);
        };
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { c, calls };
}

describe("playing an effect", () => {
  const play = (look: FxLook): FxPlay => ({ look, a: { x: 100, y: 100 }, b: { x: 400, y: 200 }, r: 120, spread: 90, color: "#ffd65a", seed: 5, t0: 0, cell: 70 });

  it("draws every look all the way through, then stops", () => {
    for (const look of Object.keys(FX_LOOKS) as FxLook[]) {
      const fx = play(look);
      const ms = fxDuration(look);
      for (const t of [0, 0.05, 0.2, 0.5, 0.8, 0.99]) {
        const { c, calls } = fakeCanvas();
        expect(drawFx(c, fx, t * ms, 1), `${look} at ${t}`).toBe(true);
        expect(calls.length, `${look} at ${t} draws something`).toBeGreaterThan(0);
      }
      expect(drawFx(fakeCanvas().c, fx, ms, 1), `${look} ends`).toBe(false);
    }
  });

  it("makes the same sparks from the same seed, on every screen", () => {
    const a = seeded(42);
    const b = seeded(42);
    const xs = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(seeded(43)()).not.toBe(xs[0]);
  });
});

describe("in the guide", () => {
  it("is in What's new under the zones, and has a section with the tool's key", () => {
    const news = GUIDE.find((s) => s.id === "whats-new")!;
    expect(news.parts[6].title).toBe("Spell effects: cast a spell everyone sees (31 October 2026)");
    const section = GUIDE.find((s) => s.id === "spells")!;
    expect(JSON.stringify(section)).toContain("**S**");
    expect(JSON.stringify(GUIDE)).toContain("**Spells (S)**");
    for (const s of SPELL_FX) expect(JSON.stringify(section), s.name).toContain(s.name);
  });
});
