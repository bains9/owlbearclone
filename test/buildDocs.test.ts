// The guide and Help & shortcuts, checked against what the Build tool's wheel, keys and bars
// really do: a note that names the wrong key sends people the wrong way.
import { describe, expect, it } from "vitest";
import { GUIDE } from "../src/client/guide";
import { wheelIntent } from "../src/client/room/buildInput";
import type { WheelPref } from "../src/client/room/buildInput";

/** A source file's text (Node's fs, which the tests' types leave out: they check browser and Worker code). */
async function source(path: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

const parts = GUIDE.flatMap((s) => s.parts);
const part = (title: string) => {
  const p = parts.find((x) => x.title === title);
  if (!p) throw new Error(`no guide part "${title}"`);
  return p;
};

/** What one scroll of a smooth-scrolling mouse or a trackpad does to the next object. */
const smooth = (keys: { alt?: boolean; z?: boolean }, pref: WheelPref = "auto") =>
  wheelIntent({ ctrl: false, meta: false, alt: false, z: false, dx: 0, dy: 12, ...keys }, "ghost", "smooth", pref);

/** The keys a sentence says to hold while scrolling: "hold **Z** or **Alt** while you scroll" gives Z and Alt. */
function heldWhileScrolling(text: string): string[] {
  return [...text.matchAll(/hold ((?:\*\*[^*]+\*\*(?:,? or |, )?)+) while you scroll/gi)].flatMap((m) =>
    [...m[1].matchAll(/\*\*([^*]+)\*\*/g)].map((k) => k[1]),
  );
}

const KEYS: Record<string, { alt?: boolean; z?: boolean }> = { Z: { z: true }, Alt: { alt: true } };

describe("the guide, for a wheel or trackpad that moves the map", () => {
  const note = part("Place objects").notes.find((n) => n.includes("moves the map instead of turning"));

  it("is written for a wheel that really does move the map, and trackpads", () => {
    expect(note).toBeDefined();
    expect(smooth({})).toBe("default");
    expect(note).toMatch(/trackpad/);
  });

  it("only names keys that turn the object while you scroll", () => {
    const held = heldWhileScrolling(note!);
    expect(held.length).toBeGreaterThan(0);
    for (const k of held) {
      expect(KEYS[k], `a key the tests know: ${k}`).toBeDefined();
      expect([k, smooth(KEYS[k])]).toEqual([k, "fine-turn"]);
    }
  });

  it("says Alt and the wheel size it, as they do", () => {
    expect(smooth({ alt: true })).toBe("size");
    const altSentences = note!.split(/(?<=\.) /).filter((s) => s.includes("**Alt**"));
    for (const s of altSentences) expect(s).toMatch(/size/);
  });

  it("names the setting that makes the wheel turn exactly as the app does", async () => {
    const room = await source("../src/client/ui/RoomPage.tsx");
    const [, option] = /pick \*\*([^*]+)\*\* for/.exec(note!) ?? [];
    const [, setting] = /for \*\*([^*]+)\*\*/.exec(note!) ?? [];
    expect(room).toContain(`<option value="always">${option}</option>`);
    expect(room).toContain(`<span>${setting}</span>`);
    expect(smooth({}, "always")).toBe("turn");
  });

  it("never offers a key that sizes as a way to turn, anywhere in the guide", () => {
    for (const p of parts)
      for (const text of [...p.steps, ...p.notes])
        for (const k of heldWhileScrolling(text)) if (KEYS[k]) expect([k, text, smooth(KEYS[k])]).toEqual([k, text, "fine-turn"]);
  });

  it("tells Select users what turns the selected objects too", () => {
    const sel = part("Select: move, turn, size, copy and delete").notes.find((n) => n.startsWith("With nothing selected"));
    expect(sel).toMatch(/hold \*\*Z\*\* while you scroll/);
  });
});

describe("Help & shortcuts, [ and ]", () => {
  const row = (src: string, key: string) => {
    const m = new RegExp(`\\["${key.replace(/[[\]]/g, "\\$&")}", "([^"]+)"\\]`).exec(src);
    if (!m) throw new Error(`no row for ${key}`);
    return m[1];
  };

  it("keeps tokens out of the Build tool's row: there [ and ] never turn tokens", async () => {
    const room = await source("../src/client/ui/RoomPage.tsx");
    expect(row(room, "Build tool: [ and ]")).not.toMatch(/token/i);
  });

  it("gives tokens' angles in their own row, as the board turns them", async () => {
    const room = await source("../src/client/ui/RoomPage.tsx");
    const board = await source("../src/client/room/board.ts");
    expect(board).toContain("const step = e.shiftKey ? 15 : 45;");
    expect(row(room, "[ and ]")).toBe("Rotate the selected token 45° (Shift: 15°)");
  });
});

describe("Build › Select on a touch screen", () => {
  it("keeps a Copy button where a phone or tablet shows it, so Paste can be used", async () => {
    const bar = await source("../src/client/ui/Toolbar.tsx");
    const floating = bar.slice(bar.indexOf("export function BuildSelectionBar"), bar.indexOf("export function BuildHints"));
    // The Build tool's bar hides its build-sel-more buttons on touch screens (the floating bar has those).
    const copyInTopBar = /<button class="seg-btn" title="Copy \(Ctrl\+C\)"/.test(bar);
    expect(copyInTopBar || floating.includes('act("copy")')).toBe(true);
    const note = part("Select: move, turn, size, copy and delete").notes.find((n) => n.startsWith("On a phone or tablet"));
    expect(note).toContain("**Copy**");
  });
});
