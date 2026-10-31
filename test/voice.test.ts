// Voice chat: what the table's voice chat (VoiceHub) passes on and to whom, TURN passwords,
// cleaning signals, the Room sending everyone to another room, and the browser side's push to
// talk and open microphone. The server pieces run here without the Workers runtime (bare
// objects with their fields set and fake sockets), and the browser side with a pretend
// microphone, window and server.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/shared/sanitize";
import type { Player } from "../src/shared/types";
import { MAX_SDP, MAX_VOICE, RTC_BURST, STUN_ONLY, VOICE_BURST, cleanSignal, usableIceServers } from "../src/shared/voice";
import type { IceServer, VoiceClientMsg, VoicePeer } from "../src/shared/voice";
import { DEFAULT_TALK_KEY, Voice, keyName, micError, voiceInitial, voiceMode } from "../src/client/room/voice";
import type { VoiceState } from "../src/client/room/voice";
import { GUIDE } from "../src/client/guide";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

interface Conn extends Player {
  sid: string;
  voice?: { muted: boolean };
}

interface Sent {
  t: string;
  peers?: VoicePeer[];
  servers?: IceServer[];
  from?: string;
  d?: { sdp?: { type: string; sdp: string; extra?: unknown }; ice?: unknown };
  message?: string;
}

interface Sock {
  conn: Conn;
  sent: Sent[];
  send(data: string): void;
  deserializeAttachment(): Conn;
  serializeAttachment(c: Conn): void;
}

interface RoomInside {
  webSocketMessage(ws: Sock, message: string): Promise<void>;
  webSocketClose(ws: Sock): Promise<void>;
  env: Record<string, string>;
}

let RoomClass: { prototype: object };
let HubClass: { prototype: object };

beforeAll(async () => {
  // Imported by a path tsc doesn't follow: the tests' types leave out the Workers runtime.
  const mod = (await import(/* @vite-ignore */ "../src/worker/" + "room")) as { Room: { prototype: object } };
  RoomClass = mod.Room;
  const hubMod = (await import(/* @vite-ignore */ "../src/worker/" + "voiceHub")) as { VoiceHub: { prototype: object } };
  HubClass = hubMod.VoiceHub;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

let n = 0;
function sock(over: Partial<Conn> = {}): Sock {
  n++;
  const conn: Conn = { connId: `conn${n}`, userId: `user${n}`, name: `P${n}`, color: "#4f9dde", role: "player", sid: `sid${n}`, ...over };
  const s: Sock = {
    conn,
    sent: [],
    send(data) {
      s.sent.push(JSON.parse(data) as Sent);
    },
    deserializeAttachment: () => s.conn,
    serializeAttachment(c) {
      s.conn = c;
    },
  };
  return s;
}

/** The table's voice chat with these sockets connected. */
function room(socks: Sock[], env: Record<string, string> = {}): RoomInside {
  const r = Object.create(HubClass.prototype) as RoomInside;
  Object.assign(r, {
    ctx: { getWebSockets: () => socks },
    env,
    limits: new Map(),
    joining: new Set(),
    ice: null,
    icePending: null,
  });
  return r;
}

/** A Room (not voice chat) whose GM's room list holds these rooms. */
function realRoom(socks: Sock[], rooms: { id: string; name: string }[]): RoomInside {
  const r = Object.create(RoomClass.prototype) as RoomInside;
  Object.assign(r, {
    sql: { exec: () => ({ toArray: () => [] }) },
    ctx: { storage: { transactionSync: (f: () => void) => f() }, getWebSockets: () => socks },
    env: { DIRECTORY: { getByName: () => ({ listRooms: async () => rooms }) } },
    info: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS } },
    sessionSeqs: new Map(),
  });
  return r;
}

const say = (r: RoomInside, s: Sock, msg: object) => r.webSocketMessage(s, JSON.stringify(msg));
const lastVoice = (s: Sock) => [...s.sent].reverse().find((m) => m.t === "voice");
const offer = { sdp: { type: "offer", sdp: "v=0\r\n" } };

