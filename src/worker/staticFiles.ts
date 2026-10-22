// The static client, as the assets binding serves it, with one exception. Every file under
// /assets/ is named with a hash of its contents and cached for a year as immutable
// (public/_headers), so the single-page fallback (index.html, for a room link such as /r/abc123)
// must never answer for a missing one: a page from before a deploy asking for one of its old
// chunks would get HTML, kept for a year, and a rollback that brought the file back would still
// get the HTML from that browser's cache. A missing file there is a plain 404 that isn't stored.
// Kept apart from index.ts so tests can check it without the Workers runtime.

/** Where vite puts the built files. It never puts a page there. */
const HASHED_FILES = "/assets/";

/** What describes the fallback's body or its caching, rather than the site (public/_headers). */
const BODY_HEADERS = ["Content-Type", "Content-Length", "Content-Encoding", "ETag", "Last-Modified", "Cache-Control", "Age"];

export async function staticFile(request: Request, assets: { fetch(request: Request): Promise<Response> }): Promise<Response> {
  const res = await assets.fetch(request);
  if (!new URL(request.url).pathname.startsWith(HASHED_FILES)) return res;
  if (!(res.headers.get("Content-Type") ?? "").toLowerCase().startsWith("text/html")) return res;
  try {
    await res.body?.cancel();
  } catch {
    // Nothing to free.
  }
  // The site's own headers (the CSP, nosniff, HSTS and the rest) stay.
  const headers = new Headers(res.headers);
  for (const h of BODY_HEADERS) headers.delete(h);
  headers.set("Content-Type", "text/plain; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(request.method === "HEAD" ? null : "Not found.", { status: 404, headers });
}
