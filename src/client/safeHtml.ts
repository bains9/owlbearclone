// Cleaning HTML before it's shown (a campaign note, a handout): only plain formatting is kept, so
// nothing in a note, or in a handout from the server, can run on anyone's page or reach anywhere.
// Tags off the list are unwrapped (their words kept), dangerous ones dropped with what's in them;
// links go only to the web, to a heading, or (for the GM) to another note; pictures only from the
// GM's vault or a room's own files. For players, links to the GM's notes are left as their words.

const KEEP: Record<string, readonly string[]> = {
  p: ["class"],
  br: [],
  hr: [],
  h1: ["id"],
  h2: ["id"],
  h3: ["id"],
  h4: ["id"],
  h5: ["id"],
  h6: ["id"],
  strong: [],
  b: [],
  em: [],
  i: [],
  u: [],
  s: [],
  del: [],
  mark: [],
  small: [],
  sup: [],
  sub: [],
  kbd: [],
  code: ["class"],
  pre: [],
  blockquote: ["class", "data-callout", "data-secret"],
  ul: ["class"],
  ol: ["start", "class"],
  li: ["class"],
  dl: [],
  dt: [],
  dd: [],
  table: ["class"],
  thead: [],
  tbody: [],
  tr: [],
  th: ["align", "style"],
  td: ["align", "style"],
  a: ["href", "class", "data-note", "data-heading", "title"],
  img: ["src", "alt", "width", "height", "title"],
  span: ["class", "style"],
  div: ["class", "style"],
  font: ["color", "style"],
  details: ["open"],
  summary: [],
  input: ["type", "checked", "disabled"],
};

/** Gone with everything in them. */
const DROP = new Set(["script", "style", "iframe", "object", "embed", "link", "meta", "base", "form", "textarea", "select", "button", "svg", "math", "template", "noscript", "audio", "video", "canvas", "frame", "frameset", "title", "head"]);

const STYLE_KEEP = new Set(["color", "background-color", "font-weight", "font-style", "text-decoration", "text-align"]);
const SAFE_VALUE = /^[#a-z0-9(),.%\s-]+$/i;
const PICTURE = /^\/api\/(vault\/file\/[0-9a-f]{64}|files\/[A-Za-z0-9]{12}\/[A-Za-z0-9]{1,64})$/;

function cleanStyle(style: string): string {
  return style
    .split(";")
    .map((d) => d.split(":"))
    .filter(([k, v]) => k && v && STYLE_KEEP.has(k.trim().toLowerCase()) && SAFE_VALUE.test(v.trim()) && !/url|expression/i.test(v))
    .map(([k, v]) => `${k.trim().toLowerCase()}: ${v.trim()}`)
    .join("; ");
}

function cleanInto(from: Node, into: Node, doc: Document, players: boolean): void {
  for (const child of Array.from(from.childNodes)) {
    if (child.nodeType === 3) {
      into.appendChild(doc.createTextNode(child.textContent ?? ""));
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP.has(tag)) continue;
    const allowed = KEEP[tag];
    // A link to the GM's notes is only words for players.
    if (!allowed || (players && tag === "a" && el.hasAttribute("data-note"))) {
      cleanInto(el, into, doc, players);
      continue;
    }
    if (tag === "img" && !PICTURE.test(el.getAttribute("src") ?? "")) {
      const alt = el.getAttribute("alt");
      if (alt) into.appendChild(doc.createTextNode(alt));
      continue;
    }
    if (tag === "input" && el.getAttribute("type") !== "checkbox") continue;
    const out = doc.createElement(tag);
    for (const name of allowed) {
      const v = el.getAttribute(name);
      if (v === null) continue;
      if (name === "style") {
        const s = cleanStyle(v);
        if (s) out.setAttribute("style", s);
      } else if (name === "href") {
        if (/^(https?:|mailto:|#)/i.test(v.trim())) out.setAttribute("href", v.trim());
      } else if (name === "width" || name === "height") {
        if (/^\d{1,4}$/.test(v)) out.setAttribute(name, v);
      } else out.setAttribute(name, v);
    }
    if (tag === "a" && /^https?:/i.test(out.getAttribute("href") ?? "")) {
      out.setAttribute("target", "_blank");
      out.setAttribute("rel", "noopener noreferrer");
    }
    if (tag === "input") out.setAttribute("disabled", "");
    cleanInto(el, out, doc, players);
    into.appendChild(out);
  }
}

/** HTML with only plain formatting left; for players (a handout), links to the GM's notes are only words. */
export function safeHtml(html: string, opts: { players?: boolean } = {}): string {
  const src = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const doc = document.implementation.createHTMLDocument("");
  const out = doc.createElement("div");
  cleanInto(src.body, out, doc, !!opts.players);
  return out.innerHTML;
}
