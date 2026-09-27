// One Room Durable Object per game. It owns the room's state (scenes, tokens,
// drawings, fog, chat, initiative) in its SQLite storage, keeps an in-memory copy
// for speed, and relays every change to the connected browsers over hibernating
// WebSockets.
//
// It is the only authority: browsers apply their own changes optimistically, but
// every change is validated and permission-checked here, and the sender always
// gets back either the accepted change or a correction.

import { DurableObject } from "cloudflare:workers";
import { DiceError, rollDice, secureRng } from "../shared/dice";
import { randomId } from "../shared/ids";
import { applyInitOp } from "../shared/initiative";
import type { InitOp } from "../shared/initiative";
import { canCreate, canDelete, canMove, canPatch, canReplace, visibleToPlayer } from "../shared/permissions";
import type { ClientMsg, Ephemeral, ServerMsg } from "../shared/protocol";
import { CLOSE_DELETED, CLOSE_NOT_FOUND, MEASURE_SHAPES } from "../shared/protocol";
import {
  DEFAULT_GRID,
  DEFAULT_SETTINGS,
  GM_OWNER,
  LIMITS,
  cleanColor,
  cleanText,
  isId,
  isOwner,
  sanitizeInitiative,
  sanitizeItem,
  sanitizeScene,
  sanitizeSet,
  sanitizeSettings,
} from "../shared/sanitize";
import type {
  Asset,
  AssetKind,
  ChatMessage,
  InitEntry,
  Initiative,
  Item,
  ItemPatch,
  MutableFields,
  Player,
  Role,
  RoomInfo,
  Scene,
} from "../shared/types";

/** What a WebSocket carries: the player, and the browser tab (never shown to anyone else). */
interface Conn extends Player {
  sid: string;
}

/** The player as others see them. */
function publicPlayer(c: Conn): Player {
  const { sid: _sid, ...p } = c;
  return p;
}

interface Change {
  id: string;
  before: Item | null;
  after: Item | null;
  /** Present when the change was a patch: the fields that changed. */
  set: Partial<MutableFields> | null;
}

const HISTORY_KEEP = 300;
const HELLO_MESSAGES = 150;
const MAX_SCENES = 100;
/** A scene can hold LIMITS.itemsPerScene items, so one message may clear them all. */
const MAX_OPS_PER_MESSAGE = LIMITS.itemsPerScene;
/**
 * Total size of every stored token, drawing and fog shape in a room. Keeps the
 * room loadable (it's all held in memory and sent to the GM on connect) and far
 * below the 32 MiB WebSocket message limit.
 */
const MAX_ROOM_ITEM_BYTES = 12 * 1024 * 1024;
/**
 * Players' share of that: each player's own items, and all players' together. What
 * players make can never use up the space the GM needs for fog and scenes.
 */
const MAX_PLAYER_ITEM_BYTES = 2 * 1024 * 1024;
const MAX_ALL_PLAYERS_ITEM_BYTES = 6 * 1024 * 1024;
/** Items one player may have on a scene (the GM is only held to LIMITS.itemsPerScene). */
const MAX_PLAYER_ITEMS_PER_SCENE = 1000;
/** Uploaded images: per room, per player, and all players together. */
const MAX_ASSETS = 600;
const MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_PLAYER_ASSETS = 100;
const MAX_PLAYER_ASSET_BYTES = 250 * 1024 * 1024;
const MAX_ALL_PLAYERS_ASSET_BYTES = 1024 * 1024 * 1024;
/** How long a deleted item's id stays reserved. */
const TOMBSTONE_MS = 30 * 86400_000;
/** How long the server remembers a browser tab's last seq, and for how many tabs at most. */
const SESSION_KEEP_MS = 7 * 86400_000;
const MAX_SESSIONS = 2000;

export function fileKey(roomId: string, assetId: string): string {
  return `rooms/${roomId}/${assetId}`;
}

