import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeError, DungeonBridge, NO_ANSWER, savedWhen, withBridge, type BridgeFrame } from "../src/client/dungeonBridge";
import { GUIDE } from "../src/client/guide";
import { withMapName } from "../src/client/importScenes";
import type { MapFile } from "../src/client/mapImport";
import { NO_PENDING, planSkip } from "../src/client/ui/ddText";

const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const headers = await source("public/_headers");
const scenesSource = await source("src/client/ui/ScenesPanel.tsx");
const bridgeSource = await source("src/client/dungeonBridge.ts");

// New scene › From Dungeon (dungeonBridge.ts, ui/FromDungeon.tsx): Table asks Dungeon's bridge
// page, in a hidden frame, for the GM's maps and for one of them as a .dd2vtt file, which goes
// through the usual import. Dungeon's end is tested in Dungeon's test/bridge.test.ts.

/** A stand-in for the frame: records what Table posts, and plays Dungeon's answers. */
function fakeFrame() {
  const posted: Record<string, unknown>[] = [];
  let hear: ((data: unknown) => void) | null = null;
  const frame: BridgeFrame & { closed: boolean } = {
    closed: false,
    post: (m) => posted.push(m as Record<string, unknown>),
    listen: (on) => {
      hear = on;
      return () => (hear = null);
    },
    close: () => (frame.closed = true),
  };
  return { frame, posted, say: (data: unknown) => hear?.(data) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe("the bridge to Dungeon", () => {
  it("waits for Dungeon to be ready, then lists the maps", async () => {
    const { frame, posted, say } = fakeFrame();
    const bridge = new DungeonBridge(frame);
    const listing = bridge.list();
    await tick();
    expect(posted).toEqual([]);
    say({ dungeon: "ready", version: 1 });
    await tick();
    expect(posted).toEqual([{ dungeon: "list", id: 1 }]);
    say({ dungeon: "list", id: 1, maps: [{ id: "bbbbbbbbbbbb", name: "Tower", updated: "2026-10-28T09:00:00Z" }, { id: "../x", name: "bad" }, { id: "aaaaaaaaaaaa", name: "  " }] });
    expect(await listing).toEqual([
      { id: "bbbbbbbbbbbb", name: "Tower", updated: "2026-10-28T09:00:00Z" },
      { id: "aaaaaaaaaaaa", name: "Untitled map", updated: "" },
    ]);
  });

  it("brings a map back as a .dd2vtt file, saying how far Dungeon has got", async () => {
    const { frame, posted, say } = fakeFrame();
    const bridge = new DungeonBridge(frame);
    say({ dungeon: "ready", version: 1 });
    const progress: string[] = [];
    const getting = bridge.file("bbbbbbbbbbbb", 128, 6144, true, (level, of) => progress.push(`${level}/${of}`));
    await tick();
    expect(posted).toEqual([{ dungeon: "file", map: "bbbbbbbbbbbb", pixelsPerGrid: 128, maxSide: 6144, lighting: true, id: 1 }]);
    say({ dungeon: "progress", id: 1, level: 1, of: 2 });
    say({ dungeon: "progress", id: 2, level: 9, of: 9 });
    say({ dungeon: "file", id: 1, name: "Tower-top.dd2vtt", mapName: "Tower/top (grid)", file: new Blob(['{"format":1}']) });
    const { file, name } = await getting;
    expect(progress).toEqual(["1/2"]);
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("Tower-top.dd2vtt");
    expect(name).toBe("Tower/top (grid)");
    expect(await file.text()).toBe('{"format":1}');
  });

  it("passes on what went wrong, and when it was Dungeon's sign-in", async () => {
    const { frame, say } = fakeFrame();
    const bridge = new DungeonBridge(frame);
    say({ dungeon: "ready", version: 1 });
    const a = bridge.list();
    await tick();
    say({ dungeon: "error", id: 1, message: "ran out", signedOut: true });
    await expect(a).rejects.toMatchObject({ message: "ran out", signedOut: true });
    const b = bridge.list();
    await tick();
    say({ dungeon: "error", id: 2, message: "That map isn't in Dungeon any more." });
    const err = await b.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeError);
    expect((err as BridgeError).signedOut).toBe(false);
  });

  it("says so when Dungeon never answers", async () => {
    vi.useFakeTimers();
    const { frame } = fakeFrame();
    const bridge = new DungeonBridge(frame, 1000);
    const listing = bridge.list().catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await listing).toMatch(/Dungeon didn't answer/);
  });

  it("stops what's waiting for Dungeon to be ready when it's closed, at once", async () => {
    const { frame } = fakeFrame();
    const bridge = new DungeonBridge(frame);
    const listing = bridge.list().catch((e: Error) => e.message);
    bridge.close();
    expect(await listing).toBe("Stopped.");
  });

  it("gives up at once when the frame has loaded something that isn't the bridge", async () => {
    const { frame, say } = fakeFrame();
    const bridge = new DungeonBridge(frame);
    const listing = bridge.list().catch((e: Error) => e.message);
    bridge.giveUp();
    expect(await listing).toBe(NO_ANSWER);
    // And a bridge that was ready isn't troubled by it.
    const other = fakeFrame();
    const ok = new DungeonBridge(other.frame);
    other.say({ dungeon: "ready", version: 1 });
    ok.giveUp();
    const second = ok.list();
    await tick();
    other.say({ dungeon: "list", id: 1, maps: [] });
    expect(await second).toEqual([]);
    void say;
  });

  it("starts a fresh frame to try again after a failure, and at once when Dungeon's sign-in ran out", async () => {
    const frames: ReturnType<typeof fakeFrame>[] = [];
    const open = () => {
      const f = fakeFrame();
      frames.push(f);
      return new DungeonBridge(f.frame, 1000);
    };
    const holder = { current: null as DungeonBridge | null };
    // Dungeon never ready: the bridge is let go, and the next try opens another frame.
    vi.useFakeTimers();
    const first = withBridge(holder, (b) => b.list(), open).catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await first).toBe(NO_ANSWER);
    expect(holder.current).toBeNull();
    expect(frames[0].frame.closed).toBe(true);
    vi.useRealTimers();
    // Signed out: one more go straight away, in a fresh frame.
    const second = withBridge(holder, (b) => b.list(), open);
    await tick();
    frames[1].say({ dungeon: "ready", version: 1 });
    await tick();
    frames[1].say({ dungeon: "error", id: 1, message: "ran out", signedOut: true });
    await tick();
    frames[2].say({ dungeon: "ready", version: 1 });
    await tick();
    frames[2].say({ dungeon: "list", id: 1, maps: [] });
    expect(await second).toEqual([]);
    expect(frames).toHaveLength(3);
    expect(frames[1].frame.closed).toBe(true);
    expect(holder.current).not.toBeNull();
  });

  it("stops what's waiting when it's closed, and takes the frame away", async () => {
    const { frame, say } = fakeFrame();
    const bridge = new DungeonBridge(frame);
    say({ dungeon: "ready", version: 1 });
    const listing = bridge.list().catch((e: Error) => e.message);
    await tick();
    bridge.close();
    expect(await listing).toBe("Stopped.");
    expect(frame.closed).toBe(true);
  });

  it("only hears Dungeon's own frame, and posts only to Dungeon", () => {
    expect(bridgeSource).toContain("e.source === frame.contentWindow && e.origin === origin");
    expect(bridgeSource).toContain("frame.contentWindow?.postMessage(message, origin)");
  });
});

