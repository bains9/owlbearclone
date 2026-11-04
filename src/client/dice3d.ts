/// <reference path="./dice-box.d.ts" />
// Dice thrown on screen (4 November 2026): a roll's dice, in 3D, tossed across the map for everyone
// who gets the roll (so a private one only for the roller and the GM), landing on what the server
// rolled. They act the roll out; they decide nothing. Each is painted in the set it was rolled in
// (shared/diceSets.ts), Classic in the roller's colour. The library (@3d-dice/dice-box-threejs, MIT:
// three.js and cannon-es) loads the first time dice are thrown, so rooms open no slower. Each device
// can turn them off (This device, under Change your name or colour); one set to reduce motion starts
// with them off.
import { messageDice, type DiceSetId } from "../shared/diceSets";
import type { ChatMessage, RollResult } from "../shared/types";

/** At most this many dice are thrown for one roll (the rest show in the chat only). */
export const MAX_THROWN = 30;
/**
 * The dice stay on the map after they stop, as on Roll20, until this device's map is clicked or
 * someone rolls again; at most this long (ms), for a screen nobody touches (a table display).
 */
export const LINGER_MS = 30_000;

/**
 * The library's notation for a roll, landing on its results: "2d10+1d6@9,9,4". Each die of a
 * kind it has (d2, d3, d4, d6, d8, d10, d12, d20, d100 as a tens and a units die, Fudge), the
 * dropped ones too; null when there's none to throw.
 */
export function throwNotation(roll: Pick<RollResult, "terms">): string | null {
  const dice: { type: string; value: number }[] = [];
  for (const t of roll.terms) {
    if (t.kind !== "dice") continue;
    for (const d of t.rolls) {
      if (t.sides === "F") dice.push({ type: "df", value: d.v });
      else if (t.sides === 100) {
        // The tens die reads 00 to 90 (00 for 0 or 100), the units die 0 to 9 (0 for 10): 00 and 0 is 100.
        const units = d.v % 10;
        const tens = d.v - units;
        dice.push({ type: "d100", value: tens === 0 ? 100 : tens }, { type: "d10", value: units === 0 ? 10 : units });
      } else if ([2, 3, 4, 6, 8, 10, 12, 20].includes(t.sides)) dice.push({ type: `d${t.sides}`, value: d.v });
    }
  }
  const thrown = dice.slice(0, MAX_THROWN);
  if (!thrown.length) return null;
  // Runs of the same kind, in order: the results go to the dice in that order.
  const groups: { type: string; n: number }[] = [];
  for (const d of thrown) {
    const last = groups.at(-1);
    if (last?.type === d.type) last.n++;
    else groups.push({ type: d.type, n: 1 });
  }
  return `${groups.map((g) => `${g.n}${g.type}`).join("+")}@${thrown.map((d) => d.value).join(",")}`;
}

export interface DiceTheme {
  /** The die's colour, its numbers', and their outline (the die's own colour: none). */
  background: string;
  foreground: string;
  outline: string;
  edge: string;
  material: "none" | "glass" | "metal" | "wood";
}

/** Each set's paint as the 3D dice show it (the chat's look, as near as plain colours get). */
const THEMES: Record<Exclude<DiceSetId, "classic">, DiceTheme> = {
  pearl: { background: "#efe6ff", foreground: "#a87a00", outline: "#efe6ff", edge: "#c2a8f0", material: "glass" },
  bone: { background: "#ece2c8", foreground: "#1d1a14", outline: "#ece2c8", edge: "#b9a77f", material: "none" },
  ruby: { background: "#b3122a", foreground: "#ffd76a", outline: "#b3122a", edge: "#6e0618", material: "glass" },
  emerald: { background: "#138a4c", foreground: "#ffffff", outline: "#138a4c", edge: "#064d2a", material: "glass" },
  sapphire: { background: "#1d4fc4", foreground: "#e9eef7", outline: "#1d4fc4", edge: "#0a1f66", material: "glass" },
  amethyst: { background: "#7a35cf", foreground: "#ffffff", outline: "#7a35cf", edge: "#3b0f78", material: "glass" },
  copper: { background: "#c06a34", foreground: "#2a1204", outline: "#c06a34", edge: "#8a4419", material: "metal" },
  frost: { background: "#bfe6f8", foreground: "#0b3354", outline: "#bfe6f8", edge: "#7cc0e2", material: "glass" },
  galaxy: { background: "#1b1550", foreground: "#ffffff", outline: "#1b1550", edge: "#2e2a6e", material: "glass" },
  villain: { background: "#141010", foreground: "#f4ead6", outline: "#141010", edge: "#b3121f", material: "glass" },
  blood: { background: "#8a0c18", foreground: "#fff3df", outline: "#8a0c18", edge: "#120003", material: "glass" },
  hellfire: { background: "#160806", foreground: "#ffc43d", outline: "#160806", edge: "#ff5a1a", material: "glass" },
};

