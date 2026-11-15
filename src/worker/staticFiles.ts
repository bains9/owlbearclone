// The static client, as the assets binding serves it, with two changes.
//
// One: every file under /assets/ is named with a hash of its contents and cached for a year
// as immutable (public/_headers), so the single-page fallback (index.html, for a room link such
// as /r/abc123) must never answer for a missing one: a page from before a deploy asking for one
// of its old chunks would get HTML, kept for a year, and a rollback that brought the file back
// would still get the HTML from that browser's cache. A missing file there is a plain 404 that
// isn't stored.
//
// Two: the Content-Security-Policy in public/_headers names no host, because the code doesn't
// know where a table is served. This table's own hosts are added here, to every answer that
// carries the policy (siteCsp).
//
// Kept apart from index.ts so tests can check it without the Workers runtime.

/** Where vite puts the built files. It never puts a page there. */
const HASHED_FILES = "/assets/";

/** What describes the fallback's body or its caching, rather than the site (public/_headers). */
const BODY_HEADERS = ["Content-Type", "Content-Length", "Content-Encoding", "ETag", "Last-Modified", "Cache-Control", "Age"];

const CSP = "Content-Security-Policy";

/**
 * The policy in public/_headers with this table's own hosts added: its own address for the
 * rooms' WebSockets (for a browser that doesn't take 'self' to cover them), and its Dungeon's,
 * when it has one, for the hidden frame that New scene › From Dungeon talks to.
 */
export function siteCsp(policy: string, url: URL, dungeon: string | null): string {
  let frame: string | null = null;
  try {
    frame = dungeon ? new URL(dungeon).origin : null;
  } catch {
    // Not an address: no frame.
  }
  const add = new Map<string, string | null>([
    ["connect-src", `${url.protocol === "http:" ? "ws" : "wss"}://${url.host}`],
    ["frame-src", frame],
  ]);
  return policy
    .split(";")
    .map((part) => {
      const words = part.trim().split(/\s+/);
      const extra = add.get(words[0].toLowerCase());
      return extra && !words.includes(extra) ? [...words, extra].join(" ") : words.join(" ");
    })
    .filter((part) => part !== "")
    .join("; ");
}

/** Dungeon's builder's 3D view (look3d.html), which Dungeon frames: the one page another site may frame. */
export const LOOK3D_PAGES = ["/look3d", "/look3d.html"];

/**
 * The 3D view page's headers: framed by this table's Dungeon and no other site (no Dungeon, no
 * framing at all). Every other page keeps X-Frame-Options DENY and frame-ancestors 'none'.
 */
export function framedByDungeon(headers: Headers, dungeon: string | null): void {
  let origin: string | null = null;
  try {
    origin = dungeon ? new URL(dungeon).origin : null;
  } catch {
    // Not an address: not framed.
  }
  if (!origin) return;
  headers.delete("X-Frame-Options");
  const csp = headers.get(CSP);
  const ancestors = `frame-ancestors ${origin}`;
  headers.set(CSP, !csp ? ancestors : /frame-ancestors[^;]*/.test(csp) ? csp.replace(/frame-ancestors[^;]*/, ancestors) : `${csp}; ${ancestors}`);
}

export async function staticFile(
  request: Request,
  assets: { fetch(request: Request): Promise<Response> },
  table: { dungeon: string | null } = { dungeon: null },
): Promise<Response> {
  const res = await assets.fetch(request);
  const url = new URL(request.url);
  const missing = url.pathname.startsWith(HASHED_FILES) && (res.headers.get("Content-Type") ?? "").toLowerCase().startsWith("text/html");
  const policy = res.headers.get(CSP);
  if (!missing) {
    const look3d = LOOK3D_PAGES.includes(url.pathname);
    if (policy === null && !look3d) return res;
    // The file as it is, under the policy with this table's hosts in it.
    const out = new Response(res.body, res);
    if (policy !== null) out.headers.set(CSP, siteCsp(policy, url, table.dungeon));
    if (look3d) framedByDungeon(out.headers, table.dungeon);
    return out;
  }
  try {
    await res.body?.cancel();
  } catch {
    // Nothing to free.
  }
  // The site's own headers (the CSP, nosniff, HSTS and the rest) stay.
  const headers = new Headers(res.headers);
  for (const h of BODY_HEADERS) headers.delete(h);
  if (policy !== null) headers.set(CSP, siteCsp(policy, url, table.dungeon));
  headers.set("Content-Type", "text/plain; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(request.method === "HEAD" ? null : "Not found.", { status: 404, headers });
}
