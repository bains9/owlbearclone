// Background sounds (Sound in the top bar): the GM chooses from a list made for them, everyone hears
// it at their own volume. The sounds themselves need a real browser to judge; what's checked here is
// that every one can be made, that a browser wouldn't refuse what it's asked to do, and how they're shared.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { CANTINA_CHORDS, CANTINA_TUNE, DIES_IRAE, GREENSLEEVES, GREENSLEEVES_CHORDS, KYRIE, REQUIEM, SOUND_RECIPES, SOUND_TRIMS, THRONE_CHORDS, THRONE_TUNE, buildSound, readChant, soundsOf, swung } from "../src/client/soundEngine";
import { DEFAULT_SETTINGS, GM_OWNER, sanitizeSettings } from "../src/shared/sanitize";
import { MAX_SOUNDS, SOUNDS, SOUND_GROUPS, sanitizeSounds, soundOption, withSound, withoutSound } from "../src/shared/sounds";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
const { DatabaseSync } = (await import(/* @vite-ignore */ "node:" + "sqlite")) as {
  DatabaseSync: new (path: string) => { prepare(q: string): { all(...b: unknown[]): Record<string, unknown>[] } };
};
const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then((t) => t.replace(/\r\n/g, "\n"));

// ---------------------------------------------------------------- an audio context to run them on

/** Throws what a browser would throw, and remembers what it was asked. */
class FakeParam {
  value = 0;
  readonly events: { kind: string; value: number; at: number }[] = [];
  private record(kind: string, value: number, at: number): this {
    if (!Number.isFinite(value) || !Number.isFinite(at) || at < 0) throw new RangeError(`${kind}(${value}, ${at})`);
    this.events.push({ kind, value, at });
    return this;
  }
  setValueAtTime(v: number, t: number) {
    return this.record("set", v, t);
  }
  linearRampToValueAtTime(v: number, t: number) {
    return this.record("linear", v, t);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    if (v <= 0) throw new RangeError(`An exponential ramp can't reach ${v}`);
    return this.record("exponential", v, t);
  }
  setTargetAtTime(v: number, t: number, constant: number) {
    if (constant < 0) throw new RangeError("Negative time constant");
    return this.record("target", v, t);
  }
  setValueCurveAtTime(curve: Float32Array, t: number, seconds: number) {
    if (curve.length < 2 || seconds <= 0 || curve.some((v) => !Number.isFinite(v))) throw new RangeError("Bad curve");
    return this.record("curve", curve.length, t);
  }
  cancelScheduledValues(t: number) {
    return this.record("cancel", 0, t);
  }
}

class FakeNode {
  readonly connected: unknown[] = [];
  connect<T>(to: T): T {
    this.connected.push(to);
    return to;
  }
  disconnect() {
    this.connected.length = 0;
  }
}

class FakeSource extends FakeNode {
  frequency = new FakeParam();
  detune = new FakeParam();
  playbackRate = new FakeParam();
  type = "";
  buffer: unknown = null;
  loop = false;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  constructor(readonly context: FakeContext) {
    super();
    context.made.push(this);
  }
  start(t = 0) {
    if (this.startedAt !== null) throw new Error("Started twice");
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`start(${t})`);
    this.startedAt = t;
  }
  stop(t = 0) {
    if (this.startedAt === null) throw new Error("Stopped before it started");
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`stop(${t})`);
    this.stoppedAt = t;
  }
}

class FakeContext {
  sampleRate = 4000;
  currentTime = 0;
  state = "running";
  onstatechange: (() => void) | null = null;
  destination = new FakeNode();
  readonly made: FakeSource[] = [];
  createGain() {
    return Object.assign(new FakeNode(), { gain: new FakeParam() });
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: "", frequency: new FakeParam(), Q: new FakeParam() });
  }
  createStereoPanner() {
    return Object.assign(new FakeNode(), { pan: new FakeParam() });
  }
  createConvolver() {
    return Object.assign(new FakeNode(), { buffer: null });
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam() });
  }
  createBufferSource() {
    return new FakeSource(this);
  }
  createOscillator() {
    return new FakeSource(this);
  }
  createBuffer(channels: number, length: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (ch: number) => data[ch] };
  }
  resume() {
    this.state = "running";
    this.onstatechange?.();
    return Promise.resolve();
  }
}

const context = () => new FakeContext() as unknown as BaseAudioContext & FakeContext;