export class Room extends DurableObject<Env> {
  private sql: SqlStorage;
  private info: RoomInfo | null = null;
  private activeSceneId: string | null = null;
  private scenes = new Map<string, Scene>();
  private items = new Map<string, Item>();
  private itemBytes = new Map<string, number>();
  private totalItemBytes = 0;
  /** Bytes of items per owner, and of everything players own together. */
  private ownerBytes = new Map<string, number>();
  private playerItemBytes = 0;
  /**
   * Ids of deleted items and who owned them. Only that owner (or the GM) may use the
   * id again, so a player can't learn from a failed re-create whether an item they
   * lost sight of was hidden or deleted, or take over a token the GM is about to
   * restore with Undo.
   */
  private tombstones = new Map<string, string>();
  /** The initiative view players last received, so an unchanged view isn't resent. */
  private lastPlayerInitiative = "";
  private assets = new Map<string, Asset>();
  private initiative: Initiative = { entries: [], turn: 0, round: 1 };
  /** Browser tab -> the last seq applied from it (a cache of the sessions table). */
  private sessionSeqs = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      // Only read here. Any request for a made-up room id reaches a brand-new object;
      // creating tables in it would leave storage behind for every such request.
      if (this.hasTables()) {
        this.migrate();
        this.load();
      }
    });
    // Keep-alive pings are answered without waking the object from hibernation.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ---------------------------------------------------------------- storage

  private hasTables(): boolean {
    return this.sql.exec(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'`).toArray().length > 0;
  }

  private migrate(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS scenes (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, scene_id TEXT NOT NULL, data TEXT NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS items_by_scene ON items (scene_id)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS tombstones (id TEXT PRIMARY KEY, owner TEXT NOT NULL, at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, last_seq INTEGER NOT NULL, at INTEGER NOT NULL)`);
  }

  private load(): void {
    const meta = new Map(
      this.sql
        .exec<{ k: string; v: string }>(`SELECT k, v FROM meta`)
        .toArray()
        .map((r) => [r.k, r.v]),
    );
    this.info = meta.has("info") ? (JSON.parse(meta.get("info")!) as RoomInfo) : null;
    this.activeSceneId = meta.has("active") ? (JSON.parse(meta.get("active")!) as string | null) : null;
    if (meta.has("initiative")) this.initiative = JSON.parse(meta.get("initiative")!) as Initiative;
    this.scenes.clear();
    for (const r of this.sql.exec<{ data: string }>(`SELECT data FROM scenes`)) {
      const s = JSON.parse(r.data) as Scene;
      this.scenes.set(s.id, s);
    }
    this.items.clear();
    this.itemBytes.clear();
    this.ownerBytes.clear();
    this.totalItemBytes = 0;
    this.playerItemBytes = 0;
    for (const r of this.sql.exec<{ data: string }>(`SELECT data FROM items`)) {
      const i = JSON.parse(r.data) as Item;
      this.items.set(i.id, i);
      this.itemBytes.set(i.id, r.data.length);
      this.countBytes(i.owner, r.data.length);
    }
    this.sql.exec(`DELETE FROM tombstones WHERE at < ?`, Date.now() - TOMBSTONE_MS);
    this.sql.exec(`DELETE FROM sessions WHERE at < ?`, Date.now() - SESSION_KEEP_MS);
    this.sessionSeqs.clear();
    this.tombstones.clear();
    for (const r of this.sql.exec<{ id: string; owner: string }>(`SELECT id, owner FROM tombstones`)) {
      this.tombstones.set(r.id, r.owner);
    }
    this.assets.clear();
    for (const r of this.sql.exec<{ data: string }>(`SELECT data FROM assets`)) {
      const a = JSON.parse(r.data) as Asset;
      this.assets.set(a.id, a);
    }
  }

  /** Adds (or with a negative size, removes) an item's bytes to the running totals. */
  private countBytes(owner: string, bytes: number): void {
    this.totalItemBytes += bytes;
    this.ownerBytes.set(owner, (this.ownerBytes.get(owner) ?? 0) + bytes);
    if (owner !== GM_OWNER) this.playerItemBytes += bytes;
  }

  private setMeta(k: string, v: unknown): void {
    this.sql.exec(
      `INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      k,
      JSON.stringify(v),
    );
  }

  private saveScene(s: Scene): void {
    this.sql.exec(
      `INSERT INTO scenes (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      s.id,
      JSON.stringify(s),
    );
  }

  private saveAsset(a: Asset): void {
    this.sql.exec(
      `INSERT INTO assets (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      a.id,
      JSON.stringify(a),
    );
  }

  // ---------------------------------------------------------------- RPC (called by the Worker)

  create(id: string, name: string): RoomInfo {
    if (this.info) throw new Error("Room already exists");
    this.migrate();
    const now = Date.now();
    const info: RoomInfo = { id, name, createdAt: now, settings: { ...DEFAULT_SETTINGS } };
    const scene: Scene = {
      id: randomId(12),
      name: "Scene 1",
      order: 0,
      mapAssetId: null,
      width: 30 * 70,
      height: 20 * 70,
      background: "#3a3f47",
      grid: { ...DEFAULT_GRID, color: "#ffffff", opacity: 0.2 },
      fogCover: false,
      createdAt: now,
    };
    this.ctx.storage.transactionSync(() => {
      this.setMeta("info", info);
      this.saveScene(scene);
      this.setMeta("active", scene.id);
      this.setMeta("initiative", this.initiative);
    });
    this.info = info;
    this.scenes.set(scene.id, scene);
    this.activeSceneId = scene.id;
    return info;
  }

  exists(): boolean {
    return this.info !== null;
  }

  /** Whether this upload may go ahead: null if so, otherwise the reason it can't. */
  uploadRefusal(role: Role, kind: AssetKind, owner: string, bytes: number): string | null {
    if (!this.info) return "This room doesn't exist.";
    if (role !== "gm" && !(kind === "token" && this.info.settings.playersCanAddTokens)) {
      return "You can't upload that kind of image to this room.";
    }
    const all = [...this.assets.values()];
    const total = all.reduce((n, a) => n + a.bytes, 0);
    if (all.length >= MAX_ASSETS || total + bytes > MAX_ASSET_BYTES) {
      return "This room has as many images as it can hold. Delete some first.";
    }
    if (role !== "gm") {
      const mine = all.filter((a) => a.owner === owner);
      const players = all.filter((a) => a.owner !== GM_OWNER).reduce((n, a) => n + a.bytes, 0);
      if (
        mine.length >= MAX_PLAYER_ASSETS ||
        mine.reduce((n, a) => n + a.bytes, 0) + bytes > MAX_PLAYER_ASSET_BYTES ||
        players + bytes > MAX_ALL_PLAYERS_ASSET_BYTES
      ) {
        return "You've uploaded as many images as a player can. Delete some of yours first.";
      }
    }
    return null;
  }

  addAsset(asset: Asset, role: Role): void {
    if (!this.info) throw new Error("Room not found");
    // Checked again here: uploads racing each other both passed the first check.
    const refusal = this.uploadRefusal(role, asset.kind, asset.owner, asset.bytes);
    if (refusal) throw new Error(refusal);
    this.saveAsset(asset);
    this.assets.set(asset.id, asset);
    this.broadcastAsset(asset);
  }

  /**
   * Deletes the room's files and storage. The room id comes from the caller, so a
   * retry after a failure part-way through still cleans up the files.
   */
  async destroy(roomId: string): Promise<void> {
    // From here on every handler sees "no room", even while the cleanup below is awaiting I/O.
    this.info = null;
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { t: "closed", reason: "deleted" });
      try {
        ws.close(CLOSE_DELETED, "Room deleted");
      } catch {
        // already closing
      }
    }
    let cursor: string | undefined;
    do {
      const list = await this.env.FILES.list({ prefix: `rooms/${roomId}/`, cursor });
      if (list.objects.length) await this.env.FILES.delete(list.objects.map((o) => o.key));
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
    await this.ctx.storage.deleteAll();
    this.activeSceneId = null;
    this.scenes.clear();
    this.items.clear();
    this.itemBytes.clear();
    this.ownerBytes.clear();
    this.totalItemBytes = 0;
    this.playerItemBytes = 0;
    this.tombstones.clear();
    this.sessionSeqs.clear();
    this.lastPlayerInitiative = "";
    this.assets.clear();
    this.initiative = { entries: [], turn: 0, round: 1 };
  }

  // ---------------------------------------------------------------- WebSockets

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    if (!this.info) {
      server.accept();
      server.send(JSON.stringify({ t: "closed", reason: "notfound" } satisfies ServerMsg));
      server.close(CLOSE_NOT_FOUND, "Room not found");
      return new Response(null, { status: 101, webSocket: client });
    }

    const url = new URL(request.url);
    // The Worker sets this header after checking the GM cookie; browsers can't reach this object directly.
    const role: Role = request.headers.get("X-Tabletop-Role") === "gm" ? "gm" : "player";
    const uid = url.searchParams.get("uid");
    const sid = url.searchParams.get("sid");
    const conn: Conn = {
      connId: randomId(10),
      // Every GM connection shares one identity no player id can equal, so a player
      // who copies the GM's browser id gets nothing of the GM's.
      userId: role === "gm" ? GM_OWNER : isId(uid) ? uid : randomId(16),
      name: cleanText(url.searchParams.get("name"), LIMITS.playerName) || (role === "gm" ? "GM" : "Player"),
      color: cleanColor(url.searchParams.get("color")) ?? "#4f9dde",
      role,
      // A tab that doesn't say which it is gets a fresh identity: nothing is deduplicated for it.
      sid: isId(sid) ? sid : randomId(16),
    };
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(conn);
    this.send(server, this.hello(conn));
    this.broadcastPlayers();
    if (role === "gm") {
      this.env.DIRECTORY.getByName("main")
        .touchRoom(this.info.id)
        .catch((err: unknown) => console.error(JSON.stringify({ message: "touchRoom failed", error: String(err) })));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const conn = ws.deserializeAttachment() as Conn | null;
    if (!conn || !this.info || typeof message !== "string") return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(message) as ClientMsg;
    } catch {
      this.send(ws, { t: "error", message: "The server couldn't read that message." });
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const raw = msg.t === "eph" ? undefined : (msg as { seq?: unknown }).seq;
    const seq = typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : undefined;
    if (seq !== undefined) {
      if (seq <= this.lastSeq(conn)) {
        // Already applied: it came on an earlier connection too. Just tell the tab how things stand.
        this.resync(ws, conn, msg, seq);
        return;
      }
      // Recorded before handling, so a handler that waits on I/O can't let a copy in meanwhile.
      this.recordSeq(conn, seq);
    }
    try {
      await this.handle(ws, conn, msg, seq);
    } catch (err) {
      console.error(JSON.stringify({ message: "message handler failed", t: msg.t, error: String(err) }));
      this.send(ws, { t: "error", message: "Something went wrong on the server." });
      if (seq !== undefined) this.resync(ws, conn, msg, seq);
      return;
    }
    // Item changes are confirmed by their echo; everything else gets an ack.
    if (seq !== undefined && msg.t !== "items") this.send(ws, { t: "ack", seq });
  }

  private sessionKey(conn: Conn): string {
    return `${conn.userId}|${conn.sid}`;
  }

  private lastSeq(conn: Conn): number {
    const key = this.sessionKey(conn);
    let v = this.sessionSeqs.get(key);
    if (v === undefined) {
      v = this.sql.exec<{ last_seq: number }>(`SELECT last_seq FROM sessions WHERE id = ?`, key).toArray()[0]?.last_seq ?? 0;
      if (this.sessionSeqs.size >= MAX_SESSIONS) this.sessionSeqs.clear();
      this.sessionSeqs.set(key, v);
    }
    return v;
  }

  private recordSeq(conn: Conn, seq: number): void {
    const key = this.sessionKey(conn);
    const known = (this.sessionSeqs.get(key) ?? 0) > 0;
    this.sessionSeqs.set(key, seq);
    this.sql.exec(
      `INSERT INTO sessions (id, last_seq, at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_seq = excluded.last_seq, at = excluded.at`,
      key,
      seq,
      Date.now(),
    );
    if (!known) {
      this.sql.exec(
        `DELETE FROM sessions WHERE id NOT IN (SELECT id FROM sessions ORDER BY at DESC LIMIT ?)`,
        MAX_SESSIONS,
      );
    }
  }

  /**
   * Answers a change that won't be applied (a copy of one already applied, or one
   * whose handler failed) with the current state of what it touched, so the sender's
   * unconfirmed copy is settled and corrected.
   */
  private resync(ws: WebSocket, conn: Conn, msg: ClientMsg, seq: number): void {
    const gm = conn.role === "gm";
    if (msg.t === "items") {
      const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
      const idOf = (v: unknown): unknown => (typeof v === "string" ? v : (v as { id?: unknown } | null)?.id);
      const ids = new Set<string>();
      for (const v of [...list(msg.upsert), ...list(msg.patch), ...list(msg.delete)]) {
        const id = idOf(v);
        if (isId(id) && ids.size < MAX_OPS_PER_MESSAGE) ids.add(id);
      }
      const upsert: Item[] = [];
      const del: string[] = [];
      for (const id of ids) {
        const item = this.items.get(id);
        if (item && (gm || visibleToPlayer(item, this.activeSceneId))) upsert.push(item);
        else del.push(id);
      }
      const out: Extract<ServerMsg, { t: "items" }> = { t: "items", by: conn.connId, seq };
      if (upsert.length) out.upsert = upsert;
      if (del.length) out.delete = del;
      const sceneId = (msg.scene as { id?: unknown } | undefined)?.id;
      const scene = gm && isId(sceneId) ? this.scenes.get(sceneId) : undefined;
      if (scene) out.scene = scene;
      this.send(ws, out);
      return;
    }
    if (msg.t === "scene.upsert" && gm) {
      const id = (msg.scene as { id?: unknown } | undefined)?.id;
      const scene = isId(id) ? this.scenes.get(id) : undefined;
      if (scene) this.send(ws, { t: "scene.upsert", scene, by: conn.connId, seq });
      else if (isId(id)) this.send(ws, { t: "scene.delete", id, by: conn.connId, seq });
    } else if (msg.t === "initiative.op") {
      this.send(ws, { t: "initiative", initiative: this.initiativeFor(conn), by: conn.connId, seq });
    }
    this.send(ws, { t: "ack", seq });
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.broadcastPlayers(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcastPlayers(ws);
  }

  // ---------------------------------------------------------------- message handling

  private async handle(ws: WebSocket, conn: Conn, msg: ClientMsg, seq: number | undefined): Promise<void> {
    const gm = conn.role === "gm";
    switch (msg.t) {
      case "items":
        this.handleItems(ws, conn, msg, seq);
        return;

      case "scene.upsert": {
        if (!gm) return this.deny(ws);
        const id = (msg.scene as Scene | undefined)?.id;
        const existing = isId(id) ? this.scenes.get(id) : undefined;
        const refuse = (message?: string) => {
          if (message) this.send(ws, { t: "error", message });
          // Put the sender's copy back: remove a scene it created, or restore the stored one.
          if (existing) this.send(ws, { t: "scene.upsert", scene: existing, by: conn.connId, seq });
          else if (isId(id)) this.send(ws, { t: "scene.delete", id, by: conn.connId, seq });
        };
        // An edit to a scene someone has deleted since: it stays deleted.
        if (!existing && !msg.create) return refuse();
        if (!existing && this.scenes.size >= MAX_SCENES) return refuse(`A room can hold at most ${MAX_SCENES} scenes.`);
        const scene = sanitizeScene(msg.scene, existing);
        if (!scene) return refuse("That scene couldn't be saved.");
        this.saveScene(scene);
        this.scenes.set(scene.id, scene);
        this.broadcast(
          { t: "scene.upsert", scene, by: conn.connId, seq },
          (c) => c.role === "gm" || scene.id === this.activeSceneId,
        );
        return;
      }

      case "scene.delete": {
        if (!gm) return this.deny(ws);
        const scene = this.scenes.get(msg.id);
        if (!scene) return;
        let nextActive = this.activeSceneId;
        if (nextActive === scene.id) {
          const rest = [...this.scenes.values()].filter((s) => s.id !== scene.id).sort((a, b) => a.order - b.order);
          nextActive = rest[0]?.id ?? null;
        }
        this.ctx.storage.transactionSync(() => {
          this.sql.exec(`DELETE FROM items WHERE scene_id = ?`, scene.id);
          this.sql.exec(`DELETE FROM scenes WHERE id = ?`, scene.id);
          if (nextActive !== this.activeSceneId) this.setMeta("active", nextActive);
        });
        for (const [id, item] of this.items) {
          if (item.sceneId !== scene.id) continue;
          this.items.delete(id);
          this.countBytes(item.owner, -(this.itemBytes.get(id) ?? 0));
          this.itemBytes.delete(id);
        }
        this.scenes.delete(scene.id);
        this.broadcast({ t: "scene.delete", id: scene.id, by: conn.connId, seq }, (c) => c.role === "gm");
        if (nextActive !== this.activeSceneId) {
          this.activeSceneId = nextActive;
          this.broadcastActive();
        } else {
          this.broadcastInitiative();
        }
        return;
      }

      case "scene.activate": {
        if (!gm) return this.deny(ws);
        if (!this.scenes.has(msg.id)) return;
        this.setMeta("active", msg.id);
        this.activeSceneId = msg.id;
        this.broadcastActive();
        return;
      }

      case "asset.rename": {
        const asset = this.assets.get(msg.id);
        if (!asset) return;
        if (!gm && asset.owner !== conn.userId) return this.deny(ws);
        const name = cleanText(msg.name, LIMITS.name);
        if (!name) return;
        const next = { ...asset, name };
        this.saveAsset(next);
        this.assets.set(next.id, next);
        this.broadcastAsset(next);
        return;
      }

      case "asset.delete": {
        const asset = this.assets.get(msg.id);
        if (!asset) return;
        if (!gm && asset.owner !== conn.userId) return this.deny(ws);
        this.sql.exec(`DELETE FROM assets WHERE id = ?`, asset.id);
        this.assets.delete(asset.id);
        this.broadcast({ t: "asset.delete", id: asset.id }, (c) => this.canSeeAsset(asset, c));
        try {
          await this.env.FILES.delete(fileKey(this.info!.id, asset.id));
        } catch (err) {
          console.error(JSON.stringify({ message: "R2 delete failed", assetId: asset.id, error: String(err) }));
        }
        return;
      }

      case "room.update": {
        if (!gm) return this.deny(ws);
        const info = this.info!;
        const name = msg.name === undefined ? info.name : cleanText(msg.name, LIMITS.name) || info.name;
        const settings = msg.settings === undefined ? info.settings : sanitizeSettings(msg.settings, info.settings);
        const next: RoomInfo = { ...info, name, settings };
        this.setMeta("info", next);
        this.info = next;
        this.broadcast({ t: "room", room: next });
        if (name !== info.name) {
          await this.env.DIRECTORY.getByName("main").renameRoom(info.id, name);
        }
        return;
      }

      case "initiative.op": {
        const op = this.cleanInitOp(msg.op, conn);
        if (op === "stale") {
          // Someone ended that turn first; just put the sender's copy right.
          this.send(ws, { t: "initiative", initiative: this.initiativeFor(conn), by: conn.connId, seq });
          return;
        }
        if (!op) {
          this.send(ws, { t: "error", message: "That initiative change wasn't allowed." });
          // Put the sender's copy back to what's stored.
          this.send(ws, { t: "initiative", initiative: this.initiativeFor(conn), by: conn.connId, seq });
          return;
        }
        const next = applyInitOp(this.initiative, op);
        this.setMeta("initiative", next);
        this.initiative = next;
        this.broadcastInitiative(conn.connId, seq);
        return;
      }

      case "chat": {
        const text = cleanText(msg.text, LIMITS.chat);
        if (!text) return;
        this.postMessage({
          id: randomId(12),
          ts: Date.now(),
          userId: conn.userId,
          name: conn.name,
          color: conn.color,
          role: conn.role,
          kind: "chat",
          text,
        });
        return;
      }

      case "roll": {
        let roll;
        try {
          roll = rollDice(String(msg.expr ?? ""), secureRng);
        } catch (err) {
          const message = err instanceof DiceError ? err.message : "That roll didn't work.";
          this.send(ws, { t: "error", message });
          return;
        }
        this.postMessage({
          id: randomId(12),
          ts: Date.now(),
          userId: conn.userId,
          name: conn.name,
          color: conn.color,
          role: conn.role,
          kind: "roll",
          text: cleanText(msg.label, 60) ?? "",
          roll,
          ...(msg.private ? { private: true } : {}),
        });
        return;
      }

      case "profile": {
        const name = cleanText(msg.name, LIMITS.playerName) || conn.name;
        const color = cleanColor(msg.color) ?? conn.color;
        // Every tab of the same person gets the new name, so the player list agrees.
        for (const other of this.ctx.getWebSockets()) {
          const c = other.deserializeAttachment() as Conn | null;
          if (c && c.userId === conn.userId && c.role === conn.role) other.serializeAttachment({ ...c, name, color });
        }
        this.broadcastPlayers();
        return;
      }

      case "eph":
        this.handleEph(ws, conn, msg.e);
        return;

      default:
        return;
    }
  }

  private handleItems(ws: WebSocket, conn: Conn, msg: Extract<ClientMsg, { t: "items" }>, seq: number | undefined): void {
    const settings = this.info!.settings;
    const isGm = conn.role === "gm";
    const changes: Change[] = [];
    const refused = new Set<string>();
    // Ids the sender asked about that, as far as the sender may know, don't exist.
    const gone: string[] = [];
    let full = false;
    // Several operations in one message may touch the same item; each sees the result of the previous one.
    const staged = new Map<string, Item | null>();
    const stagedBytes = new Map<string, number>();
    const current = (id: string): Item | null => (staged.has(id) ? staged.get(id)! : (this.items.get(id) ?? null));
    const sizeOf = (id: string): number => (stagedBytes.has(id) ? stagedBytes.get(id)! : (this.itemBytes.get(id) ?? 0));
    const hiddenFromSender = (item: Item) => !isGm && !visibleToPlayer(item, this.activeSceneId);
    const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
    const idOf = (v: unknown): unknown => (typeof v === "string" ? v : (v as { id?: unknown } | null)?.id);
    const ops = { upsert: list(msg.upsert), patch: list(msg.patch), delete: list(msg.delete) };
    // A change to the scene itself that goes with these items (covering it in fog, a new
    // map). Both happen or neither does: fog removed without the cover that should
    // replace it would show players the map.
    let scene: Scene | null = null;
    let sceneCorrection: Scene | null = null;
    /** The scene change itself was refused (not the GM, or the scene is gone): already answered. */
    let sceneInvalid = false;
    if (msg.scene !== undefined) {
      const sceneId = (msg.scene as { id?: unknown } | null)?.id;
      const existing = isGm && isId(sceneId) ? this.scenes.get(sceneId) : undefined;
      scene = existing ? sanitizeScene(msg.scene, existing) : null;
      if (!scene) {
        sceneInvalid = true;
        for (const v of [...ops.upsert, ...ops.patch, ...ops.delete]) {
          const id = idOf(v);
          if (isId(id)) refused.add(id);
        }
        ops.upsert = [];
        ops.patch = [];
        ops.delete = [];
        if (!isGm) this.deny(ws);
        else if (existing) sceneCorrection = existing;
        else if (isId(sceneId)) this.send(ws, { t: "scene.delete", id: sceneId, by: conn.connId, seq });
      }
    }
    // Never drop operations silently: anything past the cap is refused and corrected.
    let room = MAX_OPS_PER_MESSAGE;
    for (const key of ["upsert", "patch", "delete"] as const) {
      const take = ops[key].slice(0, Math.max(0, room));
      for (const extra of ops[key].slice(take.length)) {
        const id = idOf(extra);
        if (isId(id)) refused.add(id);
      }
      ops[key] = take;
      room -= take.length;
    }
    // Space the message's own deletes will free counts from the start, so a change
    // that clears old things and adds new ones in one go always fits.
    let total = this.totalItemBytes;
    let players = this.playerItemBytes;
    let mine = this.ownerBytes.get(conn.userId) ?? 0;
    const credited = new Set<string>();
    for (const id of ops.delete) {
      const item = isId(id) ? this.items.get(id) : undefined;
      if (!item || credited.has(item.id) || hiddenFromSender(item) || !canDelete(item, conn)) continue;
      credited.add(item.id);
      const size = this.itemBytes.get(item.id) ?? 0;
      total -= size;
      if (item.owner !== GM_OWNER) players -= size;
      if (item.owner === conn.userId) mine -= size;
    }
    /** Stages an item if the size budgets allow it. */
    const stage = (id: string, item: Item | null): boolean => {
      const size = item ? JSON.stringify(item).length : 0;
      const before = current(id);
      const oldSize = sizeOf(id);
      if (!item && credited.has(id)) {
        // Already counted above.
        credited.delete(id);
      } else {
        const delta = size - oldSize;
        const oldPlayer = before && before.owner !== GM_OWNER ? oldSize : 0;
        const newPlayer = item && item.owner !== GM_OWNER ? size : 0;
        const oldMine = before && before.owner === conn.userId ? oldSize : 0;
        const newMine = item && item.owner === conn.userId ? size : 0;
        const growing = delta > 0 || newPlayer > oldPlayer || newMine > oldMine;
        const over =
          total + delta > MAX_ROOM_ITEM_BYTES ||
          (!isGm && (players + newPlayer - oldPlayer > MAX_ALL_PLAYERS_ITEM_BYTES || mine + newMine - oldMine > MAX_PLAYER_ITEM_BYTES));
        if (growing && over) {
          full = true;
          return false;
        }
        total += delta;
        players += newPlayer - oldPlayer;
        mine += newMine - oldMine;
      }
      staged.set(id, item);
      stagedBytes.set(id, size);
      return true;
    };

    for (const raw of ops.upsert) {
      const id = idOf(raw);
      if (!isId(id)) continue;
      const existing = current(id);
      if (existing && hiddenFromSender(existing)) {
        gone.push(id);
        continue;
      }
      // Someone else's deleted item: its id isn't free for a player to reuse. Answered
      // exactly like an item that's hidden from them.
      const tomb = this.tombstones.get(id);
      if (!existing && !isGm && tomb !== undefined && tomb !== conn.userId) {
        gone.push(id);
        continue;
      }
      // The GM may restore an item exactly as it was (undoing a delete keeps its owner).
      const claimed = (raw as { owner?: unknown }).owner;
      const owner = isGm && isOwner(claimed) ? claimed : (existing?.owner ?? conn.userId);
      const item = sanitizeItem(raw, owner);
      if (!item || !this.scenes.has(item.sceneId)) {
        refused.add(id);
        continue;
      }
      if (existing) {
        if (!canReplace(existing, item, conn, settings)) {
          refused.add(id);
          continue;
        }
      } else if (
        !canCreate(item, conn, settings) ||
        (isGm
          ? this.countInScene(item.sceneId, staged) >= LIMITS.itemsPerScene
          : this.countInScene(item.sceneId, staged, conn.userId) >= MAX_PLAYER_ITEMS_PER_SCENE)
      ) {
        refused.add(id);
        continue;
      }
      if (hiddenFromSender(item) || !stage(id, item)) {
        refused.add(id);
        continue;
      }
      changes.push({ id, before: existing, after: item, set: null });
    }

    for (const raw of ops.patch) {
      const p = raw as ItemPatch | null;
      if (!p || !isId(p.id)) continue;
      const existing = current(p.id);
      if (!existing || hiddenFromSender(existing)) {
        gone.push(p.id);
        continue;
      }
      const set = sanitizeSet(existing, p.set);
      if (!set || !canPatch(existing, set, conn, settings)) {
        refused.add(p.id);
        continue;
      }
      const after = { ...existing, ...set } as Item;
      if (!stage(p.id, after)) {
        refused.add(p.id);
        continue;
      }
      changes.push({ id: p.id, before: existing, after, set });
    }

    for (const id of ops.delete) {
      if (!isId(id)) continue;
      const existing = current(id);
      if (!existing || hiddenFromSender(existing)) {
        gone.push(id);
        continue;
      }
      if (!canDelete(existing, conn)) {
        refused.add(id);
        continue;
      }
      stage(id, null);
      changes.push({ id, before: existing, after: null, set: null });
    }

    if (scene && (refused.size || full)) {
      // Part of a scene change was refused (the room is full, say): none of it happens.
      // Uncovering a scene without the hide shapes that came back with it would show
      // players what those shapes covered.
      for (const ch of changes) refused.add(ch.id);
      changes.length = 0;
      staged.clear();
      stagedBytes.clear();
      sceneCorrection = this.scenes.get(scene.id) ?? null;
      scene = null;
    }

    if (staged.size || scene) {
      this.ctx.storage.transactionSync(() => {
        if (scene) this.saveScene(scene);
        for (const [id, item] of staged) {
          if (item) {
            this.sql.exec(
              `INSERT INTO items (id, scene_id, data) VALUES (?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET scene_id = excluded.scene_id, data = excluded.data`,
              id,
              item.sceneId,
              JSON.stringify(item),
            );
          } else {
            this.sql.exec(`DELETE FROM items WHERE id = ?`, id);
          }
        }
      });
      if (scene) this.scenes.set(scene.id, scene);
      const now = Date.now();
      for (const [id, item] of staged) {
        const old = this.items.get(id);
        if (old) this.countBytes(old.owner, -(this.itemBytes.get(id) ?? 0));
        if (item) {
          this.items.set(id, item);
          this.itemBytes.set(id, stagedBytes.get(id)!);
          this.countBytes(item.owner, stagedBytes.get(id)!);
          if (this.tombstones.delete(id)) this.sql.exec(`DELETE FROM tombstones WHERE id = ?`, id);
        } else if (old) {
          this.items.delete(id);
          this.itemBytes.delete(id);
          this.tombstones.set(id, old.owner);
          this.sql.exec(
            `INSERT INTO tombstones (id, owner, at) VALUES (?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, at = excluded.at`,
            id,
            old.owner,
            now,
          );
        }
      }
    }

    for (const target of this.ctx.getWebSockets()) {
      const c = target.deserializeAttachment() as Conn | null;
      if (!c) continue;
      const isSender = target === ws;
      const sceneFor =
        scene && (c.role === "gm" || scene.id === this.activeSceneId) ? scene : isSender ? sceneCorrection : null;
      const upsert: Item[] = [];
      const patch: ItemPatch[] = [];
      const del: string[] = [];
      for (const ch of changes) {
        if (c.role === "gm") {
          if (!ch.after) del.push(ch.id);
          else if (ch.set) patch.push({ id: ch.id, set: ch.set });
          else upsert.push(ch.after);
        } else {
          const vb = !!ch.before && visibleToPlayer(ch.before, this.activeSceneId);
          const va = !!ch.after && visibleToPlayer(ch.after, this.activeSceneId);
          if (va && vb && ch.set) patch.push({ id: ch.id, set: ch.set });
          else if (va) upsert.push(ch.after!);
          else if (vb) del.push(ch.id);
        }
      }
      if (isSender) {
        // Corrections: put the sender's copy back to what the server actually holds.
        for (const id of refused) {
          const item = this.items.get(id);
          if (item && (c.role === "gm" || visibleToPlayer(item, this.activeSceneId))) upsert.push(item);
          else del.push(id);
        }
        del.push(...gone);
      } else if (!upsert.length && !patch.length && !del.length && !sceneFor) {
        continue;
      }
      const out: Extract<ServerMsg, { t: "items" }> = { t: "items", by: conn.connId };
      if (isSender && seq !== undefined) out.seq = seq;
      if (isSender && refused.size) out.refused = [...refused];
      if (sceneFor) out.scene = sceneFor;
      if (upsert.length) out.upsert = upsert;
      if (patch.length) out.patch = patch;
      if (del.length) out.delete = del;
      this.send(target, out);
    }

    if (full) {
      this.send(ws, {
        t: "error",
        message: "This room is full. Delete some drawings or fog shapes (or old scenes) to make room.",
      });
    } else if (refused.size && !sceneInvalid) {
      this.send(ws, { t: "error", message: "Some of that wasn't allowed, so it was undone." });
    }

    // Initiative entries follow their tokens' visibility, so a token appearing or
    // vanishing for players changes the list they see.
    const tracked = new Set(this.initiative.entries.map((e) => e.tokenId).filter((id): id is string => !!id));
    const visible = (i: Item | null) => !!i && visibleToPlayer(i, this.activeSceneId);
    if (changes.some((ch) => tracked.has(ch.id) && visible(ch.before) !== visible(ch.after))) {
      this.broadcastInitiative();
    }
  }

  private handleEph(ws: WebSocket, conn: Conn, raw: unknown): void {
    const e = raw as Ephemeral | null;
    if (!e || typeof e !== "object" || !isId(e.sceneId)) return;
    const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    let clean: Ephemeral;
    if (e.k === "drag") {
      if (!Array.isArray(e.moves)) return;
      const moves = e.moves
        .slice(0, 200)
        .filter((m) => m && isId(m.id) && finite(m.x) && finite(m.y))
        .filter((m) => {
          const item = this.items.get(m.id);
          return !!item && canMove(item, conn, this.info!.settings);
        })
        .map((m) => ({ id: m.id, x: m.x, y: m.y }));
      if (!moves.length) return;
      clean = { k: "drag", sceneId: e.sceneId, moves };
    } else if (e.k === "ruler") {
      let points: number[] | null = null;
      if (e.points !== null) {
        if (!Array.isArray(e.points) || e.points.length !== 4 || !e.points.every(finite)) return;
        points = e.points;
      }
      const shape = MEASURE_SHAPES.find((s) => s === e.shape) ?? "ruler";
      clean = { k: "ruler", sceneId: e.sceneId, points, label: cleanText(e.label, 40) ?? "", shape };
    } else if (e.k === "pointer") {
      if (!finite(e.x) || !finite(e.y)) return;
      clean = { k: "pointer", sceneId: e.sceneId, x: e.x, y: e.y };
    } else {
      return;
    }

    let forGm: string | null = null;
    let forPlayers: string | null | undefined;
    for (const target of this.ctx.getWebSockets()) {
      if (target === ws) continue;
      const c = target.deserializeAttachment() as Player | null;
      if (!c) continue;
      if (c.role === "gm") {
        forGm ??= JSON.stringify({ t: "eph", from: conn.connId, e: clean } satisfies ServerMsg);
        this.sendRaw(target, forGm);
        continue;
      }
      if (forPlayers === undefined) {
        forPlayers = null;
        if (clean.sceneId === this.activeSceneId) {
          if (clean.k === "drag") {
            const moves = clean.moves.filter((m) => {
              const item = this.items.get(m.id);
              return !!item && visibleToPlayer(item, this.activeSceneId);
            });
            if (moves.length) {
              forPlayers = JSON.stringify({ t: "eph", from: conn.connId, e: { ...clean, moves } } satisfies ServerMsg);
            }
          } else {
            forPlayers = JSON.stringify({ t: "eph", from: conn.connId, e: clean } satisfies ServerMsg);
          }
        }
      }
      if (forPlayers) this.sendRaw(target, forPlayers);
    }
  }

  // ---------------------------------------------------------------- initiative

  /** Whether players may see an initiative entry: not if it belongs to a token they can't see. */
  private entryVisible(e: InitEntry): boolean {
    if (!e.tokenId) return true;
    const token = this.items.get(e.tokenId);
    return !!token && visibleToPlayer(token, this.activeSceneId);
  }

  private initiativeFor(c: Player): Initiative {
    if (c.role === "gm") return this.initiative;
    const entries = this.initiative.entries.filter((e) => this.entryVisible(e));
    const current = this.initiative.entries[this.initiative.turn];
    const turn = current && this.entryVisible(current) ? entries.findIndex((e) => e.id === current.id) : -1;
    return { entries, turn, round: this.initiative.round };
  }

  /**
   * Validates an initiative operation. Anyone may add, edit, remove and step, but a
   * player can't touch (or link to) entries for tokens they can't see, and only the
   * GM can end combat.
   */
  private cleanInitOp(raw: unknown, conn: Player): InitOp | null | "stale" {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const gm = conn.role === "gm";
    const mayTouch = (id: unknown): id is string => {
      const e = isId(id) ? this.initiative.entries.find((x) => x.id === id) : undefined;
      return !!e && (gm || this.entryVisible(e));
    };
    switch (r.op) {
      case "add": {
        if (this.initiative.entries.length >= LIMITS.initiativeEntries) return null;
        const entry = sanitizeInitiative({ entries: [r.entry], turn: 0, round: 1 })?.entries[0];
        if (!entry) return null;
        // A taken id (perhaps a hidden entry's) gets a fresh one rather than an error.
        if (this.initiative.entries.some((e) => e.id === entry.id)) entry.id = randomId(10);
        if (entry.tokenId && !gm && !this.entryVisible(entry)) entry.tokenId = null;
        return { op: "add", entry };
      }
      case "update": {
        if (!mayTouch(r.id)) return null;
        const name = r.name === undefined ? undefined : cleanText(r.name, 40) || undefined;
        const value =
          typeof r.value === "number" && Number.isFinite(r.value) ? Math.max(-10000, Math.min(10000, r.value)) : undefined;
        if (name === undefined && value === undefined) return null;
        return { op: "update", id: r.id, name, value };
      }
      case "remove":
        return mayTouch(r.id) ? { op: "remove", id: r.id } : null;
      case "step": {
        if (r.dir !== 1 && r.dir !== -1) return null;
        if (r.from !== undefined) {
          const cur = this.initiative.entries[this.initiative.turn];
          const expected = cur && (gm || this.entryVisible(cur)) ? cur.id : null;
          if (r.from !== expected) return "stale";
        }
        return { op: "step", dir: r.dir };
      }
      case "clear":
        return gm ? { op: "clear" } : null;
      default:
        return null;
    }
  }

  private broadcastInitiative(by?: string, seq?: number): void {
    const forGm = JSON.stringify({ t: "initiative", initiative: this.initiative, by, seq } satisfies ServerMsg);
    // Every player sees the same view. When a change only touched entries hidden from
    // them, their view is the same as before: sending it anyway would tell them
    // something happened. Only the player who made the change gets their echo.
    const view = JSON.stringify(this.initiativeFor({ connId: "", userId: "", name: "", color: "", role: "player" }));
    const changed = view !== this.lastPlayerInitiative;
    this.lastPlayerInitiative = view;
    const echo = by ? `,"by":${JSON.stringify(by)}${seq !== undefined ? `,"seq":${seq}` : ""}` : "";
    const forPlayers = `{"t":"initiative","initiative":${view}${echo}}`;
    for (const ws of this.ctx.getWebSockets()) {
      const c = ws.deserializeAttachment() as Player | null;
      if (!c) continue;
      if (c.role === "gm") this.sendRaw(ws, forGm);
      else if (changed || c.connId === by) this.sendRaw(ws, forPlayers);
    }
  }

  // ---------------------------------------------------------------- helpers

  private canSeeAsset(a: Asset, c: Player): boolean {
    return c.role === "gm" || (a.owner !== GM_OWNER && a.owner === c.userId);
  }

  private hello(conn: Conn): ServerMsg {
    const gm = conn.role === "gm";
    const active = this.activeSceneId ? this.scenes.get(this.activeSceneId) : undefined;
    return {
      t: "hello",
      you: publicPlayer(conn),
      room: this.info!,
      scenes: gm ? [...this.scenes.values()] : active ? [active] : [],
      activeSceneId: this.activeSceneId,
      items: gm
        ? [...this.items.values()]
        : [...this.items.values()].filter((i) => visibleToPlayer(i, this.activeSceneId)),
      assets: [...this.assets.values()].filter((a) => this.canSeeAsset(a, conn)),
      messages: this.recentMessages(conn),
      initiative: this.initiativeFor(conn),
      players: this.players(),
      lastSeq: this.lastSeq(conn),
    };
  }

  private recentMessages(conn: Player): ChatMessage[] {
    const rows = this.sql
      .exec<{ data: string }>(`SELECT data FROM messages ORDER BY seq DESC LIMIT ?`, HISTORY_KEEP)
      .toArray();
    const out: ChatMessage[] = [];
    for (const r of rows) {
      const m = JSON.parse(r.data) as ChatMessage;
      if (this.canSeeMessage(m, conn)) out.push(m);
      if (out.length >= HELLO_MESSAGES) break;
    }
    return out.reverse();
  }

  /** Private rolls: the GM sees all of them; a player sees only their own (never the GM's). */
  private canSeeMessage(m: ChatMessage, c: Player): boolean {
    if (!m.private || c.role === "gm") return true;
    return m.role === "player" && c.userId === m.userId;
  }

  private postMessage(m: ChatMessage): void {
    this.sql.exec(`INSERT INTO messages (data) VALUES (?)`, JSON.stringify(m));
    this.sql.exec(`DELETE FROM messages WHERE seq <= (SELECT MAX(seq) FROM messages) - ?`, HISTORY_KEEP);
    this.broadcast({ t: "chat", message: m }, (c) => this.canSeeMessage(m, c));
  }

  /** Items on a scene (only those owned by `owner`, if given), counting what this message has staged. */
  private countInScene(sceneId: string, staged: Map<string, Item | null>, owner?: string): number {
    const counts = (item: Item) => item.sceneId === sceneId && (owner === undefined || item.owner === owner);
    let n = 0;
    for (const [id, item] of this.items) if (counts(item) && !staged.has(id)) n++;
    for (const item of staged.values()) if (item && counts(item)) n++;
    return n;
  }

  private players(exclude?: WebSocket): Player[] {
    const out: Player[] = [];
    const seen = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      const c = ws.deserializeAttachment() as Conn | null;
      if (!c || seen.has(c.userId)) continue;
      seen.add(c.userId);
      out.push(publicPlayer(c));
    }
    return out;
  }

  private broadcastPlayers(exclude?: WebSocket): void {
    const msg = JSON.stringify({ t: "players", players: this.players(exclude) } satisfies ServerMsg);
    for (const ws of this.ctx.getWebSockets()) if (ws !== exclude) this.sendRaw(ws, msg);
  }

  private broadcastActive(): void {
    const scene = this.activeSceneId ? (this.scenes.get(this.activeSceneId) ?? null) : null;
    const items = [...this.items.values()].filter((i) => visibleToPlayer(i, this.activeSceneId));
    const forGm = JSON.stringify({ t: "scene.active", id: this.activeSceneId } satisfies ServerMsg);
    const forPlayers = JSON.stringify({ t: "scene.active", id: this.activeSceneId, scene, items } satisfies ServerMsg);
    for (const ws of this.ctx.getWebSockets()) {
      const c = ws.deserializeAttachment() as Player | null;
      if (c) this.sendRaw(ws, c.role === "gm" ? forGm : forPlayers);
    }
    // Which initiative entries players may see depends on the live scene.
    this.broadcastInitiative();
  }

  private broadcastAsset(asset: Asset): void {
    this.broadcast({ t: "asset.upsert", asset }, (c) => this.canSeeAsset(asset, c));
  }

  private broadcast(msg: ServerMsg, filter?: (c: Player) => boolean): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (filter) {
        const c = ws.deserializeAttachment() as Player | null;
        if (!c || !filter(c)) continue;
      }
      this.sendRaw(ws, data);
    }
  }

  private deny(ws: WebSocket): void {
    this.send(ws, { t: "error", message: "Only the GM can do that." });
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    this.sendRaw(ws, JSON.stringify(msg));
  }

  private sendRaw(ws: WebSocket, data: string): void {
    try {
      ws.send(data);
    } catch (err) {
      // Usually the socket is closing and its close handler will update the player
      // list. Anything else (a message too large to send) is worth knowing about.
      console.error(JSON.stringify({ message: "WebSocket send failed", bytes: data.length, error: String(err) }));
    }
  }
}
