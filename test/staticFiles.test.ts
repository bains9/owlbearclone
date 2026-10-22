import { describe, expect, it } from "vitest";
import { staticFile } from "../src/worker/staticFiles";

// A stand-in for the assets binding as it behaves live: a file it has, or, with
// not_found_handling "single-page-application", index.html with a 200 for anything else, and
// public/_headers applied to both (so the fallback for a missing /assets/ file was immutable).
const FILES: Record<string, { type: string; body: string }> = {
  "/index.html": { type: "text/html", body: "<!doctype html><title>Tabletop</title>" },
  "/assets/index-abc123.js": { type: "text/javascript", body: "export const x = 1;" },
  "/assets/index-abc123.css": { type: "text/css", body: "body{}" },
};

const SITE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": "default-src 'self'",
  "X-Frame-Options": "DENY",
};

const fakeAssets = {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const file = FILES[path] ?? FILES["/index.html"];
    const body = request.method === "HEAD" ? null : file.body;
    return new Response(body, {
      status: 200,
      headers: {
        ...SITE_HEADERS,
        "Content-Type": file.type,
        "Content-Length": String(file.body.length),
        ETag: `"${file.body.length}"`,
        "Cache-Control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
      },
    });
  },
};

const get = (path: string, method = "GET") => staticFile(new Request(`https://table.parhome.ca${path}`, { method }), fakeAssets);

describe("static files", () => {
  it("a missing file under /assets/ is a 404 that isn't cached, not the page", async () => {
    for (const path of ["/assets/index-gVWWDJTx.js", "/assets/GuidePage-old.js", "/assets/x.css", "/assets/", "/assets/deep/er.js"]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("Cache-Control"), path).toBe("no-store");
      expect(res.headers.get("Content-Type"), path).toBe("text/plain; charset=utf-8");
      expect(res.headers.get("ETag"), path).toBeNull();
      expect(res.headers.get("Content-Length"), path).toBeNull();
      expect(await res.text(), path).toBe("Not found.");
    }
  });

  it("knows the page by its type whatever its spelling or charset", async () => {
    for (const type of ["text/html; charset=utf-8", "Text/HTML"]) {
      const res = await staticFile(new Request("https://table.parhome.ca/assets/gone.js"), {
        fetch: async () => new Response("<!doctype html>", { headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" } }),
      });
      expect(res.status, type).toBe(404);
      expect(res.headers.get("Cache-Control"), type).toBe("no-store");
    }
  });

  it("keeps the site's own headers on that 404", async () => {
    const res = await get("/assets/gone.js");
    for (const [k, v] of Object.entries(SITE_HEADERS)) expect(res.headers.get(k), k).toBe(v);
  });

  it("answers a HEAD for a missing file the same way, without a body", async () => {
    const res = await get("/assets/gone.js", "HEAD");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.body).toBeNull();
  });

  it("serves files that exist as the binding sends them, still immutable", async () => {
    for (const [path, type] of [["/assets/index-abc123.js", "text/javascript"], ["/assets/index-abc123.css", "text/css"]]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("Content-Type"), path).toBe(type);
      expect(res.headers.get("Cache-Control"), path).toBe("public, max-age=31536000, immutable");
      expect(await res.text(), path).toBe(FILES[path].body);
    }
  });

  it("keeps the single-page fallback for the app's own routes", async () => {
    for (const path of ["/", "/r/abcdefABCDEF", "/r/abcdefABCDEF?display=k", "/guide", "/guide/", "/nothing-here", "/assetsx/y.js"]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("Content-Type"), path).toBe("text/html");
      expect(res.headers.get("Cache-Control"), path).toBe("public, max-age=0, must-revalidate");
      expect(await res.text(), path).toContain("<title>Tabletop</title>");
    }
  });
});
