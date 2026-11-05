// A campaign note (an Obsidian note) as HTML, read as Obsidian's reading view shows it: Markdown with
// a line break for each new line, links between notes ([[Note]], [[Note|words]], [[Note#Heading]]),
// pictures from the vault (![[picture.png|300]], or Markdown's own), ==highlights==, callouts
// (> [!note] Title), properties (the front matter) as a small table, and %% comments %% gone. A
// callout typed secret, gm, dm, spoiler or hidden is marked so a handout leaves it out. The HTML
// isn't safe yet: safeHtml.ts cleans it before it's shown.
import { Marked, type Tokens } from "marked";
import { noteTitle, vaultFileUrl, type VaultFileInfo, type VaultIndex } from "../shared/vault";

/** Callouts a handout leaves out: the GM's own. */
export const SECRET_CALLOUTS = ["secret", "gm", "dm", "spoiler", "hidden"];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A heading's id, as links to it look for it. */
export function headingId(text: string): string {
  return (
    "h-" +
    text
      .toLowerCase()
      .replace(/<[^>]*>/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
  );
}

/** Finds what a note's links point at, as Obsidian does: by path, else by name (the nearest when there are several). */
export function vaultResolver(index: Pick<VaultIndex, "notes" | "files">) {
  const notesByPath = new Map(index.notes.map((n) => [n.path.toLowerCase(), n.path]));
  const notesByName = new Map<string, string[]>();
  for (const n of index.notes) {
    const k = noteTitle(n.path).toLowerCase();
    notesByName.set(k, [...(notesByName.get(k) ?? []), n.path]);
  }
  const filesByPath = new Map(index.files.map((f) => [f.path.toLowerCase(), f]));
  const filesByName = new Map<string, VaultFileInfo[]>();
  for (const f of index.files) {
    const k = (f.path.split("/").pop() ?? f.path).toLowerCase();
    filesByName.set(k, [...(filesByName.get(k) ?? []), f]);
  }
  const folderOf = (p: string) => p.split("/").slice(0, -1).join("/");
  const nearest = <T>(list: T[] | undefined, from: string, pathOf: (x: T) => string): T | null => {
    if (!list?.length) return null;
    const here = folderOf(from);
    return list.find((x) => folderOf(pathOf(x)) === here) ?? [...list].sort((a, b) => pathOf(a).length - pathOf(b).length)[0];
  };
  return {
    note(target: string, from: string): string | null {
      const t = target.trim().replace(/\.md$/i, "").replace(/^\/+/, "");
      if (!t) return null;
      return notesByPath.get(`${t}.md`.toLowerCase()) ?? nearest(notesByName.get((t.split("/").pop() ?? t).toLowerCase()), from, (p) => p);
    },
    file(target: string, from: string): VaultFileInfo | null {
      const t = target.trim().replace(/^\/+/, "");
      const rel = folderOf(from) ? `${folderOf(from)}/${t}` : t;
      return filesByPath.get(t.toLowerCase()) ?? filesByPath.get(rel.toLowerCase()) ?? nearest(filesByName.get((t.split("/").pop() ?? t).toLowerCase()), from, (f) => f.path);
    },
  };
}

/** A note's text without its front matter and comments, and its properties. */
export function notePrepare(body: string): { text: string; props: [string, string][] } {
  let text = body.replace(/^﻿/, "");
  const props: [string, string][] = [];
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (fm) {
    text = text.slice(fm[0].length);
    let key = "";
    for (const line of fm[1].split(/\r?\n/)) {
      const kv = /^([^\s:#][^:]*):\s*(.*)$/.exec(line);
      const item = /^\s*-\s+(.*)$/.exec(line);
      if (kv) {
        key = kv[1].trim();
        props.push([key, kv[2].trim().replace(/^["']|["']$/g, "")]);
      } else if (item && key) {
        const last = props[props.length - 1];
        last[1] = last[1] ? `${last[1]}, ${item[1].trim()}` : item[1].trim();
      }
    }
  }
  // Obsidian's comments never show, in its reading view or here.
  text = text.replace(/%%[\s\S]*?%%/g, "");
  return { text, props };
}

/** A note as HTML (not yet cleaned: see safeHtml.ts). */
export function renderNote(body: string, path: string, index: Pick<VaultIndex, "notes" | "files">): string {
  const find = vaultResolver(index);
  const { text, props } = notePrepare(body);
  const md = new Marked({ gfm: true, breaks: true });
  const wiki = /^(!?)\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/;
  md.use({
    extensions: [
      {
        name: "wiki",
        level: "inline",
        start: (src: string) => src.match(/!?\[\[/)?.index,
        tokenizer(src: string) {
          const m = wiki.exec(src);
          if (!m) return undefined;
          return { type: "wiki", raw: m[0], embed: m[1] === "!", target: m[2], heading: m[3] ?? "", alias: m[4] ?? "" };
        },
        renderer(token) {
          const t = token as unknown as { embed: boolean; target: string; heading: string; alias: string };
          if (t.embed) {
            const file = find.file(t.target, path);
            if (file) {
              const width = /^\d{1,4}(x\d{1,4})?$/.test(t.alias) ? ` width="${t.alias.split("x")[0]}"` : "";
              return `<img src="${vaultFileUrl(file.hash)}" alt="${esc(t.alias && !width ? t.alias : (file.path.split("/").pop() ?? "").replace(/.[^.]+$/, ""))}"${width}>`;
            }
          }
          const words = esc(t.alias || [t.target, t.heading].filter(Boolean).join(" › ") || t.heading);
          // A link to a heading in this note.
          if (!t.target && t.heading) return `<a class="wikilink" href="#${headingId(t.heading)}" data-heading="${esc(headingId(t.heading))}">${words}</a>`;
          const note = find.note(t.target, path);
          if (!note) return `<span class="wikilink unresolved">${words}</span>`;
          const h = t.heading ? ` data-heading="${esc(headingId(t.heading))}"` : "";
          return `<a class="wikilink${t.embed ? " embed" : ""}" data-note="${esc(note)}"${h}>${t.embed ? "↳ " : ""}${words}</a>`;
        },
      },
      {
        name: "highlight",
        level: "inline",
        start: (src: string) => src.indexOf("=="),
        tokenizer(src: string) {
          const m = /^==([^=\n]+)==/.exec(src);
          return m ? { type: "highlight", raw: m[0], text: m[1] } : undefined;
        },
        renderer(token) {
          return `<mark>${esc((token as unknown as { text: string }).text)}</mark>`;
        },
      },
    ],
    renderer: {
      heading(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, token: Tokens.Heading) {
        const inner = this.parser.parseInline(token.tokens);
        return `<h${token.depth} id="${headingId(token.text)}">${inner}</h${token.depth}>\n`;
      },
      link(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, token: Tokens.Link) {
        const inner = this.parser.parseInline(token.tokens);
        const href = token.href ?? "";
        if (/^(https?:|mailto:)/i.test(href)) return `<a href="${esc(href)}">${inner}</a>`;
        if (href.startsWith("#")) return `<a href="${esc(href)}">${inner}</a>`;
        // A Markdown link to another note: [words](Folder/Note.md).
        let target = href;
        try {
          target = decodeURIComponent(href);
        } catch {
          // As written.
        }
        const [file, heading] = target.split("#");
        const note = find.note(file, path);
        return note ? `<a class="wikilink" data-note="${esc(note)}"${heading ? ` data-heading="${esc(headingId(heading))}"` : ""}>${inner}</a>` : inner;
      },
      image(token: Tokens.Image) {
        let target = token.href ?? "";
        try {
          target = decodeURIComponent(target);
        } catch {
          // As written.
        }
        const file = find.file(target, path);
        return file ? `<img src="${vaultFileUrl(file.hash)}" alt="${esc(token.text ?? "")}">` : esc(token.text ?? "");
      },
    },
  });
  let html = md.parse(text, { async: false }) as string;
  // Callouts: > [!type] Title, with a GM's own ones marked for handouts to leave out.
  html = html.replace(/<blockquote>\s*<p>\[!([A-Za-z-]+)\]([+-]?)[ \t]*([^\n<]*)(?:<br>|\n)?/g, (_m, type: string, _fold: string, title: string) => {
    const kind = type.toLowerCase();
    const secret = SECRET_CALLOUTS.includes(kind) ? ` data-secret=""` : "";
    const heading = title.trim() || kind.charAt(0).toUpperCase() + kind.slice(1);
    return `<blockquote class="callout callout-${esc(kind)}" data-callout="${esc(kind)}"${secret}><p class="callout-title">${heading}</p><p>`;
  });
  const table = props.length
    ? `<table class="note-props"><tbody>${props.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>`
    : "";
  return table + html;
}
