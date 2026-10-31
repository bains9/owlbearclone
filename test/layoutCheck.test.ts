// The bars round the map keep out of each other's way at any screen size (31 October 2026, from
// Par's "do all": smoke tests at phone and tablet sizes). The check that found what overlapped,
// and the fix: the map's bars stack as a phone's whenever the map is as narrow as a phone's (a
// tablet beside the side panel too), not only when the window is.
import { describe, expect, it } from "vitest";
import { GUIDE } from "../src/client/guide";
import { LAYOUT_ON_TOP, LAYOUT_PIECES, layoutProblems, type Box } from "../src/client/layoutCheck";

const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const box = (name: string, left: number, top: number, right: number, bottom: number, onTop?: boolean): Box => ({ name, left, top, right, bottom, ...(onTop ? { onTop } : {}) });

describe("the layout check", () => {
  it("names two pieces that overlap, and by how much", () => {
    const card = box("div.card-dock", 418, 763, 758, 874);
    expect(layoutProblems([box("div.selbar", 192, 800, 576, 1012), card], 768, 1024)).toEqual([
      { kind: "overlap", a: "div.selbar", b: "div.card-dock", by: 74 },
    ]);
    // Touching, or a pixel over (rounding), is fine.
    expect(layoutProblems([box("div.selbar", 192, 874, 576, 1012), card], 768, 1024)).toEqual([]);
    expect(layoutProblems([box("div.selbar", 192, 873, 576, 1012), card], 768, 1024)).toEqual([]);
  });

  it("names a piece that runs off the screen, and lets a menu or the panel lie over the rest", () => {
    const menu = box("div.more-pop", 200, 40, 420, 300, true);
    expect(layoutProblems([box("div.zoom", 300, 100, 360, 140), menu], 375, 812)).toEqual([{ kind: "offscreen", a: "div.more-pop", by: 45 }]);
    expect(layoutProblems([box("div.zoom", 300, 100, 360, 140), { ...menu, right: 370 }], 375, 812)).toEqual([]);
  });

  it("measures pieces whose classes the page still has", () => {
    const sources = ["src/client/ui/RoomPage.tsx", "src/client/ui/Toolbar.tsx", "src/client/ui/SelectionBar.tsx", "src/client/ui/VoicePanel.tsx"].map(read).join("\n");
    for (const sel of [...LAYOUT_PIECES, ...LAYOUT_ON_TOP]) {
      for (const cls of sel.match(/\.[a-z-]+/g) ?? []) expect(sources, sel).toMatch(new RegExp(`class(Name)?=\\{?["\`][^"\`]*\\b${cls.slice(1)}\\b`));
    }
  });

  it("is on the page in development builds, as __layoutCheck()", () => {
    const page = read("src/client/ui/RoomPage.tsx");
    expect(page).toContain("(window as unknown as { __layoutCheck: typeof layoutCheck }).__layoutCheck = layoutCheck;");
    expect(page.indexOf("__layoutCheck = layoutCheck")).toBeGreaterThan(page.indexOf("if (import.meta.env.DEV) {"));
  });
});

describe("a map as narrow as a phone's", () => {
  it("is marked by its own width, followed as a panel opens and closes", () => {
    const common = read("src/client/ui/common.tsx");
    expect(common).toContain("export const NARROW_STAGE = 760;");
    expect(common).toContain("const narrow = area.clientWidth <= NARROW_STAGE;");
    expect(common).toContain('area.classList.toggle("narrow", narrow);');
    expect(common).toContain("const watch = new ResizeObserver(set);\n    watch.observe(area);");
    expect(read("src/client/ui/RoomPage.tsx")).toContain('useStageHeight(ref, "--bottom-h");\n  useStageNarrow(ref);');
  });

  it("puts the character card over the selection bar, as on a phone", () => {
    const bar = read("src/client/ui/SelectionBar.tsx");
    expect(bar.match(/const narrow = useRoomState\(\(s\) => s\.stageNarrow\);/g)).toHaveLength(2);
    expect(bar).not.toContain("useNarrow");
  });

  it("stacks the bars round it as a phone's, by the map's width rather than the window's", () => {
    const css = read("src/client/styles.css");
    for (const rule of [
      ":where(.stage-area.narrow) .bottom-bars {",
      ":where(.stage-area.narrow) .zoom {",
      ":where(.stage-area.narrow) .corner-bl {",
      ":where(.stage-area.narrow) .selbar-stack > .character-card {",
      ":where(.stage-area.narrow) .selbar {",
      ":where(.stage-area.narrow) .build-options {",
      ":where(.stage-area.narrow) .tool {",
    ])
      expect(css, rule).toContain(rule);
    // What's left to the window's width: the side panel over the map, the top bar, the More menu.
    const phone = css.slice(css.indexOf("/* ------------------------------------------------------------- small screens */"));
    const block = phone.slice(0, phone.indexOf("\n}\n") + 3);
    for (const gone of [".bottom-bars", ".zoom", ".corner-bl", ".selbar", ".tool {"]) expect(block, gone).not.toContain(gone);
    // Messages stop short of a character's card beside them.
    expect(css).toMatch(/\.stage-area:has\(> \.card-dock\) > \.corner-bl \{\s*right: 360px;/);
  });

  it("is in the guide", () => {
    expect(JSON.stringify(GUIDE[0])).toContain("On a tablet with the side panel open, the map is as narrow as a phone's");
  });
});
