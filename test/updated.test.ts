import { afterEach, describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { RoomClient } from "../src/client/room/client";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER } from "../src/shared/sanitize";
import type { Scene } from "../src/shared/types";

// A page left open across an update may not load the parts it loads only when first wanted (their
// files were replaced), so those say that Tabletop has been updated and to reload, rather than
// blaming the connection or the browser. BUILD_ID is "dev" in tests; the server's is stubbed.

type Answer = { build: unknown } | { status: number } | "offline" | "timeout";

/** The server, as GET /api/build answers it: its build, an error status, no answer, or none in time. */
function server(answer: Answer) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    void url;
    void init;
    if (answer === "offline") throw new TypeError("Failed to fetch");
    if (answer === "timeout") throw new DOMException("The operation timed out.", "TimeoutError");
    if ("status" in answer) return new Response("Something went wrong on the server.", { status: answer.status });
    return Response.json(answer);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("../src/client/monsters/icons");
  vi.doUnmock("../src/client/npcs/icons");
  vi.resetModules();
});

/** A fresh updated.ts: it remembers "updated" for the rest of the page's life. */
async function freshUpdated() {
  vi.resetModules();
  return import("../src/client/updated");
}

describe("whether this page is out of date", () => {
  it("asks the server for its build, without the cache and with a time limit, and says updated when it differs", async () => {
    const fetch = server({ build: "newer" });
    const { pageState, pageOutdated, loadFailure } = await freshUpdated();
    expect(await pageState()).toBe("updated");
    expect(fetch).toHaveBeenCalledWith("/api/build", { cache: "no-store", signal: expect.any(AbortSignal) });
    // Once out of date, always (until a reload): no need to ask again.
    expect(await pageOutdated()).toBe(true);
    expect(await loadFailure()).toBe("updated");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("says current when the server runs this page's build", async () => {
    server({ build: "dev" });
    const { pageState, pageOutdated, loadFailure } = await freshUpdated();
    expect(await pageState()).toBe("current");
    expect(await pageOutdated()).toBe(false);
    expect(await loadFailure()).toBe("failed");
  });

  it("says unreachable when the server can't be asked, answers an error, takes too long, or answers something else", async () => {
    const answers: Answer[] = ["offline", "timeout", { status: 500 }, { status: 404 }, { build: 42 }];
    for (const answer of answers) {
      server(answer);
      const { pageState, loadFailure } = await freshUpdated();
      expect(await pageState(), JSON.stringify(answer)).toBe("unreachable");
      // The connection message stands then.
      expect(await loadFailure(), JSON.stringify(answer)).toBe("failed");
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } })));
    const { pageState } = await freshUpdated();
    expect(await pageState()).toBe("unreachable");
  });

  it("never forgets updated, even when an answer still on its way says otherwise", async () => {
    const gates: Array<(build: string) => void> = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => gates.push((build) => done(Response.json({ build }))))));
    const { pageState } = await freshUpdated();
    const first = pageState();
    const second = pageState();
    await vi.waitFor(() => expect(gates.length).toBe(2));
    gates[0]("newer");
    expect(await first).toBe("updated");
    // During a rollout the next answer can come from a server still on this page's build.
    gates[1]("dev");
    expect(await second).toBe("updated");
    expect(await pageState()).toBe("updated");
  });

  it("words the reason as one sentence, in the form the room's own update message has", async () => {
    const { updatedText } = await freshUpdated();
    expect(updatedText("use the monsters")).toBe("Tabletop has been updated. Reload this page to use the monsters.");
    expect(updatedText("get the new version")).toBe("Tabletop has been updated. Reload this page to get the new version.");
  });
});

function gmRoom(): RoomClient {
  const room = new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });
  const scene: Scene = {
    id: "scene1", name: "Crypt", order: 0, mapAssetId: null, width: 1400, height: 1000,
    background: "#000000", grid: { ...DEFAULT_GRID }, fogCover: true, createdAt: 0,
  };
  room.store.set({
    me: { connId: "c1", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm" },
    room: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS } },
    scenes: { scene1: scene },
    viewSceneId: "scene1",
    activeSceneId: "scene1",
    items: {},
    assets: {},
  });
  room.upload = async () => {
    throw new Error("nothing should be uploaded");
  };
  return room;
}