/** Steady all through, made beforehand and looped: nothing more to schedule as they play. */
const STEADY = ["river", "rain", "wind", "blizzard"];

// ---------------------------------------------------------------- the list

describe("the list of sounds", () => {
  it("has a way of making every sound on it, and nothing that isn't on it", () => {
    expect(Object.keys(SOUND_RECIPES).sort()).toEqual(SOUNDS.map((s) => s.id).sort());
    expect(new Set(SOUNDS.map((s) => s.id)).size).toBe(SOUNDS.length);
    expect(new Set(SOUNDS.map((s) => s.name)).size).toBe(SOUNDS.length);
  });

  it("puts every sound under a heading, and says what's in it", () => {
    for (const s of SOUNDS) {
      expect(SOUND_GROUPS).toContain(s.group);
      expect(s.blurb.length).toBeGreaterThan(3);
    }
    for (const g of SOUND_GROUPS) expect(SOUNDS.filter((s) => s.group === g).length).toBeGreaterThan(2);
    expect(soundOption("tavern")?.name).toBe("Tavern");
    expect(soundOption("nope")).toBeUndefined();
  });

  it("keeps a room's sounds real and within bounds, whatever it's sent", () => {
    expect(sanitizeSounds({ tavern: 1, rain: 0.456 })).toEqual({ tavern: 1, rain: 0.46 });
    expect(sanitizeSounds({ tavern: 9, rain: -1 })).toEqual({ tavern: 1, rain: 0.05 });
    expect(sanitizeSounds({ tavern: "loud", rain: NaN, nope: 1, __proto__: 1 })).toEqual({});
    expect(sanitizeSounds({})).toEqual({});
    for (const junk of [null, undefined, "tavern", 4, ["tavern"]]) expect(sanitizeSounds(junk)).toBeNull();
    const many = Object.fromEntries(SOUNDS.map((s) => [s.id, 1]));
    expect(Object.keys(sanitizeSounds(many)!)).toHaveLength(MAX_SOUNDS);
  });

  it("adds, changes and takes away without touching the others, and won't go past the most", () => {
    expect(withSound({ rain: 0.5 }, "tavern")).toEqual({ rain: 0.5, tavern: 1 });
    expect(withSound({ rain: 0.5 }, "rain", 0.8)).toEqual({ rain: 0.8 });
    expect(withoutSound({ rain: 0.5, tavern: 1 }, "rain")).toEqual({ tavern: 1 });
    expect(withoutSound({ rain: 0.5 }, "tavern")).toEqual({ rain: 0.5 });
    const full = { rain: 1, tavern: 1, cave: 1, wind: 1 };
    expect(withSound(full, "river")).toBe(full);
    expect(withSound(full, "rain", 0.5)).toEqual({ ...full, rain: 0.5 });
  });

  it("is part of a room's settings: left out keeps it, an empty list stops it", () => {
    const on = sanitizeSettings({ sounds: { rain: 0.5 } }, DEFAULT_SETTINGS);
    expect(on.sounds).toEqual({ rain: 0.5 });
    expect(on.playersCanDraw).toBe(DEFAULT_SETTINGS.playersCanDraw);
    // Another setting changed, by a page that knows nothing of sounds.
    expect(sanitizeSettings({ playersCanDraw: false }, on)).toMatchObject({ playersCanDraw: false, sounds: { rain: 0.5 } });
    expect(sanitizeSettings({ sounds: "junk" }, on).sounds).toEqual({ rain: 0.5 });
    expect("sounds" in sanitizeSettings({ sounds: {} }, on)).toBe(false);
    // A room that's never had any stays without.
    expect("sounds" in sanitizeSettings({ playersCanDraw: false }, DEFAULT_SETTINGS)).toBe(false);
  });
});

// ---------------------------------------------------------------- the sounds

