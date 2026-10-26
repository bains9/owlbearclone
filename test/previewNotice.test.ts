// "Only you can see this scene" lives in the top bar (it used to float over the map, where it
// could cover the Build tool's objects and couldn't be moved), and is a banner near the bottom of
// the map only on a phone. The guide says so everywhere it describes it.
import { beforeAll, describe, expect, it } from "vitest";
import { GUIDE } from "../src/client/guide";
import { dotClasses, presenceCounts } from "../src/client/ui/presence";

/** A source file's text (Node's fs, which the tests' types leave out: they check browser and Worker code). */
async function source(path: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

let css = "";
let page = "";
beforeAll(async () => {
  css = (await source("../src/client/styles.css")).replace(/\r\n/g, "\n");
  page = (await source("../src/client/ui/RoomPage.tsx")).replace(/\r\n/g, "\n");
});

/** styles.css without its comments (a comment just before a rule would hide it from a "}"-anchored match). */
const uncommented = () => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every top-level (not @media) rule body whose selector list names `selector` exactly, joined. */
function topRules(selector: string): string {
  const outside = uncommented().replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const out: string[] = [];
  for (const m of outside.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(",").some((s) => s.trim().replace(/\s+/g, " ") === selector)) out.push(m[2]);
  }
  return out.join("\n");
}

/** The CSS rules for `selector` inside `@media (query)`, as written in styles.css. */
function inMedia(query: string, selector: string): string {
  const out: string[] = [];
  const re = /@media\s*\(([^)]*)\)\s*\{/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    if (m[1].replace(/\s+/g, " ").trim() !== query) continue;
    // The block's body, up to its matching brace.
    let depth = 1;
    let i = re.lastIndex;
    for (; i < css.length && depth; i++) depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
    const body = css.slice(re.lastIndex, i - 1);
    const rule = new RegExp(`(^|[\\s}])${selector.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`).exec(body);
    if (rule) out.push(rule[2]);
  }
  return out.join("\n");
}

