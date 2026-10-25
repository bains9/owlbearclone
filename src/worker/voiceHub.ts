// The table's voice chat: one for all the GM's rooms, so the group keeps talking when the GM
// moves the game to another room. Each browser tab holds a WebSocket to it alongside its
// room's; the Worker lets one in only with the id of a room that exists (index.ts), so it
// takes a room link to join, as it does to join a room.
//
// The talking goes straight between browsers (WebRTC, shared/voice.ts): this only says who's
// in voice, passes on the messages that set calls up, and hands out STUN and TURN servers.

import { DurableObject } from "cloudflare:workers";
import { randomId } from "../shared/ids";
import { GM_OWNER, LIMITS, cleanColor, cleanText, isId } from "../shared/sanitize";
import type { Role } from "../shared/types";
import { MAX_VOICE, RTC_BURST, RTC_WINDOW_MS, STUN_ONLY, VOICE_BURST, cleanSignal, usableIceServers } from "../shared/voice";
import type { IceServer, VoiceClientMsg, VoicePeer, VoiceServerMsg } from "../shared/voice";

/** What a WebSocket carries: the person, their browser tab, and whether they're in voice. */
interface Conn {
  connId: string;
  userId: string;
  name: string;
  color: string;
  role: Role;
  /** The browser tab (never shown to anyone): a tab that reconnects keeps it. */
  sid: string;
  /** The room the tab is in: deleting it takes the tab off voice chat (roomDeleted). */
  room: string;
  /** In voice chat, and whether its microphone is muted. */
  voice?: { muted: boolean };
}

/**
 * Worker secrets that turn on TURN (a relay for networks that block a direct call): a TURN
 * key made in Cloudflare's dashboard (Realtime › TURN Server), and its API token. Without
 * them voice chat uses STUN only, which works on most home networks.
 */
