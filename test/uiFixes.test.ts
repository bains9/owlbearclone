// The board's bars after a look at them all (31 October 2026, Par: "do 1 to 5"): the Spells bar's
// list of spells on the map folds away; the character card folds, and keeps clear of the middle of
// the map; a phone's selection bar wraps instead of scrolling buttons out of sight, with a word
// under each on touch screens; and each bar is guarded, so one that fails leaves the rest.
import { describe, expect, it } from "vitest";
import { GUIDE } from "../src/client/guide";

const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("the Spells bar's spells on the map", () => {
  it("shows a few, and folds more into one chip that opens a list that scrolls, newest first", () => {
    const bar = read("src/client/ui/Toolbar.tsx");
    expect(bar).toContain("const SPELLS_SHOWN = 3;");
    expect(bar).toContain("if (zones.length <= SPELLS_SHOWN) {");
    expect(bar).toContain("On the map: {zones.length}");
    expect(bar).toContain(".sort((a, b) => b.z - a.z);");
    expect(bar).toContain('{open && <span class="spell-zones-list">{zones.map(chip)}</span>}');
    const css = read("src/client/styles.css");
    expect(css).toMatch(/\.spell-zones-list \{[^}]*max-height: 104px;[^}]*overflow-y: auto;/);
  });
});

describe("the character card", () => {
  it("folds to its name, HP and stats, as each device last chose, folded to begin with on a phone", () => {
    const card = read("src/client/ui/CharacterCard.tsx");
    expect(card).toContain('const CARD_FOLDED = "tabletop-card-folded";');
    expect(card).toContain("return typeof matchMedia === \"function\" && matchMedia(NARROW).matches;");
    expect(card).toContain("{!folded && <CardSpells c={c} tokenId={props.tokenId ?? null} />}");
    expect(card).toContain("{!folded && ways.length > 0 && (");
    expect(card).toContain('aria-label={folded ? "Open the card" : "Fold the card"}');
  });

  it("keeps to the right above the bar on a bigger screen, and is as wide as the bar on a phone", () => {
    const css = read("src/client/styles.css");
    // Above the zoom buttons, and above the bars along the bottom however tall (--bottom-h).
    expect(css).toMatch(/\.card-dock \{[^}]*right: 10px;[^}]*bottom: max\(64px, calc\(12px \+ var\(--bottom-h, 0px\)\)\);/);
    // On a phone it's in the stack's flow (measured with it), so the messages sit above it too.
    expect(css).toMatch(/\.selbar-stack > \.character-card \{\s*position: static;\s*left: 0;\s*right: 0;\s*transform: none;\s*width: auto;/);
  });
});

describe("the selection bar", () => {
  it("wraps on a phone, with the messages and the preview banner above it, however tall", () => {
    const css = read("src/client/styles.css");
    expect(css).not.toContain("overflow-x: auto;\n    justify-content: flex-start;\n    scrollbar-width: none;");
    expect(css).toMatch(/\.corner-bl \{\s*left: 60px;\s*right: 8px;\s*bottom: calc\(8px \+ var\(--bottom-h, 0px\)\);/);
    expect(read("src/client/ui/RoomPage.tsx")).toContain('useStageHeight(ref, "--bottom-h");');
  });

  it("says what each button is in a word on touch screens", () => {
    const bar = read("src/client/ui/SelectionBar.tsx");
    for (const word of ["Front", "Back", "Delete", "Turn", "Flip", "Prop", "Init.", "Copy", "Snap"]) expect(bar).toContain(`data-short="${word}"`);
    expect(read("src/client/styles.css")).toMatch(/@media \(pointer: coarse\) \{\s*\.selbar \.icon-btn\[data-short\] \{/);
  });
});

describe("a bar that fails to draw", () => {
  it("is left out on its own, and tried again when what it shows changes", () => {
    const common = read("src/client/ui/common.tsx");
    expect(common).toContain("const [error, reset] = useErrorBoundary(");
    expect(common).toContain("return error ? null : <>{props.children}</>;");
    const page = read("src/client/ui/RoomPage.tsx");
    for (const part of ["<ToolOptions />", "<SelectionBar />", "<LightBar />", "<LevelBar />", "<Toasts />", "<SidePanel panel={panel} />", "<TopBar />"]) {
      const at = page.indexOf(part);
      expect(at, part).toBeGreaterThan(0);
      expect(page.lastIndexOf("<Guard name=", at), part).toBeGreaterThan(page.lastIndexOf("</Guard>", at));
    }
  });
});

describe("in the guide", () => {
  it("leads What's new, and the card and spell parts say how to fold and open", () => {
    expect(GUIDE[0].parts[3].title).toBe("Tidier bars: spells on the map, the character card, and phones (31 October 2026)");
    const all = JSON.stringify(GUIDE);
    expect(all).toContain("Click the arrow beside it to fold the card");
    expect(all).toContain("With more than three, click **On the map** first");
  });
});