describe("sending everyone to another room", () => {
  const crypt = { id: "Crypt0000001", name: "Crypt" };

  it("GM: every tab but table displays is sent there, with the room's name", async () => {
    const [gm, a, display] = [sock({ role: "gm" }), sock(), sock({ display: true })];
    const r = realRoom([gm, a, display], [crypt]);
    await say(r, gm, { t: "room.goto", to: crypt.id, seq: 1 });
    for (const s of [gm, a]) expect(s.sent.find((m) => m.t === "goto")).toEqual({ t: "goto", room: crypt });
    expect(display.sent.some((m) => m.t === "goto")).toBe(false);
  });

  it("only the GM, and only to another room that exists", async () => {
    const [gm, a] = [sock({ role: "gm" }), sock()];
    const r = realRoom([gm, a], [crypt]);
    await say(r, a, { t: "room.goto", to: crypt.id, seq: 1 });
    expect(a.sent.find((m) => m.t === "error")?.message).toBe("Only the GM can do that.");
    await say(r, gm, { t: "room.goto", to: "Gone00000001", seq: 1 });
    await say(r, gm, { t: "room.goto", to: "AbCdEf123456", seq: 2 });
    expect(gm.sent.filter((m) => m.t === "error").map((m) => m.message)).toEqual(["That room isn't there any more.", "That room isn't there any more."]);
    expect([...gm.sent, ...a.sent].some((m) => m.t === "goto")).toBe(false);
  });
});