interface TurnEnv {
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

/**
 * How long TURN passwords last, and how long one set is handed out (so every set has hours
 * left). Short, because anyone with a room link can join voice chat and get them, and they
 * relay anything until they run out.
 */
const TURN_TTL_S = 4 * 3_600;
const TURN_REUSE_MS = 3_600_000;
/** After Cloudflare fails to answer, how long to use STUN only before asking again. */
const TURN_RETRY_MS = 60_000;

export class VoiceHub extends DurableObject<Env> {
  /** Voice chat's limits (allowed): what each connection sent in its current window. */
  private limits = new Map<string, { start: number; n: number }>();
  /** Tabs whose join is waiting for TURN passwords: a leave meanwhile takes them out. */
  private joining = new Set<WebSocket>();
  /** The STUN and TURN servers handed to tabs joining voice, until they're due for renewal. */
  private ice: { servers: IceServer[]; until: number } | null = null;
  private icePending: Promise<IceServer[]> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** A tab connecting. The Worker has checked its room id and set X-Tabletop-Role from the GM cookie. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket upgrade.", { status: 426 });
    const url = new URL(request.url);
    const role: Role = request.headers.get("X-Tabletop-Role") === "gm" ? "gm" : "player";
    const uid = url.searchParams.get("uid");
    const sid = url.searchParams.get("sid");
    const conn: Conn = {
      connId: randomId(10),
      // As in a room: every GM connection shares one identity no player id can equal.
      userId: role === "gm" ? GM_OWNER : isId(uid) ? uid : randomId(16),
      name: cleanText(url.searchParams.get("name"), LIMITS.playerName) || (role === "gm" ? "GM" : "Player"),
      color: cleanColor(url.searchParams.get("color")) ?? "#4f9dde",
      role,
      sid: isId(sid) ? sid : randomId(16),
      // The Worker let it in with this room's id.
      room: url.searchParams.get("room") ?? "",
    };
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(conn);
    this.send(server, { t: "voice.hello", you: { connId: conn.connId, role } });
    // Who's in voice chat, even nobody: the tab takes this first list as how things stand, not a change.
    this.send(server, { t: "voice", peers: this.voicePeers() });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const conn = ws.deserializeAttachment() as Conn | null;
    if (!conn || typeof message !== "string") return;
    let msg: VoiceClientMsg;
    try {
      msg = JSON.parse(message) as VoiceClientMsg;
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    try {
      switch (msg.t) {
        case "voice":
          await this.handleVoice(ws, conn, msg);
          return;
        case "rtc":
          this.relayRtc(conn, msg);
          return;
        case "profile":
          this.profile(ws, conn, msg);
          return;
        case "room":
          await this.moveRoom(ws, conn, msg);
          return;
      }
    } catch (err) {
      console.error(JSON.stringify({ message: "voice message failed", t: (msg as { t?: unknown }).t, error: String(err) }));
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.leaveVoice(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.leaveVoice(ws);
  }

  /**
   * A room was deleted (index.ts calls this): whoever is on voice chat through it is taken off
   * and disconnected, as the room's own connections are.
   */
  async roomDeleted(id: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      const c = ws.deserializeAttachment() as Conn | null;
      if (c?.room !== id) continue;
      this.leaveVoice(ws);
      ws.serializeAttachment({ ...c, voice: undefined, room: "" });
      try {
        ws.close(4410, "Room deleted");
      } catch {
        // Already closing.
      }
    }
  }

  /** The tab is in another room now; only a room that exists counts. */
  private async moveRoom(ws: WebSocket, conn: Conn, msg: { id?: unknown }): Promise<void> {
    if (!this.allowed(`v:${conn.connId}`, VOICE_BURST)) return;
    const id = msg.id;
    if (typeof id !== "string" || !/^[A-Za-z0-9]{12}$/.test(id) || id === conn.room) return;
    if (!(await this.env.DIRECTORY.getByName("main").listRooms()).some((r) => r.id === id)) return;
    const now = ws.deserializeAttachment() as Conn | null;
    if (now) ws.serializeAttachment({ ...now, room: id });
  }

  /** A new name or colour (changed in a room): everyone in voice sees it. */
  private profile(ws: WebSocket, conn: Conn, msg: { name?: unknown; color?: unknown }): void {
    if (!this.allowed(`v:${conn.connId}`, VOICE_BURST)) return;
    const name = cleanText(msg.name, LIMITS.playerName) || conn.name;
    const color = cleanColor(msg.color) ?? conn.color;
    if (name === conn.name && color === conn.color) return;
    ws.serializeAttachment({ ...conn, name, color });
    if (conn.voice) this.broadcastVoice();
  }

  /** Joins voice chat, leaves it, or changes whether this tab is muted. */
  private async handleVoice(ws: WebSocket, conn: Conn, msg: { on?: unknown; muted?: unknown }): Promise<void> {
    if (msg.on !== true) {
      this.joining.delete(ws);
      if (!conn.voice) return;
      const { voice: _voice, ...rest } = conn;
      ws.serializeAttachment(rest);
      this.broadcastVoice();
      return;
    }
    // Every join or mute tells everyone, and a join makes every tab in voice set up a call:
    // more than a person could mean in ten seconds is dropped. (Leaving always works.)
    if (!this.allowed(`v:${conn.connId}`, VOICE_BURST)) return;
    const muted = msg.muted === true;
    if (!conn.voice) {
      // A tab that reconnected after its connection dropped can still be in voice on the old
      // one until the server notices it's gone: that place goes, so the tab isn't in twice.
      if (this.dropGhosts(ws, conn)) this.broadcastVoice();
      // The GM always gets in, so players filling voice chat can't keep them out.
      const full = () => conn.role !== "gm" && this.voicePeers().length >= MAX_VOICE;
      if (full()) return this.refuseVoice(ws);
      this.joining.add(ws);
      const servers = await this.iceServers();
      // That can take a moment (asking Cloudflare for TURN passwords): meanwhile the tab
      // may have gone or left, or others may have filled voice chat.
      const now = ws.deserializeAttachment() as Conn | null;
      const stillJoining = this.joining.delete(ws);
      if (!now || !this.ctx.getWebSockets().includes(ws)) return;
      if (!now.voice) {
        if (!stillJoining) return;
        if (full()) return this.refuseVoice(ws);
        ws.serializeAttachment({ ...now, voice: { muted } });
        this.send(ws, { t: "ice", servers });
        this.broadcastVoice();
        return;
      }
      // It joined meanwhile (this was a second join): just say whether it's muted.
      conn = now;
    }
    if (conn.voice?.muted === muted) return;
    ws.serializeAttachment({ ...conn, voice: { muted } });
    this.broadcastVoice();
  }

  /** Takes this tab's older connections (the same sid) out of voice chat: whether there were any. */
  private dropGhosts(ws: WebSocket, conn: Conn): boolean {
    let dropped = false;
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue;
      const c = other.deserializeAttachment() as Conn | null;
      if (!c?.voice || c.sid !== conn.sid || c.userId !== conn.userId) continue;
      const { voice: _voice, ...rest } = c;
      other.serializeAttachment(rest);
      dropped = true;
    }
    return dropped;
  }