describe("making them", () => {
  it.each(SOUNDS.map((s) => s.id))("%s: builds and plays for two minutes without a browser refusing anything", (id) => {
    const c = context();
    const sound = buildSound(id, c, c.destination as unknown as AudioNode)!;
    sound.pump(0, 120);
    expect(c.made.length).toBeGreaterThan(0);
    expect(c.made.filter((s) => s.startedAt !== null).length).toBe(c.made.length);
    // The rest keep having things happen in them, right through the two minutes.
    const late = c.made.filter((s) => (s.startedAt ?? 0) > 60);
    if (STEADY.includes(id)) expect(late).toEqual([]);
    else expect(late.length).toBeGreaterThan(0);
  });

  it("wants nothing it doesn't know", () => {
    const c = context();
    expect(buildSound("nope", c, c.destination as unknown as AudioNode)).toBeNull();
  });

  it("schedules only what's due, and keeps going when asked again", () => {
    const c = context();
    const sound = buildSound("cave", c, c.destination as unknown as AudioNode)!;
    sound.pump(0, 10);
    const first = c.made.length;
    expect(c.made.every((s) => (s.startedAt ?? 0) < 12)).toBe(true);
    sound.pump(10, 20);
    expect(c.made.length).toBeGreaterThan(first);
    expect(c.made.every((s) => (s.startedAt ?? 0) < 22)).toBe(true);
  });

  it("a page that slept skips what it missed, rather than playing it all at once", () => {
    const c = context();
    const sound = buildSound("cave", c, c.destination as unknown as AudioNode)!;
    sound.pump(0, 2);
    const before = c.made.length;
    // An hour hidden: nothing is made for the time gone by.
    c.currentTime = 3600;
    sound.pump(3600, 3602);
    const made = c.made.slice(before);
    expect(made.length).toBeLessThan(40);
    expect(made.every((s) => (s.startedAt ?? 0) >= 3599.9)).toBe(true);
  });

  it("stops what runs all the time, and schedules nothing more", () => {
    const c = context();
    const sound = buildSound("storm", c, c.destination as unknown as AudioNode)!;
    const beds = c.made.slice();
    sound.stop(5);
    expect(beds.every((s) => s.stoppedAt === 5)).toBe(true);
    const count = c.made.length;
    sound.pump(0, 60);
    expect(c.made.length).toBe(count);
  });

  it("every sound has been set to match the others, and that can be left out to measure it", () => {
    expect(Object.keys(SOUND_TRIMS).sort()).toEqual(SOUNDS.map((s) => s.id).sort());
    for (const trim of Object.values(SOUND_TRIMS)) expect(trim).toBeGreaterThan(0);
    for (const trimmed of [true, false]) {
      const c = new FakeContext();
      const gains: ReturnType<FakeContext["createGain"]>[] = [];
      const make = c.createGain.bind(c);
      c.createGain = () => {
        const g = make();
        gains.push(g);
        return g;
      };
      buildSound("rain", c as unknown as BaseAudioContext, c.destination as unknown as AudioNode, Math.random, trimmed);
      expect(gains[0].gain.value).toBe(trimmed ? SOUND_TRIMS.rain : 1);
    }
  });

  it("the cantina's band keeps time: every bar of its tune adds up, with a chord for each", () => {
    expect(CANTINA_TUNE).toHaveLength(16);
    expect(CANTINA_CHORDS).toHaveLength(16);
    for (const bar of CANTINA_TUNE) expect(bar.reduce((sum, [, beats]) => sum + beats, 0)).toBe(4);
  });

  it("the dark throne's chant keeps time too, with a chord for each bar", () => {
    expect(THRONE_CHORDS).toHaveLength(THRONE_TUNE.length);
    for (const bar of THRONE_TUNE) expect(bar.reduce((sum, [, beats]) => sum + beats, 0)).toBe(4);
  });

  describe("plainchant, as it's written", () => {
    const pitches = (line: string) => readChant(line).flatMap((s) => s.notes.map((n) => n.midi));

    it("opens the Dies Irae on its own notes: F E F D E C D D", () => {
      expect(pitches(DIES_IRAE[0]![0]!)).toEqual([53, 52, 53, 50, 52, 48, 50, 50]);
      expect(readChant(DIES_IRAE[0]![0]!).map((s) => s.text)).toEqual(["Di", "es", "i", "rae,", "di", "es", "il", "la,"]);
    });

    it("has its verses in pairs, each pair on one melody: a slip in copying either would show", () => {
      expect(DIES_IRAE).toHaveLength(6);
      for (const first of [0, 2, 4]) {
        for (const breath of [0, 1, 2]) expect(pitches(DIES_IRAE[first + 1]![breath]!)).toEqual(pitches(DIES_IRAE[first]![breath]!));
      }
    });

    it("gives every syllable a note, in every piece", () => {
      for (const piece of [DIES_IRAE, REQUIEM, KYRIE]) {
        for (const verse of piece) {
          for (const line of verse) {
            const syllables = readChant(line);
            expect(syllables.length).toBeGreaterThan(1);
            for (const s of syllables) {
              expect(s.text.length).toBeGreaterThan(0);
              expect(s.notes.length).toBeGreaterThan(0);
              for (const n of s.notes) expect(n.midi).toBeGreaterThanOrEqual(45);
            }
          }
        }
      }
    });

    it("reads what's on the page: several notes to a syllable, shapes that aren't notes, flats, and held notes", () => {
      expect(readChant("spar(hvGF)gens(g)")[0]!.notes.map((n) => n.midi)).toEqual([57, 55, 53]);
      // A flat from where it's marked, for the rest of the breath, and not before.
      expect(pitches("Ky(ifg)ri(ixhi)e(i)")).toEqual([59, 53, 55, 57, 58, 58]);
      expect(pitches("a(i)")).toEqual([59]);
      // Two dots hold the last two notes, one the last only, and the end of a breath is always held.
      expect(readChant("so(hd..)na(g)")[0]!.notes.map((n) => n.beats)).toEqual([2, 2]);
      expect(readChant("so(ecd.)na(g)")[0]!.notes.map((n) => n.beats)).toEqual([1, 1, 2]);
      expect(readChant("so(g)na(g)").map((s) => s.notes[0]!.beats)).toEqual([1, 2]);
    });

    it("sings Latin's vowels, and knows what comes before them", () => {
      expect(soundsOf("Di")).toEqual({ vowel: "i", onset: "d" });
      expect(soundsOf("rae,")).toEqual({ vowel: "e", onset: "r" });
      expect(soundsOf("Quan")).toEqual({ vowel: "a", onset: "q" });
      expect(soundsOf("qui")).toEqual({ vowel: "i", onset: "q" });
      expect(soundsOf("scri")).toEqual({ vowel: "i", onset: "scr" });
      expect(soundsOf("býl")).toEqual({ vowel: "i", onset: "b" });
      expect(soundsOf("ae")).toEqual({ vowel: "e", onset: "" });
      expect(soundsOf("thro")).toEqual({ vowel: "o", onset: "thr" });
    });
  });

  it("swings: the beat stays where it is, and the second eighth of each pair comes late", () => {
    for (const beat of [0, 1, 2, 3, 4]) expect(swung(beat)).toBe(beat);
    expect(swung(0.5)).toBeCloseTo(0.6);
    expect(swung(1.5)).toBeCloseTo(1.6);
    // Always forward, or a note would end before it began.
    for (let b = 0; b < 4; b += 0.25) expect(swung(b + 0.25)).toBeGreaterThan(swung(b));
  });

  it("plays Greensleeves whole: every bar adds up, with a chord for each half of it", () => {
    const eighths = GREENSLEEVES.reduce((sum, [, length]) => sum + length, 0);
    // One note leading in, then sixteen bars of six.
    expect(eighths).toBe(1 + 16 * 6);
    expect(GREENSLEEVES_CHORDS).toHaveLength(16 * 2);
  });
});