/** The 3D paint for a roll: its set's, or for Classic the roller's colour with white numbers. */
export function diceTheme(set: DiceSetId, rollerColor: string): DiceTheme {
  if (set !== "classic") return THEMES[set];
  const color = /^#[0-9a-f]{6}$/i.test(rollerColor) ? rollerColor : "#4f9dde";
  return { background: color, foreground: "#ffffff", outline: color, edge: color, material: "none" };
}

const KEY = "tabletop-dice-3d";
/** The choice made on this page, for when the browser won't store it. */
let here: boolean | null = null;

/** Whether this device throws the dice (on, unless it's set to reduce motion or turned off). */
export function loadDice3d(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "1" || v === "0") return v === "1";
  } catch {
    // No storage: this page's choice, or the default.
  }
  if (here !== null) return here;
  return !(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
}

export function saveDice3d(on: boolean): void {
  here = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // It lasts as long as the page.
  }
}

/** What the library's box does for us (its own types aren't published). */
interface Box {
  initialize(): Promise<void>;
  updateConfig(c: Record<string, unknown>): Promise<void>;
  setDimensions(): void;
  roll(notation: string): Promise<unknown>;
  clearDice(): void;
}

let box: Promise<Box> | null = null;
let boxFor: HTMLElement | null = null;
let throwing = 0;
let names = 0;
/** Lets the dice lying on the map go (a click on it, or the next roll). */
let letGo: (() => void) | null = null;

/** Waits until the map (`el`'s parent) is clicked, the next roll comes, or LINGER_MS pass. */
function linger(el: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const stage = el.parentElement;
    const done = () => {
      clearTimeout(timer);
      stage?.removeEventListener("pointerdown", done, true);
      if (letGo === done) letGo = null;
      resolve();
    };
    const timer = setTimeout(done, LINGER_MS);
    stage?.addEventListener("pointerdown", done, true);
    letGo = done;
  });
}

async function makeBox(el: HTMLElement): Promise<Box> {
  if (!el.id) el.id = "dice-throw";
  // A box that failed leaves its canvas: one at a time.
  el.replaceChildren();
  const { default: DiceBox } = (await import("@3d-dice/dice-box-threejs")) as { default: new (selector: string, config: Record<string, unknown>) => Box };
  const b = new DiceBox(`#${el.id}`, { sounds: false, shadows: true, theme_surface: "green-felt", theme_material: "glass", gravity_multiplier: 400, strength: 1.2, baseScale: 70 });
  await b.initialize();
  return b;
}

/**
 * Throws a roll's dice across `el` (the map), painted in its set. They stay where they land, as on
 * Roll20, until the map is clicked or someone rolls again, then fade. A new roll takes over from one
 * still rolling. Nothing happens when this device has them off, or the roll has no dice to throw; a
 * failure (no WebGL, say) only leaves them unthrown.
 */
export async function throwDice(el: HTMLElement, m: Pick<ChatMessage, "roll" | "dice" | "color">): Promise<void> {
  if (!m.roll || !loadDice3d()) return;
  const notation = throwNotation(m.roll);
  if (!notation) return;
  const mine = ++throwing;
  // The last roll's dice go: these take the map.
  letGo?.();
  try {
    if (!box || boxFor !== el) {
      boxFor = el;
      box = makeBox(el);
    }
    const b = await box;
    if (mine !== throwing) return;
    const theme = diceTheme(messageDice(m), m.color);
    await b.updateConfig({ theme_customColorset: { name: `tabletop-${++names}`, ...theme, texture: "none" } });
    el.classList.remove("fading");
    el.classList.add("showing");
    b.setDimensions();
    await b.roll(notation);
    if (mine !== throwing) return;
    await linger(el);
    if (mine !== throwing) return;
    el.classList.add("fading");
    await new Promise((r) => setTimeout(r, 600));
    if (mine !== throwing) return;
    b.clearDice();
    el.classList.remove("showing", "fading");
  } catch (err) {
    console.warn("The dice couldn't be thrown:", err);
    if (mine === throwing) el.classList.remove("showing", "fading");
    box = null;
  }
}
