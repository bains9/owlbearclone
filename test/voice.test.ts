// Voice chat: what the table's voice chat (VoiceHub) passes on and to whom, TURN passwords,
// cleaning signals, the Room sending everyone to another room, and the browser side's push to
// talk and open microphone. The server pieces run here without the Workers runtime (bare
// objects with their fields set and fake sockets), and the browser side with a pretend
// microphone, window and server.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/shared/sanitize";
import type { Player } from "../src/shared/types";
import {
  MAX_SDP,
  MAX_VOICE,
  REPORT_BURST,
  RTC_BURST,
  STUN_ONLY,
  VOICE_BURST,
  VOICE_LOG_KEEP,
  browserOf,
  cleanReport,
  cleanSignal,
  usableIceServers,
} from "../src/shared/voice";
import type { IceServer, VoiceClientMsg, VoiceLogEntry, VoicePeer } from "../src/shared/voice";
import {
  DEFAULT_TALK_KEY,
  DISCONNECTED_MS,
  RETRY_MAX_MS,
  STUCK_MS,
  Voice,
  keyName,
  micError,
  routeFrom,
  voiceInitial,
  voiceMode,
} from "../src/client/room/voice";
import type { VoiceState } from "../src/client/room/voice";
import { GUIDE } from "../src/client/guide";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

interface Conn extends Player {
  sid: string;
  voice?: { muted: boolean };
  browser?: string;
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
  webSocketClose(ws: Sock, code?: number): Promise<void>;
  voiceLog(limit?: number): Promise<VoiceLogEntry[]>;
  env: Record<string, string>;
}

/** Just enough of a Durable Object's SQLite for the voice chat's record. */
function fakeSql() {
  const rows: { id: number; at: number; data: string }[] = [];
  let next = 1;
  return {
    rows,
    exec(q: string, ...args: unknown[]) {
      let out: unknown[] = [];
      if (q.startsWith("INSERT")) rows.push({ id: next++, at: args[0] as number, data: args[1] as string });
      else if (q.startsWith("DELETE")) {
        const cut = next - 1 - (args[0] as number);
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i].id <= cut) rows.splice(i, 1);
      } else if (q.startsWith("SELECT")) out = [...rows].sort((a, b) => b.id - a.id).slice(0, args[0] as number);
      return { toArray: () => out };
    },
  };
}

/** The browser side's pretend call. */
interface FakePc {
  tracks: unknown[];
  closed: boolean;
  connectionState: string;
  restarted: number;
  stats: object[];
  onconnectionstatechange: (() => void) | null;
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
    ctx: { getWebSockets: () => socks, storage: { sql: fakeSql() } },
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

