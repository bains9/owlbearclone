// A table's own settings (shared/table.ts): where its Dungeon is and the lines it shows under
// "Loading map…". Neither is in the code: each is set where the table is deployed, cleaned by
// the server (worker/table.ts), and passed to the page by /api/me and by a room's hello.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NO_TABLE_SETTINGS, TABLE_LIMITS, cleanDungeonUrl, cleanLines, cleanTableSettings } from "../src/shared/table";
import { tableSettings } from "../src/worker/table";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER } from "../src/shared/sanitize";
import type { Scene } from "../src/shared/types";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("where a table's Dungeon is", () => {
  it("is its origin, with a closing slash, whatever else the setting had", () => {
    expect(cleanDungeonUrl("https://dungeon.example.test")).toBe("https://dungeon.example.test/");
    expect(cleanDungeonUrl("  https://dungeon.example.test/  ")).toBe("https://dungeon.example.test/");
    expect(cleanDungeonUrl("https://dungeon.example.test/maps/7?x=1#top")).toBe("https://dungeon.example.test/");
    expect(cleanDungeonUrl("https://DUNGEON.example.test:8443/")).toBe("https://dungeon.example.test:8443/");
  });

  it("is nothing when it isn't set, or isn't somewhere to send a page", () => {
    for (const bad of [undefined, null, "", "   ", 7, {}, [], "dungeon.example.test", "not an address", "ftp://dungeon.example.test/", "javascript:alert(1)", "https://user:pw@dungeon.example.test/", "https://" + "a".repeat(300) + ".test"]) {
      expect(cleanDungeonUrl(bad), String(bad)).toBeNull();
    }
    // Plain HTTP only on this computer, for trying things out.
    expect(cleanDungeonUrl("http://dungeon.example.test")).toBeNull();
    expect(cleanDungeonUrl("http://localhost:5240")).toBe("http://localhost:5240/");
    expect(cleanDungeonUrl("http://127.0.0.1:5240/x")).toBe("http://127.0.0.1:5240/");
    expect(cleanDungeonUrl("http://dungeon.localhost:5240")).toBe("http://dungeon.localhost:5240/");
  });
});

describe("a table's loading lines", () => {
  it("are taken as a list, as a JSON list in text, or as text with a line to a row", () => {
    const lines = ["The map is nearly here.", 'It says "nearly" every time.'];
    expect(cleanLines(lines)).toEqual(lines);
    expect(cleanLines(JSON.stringify(lines))).toEqual(lines);
    expect(cleanLines("The map is nearly here.\r\nIt says \"nearly\" every time.\n\n")).toEqual(lines);
    // Text that only looks like a list is its rows.
    expect(cleanLines("[not a list\nsecond row")).toEqual(["[not a list", "second row"]);
  });

  it("are plain rows of text: trimmed, with nothing empty, odd or endless among them", () => {
    expect(cleanLines(["  one  ", "", "   ", "two\nstill two\tand\u0000more", 3, null, { a: 1 }, ["x"]])).toEqual(["one", "two still two and more"]);
    expect(cleanLines(["x".repeat(TABLE_LIMITS.line + 50)])[0]).toHaveLength(TABLE_LIMITS.line);
    expect(cleanLines(Array.from({ length: TABLE_LIMITS.lines + 20 }, (_, i) => `line ${i}`))).toHaveLength(TABLE_LIMITS.lines);
    for (const none of [undefined, null, "", "   ", 7, {}, "{}", "null", '{"a":["x"]}']) expect(cleanLines(none).length, String(none)).toBeLessThanOrEqual(1);
    for (const none of [undefined, null, "", "   ", 7, {}]) expect(cleanLines(none), String(none)).toEqual([]);
  });
});

describe("a table's settings, from where it's deployed", () => {
  it("are read from the Worker's settings, set either way", () => {
    expect(tableSettings({ DUNGEON_URL: "https://dungeon.example.test", LOADING_LINES: ["One.", "Two."] })).toEqual({ dungeon: "https://dungeon.example.test/", lines: ["One.", "Two."] });
    // As secrets, both are text.
    expect(tableSettings({ DUNGEON_URL: "https://dungeon.example.test/", LOADING_LINES: '["One.","Two."]' })).toEqual({ dungeon: "https://dungeon.example.test/", lines: ["One.", "Two."] });
    expect(tableSettings({ LOADING_LINES: "One.\nTwo." })).toEqual({ dungeon: null, lines: ["One.", "Two."] });
  });

  it("are none for a table that set none", () => {
    expect(tableSettings({})).toEqual(NO_TABLE_SETTINGS);
    expect(tableSettings(undefined)).toEqual(NO_TABLE_SETTINGS);
    expect(tableSettings({ DUNGEON_URL: "", LOADING_LINES: "" })).toEqual({ dungeon: null, lines: [] });
  });

  it("are cleaned again by the page, whatever it was sent", () => {
    expect(cleanTableSettings({ dungeon: "https://dungeon.example.test/", lines: ["One."] })).toEqual({ dungeon: "https://dungeon.example.test/", lines: ["One."] });
    for (const odd of [undefined, null, 7, "x", [], { dungeon: 7, lines: "x".repeat(0) }]) expect(cleanTableSettings(odd), String(odd)).toEqual(NO_TABLE_SETTINGS);
    expect(cleanTableSettings({ dungeon: "javascript:alert(1)", lines: [7, "One."] })).toEqual({ dungeon: null, lines: ["One."] });
  });
});