describe("a monster or NPC dropped while its pictures can't load", () => {
  async function failingIcons(path: "../src/client/monsters/icons" | "../src/client/npcs/icons") {
    vi.resetModules();
    vi.doMock(path, () => {
      throw new Error("Failed to fetch dynamically imported module");
    });
  }

  it("says the monsters couldn't load, places nothing (it used to fail silently), and says reload on an out-of-date page", async () => {
    for (const [answer, want] of [["offline", "failed"], [{ build: "dev" }, "failed"], [{ build: "newer" }, "updated"]] as const) {
      server(answer);
      await failingIcons("../src/client/monsters/icons");
      const place = await import("../src/client/monsters/place");
      const room = gmRoom();
      expect(await place.placeMonster(room, "goblin", { x: 100, y: 100 }, false)).toBeNull();
      const text = want === "updated" ? place.MONSTERS_UPDATED : place.MONSTERS_LOAD_FAILED;
      expect(room.state.toasts.map((t) => [t.kind, t.text]), JSON.stringify(answer)).toEqual([["error", text]]);
      expect(room.state.items).toEqual({});
    }
  });

  it("says the same for NPCs", async () => {
    for (const [answer, want] of [["offline", "failed"], [{ build: "newer" }, "updated"]] as const) {
      server(answer);
      await failingIcons("../src/client/npcs/icons");
      const place = await import("../src/client/npcs/place");
      const room = gmRoom();
      expect(await place.placeNpc(room, "dwerv", "fighter", { x: 100, y: 100 }, false)).toBeNull();
      const text = want === "updated" ? place.NPCS_UPDATED : place.NPCS_LOAD_FAILED;
      expect(room.state.toasts.map((t) => [t.kind, t.text]), JSON.stringify(answer)).toEqual([["error", text]]);
      expect(room.state.items).toEqual({});
    }
  });

  it("has the texts the guide quotes", async () => {
    const monsters = await import("../src/client/monsters/place");
    const npcs = await import("../src/client/npcs/place");
    const dd = await import("../src/client/dd/attach");
    expect(monsters.MONSTERS_LOAD_FAILED).toBe("Couldn't load the monsters. Check the connection, then try again.");
    expect(monsters.MONSTERS_UPDATED).toBe("Tabletop has been updated. Reload this page to use the monsters.");
    expect(npcs.NPCS_LOAD_FAILED).toBe("Couldn't load the NPCs. Check the connection, then try again.");
    expect(npcs.NPCS_UPDATED).toBe("Tabletop has been updated. Reload this page to use the NPCs.");
    expect(dd.ATTACH_TEXT.updated).toBe("Tabletop has been updated. Reload this page to read Dungeondraft files.");
    expect(dd.ATTACH_TEXT.offline).toBe("Couldn't load the part of Tabletop that reads Dungeondraft files. Check the connection, then try again.");
  });
});

describe("the guide", () => {
  const news = GUIDE.find((s) => s.id === "whats-new")!;
  const notes = (sectionId: string, title: string) => {
    const part = GUIDE.find((s) => s.id === sectionId)!.parts.find((p) => p.title === title);
    if (!part) throw new Error(`no part "${title}" in ${sectionId}`);
    return [...part.steps, ...part.notes].join("\n");
  };

  it("has the update messages fourth in What's new, under the 25, 24 and 22 October entries", () => {
    expect(news.parts[3].title).toBe("Clearer messages after an update (5 October 2026)");
    const entry = notes("whats-new", news.parts[3].title);
    for (const what of ["**Monsters**", "**NPCs**", "Dungeondraft files", "may not load", "**Reload**", "**Try again**", "dropped connection", "If the guide itself can't load", "dropping a monster"]) {
      expect(entry).toContain(what);
    }
    // Nothing else claims to be the latest.
    expect(news.parts.filter((p) => p.title.includes("latest"))).toEqual([]);
  });

  it("quotes the Monsters and NPCs tabs' messages exactly", async () => {
    const monsters = await import("../src/client/monsters/place");
    const npcs = await import("../src/client/npcs/place");
    const m = notes("monsters", "Place a monster");
    expect(m).toContain(`"${monsters.MONSTERS_LOAD_FAILED}"`);
    expect(m).toContain(`"${monsters.MONSTERS_UPDATED}"`);
    const n = notes("monsters", "NPC tokens by race and class");
    expect(n).toContain(`"${npcs.NPCS_LOAD_FAILED}"`);
    expect(n).toContain(`"${npcs.NPCS_UPDATED}"`);
  });

  it("explains it under the update message in Troubleshooting", () => {
    const t = notes("troubleshooting", "\"Tabletop has been updated. Reload this page to get the new version.\"");
    expect(t).toContain("\"Tabletop has been updated. Reload this page to …\"");
    for (const what of ["**Monsters**", "**NPCs**", "Dungeondraft files", "may not load"]) expect(t).toContain(what);
  });
});