  it("passes a whisper on to the one tab it's for and nobody else, the GM included", async () => {
    const [a, b, gm] = [sock(), sock(), sock({ role: "gm" })];
    const r = room([a, b, gm]);
    for (const s of [a, b, gm]) await say(r, s, { t: "voice", on: true });
    for (const s of [a, b, gm]) s.sent.length = 0;
    await say(r, a, { t: "rtc", to: b.conn.connId, d: { whisper: true, to: "everyone" } });
    expect(b.sent).toEqual([{ t: "rtc", from: a.conn.connId, d: { whisper: true } }]);
    await say(r, a, { t: "rtc", to: b.conn.connId, d: { whisper: "yes" } });
    await say(r, a, { t: "rtc", to: b.conn.connId, d: { whisper: false } });
    expect(b.sent.at(-1)).toEqual({ t: "rtc", from: a.conn.connId, d: { whisper: false } });
    expect(b.sent).toHaveLength(2);
    expect(gm.sent).toEqual([]);
    expect(a.sent).toEqual([]);
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

describe("the voice chat's record", () => {
  const up = (peer: string) => ({ kind: "up", peer, ms: 812.4, tries: 0, turn: true, local: "relay/udp", remote: "srflx/udp", mine: ["relay/udp", "host/udp", "relay/udp"], extra: 1 });

  it("keeps who joined (with their browser), each call's news with the other's name, who left and who lost their connection, newest first", async () => {
    const a = sock({ browser: "Chrome 131, Windows" });
    const b = sock();
    const r = room([a, b]);
    await say(r, a, { t: "voice", on: true });
    await say(r, b, { t: "voice", on: true });
    await say(r, a, { t: "voice.report", r: up(b.conn.connId) });
    await say(r, a, { t: "voice", on: false });
    await r.webSocketClose(b, 1006);
    const log = await r.voiceLog();
    expect(log.map((e) => e.ev)).toEqual(["gone", "leave", "call", "join", "join"]);
    expect(log[4]).toMatchObject({ ev: "join", who: a.conn.name, user: a.conn.userId, browser: "Chrome 131, Windows" });
    expect(log[2].call).toEqual({ kind: "up", peer: b.conn.connId, peerName: b.conn.name, ms: 812, tries: 0, turn: true, local: "relay/udp", remote: "srflx/udp", mine: ["host/udp", "relay/udp"] });
    expect(log[0]).toMatchObject({ ev: "gone", code: 1006, who: b.conn.name });
    expect(typeof log[0].at).toBe("number");
    expect(await r.voiceLog(2)).toHaveLength(2);
  });

  it("takes news only from a tab in voice, only real news, and not a flood", async () => {
    const a = sock();
    const b = sock();
    const r = room([a, b]);
    await say(r, a, { t: "voice.report", r: up(b.conn.connId) });
    expect(await r.voiceLog()).toEqual([]);
    await say(r, a, { t: "voice", on: true });
    await say(r, a, { t: "voice.report", r: { ...up(b.conn.connId), kind: "chatter" } });
    await say(r, a, { t: "voice.report", r: { ...up(b.conn.connId), ms: -1 } });
    await say(r, a, { t: "voice.report" });
    expect((await r.voiceLog()).map((e) => e.ev)).toEqual(["join"]);
    const c = sock();
    const r2 = room([c, b]);
    await say(r2, c, { t: "voice", on: true });
    for (let i = 0; i < REPORT_BURST + 10; i++) await say(r2, c, { t: "voice.report", r: up(b.conn.connId) });
    expect((await r2.voiceLog()).filter((e) => e.ev === "call")).toHaveLength(REPORT_BURST);
  });

  it(`keeps the newest ${VOICE_LOG_KEEP} entries`, async () => {
    const r = room([]);
    const add = (r as unknown as { record(c: null, e: { ev: string; error?: string }): void }).record.bind(r);
    for (let i = 0; i < VOICE_LOG_KEEP + 60; i++) add(null, { ev: "turn-failed", error: String(i) });
    const log = await r.voiceLog(VOICE_LOG_KEEP + 100);
    expect(log.length).toBeLessThanOrEqual(VOICE_LOG_KEEP + 50);
    expect(log.length).toBeGreaterThanOrEqual(VOICE_LOG_KEEP);
    expect(log[0].error).toBe(String(VOICE_LOG_KEEP + 59));
  });

  it("hands fresh relay passwords to a tab in voice that asks, and to nobody else, and notes when Cloudflare gives none", async () => {
    const env = { TURN_KEY_ID: "key-id", TURN_KEY_API_TOKEN: "token" };
    const answer = { iceServers: [{ urls: ["turns:turn.cloudflare.com:443?transport=tcp"], username: "u", credential: "c" }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(answer), { status: 201 })));
    const a = sock();
    const b = sock();
    const r = room([a, b], env);
    await say(r, a, { t: "voice", on: true });
    a.sent.length = 0;
    b.sent.length = 0;
    await say(r, a, { t: "voice.ice" });
    await say(r, b, { t: "voice.ice" });
    expect(a.sent).toEqual([{ t: "ice", servers: [STUN_ONLY[0], answer.iceServers[0]] }]);
    expect(b.sent).toEqual([]);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    const c = sock();
    const r2 = room([c], env);
    await say(r2, c, { t: "voice", on: true });
    expect((await r2.voiceLog()).map((e) => e.ev)).toEqual(["join", "turn-failed"]);
  });

  it("notes a tab that came back on a new connection while its old one was still in voice", async () => {
    const old = sock({ sid: "same", userId: "u-same", voice: { muted: false } });
    const fresh = sock({ sid: "same", userId: "u-same" });
    const r = room([old, fresh]);
    await say(r, fresh, { t: "voice", on: true });
    expect((await r.voiceLog()).map((e) => [e.ev, e.conn])).toEqual([
      ["join", fresh.conn.connId],
      ["replaced", old.conn.connId],
    ]);
  });
});

describe("a call's news, cleaned", () => {
  it("keeps what the record holds, rounded, and nothing else", () => {
    expect(cleanReport({ kind: "lost", peer: "abc", ms: 61_234.7, tries: 2, turn: true, local: "relay/tls", remote: "host/udp", theirs: ["srflx/udp", "bad route", 3], x: 1 })).toEqual({
      kind: "lost",
      peer: "abc",
      ms: 61_235,
      tries: 2,
      turn: true,
      local: "relay/tls",
      remote: "host/udp",
      theirs: ["srflx/udp"],
    });
    expect(cleanReport({ kind: "up", peer: "abc", ms: 5, tries: 0 })).toEqual({ kind: "up", peer: "abc", ms: 5, tries: 0, turn: false });
    expect(cleanReport({ kind: "up", peer: "abc", ms: 5, tries: 0, local: "<script>" })).toEqual({ kind: "up", peer: "abc", ms: 5, tries: 0, turn: false });
  });

  it("refuses what isn't news of a call", () => {
    for (const bad of [null, "up", {}, { kind: "nope", peer: "a", ms: 1, tries: 0 }, { kind: "up", peer: "", ms: 1, tries: 0 }, { kind: "up", peer: "a".repeat(33), ms: 1, tries: 0 }, { kind: "up", peer: "a", ms: Infinity, tries: 0 }, { kind: "up", peer: "a", ms: 1, tries: 1.5 }]) {
      expect(cleanReport(bad)).toBeNull();
    }
  });

  it("names the browser and system in a few words", () => {
    const cases: [string, string][] = [
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "Chrome 131, Windows"],
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.70", "Edge 131, Windows"],
      ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1", "Safari 17, iOS"],
      ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1", "Chrome 131, iOS"],
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0", "Firefox 133, Mac"],
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15", "Safari 18, Mac"],
      ["Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36", "Samsung Internet 26, Android"],
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9173 Chrome/128.0.6613.186 Electron/32.2.2 Safari/537.36", "Discord 1, Windows"],
      ["Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0", "Firefox 133, Linux"],
      ["", "another browser"],
    ];
    for (const [ua, want] of cases) expect(browserOf(ua)).toBe(want);
  });

  it("reads a call's route from its statistics, in Chrome's way and Firefox's", () => {
    const chrome = [
      { id: "T", type: "transport", selectedCandidatePairId: "P" },
      { id: "P", type: "candidate-pair", localCandidateId: "L1", remoteCandidateId: "R1", state: "succeeded" },
      { id: "L1", type: "local-candidate", candidateType: "relay", protocol: "udp", relayProtocol: "tls" },
      { id: "L2", type: "local-candidate", candidateType: "host", protocol: "udp" },
      { id: "L3", type: "local-candidate", candidateType: "srflx", protocol: "udp" },
      { id: "R1", type: "remote-candidate", candidateType: "srflx", protocol: "udp" },
      { id: "X", type: "outbound-rtp" },
    ];
    expect(routeFrom(chrome)).toEqual({ local: "relay/tls", remote: "srflx/udp", mine: ["host/udp", "relay/tls", "srflx/udp"], theirs: ["srflx/udp"] });
    const firefox = [
      { id: "P0", type: "candidate-pair", localCandidateId: "L2", remoteCandidateId: "R1", nominated: true, state: "failed" },
      { id: "P", type: "candidate-pair", localCandidateId: "L1", remoteCandidateId: "R1", selected: true },
      { id: "L1", type: "local-candidate", candidateType: "host", protocol: "udp" },
      { id: "L2", type: "local-candidate", candidateType: "relay", protocol: "udp" },
      { id: "R1", type: "remote-candidate", candidateType: "prflx", protocol: "udp" },
    ];
    expect(routeFrom(firefox)).toMatchObject({ local: "host/udp", remote: "prflx/udp" });
    // Not through yet: just what each end found.
    expect(routeFrom([{ id: "L", type: "local-candidate", candidateType: "host", protocol: "udp" }])).toEqual({ mine: ["host/udp"] });
  });
});

describe("cleaning signals and servers", () => {
  it("keeps an offer or answer and a route, and nothing else", () => {
    expect(cleanSignal({ sdp: { type: "answer", sdp: "v=0", x: 1 } })).toEqual({ sdp: { type: "answer", sdp: "v=0" } });
    expect(cleanSignal({ ice: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0, usernameFragment: "ab", y: 2 } })).toEqual({
      ice: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0, usernameFragment: "ab" },
    });
    expect(cleanSignal({ ice: { candidate: "c" } })).toEqual({ ice: { candidate: "c", sdpMid: null, sdpMLineIndex: null, usernameFragment: null } });
    // A whisper: yes or no, and nothing else rides along.
    expect(cleanSignal({ whisper: true, to: "everyone" })).toEqual({ whisper: true });
    expect(cleanSignal({ whisper: false })).toEqual({ whisper: false });
    for (const bad of [
      { whisper: "yes" },
      { whisper: 1 },
      { whisper: null },
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
    // Each call's own copy of the microphone, in the order the calls started.
    const clones: { enabled: boolean; stopped: boolean; stop(): void }[] = [];
    const track = {
      enabled: true,
      stopped: false,
      onended: null as null | (() => void),
      stop() {
        this.stopped = true;
      },
      clone() {
        const c = { enabled: true, stopped: false, stop() { this.stopped = true; } };
        clones.push(c);
        return c;
      },
    };
    const mic = { getAudioTracks: () => [track], getTracks: () => [track] };
    // Calls that connect only when a test says so: enough to see what each one carries and does.
    const pcs: FakePc[] = [];
    vi.stubGlobal(
      "RTCPeerConnection",
      class {
        tracks: unknown[] = [];
        closed = false;
        connectionState = "new";
        restarted = 0;
        stats: object[] = [];
        onconnectionstatechange: (() => void) | null = null;
        constructor() {
          pcs.push(this);
        }
        addTrack(t: unknown) {
          this.tracks.push(t);
        }
        setConfiguration() {}
        restartIce() {
          this.restarted++;
        }
        getStats() {
          return Promise.resolve({ forEach: (f: (s: object) => void) => this.stats.forEach((s) => f(s)) });
        }
        close() {
          this.closed = true;
        }
      },
    );
    Object.assign(target, {
      createElement: () => ({ autoplay: false, volume: 1, srcObject: null, paused: true, append() {}, remove() {}, play: () => Promise.resolve() }),
      body: { append() {} },
    });
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
    return { voice, track, clones, pcs, sent, toasts, key, get state() { return state; }, listeners };
  }

  const person = (connId: string, userId: string, name: string, role: "gm" | "player" = "player"): VoicePeer => ({ connId, userId, name, color: "#fff", role, muted: false });
  const me = person("me", "u0", "Me");
  const cora = person("j1", "uj", "Cora");
  const coraTablet = person("j2", "uj", "Cora");
  const wren = person("v1", "uv", "Wren", "gm");
  const flush = () => new Promise((r) => setTimeout(r, 0));

  /** A pretend call's connection changing, as the browser tells it. */
  const become = (pc: FakePc, s: string) => {
    pc.connectionState = s;
    pc.onconnectionstatechange?.();
  };
  const reports = (sent: VoiceClientMsg[]) => sent.flatMap((m) => (m.t === "voice.report" ? [m.r] : []));
  const relay: IceServer[] = [STUN_ONLY[0], { urls: ["turns:turn.example:443?transport=tcp"], username: "u", credential: "c" }];

  it("a call that drops looks for another route by itself, again and again, waiting longer each time, with fresh relay passwords", async () => {
    vi.useFakeTimers();
    const t = setup(false);
    await t.voice.join();
    t.voice.onIce(relay);
    t.voice.onPeers([me, cora]);
    const pc = t.pcs[0];
    pc.stats = [
      { id: "T", type: "transport", selectedCandidatePairId: "P" },
      { id: "P", type: "candidate-pair", localCandidateId: "L", remoteCandidateId: "R" },
      { id: "L", type: "local-candidate", candidateType: "relay", protocol: "udp", relayProtocol: "tls" },
      { id: "R", type: "remote-candidate", candidateType: "srflx", protocol: "udp" },
    ];
    t.sent.length = 0;
    await vi.advanceTimersByTimeAsync(1200);
    become(pc, "connected");
    await vi.advanceTimersByTimeAsync(0);
    expect(reports(t.sent)).toEqual([{ kind: "up", peer: "j1", ms: 1200, tries: 0, turn: true, local: "relay/tls", remote: "srflx/udp", mine: ["relay/tls"], theirs: ["srflx/udp"] }]);
    expect(t.state.links.j1).toBe("connected");

    // Cut off: it may come back by itself, so it waits a moment, then looks for another route.
    t.sent.length = 0;
    await vi.advanceTimersByTimeAsync(60_000);
    become(pc, "disconnected");
    await vi.advanceTimersByTimeAsync(0);
    expect(reports(t.sent)).toMatchObject([{ kind: "lost", ms: 60_000 }]);
    expect(t.state.links.j1).toBe("connecting");
    await vi.advanceTimersByTimeAsync(DISCONNECTED_MS - 1);
    expect(pc.restarted).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.sent.filter((m) => m.t === "voice.ice")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(pc.restarted).toBe(1);

    // No way through: each try waits twice as long, it shows as can't connect after three, and it keeps on.
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      become(pc, "failed");
      const before = pc.restarted;
      let waited = 0;
      while (pc.restarted === before) {
        await vi.advanceTimersByTimeAsync(500);
        waited += 500;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([2000, 4000, 8000, 16_000, RETRY_MAX_MS, RETRY_MAX_MS, RETRY_MAX_MS, RETRY_MAX_MS]);
    expect(t.state.links.j1).toBe("failed");
    // Fresh relay passwords at most once a minute.
    expect(t.sent.filter((m) => m.t === "voice.ice").length).toBeGreaterThan(1);
    expect(t.sent.filter((m) => m.t === "voice.ice").length).toBeLessThanOrEqual(Math.ceil((5_000 + 1000 + waits.reduce((a, b) => a + b)) / 60_000) + 1);

    t.sent.length = 0;
    become(pc, "connected");
    await vi.advanceTimersByTimeAsync(0);
    expect(reports(t.sent)).toMatchObject([{ kind: "back", tries: 9 }]);
    expect(t.state.links.j1).toBe("connected");
    // Connected again: no more tries.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(pc.restarted).toBe(9);
  });

  it("a call that never gets through tries again by itself, says so, and stops when it's gone", async () => {
    vi.useFakeTimers();
    const t = setup(false);
    await t.voice.join();
    t.voice.onPeers([me, cora]);
    const pc = t.pcs[0];
    t.sent.length = 0;
    await vi.advanceTimersByTimeAsync(STUCK_MS);
    expect(reports(t.sent)).toMatchObject([{ kind: "slow", peer: "j1", ms: STUCK_MS, tries: 0, turn: false }]);
    // Without relay passwords to renew, it doesn't ask for them.
    expect(t.sent.some((m) => m.t === "voice.ice")).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(pc.restarted).toBe(1);
    await vi.advanceTimersByTimeAsync(STUCK_MS + 2000);
    expect(pc.restarted).toBe(2);
    t.voice.onPeers([me]);
    expect(pc.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(pc.restarted).toBe(2);
  });

  it("whispering: only the chosen person's tabs hear it, only they're told, and everyone sees the microphone off", async () => {
    const t = setup(true);
    await t.voice.join();
    t.voice.onPeers([me, cora, coraTablet, wren]);
    expect(t.pcs).toHaveLength(3);
    expect(t.clones.map((c) => c.enabled)).toEqual([true, true, true]);
    t.sent.length = 0;
    t.voice.whisper("uj");
    expect(t.state.whisperTo).toEqual({ userId: "uj", name: "Cora" });
    expect(t.clones.map((c) => c.enabled)).toEqual([true, true, false]);
    // Your own meter still hears you, so the map shows you talking.
    expect(t.track.enabled).toBe(true);
    expect(t.sent).toEqual([
      { t: "voice", on: true, muted: true },
      { t: "rtc", to: "j1", d: { whisper: true } },
      { t: "rtc", to: "j2", d: { whisper: true } },
    ]);
    // Not to yourself, or to someone who isn't there.
    t.voice.whisper("u0");
    t.voice.whisper("nobody");
    expect(t.state.whisperTo?.userId).toBe("uj");
    // Someone joining meanwhile gets a silent call, and isn't told.
    t.sent.length = 0;
    const ula = person("t1", "ut", "Ula");
    t.voice.onPeers([me, cora, coraTablet, wren, ula]);
    expect(t.clones.at(-1)?.enabled).toBe(false);
    expect(t.sent).toEqual([]);
    // Cora leaves: nobody hears you, and it never goes back to everyone by itself.
    t.voice.onPeers([me, wren, ula]);
    expect(t.toasts.at(-1)).toBe("Cora left voice chat, so nobody hears you. Click Talk to everyone to be heard again.");
    expect(t.clones[0].stopped && t.clones[1].stopped).toBe(true);
    expect(t.clones.slice(2).map((c) => c.enabled)).toEqual([false, false]);
    expect(t.state.whisperTo?.userId).toBe("uj");
    expect(t.sent).toEqual([]);
    // Talk to everyone.
    t.voice.whisper(null);
    expect(t.clones.slice(2).map((c) => c.enabled)).toEqual([true, true]);
    expect(t.sent).toEqual([{ t: "voice", on: true, muted: false }]);
  });

  it("whispering with push to talk: the server never hears the key, and switching tells both people", async () => {
    const t = setup(false);
    await t.voice.join();
    t.voice.onPeers([me, cora, wren]);
    t.voice.whisper("uj");
    t.sent.length = 0;
    t.key("keydown", "ShiftLeft");
    expect(t.clones.map((c) => c.enabled)).toEqual([true, false]);
    t.key("keyup", "ShiftLeft");
    expect(t.clones.map((c) => c.enabled)).toEqual([false, false]);
    expect(t.sent).toEqual([]);
    t.voice.whisper("uv");
    expect(t.sent).toEqual([
      { t: "rtc", to: "j1", d: { whisper: false } },
      { t: "rtc", to: "v1", d: { whisper: true } },
    ]);
    // After a reconnect, the new calls are told again as they start.
    t.voice.onHello();
    t.sent.length = 0;
    t.voice.onPeers([me, cora, person("v9", "uv", "Wren", "gm")]);
    expect(t.sent).toContainEqual({ t: "rtc", to: "v9", d: { whisper: true } });
    expect(t.sent.filter((m) => m.t === "rtc" && m.to === "j1")).toEqual([]);
    // Leaving ends it.
    t.voice.leave();
    expect(t.state.whisperTo).toBeNull();
  });

  it("being whispered to: shown on this tab alone, and gone when they stop or leave", async () => {
    const t = setup(false);
    await t.voice.join();
    t.voice.onPeers([me, wren]);
    t.voice.onSignal("v1", { whisper: true });
    await flush();
    expect(t.state.whisperFrom).toEqual(["v1"]);
    t.voice.onSignal("v1", { whisper: false });
    await flush();
    expect(t.state.whisperFrom).toEqual([]);
    t.voice.onSignal("v1", { whisper: true });
    await flush();
    t.voice.onPeers([me]);
    expect(t.state.whisperFrom).toEqual([]);
  });

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
    const wren: VoicePeer = { connId: "x", userId: "ux", name: "Wren", color: "#fff", role: "player", muted: false };
    const pip: VoicePeer = { connId: "y", userId: "uy", name: "Pip", color: "#fff", role: "player", muted: false };
    // The first list, as the page connects.
    t.voice.onPeers([wren, pip]);
    expect(t.toasts).toEqual(["Wren and 1 more are in voice chat. Join from the Chat & dice panel."]);
    t.voice.onPeers([wren]);
    t.voice.onPeers([]);
    expect(t.toasts).toHaveLength(1);
    t.voice.onPeers([pip]);
    expect(t.toasts.at(-1)).toBe("Pip started voice chat. Join from the Chat & dice panel.");
    // A reconnect's first list isn't news.
    t.voice.onHello();
    t.voice.onPeers([pip]);
    expect(t.toasts).toHaveLength(2);
    // Nobody in voice as the page connected: the first one in started it.
    const u = setup(false);
    u.voice.onPeers([]);
    u.voice.onPeers([wren]);
    expect(u.toasts).toEqual(["Wren started voice chat. Join from the Chat & dice panel."]);
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
    expect(news.parts[46].title).toBe("Voice chat follows the group to other rooms (25 October 2026)");
    const entry = [...news.parts[46].steps, ...news.parts[46].notes].join("\n");
    for (const what of ["**Room settings**", "**Move the group**", "**Send everyone**", "carries on", "Table displays stay"]) expect(entry).toContain(what);
    const part = GUIDE.find((s) => s.id === "room-settings")?.parts.find((p) => p.title === "Move everyone to another room") ??
      GUIDE.flatMap((s) => s.parts).find((p) => p.title === "Move everyone to another room");
    expect(part?.steps.join(" ")).toContain("**Send everyone**");
  });
  const voice = GUIDE.find((s) => s.id === "voice")!;
  const all = (parts: { steps: string[]; notes: string[] }[]) => parts.flatMap((p) => [...p.steps, ...p.notes]).join("\n");

  it("has the microphone fix fourteenth in What's new, under the rooms and the dice, then voice chat", () => {
    expect(news.parts[48].title).toBe("Voice chat: the microphone works now (25 October 2026)");
    expect(all([news.parts[48]])).toContain("**Voice chat: Tabletop can't use your microphone**");
    expect(news.parts[49].title).toBe("Voice chat (24 October 2026)");
    const entry = all([news.parts[49]]);
    for (const what of ["**Join voice**", "**Left Shift**", "**Hold to talk**", "**Mute**", "top right of the map", "8 people", "headphones", "See **Voice chat**"]) {
      expect(entry).toContain(what);
    }
  });

  it("names only labels the panel really shows, and the default key by its name", async () => {
    const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
    const panel = await readFile(new URL("../src/client/ui/VoicePanel.tsx", import.meta.url), "utf8");
    const words = `${all(news.parts.slice(48, 50))}\n${all(voice.parts)}`;
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

  it("says how to whisper, that nobody else can tell, and that it never goes back to everyone by itself", () => {
    const part = voice.parts.find((p) => p.title === "Whisper to one person")!;
    const text = all([part]);
    for (const what of ["**Whisper**", "**whispering to you**", "**Talk to everyone**", "**Stop**", "the GM included", "never goes back to everyone by itself"]) {
      expect(text).toContain(what);
    }
  });

  it("has calls reconnecting by themselves second in What's new, and says what voice chat's record keeps, and never", () => {
    expect(news.parts[1].title).toBe("Voice chat reconnects by itself (15 November 2026)");
    for (const text of [all([news.parts[1]]), all(voice.parts)]) {
      for (const what of ["keeps trying", "Never what's said", `${VOICE_LOG_KEEP.toLocaleString("en")} entries`]) expect(text).toContain(what);
    }
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