// ---------------------------------------------------------------- on a device

describe("on a device", () => {
  let c: FakeContext;
  let listeners: Map<string, () => void>;
  let stored: Map<string, string>;
  const load = () => import("../src/client/soundscape");

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    // Until a page makes its own: one that makes none is seen to have made nothing.
    c = new FakeContext();
    listeners = new Map();
    stored = new Map();
    vi.stubGlobal("AudioContext", function AudioContext() {
      c = new FakeContext();
      return c;
    });
    vi.stubGlobal("window", {
      addEventListener: (name: string, f: () => void) => listeners.set(name, f),
      removeEventListener: (name: string) => listeners.delete(name),
    });
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => stored.set(k, v),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("says when the browser's holding it back, and the next click anywhere starts it", async () => {
    const s = await load();
    const seen = vi.fn();
    s.subscribeSound(seen);
    vi.stubGlobal("AudioContext", function AudioContext() {
      c = new FakeContext();
      c.state = "suspended";
      c.resume = () => Promise.resolve(); // Refused: there's been no click yet.
      return c;
    });
    s.setRoomSounds({ rain: 1 });
    expect(s.soundState().held).toBe(false);
    vi.advanceTimersByTime(600);
    expect(s.soundState().held).toBe(true);
    expect(listeners.has("pointerdown")).toBe(true);
    expect(listeners.has("keydown")).toBe(true);
    // A click: this time the browser says yes.
    c.resume = () => {
      c.state = "running";
      c.onstatechange?.();
      return Promise.resolve();
    };
    listeners.get("pointerdown")!();
    expect(s.soundState().held).toBe(false);
    expect(listeners.size).toBe(0);
  });

  it("says nothing when the browser lets it play straight away", async () => {
    const s = await load();
    s.setRoomSounds({ rain: 1 });
    vi.advanceTimersByTime(2000);
    expect(s.soundState().held).toBe(false);
    expect(listeners.size).toBe(0);
  });

  it("starts what's added, leaves what's still on, and fades out what's gone", async () => {
    const s = await load();
    s.setRoomSounds({ rain: 1 });
    const beds = c.made.filter((b) => b.stoppedAt === null);
    expect(beds.length).toBeGreaterThan(0);
    s.setRoomSounds({ rain: 0.5, cave: 1 });
    expect(c.made.length).toBeGreaterThan(beds.length);
    expect(beds.every((b) => b.stoppedAt === null)).toBe(true);
    s.setRoomSounds({ cave: 1 });
    expect(beds.every((b) => b.stoppedAt !== null)).toBe(true);
  });

  it("keeps its own volume, starts plainly audible, and remembers", async () => {
    const s = await load();
    expect(s.soundState().volume).toBe(s.DEFAULT_VOLUME);
    expect(s.volumeGain(0)).toBe(0);
    expect(s.volumeGain(1)).toBe(1);
    expect(s.volumeGain(0.5)).toBeLessThan(0.5);
    s.setSoundVolume(0.3);
    expect(stored.get("tabletop-sound-volume")).toBe("0.3");
    vi.resetModules();
    expect((await load()).soundState().volume).toBe(0.3);
  });

  it("makes nothing at all while muted, and picks up what's on when it isn't", async () => {
    const s = await load();
    s.setSoundMuted(true);
    s.setRoomSounds({ rain: 1 });
    expect(c.made.length).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(s.soundState().held).toBe(false);
    s.setSoundMuted(false);
    expect(c.made.length).toBeGreaterThan(0);
    expect(stored.get("tabletop-sound-muted")).toBe("0");
  });

  it("lets the GM hear one alone, apart from what the room has on", async () => {
    const s = await load();
    s.previewSound("cave");
    expect(s.soundState().preview).toBe("cave");
    // What runs all the time: its first drips, scheduled already, stop by themselves.
    const beds = c.made.filter((b) => b.stoppedAt === null);
    expect(beds.length).toBeGreaterThan(0);
    s.setRoomSounds({});
    expect(beds.every((b) => b.stoppedAt === null)).toBe(true);
    s.previewSound(null);
    expect(s.soundState().preview).toBeNull();
    expect(beds.every((b) => b.stoppedAt !== null)).toBe(true);
  });
});

