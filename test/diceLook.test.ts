// How a roll's dice look in the chat (4 November 2026): in the set they were rolled in, a painted
// set's dice tumbling in while the roll is new and Pearl's total in gold; Classic dice framed and
// tinted in the roller's colour (the one beside their name). Looks only.
import { describe, expect, it } from "vitest";
import { GUIDE } from "../src/client/guide";
import { FRESH_MS, rollLook } from "../src/client/ui/diceLook";

const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("a roll's look", () => {
  it("is its set's: painted dice tumble in while it's new, Pearl's total is gold", () => {
    expect(rollLook({ dice: "pearl", ts: 1000 }, 2000)).toEqual({ box: "pearl fresh", dice: "dice-painted dice-set-pearl", fresh: true });
    expect(rollLook({ dice: "pearl", ts: 1000 }, 1000 + FRESH_MS)).toEqual({ box: "pearl", dice: "dice-painted dice-set-pearl", fresh: false });
    expect(rollLook({ dice: "villain", ts: 1000 }, 2000)).toEqual({ box: "fresh", dice: "dice-painted dice-set-villain", fresh: true });
    // Classic, and rolls from before sets: still, in the roller's colour.
    expect(rollLook({ ts: 1000 }, 2000)).toEqual({ box: "", dice: "", fresh: false });
  });

  it("in the chat: the set's classes, each new die a little after the last, the roller's colour for Classic", () => {
    const view = read("src/client/ui/ChatPanel.tsx");
    expect(view).toContain('<div class={cx("roll", props.compact && "compact", look.box)} style={{ "--die-color": m.color } as Record<string, string>}>');
    expect(view).toContain('<div class={cx("roll-dice", look.dice)}>');
    expect(view).toContain("delay={look.fresh ? `${n++ * 70}ms` : undefined}");
    const css = read("src/client/styles.css");
    expect(css).toContain(".roll-dice:not(.dice-painted) .die:not(.die-shaped) {\n  border: 2px solid var(--die-color, transparent);");
    expect(css).toContain(".roll-dice:not(.dice-painted) .die:not(.die-shaped):not(.max):not(.min) {\n  background: color-mix(in srgb, var(--die-color, transparent) 24%, var(--panel-3));");
    // A shaped Classic die: its paint the roller's colour, its outline too.
    expect(css).toContain(".die-shaped .die-body {\n  position: absolute;\n  inset: 0;\n  z-index: -1;\n  clip-path: var(--die-clip);\n  background: color-mix(in srgb, var(--die-color, transparent) 26%, var(--panel-3));");
    expect(css).toContain(".roll.fresh .dice-painted .die {\n  animation: dice-tumble");
    expect(css).toContain(".roll.pearl .roll-total {");
    // Still for a device set to reduce motion.
    const still = css.slice(css.indexOf("@keyframes dice-tumble"));
    expect(still).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n {2}\.roll\.fresh \.dice-painted \.die \{\n {4}animation: none;/);
  });

  it("is in What's new, with how to change your colour", () => {
    const news = GUIDE.find((s) => s.id === "whats-new")!;
    const entry = [...news.parts[2].steps, ...news.parts[2].notes].join("\n");
    for (const words of ["**Chat & dice**", "**Change your name or colour**", "green and red", "Pearl", "tumble in", "reduce motion"]) expect(entry).toContain(words);
    expect(read("src/client/ui/ChatPanel.tsx")).toContain('title="Change your name or colour"');
  });
});