describe("the table's voice chat", () => {
  it("hands a joining tab the STUN server, and tells everyone connected who's in voice", async () => {
    const [a, b] = [sock(), sock()];
    const r = room([a, b]);
    await say(r, a, { t: "voice", on: true });
    expect(a.sent.find((m) => m.t === "ice")?.servers).toEqual(STUN_ONLY);
    expect(a.conn.voice).toEqual({ muted: false });
    expect(lastVoice(b)?.peers).toEqual([{ connId: a.conn.connId, userId: a.conn.userId, name: a.conn.name, color: a.conn.color, role: "player", muted: false }]);
  });

  it("says when someone mutes, not when nothing changed, and when they leave", async () => {
    const [a, b] = [sock(), sock()];
    const r = room([a, b]);
    await say(r, a, { t: "voice", on: true, muted: true });
    expect(lastVoice(b)?.peers?.[0].muted).toBe(true);
    b.sent.length = 0;
    await say(r, a, { t: "voice", on: true, muted: true });
    expect(b.sent).toEqual([]);
    await say(r, a, { t: "voice", on: true, muted: false });
    expect(lastVoice(b)?.peers?.[0].muted).toBe(false);
    expect(a.sent.filter((m) => m.t === "ice")).toHaveLength(1);
    await say(r, a, { t: "voice", on: false });
    expect(a.conn.voice).toBeUndefined();
    expect(lastVoice(b)?.peers).toEqual([]);
    // Leaving twice says nothing more.
    b.sent.length = 0;
    await say(r, a, { t: "voice", on: false });
    expect(b.sent).toEqual([]);
  });

  it("passes signals only between two tabs in voice, cleaned, and never to the sender", async () => {
    const [a, b, out] = [sock(), sock(), sock()];
    const r = room([a, b, out]);
    await say(r, a, { t: "voice", on: true });
    await say(r, b, { t: "voice", on: true });
    for (const s of [a, b, out]) s.sent.length = 0;
    await say(r, a, { t: "rtc", to: b.conn.connId, d: { sdp: { ...offer.sdp, extra: 1 }, junk: true } });
    expect(b.sent).toEqual([{ t: "rtc", from: a.conn.connId, d: offer }]);
    await say(r, a, { t: "rtc", to: out.conn.connId, d: offer });
    await say(r, out, { t: "rtc", to: a.conn.connId, d: offer });
    await say(r, a, { t: "rtc", to: a.conn.connId, d: offer });
    await say(r, a, { t: "rtc", to: b.conn.connId, d: { sdp: { type: "pranswer", sdp: "x" } } });
    await say(r, a, { t: "rtc", to: 42, d: offer });
    expect(out.sent).toEqual([]);
    expect(a.sent).toEqual([]);
    expect(b.sent).toHaveLength(1);
  });

  it("drops a flood of signals from one tab", async () => {
    const [a, b] = [sock(), sock()];
    const r = room([a, b]);
    await say(r, a, { t: "voice", on: true });
    await say(r, b, { t: "voice", on: true });
    b.sent.length = 0;
    for (let i = 0; i < RTC_BURST + 50; i++) await say(r, a, { t: "rtc", to: b.conn.connId, d: offer });
    expect(b.sent).toHaveLength(RTC_BURST);
  });

  it(`takes ${MAX_VOICE} tabs at a time, and tells the next one it's full`, async () => {
    const socks = Array.from({ length: MAX_VOICE + 1 }, () => sock());
    const r = room(socks);
    for (const s of socks) await say(r, s, { t: "voice", on: true });
    const last = socks[MAX_VOICE];
    expect(last.conn.voice).toBeUndefined();
    expect(last.sent.find((m) => m.t === "voice.refused")?.message).toContain(String(MAX_VOICE));
    expect(last.sent.some((m) => m.t === "ice")).toBe(false);
    expect(lastVoice(last)?.peers).toHaveLength(MAX_VOICE);
  });

  it("takes a closed tab out of voice chat", async () => {
    const [a, b] = [sock(), sock()];
    const socks = [a, b];
    const r = room(socks);
    await say(r, a, { t: "voice", on: true });
    await say(r, b, { t: "voice", on: true });
    await r.webSocketClose(a);
    expect(lastVoice(b)?.peers?.map((p) => p.connId)).toEqual([b.conn.connId]);
  });

  it("tells everyone a new name in voice chat", async () => {
    const [a, b] = [sock(), sock()];
    const r = room([a, b]);
    await say(r, a, { t: "voice", on: true });
    await say(r, a, { t: "profile", name: "Renamed", color: "#ff0000" });
    expect(lastVoice(b)?.peers?.[0]).toMatchObject({ name: "Renamed", color: "#ff0000" });
  });

  it("counts signals for each pair, so a flood at one tab doesn't stop its calls to the others", async () => {
    const [a, b, c] = [sock(), sock(), sock()];
    const r = room([a, b, c]);
    for (const s of [a, b, c]) await say(r, s, { t: "voice", on: true });
    for (let i = 0; i < RTC_BURST + 10; i++) await say(r, b, { t: "rtc", to: a.conn.connId, d: offer });
    c.sent.length = 0;
    await say(r, a, { t: "rtc", to: c.conn.connId, d: offer });
    expect(c.sent).toHaveLength(1);
  });

  it("drops joins and mute changes past what a person could mean, but always lets a tab leave", async () => {
    const [a, b] = [sock(), sock()];
    const r = room([a, b]);
    await say(r, a, { t: "voice", on: true });
    for (let i = 0; i < VOICE_BURST + 20; i++) await say(r, a, { t: "voice", on: true, muted: i % 2 === 0 });
    // The join and the changes after it, up to the limit, each told everyone.
    expect(b.sent.filter((m) => m.t === "voice")).toHaveLength(VOICE_BURST);
    await say(r, a, { t: "voice", on: false });
    expect(a.conn.voice).toBeUndefined();
  });

  it("always lets the GM in, marked as the GM", async () => {
    const socks = Array.from({ length: MAX_VOICE }, () => sock());
    const gm = sock({ role: "gm" });
    const r = room([...socks, gm]);
    for (const s of socks) await say(r, s, { t: "voice", on: true });
    await say(r, gm, { t: "voice", on: true });
    expect(gm.conn.voice).toEqual({ muted: false });
    expect(lastVoice(socks[0])?.peers?.map((p) => p.role)).toEqual([...socks.map(() => "player"), "gm"]);
  });

  it("takes a reconnected tab's old connection out of voice as it joins again, so it isn't in twice", async () => {
    const old = sock({ sid: "tabsid", userId: "same" });
    const fresh = sock({ sid: "tabsid", userId: "same" });
    const other = sock();
    const r = room([old, fresh, other]);
    await say(r, old, { t: "voice", on: true });
    await say(r, fresh, { t: "voice", on: true });
    expect(old.conn.voice).toBeUndefined();
    expect(lastVoice(other)?.peers?.map((p) => p.connId)).toEqual([fresh.conn.connId]);
  });

  it("does nothing with what isn't one of its messages", async () => {
    const [a, b] = [sock(), sock()];
    const r = room([a, b]);
    await say(r, a, { t: "items", seq: 1, upsert: [] });
    await say(r, a, { t: "chat", text: "hi" });
    await r.webSocketMessage(a, "not json");
    expect([...a.sent, ...b.sent]).toEqual([]);
  });

  describe("TURN", () => {
    const env = { TURN_KEY_ID: "key-id", TURN_KEY_API_TOKEN: "token" };
    const answer = {
      iceServers: [
        { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
        {
          urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"],
          username: "u",
          credential: "c",
        },
      ],
    };

    it("asks Cloudflare once for passwords, leaves out port 53, and reuses them", async () => {
      const fetch = vi.fn(async () => new Response(JSON.stringify(answer), { status: 201 }));
      vi.stubGlobal("fetch", fetch);
      const [a, b] = [sock(), sock()];
      const r = room([a, b], env);
      await say(r, a, { t: "voice", on: true });
      await say(r, b, { t: "voice", on: true });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://rtc.live.cloudflare.com/v1/turn/keys/key-id/credentials/generate-ice-servers");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token");
      expect(JSON.parse(init.body as string)).toEqual({ ttl: 4 * 3600 });
      const servers = a.sent.find((m) => m.t === "ice")?.servers;
      expect(servers).toEqual([
        { urls: ["stun:stun.cloudflare.com:3478"] },
        { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "u", credential: "c" },
      ]);
      expect(b.sent.find((m) => m.t === "ice")?.servers).toEqual(servers);
    });

    it("falls back to STUN when Cloudflare fails, and asks again a minute later", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const fetch = vi.fn(async () => new Response("nope", { status: 500 }));
      vi.stubGlobal("fetch", fetch);
      vi.spyOn(console, "error").mockImplementation(() => {});
      const [a, b, c] = [sock(), sock(), sock()];
      const r = room([a, b, c], env);
      await say(r, a, { t: "voice", on: true });
      await say(r, b, { t: "voice", on: true });
      expect(a.sent.find((m) => m.t === "ice")?.servers).toEqual(STUN_ONLY);
      expect(fetch).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + 61_000);
      await say(r, c, { t: "voice", on: true });
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("asks again once an hour is up", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const fetch = vi.fn(async () => new Response(JSON.stringify(answer)));
      vi.stubGlobal("fetch", fetch);
      const [a, b, c] = [sock(), sock(), sock()];
      const r = room([a, b, c], env);
      await say(r, a, { t: "voice", on: true });
      vi.setSystemTime(Date.now() + 3_599_000);
      await say(r, b, { t: "voice", on: true });
      expect(fetch).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + 2_000);
      await say(r, c, { t: "voice", on: true });
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("doesn't put a tab in voice that left while the passwords were on the way, and joins meanwhile share one request", async () => {
      let release!: () => void;
      const fetch = vi.fn(() => new Promise<Response>((res) => (release = () => res(new Response(JSON.stringify(answer))))));
      vi.stubGlobal("fetch", fetch);
      const [a, b] = [sock(), sock()];
      const r = room([a, b], env);
      const aJoins = say(r, a, { t: "voice", on: true });
      const bJoins = say(r, b, { t: "voice", on: true, muted: true });
      await say(r, a, { t: "voice", on: false });
      release();
      await Promise.all([aJoins, bJoins]);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(a.conn.voice).toBeUndefined();
      expect(a.sent.some((m) => m.t === "ice")).toBe(false);
      expect(b.conn.voice).toEqual({ muted: true });
      expect(lastVoice(a)?.peers?.map((p) => p.connId)).toEqual([b.conn.connId]);
    });

    it("doesn't put a tab in voice that closed while the passwords were on the way", async () => {
      let release!: () => void;
      vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((res) => (release = () => res(new Response(JSON.stringify(answer)))))));
      const [a, b] = [sock(), sock()];
      const socks = [a, b];
      const r = room(socks, env);
      const joining = say(r, a, { t: "voice", on: true });
      await Promise.resolve();
      socks.splice(0, 1);
      release();
      await joining;
      expect(a.conn.voice).toBeUndefined();
      expect(b.sent.filter((m) => m.t === "voice")).toEqual([]);
    });
  });
});

