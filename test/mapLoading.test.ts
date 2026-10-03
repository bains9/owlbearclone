// The map's loading message: the Baldr line picker, the overlay over time (hidden, the
// wait, loading, being retried, given up on, gone once the map is there), switching scenes
// mid-load, the season note, and the image cache's view of a map that won't load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BALDR_LINES, nextLine, pickLine } from "../src/client/room/loadingLines";
import {
  LOADING_DELAY_MS,
  NO_MAP_LOAD,
  SEASON_DELAY_MS,
  overlayAt,
  overlayDue,
  sameMapLoad,
  seasonNoteAt,
  seasonNoteDue,
  seasonNoteTop,
  trackLoad,
  trackSeason,
  withLine,
} from "../src/client/room/mapLoading";
import type { LoadTrack, MapLoad } from "../src/client/room/mapLoading";

/** A random number generator that's the same every run. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("the Baldr lines", () => {
  it("are the 18 approved lines, each once", () => {
    expect(BALDR_LINES).toHaveLength(18);
    expect(new Set(BALDR_LINES).size).toBe(18);
    expect(BALDR_LINES[0]).toBe("Baldr doesn't roll initiative. Initiative waits for Baldr.");
    expect(BALDR_LINES[3]).toBe('Baldr\'s armour class is "no".');
    expect(BALDR_LINES[17]).toBe("Baldr doesn't need a map. The map needs Baldr. That's why it's loading.");
  });

  it("never picks the last line again, and comes to every line", () => {
    const random = seeded(7);
    const seen = new Set<number>();
    let last = -1;
    for (let i = 0; i < 2000; i++) {
      const line = pickLine(last, random);
      expect(line).not.toBe(last);
      expect(line).toBeGreaterThanOrEqual(0);
      expect(line).toBeLessThan(BALDR_LINES.length);
      seen.add(line);
      last = line;
    }
    expect(seen.size).toBe(BALDR_LINES.length);
  });

  it("can pick any other line, at the edges of the random range too", () => {
    for (let last = 0; last < BALDR_LINES.length; last++) {
      const reachable = new Set<number>();
      for (let k = 0; k < BALDR_LINES.length - 1; k++) {
        reachable.add(pickLine(last, () => k / (BALDR_LINES.length - 1)));
      }
      expect(reachable.size).toBe(BALDR_LINES.length - 1);
      expect(reachable.has(last)).toBe(false);
      // A generator that returns 1 (it shouldn't) still gives a line.
      expect(pickLine(last, () => 1)).toBeLessThan(BALDR_LINES.length);
      expect(pickLine(last, () => 1)).not.toBe(last);
    }
    expect(pickLine(-1, () => 0.999999)).toBe(BALDR_LINES.length - 1);
  });

  it("goes by the line last shown on this device, with or without storage", () => {
    // No storage here (as in a private window): the page remembers the last line itself.
    let last = nextLine(() => 0);
    for (let i = 0; i < 50; i++) {
      const line = nextLine(() => 0);
      expect(line).not.toBe(last);
      last = line;
    }
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, v),
    });
    try {
      stored.set("tabletop-baldr-line", "5");
      expect(nextLine(() => 5.5 / 17)).toBe(6);
      expect(stored.get("tabletop-baldr-line")).toBe("6");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

const A = "/api/rooms/r/files/mapA";
const B = "/api/rooms/r/files/mapB";
const load = (url: string | null, status: MapLoad["status"], season: string | null = null): MapLoad => ({ url, status, season });

/** Follows a run of reports from the board, as the overlay does, with lines handed out in order. */
function follower(pick?: () => number) {
  let next = 0;
  let t: LoadTrack | null = null;
  const lines = pick ?? (() => next++);
  return {
    report(l: MapLoad, now: number): LoadTrack {
      t = trackLoad(t, l, now);
      return t;
    },
    /** What the overlay shows at `now` (drawn then, so a line is picked if it's due one). */
    at(now: number) {
      t = withLine(t, now, lines);
      return overlayAt(t, now);
    },
    get track() {
      return t;
    },
  };
}

