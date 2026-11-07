// Campaign notes read wide (notesWide.tsx, 4 November 2026): Vern's notes squeezed into the side
// column, when Obsidian gives them most of his screen. Read wide opens the panel out across the
// screen, the list down its left and the note beside it, the map keeping the rest and still in play.
import { describe, expect, it } from "vitest";
import { GUIDE } from "../src/client/guide";
import { MAP_MIN, WIDE_FROM, WIDE_MIN, wideWidth } from "../src/client/notesWidth";

const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then((t) => t.replace(/\r\n/g, "\n"));

describe("how wide the reader is", () => {
  it("takes three quarters of the screen, until the edge is dragged", () => {
    expect(wideWidth(1920, null)).toBe(1440);
    expect(wideWidth(1920, 1000)).toBe(1000);
  });

  it("never squeezes the map out, nor gets too narrow to read", () => {
    expect(wideWidth(1920, 1900)).toBe(1920 - MAP_MIN);
    expect(wideWidth(1920, 100)).toBe(WIDE_MIN);
    // The narrowest screen that reads wide still leaves the map its share.
    expect(wideWidth(WIDE_FROM, null)).toBeLessThanOrEqual(WIDE_FROM - MAP_MIN);
    expect(wideWidth(WIDE_FROM, null)).toBeGreaterThanOrEqual(WIDE_MIN);
  });
});

describe("the panel", () => {
  it("offers Read wide on Campaign notes only, for the GM, and puts the list beside the note", async () => {
    const page = await source("src/client/ui/RoomPage.tsx");
    expect(page).toContain(`const isNotes = props.panel === "notes" && gm;`);
    expect(page).toContain(`{isNotes && notes.can && (`);
    expect(page).toContain(`{wide ? "Side panel" : "Read wide"}`);
    const panel = await source("src/client/ui/NotesPanel.tsx");
    expect(panel).toMatch(/<div class="notes-side" ref=\{side\}>\s*\{head\}\s*\{list\}\s*\{foot\}\s*<\/div>\s*<div class="notes-main">/);
  });
});

describe("the guide", () => {
  it("says how to read wide, in What's new and in Campaign notes", () => {
    const news = GUIDE.find((s) => s.id === "whats-new")!.parts[3];
    expect(news.steps.join("\n")).toContain("Click **Read wide** at the top of the panel to read as in Obsidian");
    const read = GUIDE.find((s) => s.id === "campaign-notes")!.parts.find((p) => p.title === "Find and read a note")!;
    const text = [...read.steps, ...read.notes].join("\n");
    for (const words of ["**Read wide**", "**Side panel**", "book button", "left edge"]) expect(text).toContain(words);
  });
});