describe("New scene › From Dungeon", () => {
  it("is a tab of New scene that hands the file to the usual import", () => {
    expect(scenesSource).toContain("From Dungeon");
    // skip: past any Dungeondraft file or picture waiting in Upload a map for its other half.
    expect(scenesSource).toContain("onFile={(f, link) => void onFiles([f], { skip: true, dungeon: link })}");
    expect(scenesSource).toContain("...(opts.dungeon ? { dungeon: opts.dungeon } : {})");
  });

  it("brings a Dungeon map in alone, whatever's waiting in Upload a map", () => {
    const waiting = { ...NO_PENDING, dds: [new File(["{}"], "Tavern.dungeondraft_map")] };
    const dungeon = new File(["{}"], "Crypt.dd2vtt");
    const plan = planSkip(waiting, dungeon);
    expect(plan.now).toEqual([dungeon]);
    expect(plan.pending.dds.map((f) => f.name)).toEqual(["Tavern.dungeondraft_map"]);
  });

  it("names the scenes after the map's own name, not its file's", () => {
    const maps = [{ name: "Tower- top" }, { name: "Tower- top: Cellar" }, { name: "Other" }] as MapFile[];
    withMapName(maps, "Tower- top (grid).dd2vtt", "Tower: top (grid)");
    expect(maps.map((m) => m.name)).toEqual(["Tower: top (grid)", "Tower: top (grid): Cellar", "Other"]);
  });

  it("lets the page frame Dungeon (and itself, which Dungeon's sign-in passes through), and nothing else", () => {
    const csp = headers.split("\n").find((l: string) => l.includes("Content-Security-Policy"))!;
    // Dungeon's frame comes by Table's own /api/dungeon/hop when it needs to sign in.
    expect(csp).toContain("frame-src 'self' https://dungeon.parhome.ca;");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("says when Dungeon saved each map", () => {
    const now = Date.parse("2026-10-28T12:00:00Z");
    expect(savedWhen("2026-10-28T11:59:40Z", now)).toBe("Saved just now");
    expect(savedWhen("2026-10-28T11:59:00Z", now)).toBe("Saved 1 minute ago");
    expect(savedWhen("2026-10-28T11:15:00Z", now)).toBe("Saved 45 minutes ago");
    expect(savedWhen("2026-10-28T09:00:00Z", now)).toBe("Saved 3 hours ago");
    expect(savedWhen("2026-10-20T09:00:00Z", now)).toMatch(/^Saved .*2026/);
    expect(savedWhen("", now)).toBe("");
  });

  it("is in What's new and the guide's new-scene steps", () => {
    const news = GUIDE[0];
    const text = JSON.stringify(GUIDE);
    expect(news.parts[9].title).toBe("Maps straight from Dungeon, and updated from it (28 October 2026)");
    expect(text).not.toContain("ready for vision");
    expect(text).toContain("Choose **Upload a map**, **Uploaded maps** or **From Dungeon**.");
    const part = GUIDE.find((s) => s.id === "adding-maps")!.parts.find((p) => p.title === "Maps from Dungeon")!;
    expect(part.steps.join("\n")).toContain("**From Dungeon**");
    expect(part.notes.join("\n")).toContain("**Update from Dungeon**");
  });
});