  private refuseVoice(ws: WebSocket): void {
    this.send(ws, { t: "voice.refused", message: `Voice chat is full: it takes ${MAX_VOICE} people at a time.` });
  }

  /** A connection that closed: if it was in voice chat, everyone hears it left. */
  private leaveVoice(ws: WebSocket): void {
    this.joining.delete(ws);
    const c = ws.deserializeAttachment() as Conn | null;
    if (!c) return;
    for (const key of this.limits.keys()) if (key === `v:${c.connId}` || key.startsWith(`r:${c.connId}>`)) this.limits.delete(key);
    if (c.voice) this.broadcastVoice(ws);
  }

  /** Passes a call's signal on to the tab it's for, when both are in voice chat. */
  private relayRtc(conn: Conn, msg: { to?: unknown; d?: unknown }): void {
    if (!conn.voice || typeof msg.to !== "string" || msg.to === conn.connId) return;
    const d = cleanSignal(msg.d);
    if (!d) return;
    for (const ws of this.ctx.getWebSockets()) {
      const c = ws.deserializeAttachment() as Conn | null;
      if (c?.connId !== msg.to) continue;
      // Counted for each pair, so a flood at one tab can't use up its signals to the others.
      if (c.voice && this.allowed(`r:${conn.connId}>${c.connId}`, RTC_BURST)) {
        this.send(ws, { t: "rtc", from: conn.connId, d });
      }
      return;
    }
  }

  /**
   * Whether one more voice chat message under this key fits its limit for the current
   * window (RTC_WINDOW_MS): far more than an honest tab sends.
   */
  private allowed(key: string, limit: number): boolean {
    const now = Date.now();
    let w = this.limits.get(key);
    if (!w || now - w.start >= RTC_WINDOW_MS) {
      for (const [k, old] of this.limits) if (now - old.start >= RTC_WINDOW_MS) this.limits.delete(k);
      w = { start: now, n: 0 };
      this.limits.set(key, w);
    }
    return ++w.n <= limit;
  }

  /** Everyone in voice chat, one entry for each tab. */
  private voicePeers(exclude?: WebSocket): VoicePeer[] {
    const out: VoicePeer[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      const c = ws.deserializeAttachment() as Conn | null;
      if (c?.voice) out.push({ connId: c.connId, userId: c.userId, name: c.name, color: c.color, role: c.role, muted: c.voice.muted });
    }
    return out;
  }

  /** Who's in voice chat, to every tab connected. */
  private broadcastVoice(exclude?: WebSocket): void {
    const msg = JSON.stringify({ t: "voice", peers: this.voicePeers(exclude) } satisfies VoiceServerMsg);
    for (const ws of this.ctx.getWebSockets()) if (ws !== exclude) this.sendRaw(ws, msg);
  }

  /**
   * The servers a tab joining voice chat uses to reach the others: Cloudflare's STUN, and
   * TURN too when the Worker has a TURN key. One set of TURN passwords serves every join for
   * up to an hour (each lasts four), so joining doesn't ask Cloudflare every time. It's kept
   * in memory only, so after a quiet spell (when this is put to sleep) it asks again.
   */
  private async iceServers(): Promise<IceServer[]> {
    const env = this.env as TurnEnv;
    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return STUN_ONLY;
    if (this.ice && this.ice.until > Date.now()) return this.ice.servers;
    this.icePending ??= this.fetchIceServers(env.TURN_KEY_ID, env.TURN_KEY_API_TOKEN).finally(() => {
      this.icePending = null;
    });
    return this.icePending;
  }

  private async fetchIceServers(keyId: string, token: string): Promise<IceServer[]> {
    try {
      const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: TURN_TTL_S }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const found = usableIceServers(((await res.json()) as { iceServers?: unknown }).iceServers);
      if (!found.some((s) => s.username)) throw new Error("no TURN servers in the answer");
      const servers = found.some((s) => s.urls.some((u) => u.startsWith("stun:"))) ? found : [...STUN_ONLY, ...found];
      this.ice = { servers, until: Date.now() + TURN_REUSE_MS };
      return servers;
    } catch (err) {
      console.error(JSON.stringify({ message: "TURN passwords failed", error: String(err) }));
      this.ice = { servers: STUN_ONLY, until: Date.now() + TURN_RETRY_MS };
      return STUN_ONLY;
    }
  }

  private send(ws: WebSocket, msg: VoiceServerMsg): void {
    this.sendRaw(ws, JSON.stringify(msg));
  }

  private sendRaw(ws: WebSocket, data: string): void {
    try {
      ws.send(data);
    } catch {
      // The socket is closing: its close handler takes it out of voice chat.
    }
  }
}