// ---------------------------------------------------------------- the room

interface RoomInside {
  create(id: string, name: string): unknown;
  info: { settings: { sounds?: Record<string, number> } };
  load(): void;
  hello(conn: unknown): { room: { settings: { sounds?: Record<string, number> } } };
  webSocketMessage(ws: unknown, message: string): Promise<void>;
}

function sqlStore() {
  const db = new DatabaseSync(":memory:");
  return {
    exec(q: string, ...b: unknown[]) {
      const rows = db.prepare(q).all(...b);
      return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() };
    },
  };
}

const conn = (role: string, more: Record<string, unknown> = {}) => ({ connId: `c-${role}${more.display ? "d" : ""}`, userId: role === "gm" ? GM_OWNER : "player000000001", name: role, color: "#888888", role, sid: `s-${role}`, v: 8, ...more });

function socket(c: ReturnType<typeof conn>) {
  const sent: Record<string, unknown>[] = [];
  return { sent, send: (m: string) => void sent.push(JSON.parse(m)), deserializeAttachment: () => c, serializeAttachment: () => undefined, close: () => undefined };
}

async function aRoom() {
  vi.stubGlobal("WebSocketRequestResponsePair", class {});
  const { Room } = (await import(/* @vite-ignore */ "../src/worker/" + "room")) as { Room: new (c: unknown, e: unknown) => RoomInside };
  const gm = socket(conn("gm"));
  const player = socket(conn("player"));
  const sql = sqlStore();
  const ctx = {
    storage: { sql, transactionSync: (f: () => unknown) => f(), deleteAll: async () => undefined },
    blockConcurrencyWhile: (f: () => unknown) => f(),
    getWebSockets: () => [gm, player],
    setWebSocketAutoResponse: () => undefined,
  };
  const env = { FILES: {}, DIRECTORY: { getByName: () => ({ touchRoom: () => undefined, gmDice: () => null, characterDice: () => null, renameRoom: () => undefined }) } };
  const room = new Room(ctx, env);
  room.create("AbCdEf123456", "Room");
  // Each its own: the server rightly takes the same one twice as one change.
  let seq = 0;
  const send = (ws: ReturnType<typeof socket>, msg: unknown) => room.webSocketMessage(ws, JSON.stringify({ seq: ++seq, ...(msg as object) }));
  return { room, gm, player, send, ctx, env, Room };
}

