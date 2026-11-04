// Everyone's dice in their own colour, and Malspar's pearl (4 November 2026): the colour beside the
// roller's name goes round and tints each die in the chat; Malspar's rolls (from his card, or by a
// player who plays him) get pearl dice with gold numbers that shimmer and tumble in. Looks only.
import { describe, expect, it } from "vitest";
import { GUIDE } from "../src/client/guide";
import { PEARL_CHARACTER, isPearlRoll } from "../src/client/ui/diceLook";
import { cleanCharacter, type Character } from "../src/shared/characters";

const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd";
const malspar: Character = { ...cleanCharacter({ id: SHEET, name: "Malspar Thorne", hp: 30, maxHp: 30 })!, players: [{ userId: "playsMalspar1", name: "G" }] };
const others: Character = { ...cleanCharacter({ id: "1Other0000000000000000000000000000", name: "Grimmdark", hp: 30, maxHp: 37 })!, players: [{ userId: "playsGrimm123", name: "Greg" }] };
const party = { characters: [others, malspar] };
const roll = (text: string, userId: string, role: "gm" | "player" = "player") => ({ kind: "roll" as const, text, userId, role });

describe("Malspar's pearl dice", () => {
  it("are his rolls: from his card, or by a player who plays him", () => {
    expect(PEARL_CHARACTER).toBe("Malspar");
    expect(isPearlRoll(roll("Malspar: Rapier to hit", "playsMalspar1"), party)).toBe(true);
    expect(isPearlRoll(roll("", "playsMalspar1"), party)).toBe(true);
    // The GM rolling from his card.
    expect(isPearlRoll(roll("Malspar: sneak damage", "theGm00000000", "gm"), party)).toBe(true);
  });

  it("not anyone else's, nor the GM's own (their creatures keep plain dice)", () => {
    expect(isPearlRoll(roll("Grimmdark: combat rest", "playsGrimm123"), party)).toBe(false);
    expect(isPearlRoll(roll("", "playsGrimm123"), party)).toBe(false);
    expect(isPearlRoll(roll("", "playsMalspar1", "gm"), { characters: [{ ...malspar, players: [{ userId: "playsMalspar1", name: "G" }] }] })).toBe(false);
    expect(isPearlRoll({ kind: "chat", text: "Malspar: hello", userId: "playsMalspar1", role: "player" }, party)).toBe(false);
    expect(isPearlRoll(roll("", "playsMalspar1"), null)).toBe(false);
  });

  it("are pearl with gold numbers, shimmer, tumble in while new, and keep still for reduced motion", () => {
    const css = read("src/client/styles.css");
    for (const rule of [".roll.pearl .die,", ".roll.pearl .die::after {", ".roll.pearl.fresh .die {", ".roll.pearl .roll-total {", "@keyframes pearl-shine", "@keyframes pearl-tumble"]) expect(css).toContain(rule);
    const still = css.slice(css.indexOf("@keyframes pearl-tumble"));
    expect(still).toContain("@media (prefers-reduced-motion: reduce)");
    expect(still).toContain("animation: none;");
    const view = read("src/client/ui/ChatPanel.tsx");
    expect(view).toContain('cx("roll", props.compact && "compact", pearl && "pearl", fresh && "fresh")');
  });
});

describe("everyone's dice in their own colour", () => {
  it("each die framed and tinted in the roller's colour, the highest and lowest still green and red", () => {
    const view = read("src/client/ui/ChatPanel.tsx");
    expect(view).toContain('style={{ "--die-color": m.color } as Record<string, string>}');
    const css = read("src/client/styles.css");
    expect(css).toContain("border: 2px solid var(--die-color, transparent);");
    expect(css).toContain(".roll .die:not(.max):not(.min) {");
  });

  it("leads What's new, and says how to change your colour", () => {
    const news = GUIDE.find((s) => s.id === "whats-new")!;
    expect(news.parts[0].title).toBe("Everyone's dice in their own colour (4 November 2026)");
    const entry = [...news.parts[0].steps, ...news.parts[0].notes].join("\n");
    for (const words of ["**Chat & dice**", "**Change your name or colour**", "green and red", "Malspar", "pearl", "for looks only", "reduce motion"]) expect(entry).toContain(words);
    expect(read("src/client/ui/ChatPanel.tsx")).toContain('title="Change your name or colour"');
  });
});
