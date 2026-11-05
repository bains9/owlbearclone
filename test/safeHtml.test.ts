// @vitest-environment happy-dom
// Cleaning a campaign note's or a handout's HTML before it's shown (safeHtml.ts): plain formatting
// stays; nothing that runs, loads from elsewhere or reaches out does; for players, links to the GM's
// notes are only words.
import { describe, expect, it } from "vitest";
import { safeHtml } from "../src/client/safeHtml";
import { renderNote } from "../src/client/vaultRender";

const HASH = "a".repeat(64);

describe("cleaning HTML", () => {
  it("keeps plain formatting, tables, callouts and the vault's pictures", () => {
    const html = `<h2 id="h-x">X</h2><p><strong>b</strong> <em>i</em> <mark>m</mark></p><table class="note-props"><tbody><tr><th>k</th><td>v</td></tr></tbody></table><blockquote class="callout callout-secret" data-callout="secret" data-secret=""><p class="callout-title">S</p></blockquote><img src="/api/vault/file/${HASH}" alt="map" width="300">`;
    expect(safeHtml(html)).toBe(html);
  });

  it("drops what runs or reaches out: scripts, handlers, javascript: links, frames, styles, foreign pictures", () => {
    const out = safeHtml(
      `<script>alert(1)</script><p onclick="steal()">hi</p><a href="javascript:alert(1)">x</a><iframe src="https://evil"></iframe><style>*{}</style><img src="https://evil/p.png" alt="far" onerror="x()"><img src="x" onerror="x()">`,
    );
    expect(out).toBe(`<p>hi</p><a>x</a>far`);
  });

  it("keeps a colour, but no other style", () => {
    expect(safeHtml(`<span style="color: #e4572e; position: fixed; background: url(x)">red</span>`)).toBe(`<span style="color: #e4572e">red</span>`);
    expect(safeHtml(`<font color="red">r</font>`)).toBe(`<font color="red">r</font>`);
  });

  it("opens web links in a new tab, safely; keeps links to headings", () => {
    expect(safeHtml(`<a href="https://example.com">e</a><a href="#h-a">a</a>`)).toBe(`<a href="https://example.com" target="_blank" rel="noopener noreferrer">e</a><a href="#h-a">a</a>`);
  });

  it("for players, links to the GM's notes are only words; tags off the list keep their words", () => {
    expect(safeHtml(`<p>See <a class="wikilink" data-note="Villains/Traitor.md">the vicar</a>.</p>`, { players: true })).toBe("<p>See the vicar.</p>");
    expect(safeHtml(`<section><article>words</article></section>`)).toBe("words");
  });

  it("a whole note, rendered then cleaned, never carries a handler or a script", () => {
    const body = `# Temple\n<span style="color:red" onmouseover="x()">Hilda</span>\n<script>steal()</script>\n[[Missing]] and [click](javascript:alert(1))`;
    const out = safeHtml(renderNote(body, "Temple.md", { notes: [{ path: "Temple.md", title: "Temple", size: 1 }], files: [] }));
    expect(out).not.toMatch(/onmouseover|<script|javascript:/i);
    expect(out).toContain(`<span style="color: red">Hilda</span>`);
  });
});
