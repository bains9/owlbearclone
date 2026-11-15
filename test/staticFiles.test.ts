import { describe, expect, it } from "vitest";
import { siteCsp, staticFile } from "../src/worker/staticFiles";

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

const get = (path: string, method = "GET") => staticFile(new Request(`https://table.example.test${path}`, { method }), fakeAssets);

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
      const res = await staticFile(new Request("https://table.example.test/assets/gone.js"), {
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

  it("adds this table's own hosts to the policy on every answer, which names none itself", async () => {
    // public/_headers as it's written: no host in it, since the code doesn't know where a table is served.
    const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
    const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
    const policy = headers.split(/\r?\n/).find((l) => l.includes("Content-Security-Policy"))!.replace(/^\s*Content-Security-Policy:\s*/, "");
    expect(policy).toContain("connect-src 'self' https://cloudflareinsights.com;");
    expect(policy).toContain("frame-src 'self';");
    expect(policy).not.toMatch(/wss?:/);
    const assets = (type: string) => ({ fetch: async () => new Response("x", { headers: { "Content-Security-Policy": policy, "Content-Type": type, ETag: '"1"' } }) });
    const csp = async (url: string, dungeon: string | null, type = "text/html") => (await staticFile(new Request(url), assets(type), { dungeon })).headers.get("Content-Security-Policy")!;

    // A table with a Dungeon: its own address for the rooms' WebSockets, and Dungeon's for the hidden frame.
    const both = await csp("https://table.example.test/r/abcdefABCDEF", "https://dungeon.example.test/");
    expect(both).toContain("connect-src 'self' https://cloudflareinsights.com wss://table.example.test;");
    expect(both).toContain("frame-src 'self' https://dungeon.example.test;");
    expect(both).toContain("frame-ancestors 'none'");
    // Everything else is as public/_headers has it.
    expect(both.replace(" wss://table.example.test", "").replace(" https://dungeon.example.test", "")).toBe(policy);
    // The page's scripts and the workers they start get it too, and so does the 404 for a missing file.
    expect(await csp("https://table.example.test/assets/index-abc123.js", "https://dungeon.example.test/", "text/javascript")).toBe(both);
    expect(await csp("https://table.example.test/assets/gone.js", "https://dungeon.example.test/")).toBe(both);

    // A table without one frames nothing but itself.
    const alone = await csp("https://another.example.test/", null);
    expect(alone).toContain("connect-src 'self' https://cloudflareinsights.com wss://another.example.test;");
    expect(alone).toContain("frame-src 'self';");
    // On this computer over plain HTTP, the sockets are plain too, on the same port.
    expect(await csp("http://localhost:5230/", null)).toContain("connect-src 'self' https://cloudflareinsights.com ws://localhost:5230;");
  });

  it("adds a host once, and leaves an answer with no policy alone", async () => {
    const policy = "default-src 'self'; connect-src 'self' wss://table.example.test; frame-src 'self'";
    expect(siteCsp(policy, new URL("https://table.example.test/"), null)).toBe(policy);
    expect(siteCsp(policy, new URL("https://table.example.test/"), "not an address")).toBe(policy);
    expect(siteCsp("default-src 'self'", new URL("https://table.example.test/"), "https://dungeon.example.test/")).toBe("default-src 'self'");
    const plain = new Response("x", { headers: { "Content-Type": "text/css" } });
    expect(await staticFile(new Request("https://table.example.test/assets/a.css"), { fetch: async () => plain }, { dungeon: null })).toBe(plain);
  });

  it("passes the file itself on untouched under the new policy: its body, type, caching and ETag", async () => {
    const res = await staticFile(
      new Request("https://table.example.test/assets/index-abc123.js"),
      { fetch: async () => new Response("export const x = 1;", { status: 200, headers: { "Content-Security-Policy": "connect-src 'self'", "Content-Type": "text/javascript", ETag: '"19"', "Cache-Control": "public, max-age=31536000, immutable" } }) },
      { dungeon: null },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("export const x = 1;");
    expect(res.headers.get("Content-Type")).toBe("text/javascript");
    expect(res.headers.get("ETag")).toBe('"19"');
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("Content-Security-Policy")).toBe("connect-src 'self' wss://table.example.test");
    // A "not changed" answer has no body to pass on, and keeps its status.
    const same = await staticFile(new Request("https://table.example.test/"), { fetch: async () => new Response(null, { status: 304, headers: { "Content-Security-Policy": "connect-src 'self'", ETag: '"19"' } }) }, { dungeon: null });
    expect(same.status).toBe(304);
    expect(same.body).toBeNull();
    expect(same.headers.get("ETag")).toBe('"19"');
  });

  it("lets this table's Dungeon, and no other site, frame the builder's 3D view (look3d.html); every other page stays unframeable", async () => {
    const policy = "default-src 'self'; frame-ancestors 'none'";
    const assets = { fetch: async () => new Response("<!doctype html>", { headers: { "Content-Security-Policy": policy, "X-Frame-Options": "DENY", "Content-Type": "text/html" } }) };
    const dungeon = { dungeon: "https://dungeon.example.test/" };
    for (const path of ["/look3d", "/look3d.html"]) {
      const res = await staticFile(new Request(`https://table.example.test${path}`), assets, dungeon);
      expect(res.headers.get("X-Frame-Options"), path).toBeNull();
      expect(res.headers.get("Content-Security-Policy"), path).toContain("frame-ancestors https://dungeon.example.test");
      expect(res.headers.get("Content-Security-Policy"), path).not.toContain("'none'");
    }
    // No Dungeon: no one may frame it.
    const alone = await staticFile(new Request("https://table.example.test/look3d"), assets, { dungeon: null });
    expect(alone.headers.get("X-Frame-Options")).toBe("DENY");
    expect(alone.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    // Any other page, Dungeon or not.
    const room = await staticFile(new Request("https://table.example.test/r/abc"), assets, dungeon);
    expect(room.headers.get("X-Frame-Options")).toBe("DENY");
    expect(room.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
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