describe("the map's loading overlay over time", () => {
  it("waits, then shows Loading map with a line, and goes once the map is there", () => {
    const f = follower();
    f.report(load(A, "loading"), 1000);
    expect(f.at(1000)).toEqual({ kind: "hidden" });
    expect(f.at(1000 + LOADING_DELAY_MS - 1)).toEqual({ kind: "hidden" });
    expect(overlayDue(f.track, 1100)).toBe(LOADING_DELAY_MS - 100);
    expect(f.at(1000 + LOADING_DELAY_MS)).toEqual({ kind: "loading", line: 0 });
    expect(overlayDue(f.track, 1000 + LOADING_DELAY_MS)).toBeNull();
    f.report(load(A, "ready"), 3000);
    expect(f.at(3000)).toEqual({ kind: "hidden" });
    expect(overlayDue(f.track, 3000)).toBeNull();
  });

  it("never shows for a map that arrives within the wait (one the browser already has)", () => {
    const f = follower();
    f.report(load(A, "loading"), 0);
    f.report(load(A, "ready"), LOADING_DELAY_MS - 50);
    for (const now of [LOADING_DELAY_MS - 50, LOADING_DELAY_MS, 5000]) expect(f.at(now).kind).toBe("hidden");
    // And straight there: never anything.
    const g = follower();
    g.report(load(B, "ready"), 0);
    expect(g.at(10_000).kind).toBe("hidden");
  });

  it("says it's trying again while a failed map is retried, without a joke, then gives up with Try again", () => {
    const f = follower();
    f.report(load(A, "loading"), 0);
    f.report(load(A, "retrying"), 100);
    // Still within the wait: nothing yet.
    expect(f.at(200).kind).toBe("hidden");
    expect(f.at(LOADING_DELAY_MS)).toEqual({ kind: "retrying" });
    // The retries come and go: the same message, the same start.
    const before = f.track;
    f.report(load(A, "retrying"), 6000);
    expect(f.track).toBe(before);
    f.report(load(A, "failed"), 130_000);
    expect(f.at(130_000)).toEqual({ kind: "failed" });
    expect(overlayDue(f.track, 130_000)).toBeNull();
  });

  it("shows a map already given up on at once", () => {
    const f = follower();
    f.report(load(A, "failed"), 0);
    expect(f.at(0)).toEqual({ kind: "failed" });
  });

  it("starts afresh on Try again: a new line, and no gap with nothing showing", () => {
    const f = follower();
    f.report(load(A, "loading"), 0);
    expect(f.at(500)).toEqual({ kind: "loading", line: 0 });
    f.report(load(A, "failed"), 1000);
    f.report(load(A, "loading"), 2000);
    expect(f.at(2000)).toEqual({ kind: "loading", line: 1 });
    f.report(load(A, "ready"), 2500);
    expect(f.at(2500).kind).toBe("hidden");
  });

  it("follows a switch of scenes mid-load", () => {
    const f = follower();
    f.report(load(A, "loading"), 0);
    expect(f.at(500)).toEqual({ kind: "loading", line: 0 });
    // To another map that's loading: it stays up, with that map's own line.
    f.report(load(B, "loading"), 600);
    expect(f.track?.url).toBe(B);
    expect(f.at(600)).toEqual({ kind: "loading", line: 1 });
    // To a scene without a map: nothing.
    f.report(load(null, "ready"), 700);
    expect(f.at(700).kind).toBe("hidden");
    expect(f.at(10_000).kind).toBe("hidden");
    // Back to B, still loading: a new load as far as the overlay goes, so the wait again.
    f.report(load(B, "loading"), 800);
    expect(f.at(800).kind).toBe("hidden");
    expect(f.at(800 + LOADING_DELAY_MS)).toEqual({ kind: "loading", line: 2 });
    // To a scene whose map is there already: gone at once.
    f.report(load(A, "ready"), 2000);
    expect(f.at(2000).kind).toBe("hidden");
  });

  it("waits afresh for a map switched to before the first one's overlay came up", () => {
    const f = follower();
    f.report(load(A, "loading"), 0);
    f.report(load(B, "loading"), 300);
    expect(f.at(500).kind).toBe("hidden");
    // A's line was never seen, so none was used up on it.
    expect(f.at(300 + LOADING_DELAY_MS)).toEqual({ kind: "loading", line: 0 });
  });

  it("picks a line only once Loading map shows: not for a map that comes within the wait, nor one only tried again", () => {
    const pick = vi.fn(() => 3);
    const f = follower(pick);
    f.report(load(A, "loading"), 0);
    f.at(100);
    f.report(load(A, "ready"), 300);
    f.at(300);
    f.at(5000);
    expect(pick).not.toHaveBeenCalled();
    // Failing within the wait: it says it's trying again, with no line, and gives up likewise.
    f.report(load(B, "loading"), 6000);
    f.report(load(B, "retrying"), 6100);
    expect(f.at(6000 + LOADING_DELAY_MS)).toEqual({ kind: "retrying" });
    f.report(load(B, "failed"), 9000);
    expect(f.at(9000)).toEqual({ kind: "failed" });
    expect(pick).not.toHaveBeenCalled();
    // Shown: picked once, and kept for as long as that load lasts.
    f.report(load(A, "loading"), 10_000);
    expect(f.at(10_000 + LOADING_DELAY_MS)).toEqual({ kind: "loading", line: 3 });
    f.at(12_000);
    f.report(load(A, "retrying"), 12_500);
    f.report(load(A, "loading"), 13_000);
    expect(f.at(13_000)).toEqual({ kind: "loading", line: 3 });
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it("never shows the same line twice in a row, however many quick loads come between", () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, v),
    });
    try {
      const random = seeded(11);
      const f = follower(() => nextLine(random));
      const shown: number[] = [];
      let now = 0;
      for (let i = 0; i < 2000; i++) {
        const url = `/api/rooms/r/files/map${i}`;
        f.report(load(url, "loading"), now);
        // Every other load is quick (the browser had it) and never shows; the rest are slow.
        const quick = i % 2 === 1 || random() < 0.3;
        if (!quick) {
          const o = f.at(now + LOADING_DELAY_MS);
          if (o.kind === "loading") shown.push(o.line);
        } else {
          f.at(now + 50);
        }
        f.report(load(url, "ready"), now + (quick ? 100 : 1000));
        now += 2000;
      }
      expect(shown.length).toBeGreaterThan(500);
      for (let i = 1; i < shown.length; i++) expect(shown[i]).not.toBe(shown[i - 1]);
      expect(new Set(shown).size).toBe(BALDR_LINES.length);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("goes away when there's no scene at all", () => {
    const f = follower();
    f.report(load(A, "loading"), 0);
    f.report(NO_MAP_LOAD, 1000);
    expect(f.at(1000).kind).toBe("hidden");
  });

  it("tells the board's reports apart only by what they say", () => {
    expect(sameMapLoad(load(A, "loading"), load(A, "loading"))).toBe(true);
    expect(sameMapLoad(load(A, "loading"), load(A, "retrying"))).toBe(false);
    expect(sameMapLoad(load(A, "ready", "k1"), load(A, "ready", "k2"))).toBe(false);
    expect(sameMapLoad(load(A, "ready"), load(B, "ready"))).toBe(false);
  });
});

describe("the season note", () => {
  it("shows after its wait while a season is made, and goes when it lands", () => {
    let t = trackSeason(null, null, 0);
    expect(seasonNoteAt(t, 10_000)).toBe(false);
    expect(seasonNoteDue(t, 0)).toBeNull();
    t = trackSeason(t, "mapA|winter|2", 1000);
    expect(seasonNoteAt(t, 1000 + SEASON_DELAY_MS - 1)).toBe(false);
    expect(seasonNoteDue(t, 1200)).toBe(SEASON_DELAY_MS - 200);
    expect(seasonNoteAt(t, 1000 + SEASON_DELAY_MS)).toBe(true);
    // Reported again (a token moved): the same wait.
    expect(trackSeason(t, "mapA|winter|2", 1600)).toBe(t);
    t = trackSeason(t, null, 3000);
    expect(seasonNoteAt(t, 3000)).toBe(false);
  });

  it("waits again for another look", () => {
    let t = trackSeason(null, "mapA|winter|2", 0);
    t = trackSeason(t, "mapA|winter|3", 2000);
    expect(seasonNoteAt(t, 2100)).toBe(false);
    expect(seasonNoteAt(t, 2000 + SEASON_DELAY_MS)).toBe(true);
  });
});

describe("the season note's place", () => {
  it("keeps to the style sheet but on a phone with a tool's options bar, where it goes below the bar", () => {
    expect(seasonNoteTop(null, false)).toBeNull();
    expect(seasonNoteTop(null, true)).toBeNull();
    expect(seasonNoteTop({ top: 10, height: 40 }, false)).toBeNull();
    expect(seasonNoteTop({ top: 10, height: 40 }, true)).toBe(58);
    // A bar that wraps onto more rows pushes it further down.
    expect(seasonNoteTop({ top: 10, height: 120 }, true)).toBe(138);
  });
});

describe("a map picture that won't load", () => {
  class FakeImage {
    static made: FakeImage[] = [];
    decoding = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = "";
    constructor() {
      FakeImage.made.push(this);
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    FakeImage.made = [];
    vi.stubGlobal("Image", FakeImage);
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is loading, then being retried, then given up on, and loads again after Try again", async () => {
    const { getImage, imageStatus, retryImage } = await import("../src/client/room/images");
    const url = "/api/rooms/r/files/broken";
    let calls = 0;
    // As the board does: it's told, and asks again (on its next frame).
    const ask = () => getImage(url, () => calls++);
    expect(ask()).toBeNull();
    expect(imageStatus(url)).toBe("loading");
    // Each try fails: the next one starts after the back-off (2 s, 4 s, ...).
    for (let tries = 1; tries <= 7; tries++) {
      FakeImage.made[FakeImage.made.length - 1].onerror!();
      expect(ask()).toBeNull();
      expect(imageStatus(url)).toBe(tries > 6 ? "failed" : "retrying");
      if (tries <= 6) {
        vi.advanceTimersByTime(1000 * 2 ** tries);
        expect(ask()).toBeNull();
        expect(imageStatus(url)).toBe("retrying");
      }
    }
    expect(FakeImage.made).toHaveLength(7);
    vi.advanceTimersByTime(600_000);
    expect(FakeImage.made).toHaveLength(7);
    expect(imageStatus(url)).toBe("failed");
    expect(calls).toBeGreaterThan(0);

    retryImage(url);
    expect(imageStatus(url)).toBe("loading");
    expect(ask()).toBeNull();
    expect(FakeImage.made).toHaveLength(8);
    FakeImage.made[7].onload!();
    expect(imageStatus(url)).toBe("ready");
  });
});
