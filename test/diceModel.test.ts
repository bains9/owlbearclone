// Dice as they are (4 November 2026), modelled on Roll20: each die in the chat shaped as it is, the
// total outlined green, red or blue for both; and a roll's dice thrown across the map in 3D for
// everyone who gets the roll, landing on what the server rolled, staying until the map is clicked
// or someone rolls again. Each device can turn the 3D dice off.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { LINGER_MS, MAX_THROWN, diceTheme, loadDice3d, saveDice3d, throwNotation } from "../src/client/dice3d";
import { RoomClient } from "../src/client/room/client";
import { dieShape, totalOutline } from "../src/client/ui/diceLook";
import { DICE_SET_IDS } from "../src/shared/diceSets";
import type { ChatMessage, RollResult, RollTerm } from "../src/shared/types";

const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then((t) => t.replace(/\r\n/g, "\n"));

const dice = (sides: number | "F", ...vs: (number | [number, "dropped"])[]): RollTerm => ({
  kind: "dice",
  sign: 1,
  notation: `${vs.length}d${sides}`,
  count: vs.length,
  sides,
  rolls: vs.map((v) => (Array.isArray(v) ? { v: v[0], dropped: true } : { v, dropped: false })),
  subtotal: 0,
});
const roll = (...terms: RollTerm[]): RollResult => ({ expr: "", total: 0, terms });

describe("the chat's dice, shaped", () => {
  it("as the real thing: a d4 a triangle, a d6 a square, a d8 a diamond, a d10 a kite, a d12 a pentagon, a d20 a gem", () => {
    expect([4, 6, 8, 10, 12, 20].map((s) => dieShape(s)?.key)).toEqual(["d4", "d6", "d8", "d10", "d12", "d20"]);
    expect(dieShape(4)?.points?.split(" ")).toHaveLength(3);
    expect(dieShape(12)?.points?.split(" ")).toHaveLength(5);
    expect(dieShape(20)?.points?.split(" ")).toHaveLength(6);
    // The d10's V, so it isn't taken for a d8.
    expect(dieShape(10)?.facets).toBe("4,36 50,50 96,36");
    expect(dieShape(20)?.clip).toBe("polygon(50% 2%, 94% 26%, 94% 74%, 50% 98%, 6% 74%, 6% 26%)");
  });

  it("a d100 a wide kite, Fudge a square, a d3 a triangle, a d2 a coin; a d7 none (a chip)", () => {
    expect(dieShape(100)).toMatchObject({ key: "d10", wide: true });
    expect(dieShape("F")?.key).toBe("d6");
    expect(dieShape(3)?.key).toBe("d4");
    expect(dieShape(2)).toMatchObject({ key: "d2", clip: "circle(46% at 50% 50%)" });
    expect(dieShape(7)).toBeNull();
  });

  it("with the total outlined as Roll20 outlines a roll: green, red, blue for both; a roll to hit by the handbook", () => {
    expect(totalOutline(roll(dice(20, 20)))).toBe("hit");
    expect(totalOutline(roll(dice(20, 1)))).toBe("fail");
    expect(totalOutline(roll(dice(6, 6, 1, 3)))).toBe("both");
    expect(totalOutline(roll(dice(6, 3, 4)))).toBeNull();
    // A dropped die doesn't count (advantage's lower d20).
    expect(totalOutline(roll(dice(20, 15, [1, "dropped"])))).toBeNull();
    expect(totalOutline(roll(dice("F", 1, 0)))).toBe("hit");
    // The handbook's critical, when it's a roll to hit.
    expect(totalOutline(roll(dice(10, 10, 4)), null)).toBe("hit");
    expect(totalOutline(roll(dice(10, 10, 4)), "fail")).toBe("fail");
  });

  it("drawn: the paint clipped to the outline, the outline over it, the number where it sits", async () => {
    const chat = await source("src/client/ui/ChatPanel.tsx");
    expect(chat).toContain(`<span class={cx(props.cls, "die-shaped", \`die-\${shape.key}\`, shape.wide && "wide")} title={props.title} style={style}>`);
    expect(chat).toContain('{shape.points ? <polygon class="die-edge" points={shape.points} /> : <circle class="die-edge" cx="50" cy="50" r="46" />}');
    expect(chat).toContain(`<span class={cx("roll-total", outline && \`outlined \${outline}\`)}`);
    const css = await source("src/client/styles.css");
    expect(css).toContain(".die-shaped .die-body {\n  position: absolute;\n  inset: 0;\n  z-index: -1;\n  clip-path: var(--die-clip);");
    expect(css).toContain(".roll-total.outlined.both {\n  border-color: #4f9dde;");
    expect(css).toContain("@media (prefers-reduced-motion: reduce) {\n  .dice-painted .die.die-shaped::before {\n    animation: none;");
  });
});