describe("cleaning signals and servers", () => {
  it("keeps an offer or answer and a route, and nothing else", () => {
    expect(cleanSignal({ sdp: { type: "answer", sdp: "v=0", x: 1 } })).toEqual({ sdp: { type: "answer", sdp: "v=0" } });
    expect(cleanSignal({ ice: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0, usernameFragment: "ab", y: 2 } })).toEqual({
      ice: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0, usernameFragment: "ab" },
    });
    expect(cleanSignal({ ice: { candidate: "c" } })).toEqual({ ice: { candidate: "c", sdpMid: null, sdpMLineIndex: null, usernameFragment: null } });
    for (const bad of [
      null,
      "x",
      {},
      { sdp: null },
      { sdp: { type: "rollback", sdp: "x" } },
      { sdp: { type: "offer", sdp: "" } },
      { sdp: { type: "offer", sdp: "x".repeat(MAX_SDP + 1) } },
      { ice: null },
      { ice: { candidate: 5 } },
      { ice: { candidate: "c", sdpMLineIndex: 1.5 } },
      { ice: { candidate: "c", sdpMLineIndex: -1 } },
      { ice: { candidate: "c", sdpMid: 3 } },
      { ice: { candidate: "x".repeat(2000) } },
    ]) {
      expect(cleanSignal(bad), JSON.stringify(bad)?.slice(0, 60)).toBeNull();
    }
  });

  it("takes a list or a single server, and leaves out a relay without its password", () => {
    expect(usableIceServers({ urls: "stun:a:3478" })).toEqual([{ urls: ["stun:a:3478"] }]);
    expect(usableIceServers([{ urls: ["turn:a:3478"] }, { urls: ["http://x"] }, null, { urls: [] }])).toEqual([]);
    expect(usableIceServers("nope")).toEqual([]);
  });
});