describe("the code itself", () => {
  it("names no table's address, Dungeon or lines: wrangler.jsonc and the page's headers hold none", async () => {
    const wrangler = await source("wrangler.jsonc");
    for (const key of ['"routes"', '"vars"', '"workers_dev"', "DUNGEON_URL", "LOADING_LINES"]) expect(wrangler.replace(/^\s*\/\/.*$/gm, ""), key).not.toContain(key);
    const headers = await source("public/_headers");
    expect(headers).not.toMatch(/wss?:\/\//);
    expect(headers.match(/https:\/\/[^\s;]+/g)).toEqual(["https://static.cloudflareinsights.com", "https://cloudflareinsights.com"]);
    // The example of a table's own settings is only an example.
    const example = await source("local.example.jsonc");
    expect(example).toContain('"LOADING_LINES": []');
    expect(example.match(/https?:\/\/[^\s"]+/g)).toEqual(["https://dungeon.example.com"]);
    // And the file that holds a real table's is never committed.
    expect((await source(".gitignore")).split(/\r?\n/)).toContain("local.jsonc");
  });

  it("asks the server where Dungeon is, for the home page and for a room", async () => {
    const worker = await source("src/worker/index.ts");
    expect(worker).toContain("dungeon: tableSettings(env).dungeon");
    expect(worker).toContain("return staticFile(request, env.ASSETS, tableSettings(env));");
    const link = await source("src/client/dungeonLink.ts");
    expect(link).not.toMatch(/https?:\/\/(?!dungeon\.example\.com)/);
  });
});

// ---------------------------------------------------------------- a room's hello

interface Conn {
  connId: string;
  userId: string;
  name: string;
  color: string;
  role: "gm" | "player";
  sid: string;
  v: number;
  display?: boolean;
}

interface RoomInside {
  hello(conn: Conn): { t: string; table?: { lines?: string[]; dungeon?: string } };
}

let RoomClass: { prototype: object };

beforeAll(async () => {
  // Imported by a path tsc doesn't follow: the tests' types leave out the Workers runtime.
  const mod = (await import(/* @vite-ignore */ "../src/worker/" + "room")) as { Room: { prototype: object } };
  RoomClass = mod.Room;
});

const scene = (id: string): Scene => ({ id, name: id, order: 0, mapAssetId: null, width: 1400, height: 1000, background: "#000000", grid: { ...DEFAULT_GRID }, fogCover: false, createdAt: 0 });
const conn = (id: string, over: Partial<Conn> = {}): Conn => ({ connId: id, userId: id, name: id, color: "#00ff00", role: "player", sid: `${id}sid`, v: 20, ...over });

/** A room on a table with these settings (or with none at all). */
function room(env: Record<string, unknown> | undefined): RoomInside {
  const r = Object.create(RoomClass.prototype) as RoomInside;
  Object.assign(r, {
    sql: { exec: () => ({ toArray: () => [] }) },
    ctx: { storage: { transactionSync: (f: () => void) => f() }, getWebSockets: () => [] },
    env,
    info: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS } },
    activeSceneId: "town",
    placed: new Map(),
    scenes: new Map([["town", scene("town")]]),
    items: new Map(),
    assets: new Map(),
    initiative: { entries: [], turn: 0, round: 1 },
    displayView: null,
    sessionSeqs: new Map(),
    tokenStats: new Map(),
    tokenNotes: {},
    handouts: [],
    explored: new Map(),
  });
  return r;
}

describe("a room's hello", () => {
  const gm = conn("gm", { userId: GM_OWNER, role: "gm" });
  const player = conn("p1");
  const display = conn("d1", { display: true });

  it("gives everyone the table's loading lines, and only the GM where its Dungeon is", () => {
    const r = room({ DUNGEON_URL: "https://dungeon.example.test", LOADING_LINES: ["One.", "Two."] });
    expect(r.hello(gm).table).toEqual({ lines: ["One.", "Two."], dungeon: "https://dungeon.example.test/" });
    expect(r.hello(player).table).toEqual({ lines: ["One.", "Two."] });
    expect(r.hello(display).table).toEqual({ lines: ["One.", "Two."] });
  });

  it("says nothing of settings on a table that has none", () => {
    for (const env of [{}, undefined, { DUNGEON_URL: "", LOADING_LINES: [] }]) {
      const r = room(env);
      expect("table" in r.hello(gm)).toBe(false);
      expect("table" in r.hello(player)).toBe(false);
    }
    // One without the other.
    expect(room({ DUNGEON_URL: "https://dungeon.example.test" }).hello(gm).table).toEqual({ dungeon: "https://dungeon.example.test/" });
    expect("table" in room({ DUNGEON_URL: "https://dungeon.example.test" }).hello(player)).toBe(false);
    expect(room({ LOADING_LINES: "One." }).hello(gm).table).toEqual({ lines: ["One."] });
  });
});