describe("the dice thrown on the map", () => {
  // The browser's storage, as these tests have none.
  const kept = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
    clear: () => kept.clear(),
  });
  afterEach(() => {
    kept.clear();
    vi.restoreAllMocks();
  });

  it("land on the server's rolls, the dropped ones too, in the library's notation", () => {
    expect(throwNotation(roll(dice(10, 9, 9)))).toBe("2d10@9,9");
    expect(throwNotation(roll(dice(20, 15, [3, "dropped"]), { kind: "num", sign: 1, value: 5 }, dice(6, 4)))).toBe("2d20+1d6@15,3,4");
    expect(throwNotation(roll(dice("F", 1, 0, -1)))).toBe("3df@1,0,-1");
    // A d7 has no die to throw; a roll of numbers only, nothing.
    expect(throwNotation(roll(dice(7, 3)))).toBeNull();
    expect(throwNotation(roll({ kind: "num", sign: 1, value: 4 }))).toBeNull();
  });

  it("a d100 as two dice, as on Roll20: tens 00 to 90 and units 0 to 9, 00 and 0 making 100", () => {
    expect(throwNotation(roll(dice(100, 37)))).toBe("1d100+1d10@30,7");
    expect(throwNotation(roll(dice(100, 40)))).toBe("1d100+1d10@40,10");
    expect(throwNotation(roll(dice(100, 5)))).toBe("1d100+1d10@100,5");
    expect(throwNotation(roll(dice(100, 100)))).toBe("1d100+1d10@100,10");
  });

  it("at most a handful at once (the chat shows them all)", () => {
    const n = throwNotation(roll(dice(6, ...Array.from({ length: 100 }, () => 3))))!;
    expect(n.startsWith(`${MAX_THROWN}d6@`)).toBe(true);
    expect(n.split("@")[1].split(",")).toHaveLength(MAX_THROWN);
  });

  it("painted in each set; Classic in the roller's colour", () => {
    for (const id of DICE_SET_IDS.filter((x) => x !== "classic")) expect(diceTheme(id, "#000000").background).toMatch(/^#[0-9a-f]{6}$/);
    expect(diceTheme("villain", "#000000")).toMatchObject({ background: "#141010", foreground: "#f4ead6", edge: "#b3121f" });
    expect(diceTheme("pearl", "#000000")).toMatchObject({ foreground: "#a87a00", material: "glass" });
    expect(diceTheme("classic", "#29bf9b")).toMatchObject({ background: "#29bf9b", foreground: "#ffffff" });
    expect(diceTheme("classic", "nope").background).toBe("#4f9dde");
  });

  it("on unless the device is set to reduce motion or turns them off; each device remembers", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q }));
    expect(loadDice3d()).toBe(true);
    saveDice3d(false);
    expect(loadDice3d()).toBe(false);
    kept.clear();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q }));
    expect(loadDice3d()).toBe(false);
    saveDice3d(true);
    expect(loadDice3d()).toBe(true);
  });

  it("for each roll as it comes in, not those from before the page joined", () => {
    const room = new RoomClient("AbCdEf123456", { uid: "user1abcdef", name: "Ann", color: "#ff0000" });
    const seen: ChatMessage[] = [];
    const off = room.onRoll((m) => seen.push(m));
    const message: ChatMessage = { id: "m1", ts: 1, userId: "u", name: "Ann", color: "#ff0000", role: "player", kind: "roll", text: "", roll: roll(dice(20, 7)) };
    (room as unknown as { onServer(msg: unknown): void }).onServer({ t: "chat", message });
    (room as unknown as { onServer(msg: unknown): void }).onServer({ t: "chat", message: { ...message, id: "m2", kind: "chat", roll: undefined } });
    expect(seen.map((m) => m.id)).toEqual(["m1"]);
    off();
    (room as unknown as { onServer(msg: unknown): void }).onServer({ t: "chat", message: { ...message, id: "m3" } });
    expect(seen).toHaveLength(1);
  });

  it("stay where they land until the map is clicked or someone rolls again (half a minute at most)", async () => {
    expect(LINGER_MS).toBe(30_000);
    const d3 = await source("src/client/dice3d.ts");
    expect(d3).toContain('stage?.addEventListener("pointerdown", done, true);');
    expect(d3).toContain("// The last roll's dice go: these take the map.\n  letGo?.();");
    expect(d3).toContain('await import("@3d-dice/dice-box-threejs")');
    const page = await source("src/client/ui/RoomPage.tsx");
    expect(page).toContain('<Guard name="the dice thrown on the map">\n            <DiceThrow />');
    expect(page).toContain("Throw the dice on the map (3D)");
    const css = await source("src/client/styles.css");
    expect(css).toContain(".dice-throw {\n  position: absolute;\n  inset: 0;\n  z-index: 9;\n  pointer-events: none;");
  });
});

describe("the guide", () => {
  it("leads What's new with them, and Dice and chat explains the thrown dice", () => {
    const news = GUIDE.find((s) => s.id === "whats-new")!;
    expect(news.parts[1].title).toBe("Dice as they are: shaped in the chat, and thrown across the map (4 November 2026)");
    const top = [...news.parts[1].steps, ...news.parts[1].notes].join("\n");
    for (const words of ["a d4 is a triangle", "outlined as on Roll20", "**Throw the dice on the map (3D)**", "they stay where they land until you click the map or someone rolls again", "00 and 0 make 100"]) expect(top).toContain(words);
    const chat = GUIDE.find((s) => s.id === "dice-and-chat")!;
    expect(chat.parts.at(-1)!.title).toBe("Dice thrown on the map");
  });
});
