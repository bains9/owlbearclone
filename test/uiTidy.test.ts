// The rest of the look at the bars (31 October 2026, Par: "do 6 to 9 too"): each edge of the map
// stacks what's there, so nothing lands on anything else; the top bar's More keeps what's used now
// and then; a card lists what can be cast now first; and Konva's layer-count warning is left out.
import { describe, expect, it } from "vitest";
import { GUIDE } from "../src/client/guide";

const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** The text of a CSS rule's block (the first rule with exactly that selector). */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThan(0);
  return css.slice(at, css.indexOf("}", at));
}

describe("the edges of the map", () => {
  it("each stack what's there: the bottom's bars, the messages over the hints, the level bar over who's speaking", () => {
    const page = read("src/client/ui/RoomPage.tsx");
    const inside = (open: string, close: string, parts: string[]) => {
      const a = page.indexOf(open);
      const b = page.indexOf(close, a);
      expect(a, open).toBeGreaterThan(0);
      let last = a;
      for (const p of parts) {
        const at = page.indexOf(p, last);
        expect(at > a && at < b, `${p} in ${open}`).toBe(true);
        last = at;
      }
    };
    inside("<BottomBars>", "</BottomBars>", ["<PreviewBanner />", "<SelectionBar />", "<LightBar />", "<BuildSelectionBar />"]);
    inside('<div class="corner-bl">', "</div>", ["<Toasts />", "<BuildHints />"]);
    inside("<TopRight>", "</TopRight>", ["<LevelBar />", "<SpeakingOverlay />"]);
    expect(page).toContain('useClearOfBars(ref, true, ".tool-options, .board-season-note.shown");');
  });

  it("are laid out by their stacks, not by what comes after what", () => {
    const css = read("src/client/styles.css");
    expect(css).not.toMatch(/~ \.toasts|~ \.speaking-overlay|\.build-selbar ~|\.build-hints ~|--selbar-h/);
    for (const sel of [".toasts", ".level-bar", ".speaking-overlay", ".build-hints"]) expect(rule(css, sel), sel).not.toContain("position: absolute");
    expect(rule(css, ".corner-bl")).toContain("bottom: calc(12px + var(--bottom-h, 0px));");
    expect(rule(css, ".bottom-bars")).toContain("flex-direction: column;");
    expect(css).toContain(":where(.stage-area.narrow:has(> .tool-options)) > .corner-tr {");
    expect(read("src/client/ui/common.tsx")).toContain("area.style.setProperty(name, `${el.offsetHeight ? el.offsetHeight + gap : 0}px`);");
  });
});

describe("the top bar's More", () => {
  it("has Copy invite link and Help & shortcuts for everyone, Table display and Dungeon for the GM", () => {
    const page = read("src/client/ui/RoomPage.tsx");
    const menu = page.slice(page.indexOf("function MoreMenu("), page.indexOf("function SidePanel("));
    for (const words of ["<Link size={16} /> Copy invite link", "<Monitor size={16} /> Table display", "<Castle size={16} /> Dungeon, the map maker", "<CircleQuestionMark size={16} /> Help & shortcuts"]) {
      expect(menu).toContain(words);
    }
    expect(menu).toContain("{props.gm && (");
    expect(menu).toContain('{props.displays > 0 && <span class="live-dot" />}');
    // They're no longer buttons of their own in the bar.
    const bar = page.slice(page.indexOf("function TopBar("), page.indexOf("function MoreMenu("));
    expect(bar).not.toContain('title="Copy invite link"');
    expect(bar).not.toContain("display-btn");
    expect(bar).toContain("<MoreMenu");
  });

  it("is how the guide says to reach them", () => {
    const all = JSON.stringify(GUIDE);
    expect(all).toContain("Click **More** (the three dots) and **Copy invite link**");
    expect(all).toContain("In your room, click **More** (the three dots) in the top bar, then **Table display**.");
    expect(all).not.toContain("the monitor button");
    expect(all).not.toContain("the question-mark button");
  });
});

describe("a caster's card", () => {
  it("lists what can be cast now first, each part still by level", () => {
    const card = read("src/client/ui/CharacterCard.tsx");
    expect(card).toContain("const shown = [...castable].sort((a, b) => Number(outNow(a)) - Number(outNow(b)));");
    expect(card).toContain("{shown.map((s) => {");
  });
});

describe("Konva's warning", () => {
  it("about the number of layers is left out, and only that one", () => {
    const board = read("src/client/room/board.ts");
    expect(board).toMatch(
      /Konva\.showWarnings = false;\n\s*this\.stage\.add\(this\.bgLayer, this\.drawLayer, this\.tokenLayer, this\.monoLayer, this\.sightLayer, this\.fogLayer, this\.uiLayer\);\n\s*Konva\.showWarnings = warn;/,
    );
  });
});