describe("the notice's place on the page", () => {
  it("is in the top bar, and the floating banner shows only where a phone's rules apply", () => {
    expect(inMedia("max-width: 760px", ".preview-chip")).toMatch(/display:\s*none/);
    // Hidden unless the phone's rules apply, so a zoomed window between 760 and 761 px (which
    // matches neither) never gets the banner back at the top of the map.
    const outside = uncommented().replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    expect(outside).toMatch(/(^|\})\s*\.preview-banner\.preview-phone\s*\{\s*display:\s*none;?\s*\}/);
    expect(inMedia("max-width: 760px", ".preview-banner.preview-phone")).toMatch(/display:\s*flex/);
    expect(css).not.toMatch(/@media \(min-width: 761px\)\s*\{\s*\.preview-banner\.preview-phone/);
  });

  it("drops words as the window narrows but keeps them for screen readers", () => {
    // Moved out of sight, not display: none, so they're still read out.
    for (const [query, selector] of [
      ["max-width: 1599px", ".preview-chip-players"],
      ["max-width: 999px", ".preview-chip-text"],
    ] as const) {
      const rule = inMedia(query, selector);
      expect(rule, `${selector} in ${query}`).toMatch(/clip-path:\s*inset\(50%\)/);
      expect(rule).not.toMatch(/display:\s*none/);
    }
    // The back button keeps its name in its aria-label when its words go.
    expect(inMedia("max-width: 1199px", ".preview-chip-back-text")).toMatch(/display:\s*none/);
    expect(page).toMatch(/class="btn btn-sm preview-chip-back"[\s\S]{0,120}aria-label="Back to live scene"/);
  });

  it("keeps a long scene name from pushing the top bar's buttons off, and says it all on a tap", () => {
    // Scene names can be 60 characters; the players' scene is cut short with an ellipsis.
    const players = topRules(".preview-chip-players");
    expect(players).toMatch(/max-width:\s*\d+(\.\d+)?em/);
    expect(players).toMatch(/overflow:\s*hidden/);
    expect(players).toMatch(/text-overflow:\s*ellipsis/);
    // A touch screen has no tooltip: the eye is a button that says the whole notice, and what the
    // arrow does when there is one.
    expect(page).toMatch(/class="preview-chip-eye"[\s\S]{0,160}room\.toast\(`Only you can see this scene\. \$\{players\}\$\{active \? " The arrow takes you back to them\." : ""\}`\)/);
  });

  it("gives way in its words, not its buttons, when the top bar is short of room", () => {
    // A grid whose word columns can shrink to nothing (so never narrower than the eye and the
    // buttons), shrinking faster than the room's name, which keeps a floor of its own.
    const chip = topRules(".preview-chip");
    expect(chip).toMatch(/display:\s*grid/);
    expect(chip).toMatch(/grid-template-columns:\s*auto minmax\(0, max-content\) minmax\(0, max-content\) auto auto/);
    expect(chip).toMatch(/flex:\s*0 [2-9] auto/);
    for (const [sel, col] of [[".preview-chip-text", 2], [".preview-chip-players", 3]] as const) {
      expect(topRules(sel), sel).toMatch(new RegExp(`grid-column:\\s*${col}\\b`));
      expect(topRules(sel), sel).toMatch(/text-overflow:\s*ellipsis/);
    }
    expect(topRules(".topbar.previewing .topbar-title")).toMatch(/min-width:\s*\d+px/);
    // Reload as its icon at 761-880 px while previewing, keeping its name for screen readers.
    expect(uncommented()).toMatch(
      /@media \(min-width: 761px\) and \(max-width: 880px\)\s*\{\s*\.topbar\.previewing \.update-btn \.update-word\s*\{\s*display:\s*none;?\s*\}\s*\}/,
    );
    expect(page).toMatch(/class="btn btn-primary btn-sm update-btn"[\s\S]{0,160}aria-label="Update: Reload"/);
  });

  it("shows while previewing, with its tooltip and buttons that do what they say", () => {
    const chip = page.slice(page.indexOf("function PreviewChip()"), page.indexOf("function PreviewBanner()"));
    expect(chip).toMatch(/const \{ view, active, players \} = usePreview\(\);\n  if \(!view\) return null;/);
    expect(chip).toContain('<div class="preview-chip" title={`Only you can see this scene. ${players}`}>');
    expect(chip).toContain("onClick={() => room.activateScene(view)}");
    expect(chip).toContain("onClick={() => room.viewSceneLocally(active)}");
    expect(page).toContain("const previewing = usePreview().view !== null;");
  });

  it("makes room beside it with the presence helper, counting people (not table displays)", () => {
    expect(page).toContain("...dotClasses(i, players.length)");
    expect(page).toContain("presenceCounts(players.length).map(");
    expect(page).not.toContain("players.length > 6 &&");
    expect(css).toMatch(/@media \(max-width: 1199px\) \{[^@]*\.topbar\.previewing \.update-btn \.hide-narrow\s*\{\s*display:\s*none/);
  });

  it("sits in the top bar after the scene's name, and nothing places a banner over the map any more", () => {
    const top = page.slice(page.indexOf("function TopBar()"), page.indexOf("function SidePanel("));
    expect(top.indexOf('class="topbar-title"')).toBeGreaterThan(0);
    expect(top.indexOf("<PreviewChip />")).toBeGreaterThan(top.indexOf('class="topbar-title"'));
    expect(top.indexOf("<PreviewChip />")).toBeLessThan(top.indexOf('class="spacer"'));
    // The old code that put the banner just below a tool's options bar.
    expect(page).not.toMatch(/querySelector[^(]*\(\s*["'`]\.tool-options/);
    expect(page).toContain('class="preview-banner preview-phone"');
    // The top bar is marked while the chip is in it, and the CSS keys on that mark.
    expect(top).toContain('class={cx("topbar", previewing && "previewing")}');
    expect(css).not.toContain(":has(.preview-chip)");
  });
});

describe("the presence dots beside it", () => {
  /** The `display` each `.player-dot.<class>` rule in `text` sets, in order; with `chip`, only rules scoped to a top bar with the chip in it (.previewing, set by TopBar: no :has(), which older browsers drop whole rules over). */
  function dotRules(text: string, chip: boolean): [string, string][] {
    const out: [string, string][] = [];
    for (const m of text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const display = /display:\s*([\w-]+)/.exec(m[2])?.[1];
      if (!display) continue;
      for (const sel of m[1].split(",").map((s) => s.trim())) {
        const k = /^(\.topbar\.previewing\s+)?\.player-dot\.([\w-]+)$/.exec(sel);
        if (k && !!k[1] === chip) out.push([k[2], display]);
      }
    }
    return out;
  }
  /** styles.css without its @media blocks. */
  const topLevel = () => css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  /** One @media block's body (the first with this query). */
  const media = (query: string) => {
    const at = css.indexOf(`@media (${query}) {`);
    const m = /@media[^{]*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/.exec(css.slice(at));
    return { at, body: m?.[1] ?? "" };
  };

  it("always show everyone: the dots shown and the count add up, at every width", () => {
    const narrow = media("max-width: 1199px");
    const narrower = media("max-width: 880px");
    // Both apply below 880 px; the narrower one has to come later to win.
    expect(narrow.at).toBeGreaterThan(0);
    expect(narrower.at).toBeGreaterThan(narrow.at);
    const layouts = {
      wide: [...dotRules(topLevel(), false)],
      "up to 1199 px": [...dotRules(topLevel(), false), ...dotRules(narrow.body, true)],
      "up to 880 px": [...dotRules(topLevel(), false), ...dotRules(narrow.body, true), ...dotRules(narrower.body, true)],
    };
    const most = { wide: 7, "up to 1199 px": 4, "up to 880 px": 3 };
    for (const [layout, rules] of Object.entries(layouts) as [keyof typeof most, [string, string][]][]) {
      const shown = (classes: string[]) => {
        let on = true; // .player-dot is shown
        for (const [cls, display] of rules) if (classes.includes(cls)) on = display !== "none";
        return on;
      };
      for (let n = 0; n <= 12; n++) {
        const dots = Array.from({ length: Math.min(n, 6) }, (_, i) => dotClasses(i, n)).filter(shown).length;
        const counts = presenceCounts(n).filter((c) => shown([c.cls]));
        const counted = counts.reduce((sum, c) => sum + Number(c.text.slice(1)), 0);
        expect(dots + counted, `${n} people, ${layout}`).toBe(n);
        expect(counts.length, `${n} people, ${layout}`).toBeLessThanOrEqual(1);
        expect(dots + counts.length, `${n} people, ${layout}`).toBeLessThanOrEqual(Math.min(n, most[layout]));
      }
    }
  });
});

describe("the guide", () => {
  const news = GUIDE.find((s) => s.id === "whats-new")!;
  const parts = GUIDE.flatMap((s) => s.parts);
  const text = (title: string) => {
    const p = parts.find((x) => x.title === title);
    if (!p) throw new Error(`no guide part "${title}"`);
    return [...p.steps, ...p.notes].join("\n");
  };

  it("has the move fifth in What's new, under the voice chat and dice entries", () => {
    expect(news.parts[4].title).toBe("Voice chat (24 October 2026)");
    expect(news.parts[5].title).toBe('"Only you can see this scene" moved to the top bar (22 October 2026)');
    const entry = text(news.parts[5].title);
    for (const what of ["top bar", "**Show to players**", "**Back to live scene**", "Build tool's objects", "crossed-out eye", "phone"]) {
      expect(entry).toContain(what);
    }
    expect(entry).toContain('**GM: "Only you can see this scene"**');
    expect(text('GM: "Only you can see this scene"')).toContain("top bar");
  });

  it("no longer sends the GM to a banner on the map, except on a phone, near the bottom", () => {
    // The 27 September entry's note records what that update did (it moved the banner just below a
    // tool's bar), and the new entry says what it used to be: those two keep their words.
    const history = (l: string) => l.startsWith('The "Only you can see this scene" banner (GM): it now sits just below') || /used to be a banner/.test(l);
    const lines = parts.flatMap((p) => [...p.steps, ...p.notes]).filter((l) => /banner/.test(l) && !history(l));
    expect(lines.length).toBeGreaterThan(5);
    for (const l of lines) expect(l, l).toMatch(/phone/);
    for (const l of lines) expect(l, l).toMatch(/near the bottom of the map/);
    for (const l of lines) expect(l, l).not.toMatch(/banner across the map|banner on the map|"Only you can see this scene\.?" banner/);
    // The new entry tells a touch screen how to read it all, and what happens to the circles and Reload.
    const entry = text(news.parts[5].title);
    expect(entry).toContain("tap the eye");
    expect(entry).toContain("**Reload**");
    expect(entry).toContain("coloured circles");
    // Outside What's new too: the top bar's circles, and the Update button in Troubleshooting.
    expect(text("The top bar")).toMatch(/narrower top bar, they stop at four/);
  });
});