describe("the browser side", () => {
  it("names keys as people know them", () => {
    expect(DEFAULT_TALK_KEY).toBe("ShiftLeft");
    expect(keyName("ShiftLeft")).toBe("Left Shift");
    expect(keyName("ControlRight")).toBe("Right Ctrl");
    expect(keyName("KeyT")).toBe("T");
    expect(keyName("Digit5")).toBe("5");
    expect(keyName("Numpad0")).toBe("Numpad 0");
    expect(keyName("Space")).toBe("Space");
    expect(keyName("Backquote")).toBe("`");
    expect(keyName("F2")).toBe("F2");
    expect(keyName("PageDown")).toBe("Page Down");
  });

  it("explains a microphone that won't open", () => {
    expect(micError({ name: "NotAllowedError" })).toContain("isn't allowed to use your microphone");
    expect(micError({ name: "NotFoundError" })).toContain("No microphone was found");
    expect(micError({ name: "NotReadableError" })).toContain("Another app");
    expect(micError(new Error("x"))).toBe("Your microphone couldn't be started.");
  });

  it("starts the GM with an open microphone and players with push to talk", () => {
    const v = voiceInitial();
    expect(v.mode).toBeNull();
    expect(voiceMode(v, true)).toBe("open");
    expect(voiceMode(v, false)).toBe("ptt");
    expect(voiceMode({ ...v, mode: "open" }, false)).toBe("open");
    expect(v.talkKey).toBe(DEFAULT_TALK_KEY);
  });

  /** A Voice with a pretend microphone, window and server: what it sent, and its microphone. */
  function setup(gm: boolean) {
    const listeners = new Map<string, Set<(e: unknown) => void>>();
    const target = {
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: (e: unknown) => void) => listeners.get(type)?.delete(fn),
    };
    const track = { enabled: true, stopped: false, onended: null as null | (() => void), stop() { this.stopped = true; } };
    const mic = { getAudioTracks: () => [track], getTracks: () => [track] };
    vi.stubGlobal("window", target);
    vi.stubGlobal("document", target);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => mic } });
    let state: VoiceState = voiceInitial();
    const sent: VoiceClientMsg[] = [];
    const toasts: string[] = [];
    const voice = new Voice({
      get: () => state,
      set: (p) => {
        state = { ...state, ...p };
      },
      myId: () => "me",
      isGm: () => gm,
      send: (m) => {
        sent.push(m);
        return true;
      },
      toast: (t) => toasts.push(t),
    });
    const key = (type: "keydown" | "keyup", code: string, extra: Record<string, unknown> = {}) => {
      const e = { type, code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: null, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...extra };
      for (const fn of listeners.get(type) ?? []) fn(e);
      return e;
    };
    return { voice, track, sent, toasts, key, get state() { return state; }, listeners };
  }

  it("push to talk: silent until the key is held, typing in a box never talks, and letting go is silent again", async () => {
    const t = setup(false);
    await t.voice.join();
    expect(t.state.status).toBe("on");
    expect(t.track.enabled).toBe(false);
    expect(t.sent).toEqual([{ t: "voice", on: true, muted: true }]);
    t.key("keydown", "ShiftLeft", { target: { tagName: "INPUT", isContentEditable: false } });
    expect(t.track.enabled).toBe(false);
    t.key("keydown", "ShiftLeft");
    expect(t.track.enabled).toBe(true);
    expect(t.sent.at(-1)).toEqual({ t: "voice", on: true, muted: false });
    const repeats = t.sent.length;
    t.key("keydown", "ShiftLeft", { repeat: true });
    expect(t.sent).toHaveLength(repeats);
    t.key("keyup", "ShiftLeft");
    expect(t.track.enabled).toBe(false);
    expect(t.sent.at(-1)).toEqual({ t: "voice", on: true, muted: true });
    // Another key talks only, ahead of the map's shortcuts.
    t.voice.setTalkKey("KeyV");
    const down = t.key("keydown", "KeyV");
    expect(down.prevented).toBe(true);
    expect(t.track.enabled).toBe(true);
    // The page losing the keyboard lets go.
    for (const fn of t.listeners.get("blur") ?? []) fn({});
    expect(t.track.enabled).toBe(false);
    t.voice.leave();
    expect(t.sent.at(-1)).toEqual({ t: "voice", on: false });
    expect(t.track.stopped).toBe(true);
    expect(t.listeners.get("keydown")?.size).toBe(0);
  });

  it("an open microphone (the GM): on at once, Mute turns it off, and the key does nothing", async () => {
    const t = setup(true);
    await t.voice.join();
    expect(t.track.enabled).toBe(true);
    expect(t.sent).toEqual([{ t: "voice", on: true, muted: false }]);
    t.key("keydown", "ShiftLeft");
    expect(t.sent).toHaveLength(1);
    t.voice.setMuted(true);
    expect(t.track.enabled).toBe(false);
    expect(t.sent.at(-1)).toEqual({ t: "voice", on: true, muted: true });
    t.voice.setMode("ptt");
    expect(t.track.enabled).toBe(false);
    t.key("keydown", "ShiftLeft");
    expect(t.track.enabled).toBe(true);
  });

  it("talks from a checkbox or a slider (they keep the focus after a click), never from a text box", async () => {
    const t = setup(false);
    await t.voice.join();
    const box = (type?: string) => ({ tagName: "INPUT", type, isContentEditable: false });
    for (const target of [box("text"), box(), box("search"), { tagName: "TEXTAREA", isContentEditable: false }, { tagName: "DIV", isContentEditable: true }]) {
      t.key("keydown", "ShiftLeft", { target });
      expect(t.track.enabled, JSON.stringify(target)).toBe(false);
    }
    for (const target of [box("checkbox"), box("range"), box("button")]) {
      t.key("keydown", "ShiftLeft", { target });
      expect(t.track.enabled, JSON.stringify(target)).toBe(true);
      t.key("keyup", "ShiftLeft");
    }
  });

  it("leaves Shift (and Ctrl, Alt, Cmd) doing their jobs, takes no Ctrl+key, and lets go when the page is hidden", async () => {
    const t = setup(false);
    await t.voice.join();
    const shift = t.key("keydown", "ShiftLeft");
    expect(shift.prevented).toBe(false);
    expect(t.voice.shiftTalks()).toBe(true);
    for (const fn of t.listeners.get("visibilitychange") ?? []) fn({});
    expect(t.track.enabled).toBe(false);
    expect(t.voice.shiftTalks()).toBe(false);
    t.voice.setTalkKey("KeyV");
    t.key("keydown", "KeyV", { ctrlKey: true });
    expect(t.track.enabled).toBe(false);
    // On a Mac, a key let go while Cmd is down sends no key-up: Cmd's lets go instead.
    t.key("keydown", "KeyV");
    expect(t.track.enabled).toBe(true);
    t.key("keyup", "MetaLeft", { key: "Meta" });
    expect(t.track.enabled).toBe(false);
  });

  it("won't take Esc or Caps Lock as the key", () => {
    const t = setup(false);
    t.voice.setTalkKey("CapsLock");
    t.voice.setTalkKey("Escape");
    t.voice.setTalkKey("");
    expect(t.state.talkKey).toBe(DEFAULT_TALK_KEY);
    t.voice.setTalkKey("Backquote");
    expect(t.state.talkKey).toBe("Backquote");
  });

  it("asking for the microphone again while the server still has an old join: says it's out, so the real join is news", async () => {
    const t = setup(false);
    t.state.status; // starts off
    const me: VoicePeer = { connId: "me", userId: "u", name: "Me", color: "#fff", role: "player", muted: true };
    // As if Join was clicked and the browser is still asking.
    (t.voice as unknown as { host: { set(p: Partial<VoiceState>): void } }).host.set({ status: "starting" });
    t.voice.onPeers([me]);
    expect(t.sent).toEqual([{ t: "voice", on: false }]);
  });

  it("held-back sound waits for the next click or key press anywhere, then tries again", async () => {
    const t = setup(false);
    await t.voice.join();
    (t.voice as unknown as { setHeld(h: boolean): void }).setHeld(true);
    expect(t.state.blocked).toBe(true);
    expect(t.listeners.get("pointerdown")?.size).toBe(1);
    for (const fn of t.listeners.get("pointerdown") ?? []) fn({});
    await new Promise((r) => setTimeout(r, 0));
    expect(t.state.blocked).toBe(false);
    expect(t.listeners.get("pointerdown")?.size).toBe(0);
    expect(t.listeners.get("keydown")?.size).toBe(1); // push to talk's own
  });

  it("a refusal (voice chat full) turns it all off and says why", async () => {
    const t = setup(false);
    await t.voice.join();
    t.voice.onRefused("Voice chat is full: it takes 8 people at a time.");
    expect(t.state.status).toBe("off");
    expect(t.track.stopped).toBe(true);
    expect(t.toasts.at(-1)).toContain("full");
  });

  it("rejoins after a reconnect, and leaves again if the server still has it after it left", async () => {
    const t = setup(false);
    await t.voice.join();
    t.sent.length = 0;
    t.voice.onHello();
    expect(t.sent).toEqual([{ t: "voice", on: true, muted: true }]);
    t.voice.leave();
    t.sent.length = 0;
    const me: VoicePeer = { connId: "me", userId: "u", name: "Me", color: "#fff", role: "player", muted: true };
    t.voice.onPeers([me]);
    expect(t.sent).toEqual([{ t: "voice", on: false }]);
  });

  it("tells someone not in voice that it's on as the page connects, and when it starts, but not again on a reconnect", () => {
    const t = setup(false);
    const vern: VoicePeer = { connId: "x", userId: "ux", name: "Vern", color: "#fff", role: "player", muted: false };
    const par: VoicePeer = { connId: "y", userId: "uy", name: "Par", color: "#fff", role: "player", muted: false };
    // The first list, as the page connects.
    t.voice.onPeers([vern, par]);
    expect(t.toasts).toEqual(["Vern and 1 more are in voice chat. Join from the Chat & dice panel."]);
    t.voice.onPeers([vern]);
    t.voice.onPeers([]);
    expect(t.toasts).toHaveLength(1);
    t.voice.onPeers([par]);
    expect(t.toasts.at(-1)).toBe("Par started voice chat. Join from the Chat & dice panel.");
    // A reconnect's first list isn't news.
    t.voice.onHello();
    t.voice.onPeers([par]);
    expect(t.toasts).toHaveLength(2);
    // Nobody in voice as the page connected: the first one in started it.
    const u = setup(false);
    u.voice.onPeers([]);
    u.voice.onPeers([vern]);
    expect(u.toasts).toEqual(["Vern started voice chat. Join from the Chat & dice panel."]);
  });
});