describe("in a room", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("the GM puts one on: everyone's told, a page opened later joins in, and it's still on after a restart", async () => {
    const { room, gm, player, send, ctx, env, Room } = await aRoom();
    await send(gm, { t: "room.update", settings: { sounds: { tavern: 0.8 } } });
    expect(room.info.settings.sounds).toEqual({ tavern: 0.8 });
    for (const who of [gm, player]) {
      expect(who.sent.find((m) => m.t === "room")).toMatchObject({ room: { settings: { sounds: { tavern: 0.8 } } } });
    }
    expect(room.hello(conn("player")).room.settings.sounds).toEqual({ tavern: 0.8 });
    const again = new Room(ctx, env);
    again.load();
    expect(again.info.settings.sounds).toEqual({ tavern: 0.8 });
  });

  it("a player can't choose what plays", async () => {
    const { room, player, send } = await aRoom();
    await send(player, { t: "room.update", settings: { sounds: { dread: 1 } } });
    expect(room.info.settings.sounds).toBeUndefined();
  });

  it("nothing but a real sound gets in, and Stop all stops it", async () => {
    const { room, gm, send } = await aRoom();
    await send(gm, { t: "room.update", settings: { sounds: { nope: 1, rain: 7 } } });
    expect(room.info.settings.sounds).toEqual({ rain: 1 });
    await send(gm, { t: "room.update", settings: { sounds: {} } });
    expect(room.info.settings.sounds).toBeUndefined();
  });
});

// ---------------------------------------------------------------- the page

describe("the page", () => {
  it("has it in the top bar for everyone, the list for the GM alone", async () => {
    const page = await source("src/client/ui/RoomPage.tsx");
    expect(page).toContain(`{ id: "sound", label: "Sound", icon: Music },`);
    expect(page).toContain(`props.panel === "sound") body = <SoundPanel />`);
    const panel = await source("src/client/ui/SoundPanel.tsx");
    expect(panel).toContain("{gm &&\n        SOUND_GROUPS.map(");
  });

  it("on a phone, where the top bar is already full, it's under More instead", async () => {
    const page = await source("src/client/ui/RoomPage.tsx");
    expect(page).toContain(`p.id === "sound" && "hide-phone"`);
    expect(page).toContain(`<button class="more-item show-phone" role="menuitem" onClick={pick(props.onSound)}>`);
    const css = await source("src/client/styles.css");
    expect(css).toMatch(/\.more-item\.show-phone \{\n  display: none;/);
    expect(css).toMatch(/@media \(max-width: 560px\) \{\n  \.icon-btn\.hide-phone \{\n    display: none;\n  \}\n  \.more-item\.show-phone \{\n    display: flex;/);
  });

  it("a table display plays nothing, and leaving the room stops it", async () => {
    const panel = await source("src/client/ui/SoundPanel.tsx");
    expect(panel).toContain("if (room.display) return;");
    expect(panel).toMatch(/\(\) => \(\) => \{\s+setRoomSounds\(\{\}\);\s+previewSound\(null\);/);
  });

  it("says so in What's new and the guide", () => {
    const news = GUIDE.find((s) => s.id === "whats-new")!;
    expect(news.intro).toContain("The latest updates came out on 6 November 2026.");
    const part = news.parts[1];
    expect(part.title).toContain("background sound");
    const words = [...part.steps, ...part.notes].join(" ");
    for (const label of ["**Sound**", "**Add**", "**Switch**", "**Stop all**", "**Your volume**"]) expect(words).toContain(label);
    const guide = GUIDE.find((s) => s.id === "sound")!;
    expect(guide.audience).toBe("everyone");
    const all = guide.parts.flatMap((p) => [...p.steps, ...p.notes]).join(" ");
    for (const s of SOUNDS) expect(all).toContain(s.name);
    expect(all).toContain("table display");
    const around = GUIDE.find((s) => s.id === "finding-your-way-around")!.parts.flatMap((p) => p.notes).join(" ");
    expect(around).toContain("**Sound**");
  });
});