describe("the site's headers", () => {
  it("let this site's own pages use the microphone, and nothing else (camera and location stay off)", async () => {
    const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
    const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
    expect(/Permissions-Policy:\s*(.+)/.exec(headers)?.[1].trim()).toBe("camera=(), microphone=(self), geolocation=()");
  });
});

describe("the guide", () => {
  const news = GUIDE.find((s) => s.id === "whats-new")!;

  it("has voice chat following the group twelfth in What's new, under the Build tool's library, maps from Dungeon, Dungeon's sign-in and extending maps, and says how to move it", () => {
    expect(news.parts[12].title).toBe("Voice chat follows the group to other rooms (25 October 2026)");
    const entry = [...news.parts[12].steps, ...news.parts[12].notes].join("\n");
    for (const what of ["**Room settings**", "**Move the group**", "**Send everyone**", "carries on", "Table displays stay"]) expect(entry).toContain(what);
    const part = GUIDE.find((s) => s.id === "room-settings")?.parts.find((p) => p.title === "Move everyone to another room") ??
      GUIDE.flatMap((s) => s.parts).find((p) => p.title === "Move everyone to another room");
    expect(part?.steps.join(" ")).toContain("**Send everyone**");
  });
  const voice = GUIDE.find((s) => s.id === "voice")!;
  const all = (parts: { steps: string[]; notes: string[] }[]) => parts.flatMap((p) => [...p.steps, ...p.notes]).join("\n");

  it("has the microphone fix fourteenth in What's new, under the rooms and the dice, then voice chat", () => {
    expect(news.parts[14].title).toBe("Voice chat: the microphone works now (25 October 2026)");
    expect(all([news.parts[14]])).toContain("**Voice chat: Tabletop can't use your microphone**");
    expect(news.parts[15].title).toBe("Voice chat (24 October 2026)");
    const entry = all([news.parts[15]]);
    for (const what of ["**Join voice**", "**Left Shift**", "**Hold to talk**", "**Mute**", "top right of the map", "8 people", "headphones", "See **Voice chat**"]) {
      expect(entry).toContain(what);
    }
  });

  it("names only labels the panel really shows, and the default key by its name", async () => {
    const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
    const panel = await readFile(new URL("../src/client/ui/VoicePanel.tsx", import.meta.url), "utf8");
    const words = `${all(news.parts.slice(14, 16))}\n${all(voice.parts)}`;
    const labels = [...new Set(words.match(/\*\*[^*]+\*\*/g) ?? [])].map((b) => b.slice(2, -2));
    expect(labels.length).toBeGreaterThan(10);
    // Keys, the panel itself, and labels built from the key or the name: checked below.
    const elsewhere = new Set(["Chat & dice", "Voice chat", "Left Shift", "Shift", "Esc", "Hold to talk (Left Shift)", "You",
      // Guide pages the fix points to.
      "Troubleshooting", "Voice chat: Tabletop can't use your microphone"]);
    expect(labels.filter((l) => !elsewhere.has(l) && !panel.includes(l))).toEqual([]);
    expect(panel).toContain('`Hold to talk (${key})`');
    expect(panel).toContain('"You"');
    expect(keyName(DEFAULT_TALK_KEY)).toBe("Left Shift");
  });

  it("has a Voice chat section saying what the panel says, and a Troubleshooting entry", () => {
    expect(voice.title).toBe("Voice chat");
    const text = all(voice.parts);
    for (const what of ["**Join voice**", "**Leave**", "**Left Shift**", "**Hold to talk**", "**Push to talk**", "**Change**", "**Key:**", "**Mute**", "**Unmute**", "**You**", "slider", "iPhone"]) {
      expect(text).toContain(what);
    }
    expect(voice.intro).toContain(`${MAX_VOICE} people`);
    const troubleshooting = GUIDE.find((s) => s.id === "troubleshooting")!.parts;
    const trouble = troubleshooting.find((p) => p.title.startsWith("Voice chat: you can't hear"));
    expect(all([trouble!])).toContain("**can't connect**");
    const mic = troubleshooting.find((p) => p.title === "Voice chat: Tabletop can't use your microphone");
    expect(all([mic!])).toContain("sudo snap connect firefox:audio-record");
  });
});
