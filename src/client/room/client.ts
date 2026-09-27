// The browser side of a room: holds the state, talks to the Room Durable Object
// over a WebSocket, applies the user's own changes immediately (optimistically),
// reconciles them with what the server confirms, and keeps an undo history.

import { randomId } from "../../shared/ids";
import { applyInitOp } from "../../shared/initiative";
import type { InitOp } from "../../shared/initiative";
import { applyOps, inverseOps, isEmptyOps } from "../../shared/ops";
import type { ItemMap } from "../../shared/ops";
import { canMove } from "../../shared/permissions";
import type { ClientMsg, Ephemeral, ItemOps, MeasureShape, ServerMsg } from "../../shared/protocol";
import { CLOSE_DELETED, CLOSE_NOT_FOUND } from "../../shared/protocol";
import { cellSpacing, isHex, snapTokenCenter } from "../../shared/geometry";
import type { Point } from "../../shared/geometry";
import type {
  Asset,
  AssetKind,
  ChatMessage,
  DrawShape,
  DrawingItem,
  Initiative,
  Item,
  ItemKind,
  Player,
  RoomInfo,
  RoomSettings,
  Scene,
  TokenItem,
} from "../../shared/types";
import { uploadImage } from "../api";
import { saveProfile } from "../identity";
import type { Profile } from "../identity";
import { Store } from "../store";

export type ToolId = "select" | "draw" | "erase" | "fog" | "measure" | "pointer";
export type PanelId = "chat" | "scenes" | "library" | "initiative" | "settings";
export type Status = "connecting" | "open" | "reconnecting" | "notfound" | "deleted";

export interface DrawOptions {
  shape: DrawShape;
  color: string;
  /** Stroke width in screen pixels at the moment of drawing. */
  width: number;
  fill: boolean;
}

export interface FogOptions {
  mode: "hide" | "reveal";
  /** brush: paint a stroke. lasso: trace an outline freehand. */
  shape: "brush" | "rect" | "poly" | "lasso";
  /** Brush width in grid squares. */
  brush: number;
  snap: boolean;
  /** GM only: show fog fully opaque, the way players see it. */
  preview: boolean;
}

export interface MeasureOptions {
  shape: MeasureShape;
  /** Templates only: leave the area on the map as a drawing when you let go. */
  keep: boolean;
}

export interface Toast {
  id: number;
  kind: "error" | "info" | "roll";
  text: string;
  message?: ChatMessage;
}

export interface RoomState {
  status: Status;
  me: Player | null;
  room: RoomInfo | null;
  scenes: Record<string, Scene>;
  activeSceneId: string | null;
  viewSceneId: string | null;
  items: ItemMap;
  assets: Record<string, Asset>;
  messages: ChatMessage[];
  initiative: Initiative;
  players: Player[];
  tool: ToolId;
  drawOpts: DrawOptions;
  fogOpts: FogOptions;
  measureOpts: MeasureOptions;
  /**
   * Set while the GM is lining the grid up by drawing a box on the map: how many
   * squares across the box will cover.
   */
  gridAlign: { cells: number } | null;
  /** Set while the note dialog is open: where a new note goes, or which note is being edited. */
  textPrompt: { x: number; y: number; fontSize: number; editId?: string; text?: string } | null;
  selection: string[];
  panel: PanelId | null;
  unread: number;
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  toasts: Toast[];
  uploading: number;
}

/** What the board exposes to the rest of the app. */
export interface BoardApi {
  viewCenter(): Point;
  centerOn(p: Point): void;
  fit(): void;
  zoomBy(factor: number): void;
}

/** Our changes to one item that the server hasn't confirmed yet. */
interface Pending {
  /** seq of our latest upsert or delete of the whole item; 0 when none is in flight. */
  all: number;
  /** field name -> seq of our latest patch that set it. */
  fields: Map<string, number>;
}

interface UndoEntry {
  /** The scene the change was made on: undo only ever acts on the scene you're looking at. */
  sceneId: string | null;
  redo: ItemOps;
  undo: ItemOps;
  /** A change to the scene itself that belongs to the same step (covering it in fog, a new map). */
  scene?: { before: Scene; after: Scene };
}

type Outgoing = { kind: "items"; ops: ItemOps } | { kind: "msg"; msg: ClientMsg };

const MAX_MESSAGES = 300;
const MAX_UNDO = 200;
/** Big changes (clearing a scene's fog, say) are sent in pieces of this many operations. */
const OPS_PER_MESSAGE = 1000;
/** How long a ping may go unanswered before the connection is treated as dead. */
const PING_TIMEOUT_MS = 20_000;

/** Splits operations into pieces, keeping their order (upserts, then patches, then deletes). */
function chunkOps(ops: ItemOps, size: number): ItemOps[] {
  const flat: [keyof ItemOps, unknown][] = [
    ...(ops.upsert ?? []).map((x) => ["upsert", x] as [keyof ItemOps, unknown]),
    ...(ops.patch ?? []).map((x) => ["patch", x] as [keyof ItemOps, unknown]),
    ...(ops.delete ?? []).map((x) => ["delete", x] as [keyof ItemOps, unknown]),
  ];
  const out: ItemOps[] = [];
  for (let i = 0; i < flat.length; i += size) {
    const chunk: Record<string, unknown[]> = {};
    for (const [k, v] of flat.slice(i, i + size)) (chunk[k] ??= []).push(v);
    out.push(chunk as ItemOps);
  }
  return out;
}

function toMap<T extends { id: string }>(list: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const x of list) out[x.id] = x;
  return out;
}

export class RoomClient {
  readonly store: Store<RoomState>;
  board: BoardApi | null = null;

  private ws: WebSocket | null = null;
  private ready = false;
  private disposed = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastPong = 0;
  private pingSentAt = 0;
  private seq = 0;
  private pending = new Map<string, Pending>();
  /** Sent but not yet echoed, by seq: re-sent after a reconnect in case they were lost. */
  private inflight = new Map<number, ItemOps>();
  private outbox: Outgoing[] = [];
  /** Scene edits and initiative edits of ours the server hasn't echoed yet. */
  private scenePending = new Map<string, number>();
  private initPending = 0;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private ephListeners = new Set<(from: string, e: Ephemeral) => void>();
  private toastSeq = 0;

  constructor(
    readonly roomId: string,
    private profile: Profile,
  ) {
    this.store = new Store<RoomState>({
      status: "connecting",
      me: null,
      room: null,
      scenes: {},
      activeSceneId: null,
      viewSceneId: null,
      items: {},
      assets: {},
      messages: [],
      initiative: { entries: [], turn: 0, round: 1 },
      players: [],
      tool: "select",
      drawOpts: { shape: "pen", color: profile.color, width: 4, fill: false },
      fogOpts: { mode: "reveal", shape: "brush", brush: 2, snap: true, preview: false },
      measureOpts: { shape: "ruler", keep: false },
      textPrompt: null,
      gridAlign: null,
      selection: [],
      panel: typeof window !== "undefined" && window.innerWidth >= 900 ? "chat" : null,
      unread: 0,
      canUndo: false,
      canRedo: false,
      zoom: 1,
      toasts: [],
      uploading: 0,
    });
  }

  get state(): RoomState {
    return this.store.state;
  }

  get isGm(): boolean {
    return this.state.me?.role === "gm";
  }

  get viewScene(): Scene | null {
    const s = this.state;
    return s.viewSceneId ? (s.scenes[s.viewSceneId] ?? null) : null;
  }

  // ---------------------------------------------------------------- connection

  connect(): void {
    if (this.disposed) return;
    const p = this.profile;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const qs = new URLSearchParams({ uid: p.uid, name: p.name, color: p.color });
    const ws = new WebSocket(`${proto}//${location.host}/api/rooms/${this.roomId}/ws?${qs}`);
    this.ws = ws;
    this.ready = false;
    ws.onopen = () => {
      this.lastPong = Date.now();
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      if (ev.data === "pong") {
        this.lastPong = Date.now();
        return;
      }
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data as string) as ServerMsg;
      } catch {
        return;
      }
      this.lastPong = Date.now();
      this.onServer(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.ready = false;
      if (this.disposed) return;
      if (ev.code === CLOSE_NOT_FOUND) return this.store.set({ status: "notfound" });
      if (ev.code === CLOSE_DELETED) return this.store.set({ status: "deleted" });
      const st = this.state.status;
      if (st === "notfound" || st === "deleted") return;
      this.store.set({ status: this.state.me ? "reconnecting" : "connecting" });
      this.scheduleReconnect();
    };
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => this.checkHeartbeat(), 15_000);
      document.addEventListener("visibilitychange", this.onVisibility);
      window.addEventListener("online", this.onVisibility);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.disposed) return;
    const delay = Math.min(10_000, 500 * 2 ** this.attempts) + Math.random() * 400;
    this.attempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private ping(ws: WebSocket): void {
    ws.send("ping");
    this.pingSentAt = Date.now();
  }

  /** A ping that went unanswered: the connection is dead even though it looks open. */
  private pingUnanswered(): boolean {
    return this.pingSentAt > 0 && this.lastPong < this.pingSentAt && Date.now() - this.pingSentAt > PING_TIMEOUT_MS;
  }

  private restart(): void {
    this.ws?.close();
    this.ws = null;
    this.ready = false;
    this.pingSentAt = 0;
    this.store.set({ status: "reconnecting" });
    this.scheduleReconnect();
  }

  /**
   * Runs every 15 s, or as rarely as once a minute in a background tab. A quiet
   * room isn't a dead one, so only an unanswered ping counts as dead.
   */
  private checkHeartbeat(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (this.pingUnanswered()) return this.restart();
    if (this.lastPong >= this.pingSentAt) this.ping(ws);
  }

  private onVisibility = (): void => {
    if (document.visibilityState !== "visible" || this.disposed) return;
    const st = this.state.status;
    if (st === "notfound" || st === "deleted") return;
    const ws = this.ws;
    if (!ws || ws.readyState > WebSocket.OPEN) {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.attempts = 0;
      this.connect();
    } else if (ws.readyState === WebSocket.OPEN) {
      // Back from sleep, the socket may be dead without knowing it. Ask, and give up
      // on it quickly if there's no answer.
      this.ping(ws);
      const sent = this.pingSentAt;
      setTimeout(() => {
        if (this.ws === ws && this.lastPong < sent) this.restart();
      }, 5000);
    }
  };

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("online", this.onVisibility);
    this.ws?.close();
    this.ws = null;
  }

  private send(msg: ClientMsg): void {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.outbox.push({ kind: "msg", msg });
    }
  }

  sendEph(e: Ephemeral): void {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: "eph", e }));
  }

  onEph(fn: (from: string, e: Ephemeral) => void): () => void {
    this.ephListeners.add(fn);
    return () => this.ephListeners.delete(fn);
  }

  // ---------------------------------------------------------------- server messages

  private onServer(msg: ServerMsg): void {
    const s = this.state;
    switch (msg.t) {
      case "hello": {
        this.attempts = 0;
        const scenes = toMap(msg.scenes);
        const items = toMap(msg.items);
        const gm = msg.you.role === "gm";
        const view =
          gm && s.viewSceneId && scenes[s.viewSceneId] ? s.viewSceneId : (msg.activeSceneId ?? msg.scenes[0]?.id ?? null);
        this.pending.clear();
        this.scenePending.clear();
        this.initPending = 0;
        // Changes sent on the old connection that were never confirmed may have been
        // lost with it: apply them again on top of the fresh state and resend them.
        const unconfirmed = [...this.inflight.values()];
        this.inflight.clear();
        this.store.set({
          status: "open",
          me: msg.you,
          room: msg.room,
          scenes,
          activeSceneId: msg.activeSceneId,
          viewSceneId: view,
          items,
          assets: toMap(msg.assets),
          messages: msg.messages,
          initiative: msg.initiative,
          players: msg.players,
          selection: s.selection.filter((id) => items[id]),
          tool: !gm && s.tool === "fog" ? "select" : s.tool,
        });
        document.title = `${msg.room.name} · Tabletop`;
        this.ready = true;
        for (const ops of unconfirmed) this.applyLocal(ops);
        const queued = this.outbox;
        this.outbox = [];
        for (const out of queued) {
          if (out.kind === "items") this.applyLocal(out.ops);
          else this.send(out.msg);
        }
        this.refreshUndoFlags();
        return;
      }

      case "items":
        this.applyServerItems(msg);
        return;

      case "scene.upsert": {
        // While an edit of ours to this scene is unconfirmed, older versions (our own
        // earlier edits, or someone else's the server ordered before ours) are stale.
        const waiting = this.scenePending.get(msg.scene.id) ?? 0;
        if (msg.by === s.me?.connId) {
          if (waiting > 1) this.scenePending.set(msg.scene.id, waiting - 1);
          else this.scenePending.delete(msg.scene.id);
          if (waiting > 1) return;
        } else if (waiting > 0) {
          return;
        }
        this.store.set({ scenes: { ...s.scenes, [msg.scene.id]: msg.scene } });
        return;
      }

      case "scene.delete": {
        this.scenePending.delete(msg.id);
        this.undoStack = this.undoStack.filter((e) => e.sceneId !== msg.id);
        this.redoStack = this.redoStack.filter((e) => e.sceneId !== msg.id);
        const scenes = { ...s.scenes };
        delete scenes[msg.id];
        const items: ItemMap = {};
        for (const [id, item] of Object.entries(s.items)) if (item.sceneId !== msg.id) items[id] = item;
        const view = s.viewSceneId === msg.id ? (s.activeSceneId !== msg.id ? s.activeSceneId : null) : s.viewSceneId;
        this.store.set({ scenes, items, viewSceneId: view, selection: s.selection.filter((id) => items[id]) });
        this.refreshUndoFlags();
        return;
      }

      case "scene.active": {
        if (this.isGm) {
          this.store.set({ activeSceneId: msg.id, viewSceneId: s.viewSceneId ?? msg.id });
        } else {
          this.pending.clear();
          this.store.set({
            activeSceneId: msg.id,
            viewSceneId: msg.id,
            scenes: msg.scene ? { [msg.scene.id]: msg.scene } : {},
            items: toMap(msg.items ?? []),
            selection: [],
          });
        }
        this.refreshUndoFlags();
        return;
      }

      case "asset.upsert":
        this.store.set({ assets: { ...s.assets, [msg.asset.id]: msg.asset } });
        return;

      case "asset.delete": {
        const assets = { ...s.assets };
        delete assets[msg.id];
        this.store.set({ assets });
        return;
      }

      case "room":
        this.store.set({ room: msg.room });
        document.title = `${msg.room.name} · Tabletop`;
        return;

      case "initiative":
        if (msg.by === s.me?.connId) {
          this.initPending = Math.max(0, this.initPending - 1);
          if (this.initPending > 0) return;
        } else if (this.initPending > 0) {
          return;
        }
        this.store.set({ initiative: msg.initiative });
        return;

      case "chat": {
        const messages = [...s.messages, msg.message].slice(-MAX_MESSAGES);
        const away = s.panel !== "chat";
        this.store.set({ messages, unread: away ? s.unread + 1 : 0 });
        if (away && msg.message.kind === "roll") {
          this.pushToast({ kind: "roll", text: "", message: msg.message }, 6000);
        } else if (away) {
          this.pushToast({ kind: "info", text: `${msg.message.name}: ${msg.message.text}` }, 4000);
        }
        return;
      }

      case "players":
        this.store.set({ players: msg.players });
        return;

      case "eph":
        for (const fn of this.ephListeners) fn(msg.from, msg.e);
        return;

      case "error":
        this.toast(msg.message, "error");
        return;

      case "closed":
        this.store.set({ status: msg.reason === "deleted" ? "deleted" : "notfound" });
        return;
    }
  }

  /**
   * Reconciles the server's item changes with our own unconfirmed ones.
   *
   * For each item we've changed we remember, per field, the seq of our latest
   * change to it (and separately for whole-item replacements and deletes). The
   * server applies everything in one order and tells us about it in that order, so:
   * - someone else's update to a field we changed and haven't had confirmed was
   *   ordered before our change (otherwise our echo would have come first), so our
   *   value wins and theirs is skipped for that field only;
   * - an echo of our own change applies except for fields we've changed again since.
   */
  private applyServerItems(msg: Extract<ServerMsg, { t: "items" }>): void {
    const s = this.state;
    const mine = msg.seq !== undefined && msg.by === s.me?.connId;
    const seq = mine ? msg.seq! : 0;
    const next: ItemMap = { ...s.items };
    // A refused change is corrected by the server's copy, whatever else we have in flight.
    for (const id of msg.refused ?? []) this.pending.delete(id);
    if (mine) {
      for (const k of this.inflight.keys()) if (k <= seq) this.inflight.delete(k);
    }

    const wholeProtected = (id: string) => (this.pending.get(id)?.all ?? 0) > seq;
    const protectedFields = (id: string): string[] => {
      const p = this.pending.get(id);
      return p ? [...p.fields].filter(([, fs]) => fs > seq).map(([f]) => f) : [];
    };

    for (const item of msg.upsert ?? []) {
      if (wholeProtected(item.id)) continue;
      const keep = protectedFields(item.id);
      const local = next[item.id] as unknown as Record<string, unknown> | undefined;
      if (keep.length && local) {
        const merged = { ...item } as unknown as Record<string, unknown>;
        for (const f of keep) merged[f] = local[f];
        next[item.id] = merged as unknown as Item;
      } else {
        next[item.id] = item;
      }
    }
    for (const patch of msg.patch ?? []) {
      const cur = next[patch.id];
      if (!cur || wholeProtected(patch.id)) continue;
      const set = { ...patch.set } as Record<string, unknown>;
      for (const f of protectedFields(patch.id)) delete set[f];
      next[patch.id] = { ...cur, ...set } as Item;
    }
    for (const id of msg.delete ?? []) {
      // Our own newer re-creation of the item (an undo, say) outranks this delete.
      if (wholeProtected(id)) continue;
      delete next[id];
    }

    if (mine) {
      const touched = [...(msg.upsert ?? []).map((i) => i.id), ...(msg.patch ?? []).map((p) => p.id), ...(msg.delete ?? [])];
      for (const id of touched) this.settle(id, seq);
    }
    const selection = s.selection.filter((id) => next[id]);
    this.store.set({ items: next, selection: selection.length === s.selection.length ? s.selection : selection });
  }

  /** Forgets the parts of our pending changes to an item that the echo for `seq` confirmed. */
  private settle(id: string, seq: number): void {
    const p = this.pending.get(id);
    if (!p) return;
    if (p.all && p.all <= seq) p.all = 0;
    for (const [f, fs] of p.fields) if (fs <= seq) p.fields.delete(f);
    if (!p.all && !p.fields.size) this.pending.delete(id);
  }

  private markPending(ops: ItemOps, seq: number): void {
    const entry = (id: string): Pending => {
      let p = this.pending.get(id);
      if (!p) {
        p = { all: 0, fields: new Map() };
        this.pending.set(id, p);
      }
      return p;
    };
    for (const item of ops.upsert ?? []) entry(item.id).all = seq;
    for (const p of ops.patch ?? []) {
      const e = entry(p.id);
      for (const f of Object.keys(p.set)) e.fields.set(f, seq);
    }
    for (const id of ops.delete ?? []) entry(id).all = seq;
  }

  // ---------------------------------------------------------------- item changes

  /** Applies a change locally, sends it, and (by default) records it for undo. */
  change(ops: ItemOps, undoable = true): void {
    if (isEmptyOps(ops)) return;
    if (undoable) {
      this.undoStack.push({ sceneId: this.sceneOf(ops), redo: ops, undo: inverseOps(this.state.items, ops) });
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      this.redoStack = [];
    }
    this.applyLocal(ops);
    this.refreshUndoFlags();
  }

  /** The scene a change belongs to. */
  private sceneOf(ops: ItemOps): string | null {
    const items = this.state.items;
    const id = ops.upsert?.[0]?.sceneId ?? items[ops.patch?.[0]?.id ?? ""]?.sceneId ?? items[ops.delete?.[0] ?? ""]?.sceneId;
    return id ?? this.state.viewSceneId;
  }

  private applyLocal(ops: ItemOps): void {
    const open = this.ready && this.ws?.readyState === WebSocket.OPEN;
    for (const chunk of chunkOps(ops, OPS_PER_MESSAGE)) {
      if (!open) {
        // Offline (or the connection is closing): show it now, send it once we're back.
        this.outbox.push({ kind: "items", ops: chunk });
        continue;
      }
      const seq = ++this.seq;
      this.markPending(chunk, seq);
      this.inflight.set(seq, chunk);
      this.ws!.send(JSON.stringify({ t: "items", seq, ...chunk } satisfies ClientMsg));
    }
    this.store.set((s) => {
      const items = applyOps(s.items, ops);
      const selection = s.selection.filter((id) => items[id]);
      return { items, selection: selection.length === s.selection.length ? s.selection : selection };
    });
  }

  private refreshUndoFlags(): void {
    const view = this.state.viewSceneId;
    const canUndo = this.undoStack.some((e) => e.sceneId === view);
    const canRedo = this.redoStack.some((e) => e.sceneId === view);
    if (canUndo !== this.state.canUndo || canRedo !== this.state.canRedo) this.store.set({ canUndo, canRedo });
  }

  /** Undoes your latest change on the scene you're looking at (never on a scene you can't see). */
  undo(): void {
    const view = this.state.viewSceneId;
    const i = this.undoStack.findLastIndex((e) => e.sceneId === view);
    if (i < 0) return;
    const [entry] = this.undoStack.splice(i, 1);
    this.redoStack.push(entry);
    this.applyStep(entry.undo, entry.scene?.before);
    this.refreshUndoFlags();
  }

  redo(): void {
    const view = this.state.viewSceneId;
    const i = this.redoStack.findLastIndex((e) => e.sceneId === view);
    if (i < 0) return;
    const [entry] = this.redoStack.splice(i, 1);
    this.undoStack.push(entry);
    this.applyStep(entry.redo, entry.scene?.after);
    this.refreshUndoFlags();
  }

  /**
   * Applies item changes together with a scene change. Whichever half covers more of
   * the map goes first, so players never glimpse the map in between.
   */
  private applyStep(ops: ItemOps, scene?: Scene): void {
    if (!scene) return this.applyLocal(ops);
    const covering = scene.fogCover && !this.state.scenes[scene.id]?.fogCover;
    if (covering) {
      this.upsertScene(scene);
      this.applyLocal(ops);
    } else {
      this.applyLocal(ops);
      this.upsertScene(scene);
    }
  }

  /** Changes a scene and its items as one undoable step. */
  changeScene(after: Scene, ops: ItemOps): void {
    const before = this.state.scenes[after.id];
    if (!before) return;
    this.undoStack.push({ sceneId: after.id, redo: ops, undo: inverseOps(this.state.items, ops), scene: { before, after } });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.applyStep(ops, after);
    this.refreshUndoFlags();
  }

  /**
   * Cover all (the whole scene goes dark for players) or Clear all (players see it
   * all): sets the scene's base cover and removes its fog shapes, in one undoable step.
   */
  resetFog(sceneId: string, cover: boolean): void {
    const scene = this.state.scenes[sceneId];
    if (!scene) return;
    const ids = Object.values(this.state.items)
      .filter((i) => i.kind === "fog" && i.sceneId === sceneId)
      .map((i) => i.id);
    this.changeScene({ ...scene, fogCover: cover }, ids.length ? { delete: ids } : {});
  }

  nextZ(sceneId: string, kind: ItemKind): number {
    let z = 0;
    for (const item of Object.values(this.state.items)) {
      if (item.sceneId === sceneId && item.kind === kind && item.z >= z) z = item.z + 1;
    }
    return z;
  }

  minZ(sceneId: string, kind: ItemKind): number {
    let z = 0;
    for (const item of Object.values(this.state.items)) {
      if (item.sceneId === sceneId && item.kind === kind && item.z <= z) z = item.z - 1;
    }
    return z;
  }

  canMoveItem(item: Item): boolean {
    const s = this.state;
    if (!s.me || !s.room) return false;
    return canMove(item, s.me, s.room.settings);
  }

  addToken(opts: Partial<Pick<TokenItem, "assetId" | "color" | "label" | "size">>, at?: Point): TokenItem | null {
    const s = this.state;
    const scene = this.viewScene;
    if (!scene || !s.me || !s.room) return null;
    if (!this.isGm && !s.room.settings.playersCanAddTokens) {
      this.toast("The GM has turned off adding tokens.", "error");
      return null;
    }
    const size = opts.size ?? 1;
    const raw = at ?? this.board?.viewCenter() ?? { x: scene.width / 2, y: scene.height / 2 };
    let pos = scene.grid.snap ? snapTokenCenter(raw, size, scene.grid) : raw;
    if (!at) pos = this.freeSpotNear(scene, pos);
    const token: TokenItem = {
      id: randomId(12),
      sceneId: scene.id,
      kind: "token",
      z: this.nextZ(scene.id, "token"),
      owner: s.me.userId,
      x: pos.x,
      y: pos.y,
      size,
      rotation: 0,
      assetId: opts.assetId ?? null,
      color: opts.color ?? s.me.color,
      label: opts.label ?? "",
      hidden: false,
      locked: false,
      rings: [],
    };
    this.change({ upsert: [token] });
    this.store.set({ selection: [token.id], tool: "select" });
    return token;
  }

  /** The nearest grid position to `p` (spiralling outwards) that no token already sits on. */
  private freeSpotNear(scene: Scene, p: Point): Point {
    const g = scene.grid.size;
    const step = cellSpacing(scene.grid);
    const taken = Object.values(this.state.items).filter(
      (i): i is TokenItem => i.kind === "token" && i.sceneId === scene.id,
    );
    const free = (q: Point) => taken.every((t) => Math.hypot(t.x - q.x, t.y - q.y) >= g * 0.5);
    for (let ring = 0; ring <= 8; ring++) {
      const candidates: [number, number][] = [];
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) candidates.push([dx, dy]);
        }
      }
      // Nearest first; among equals, start to the right and go clockwise.
      const angle = ([dx, dy]: [number, number]) => (Math.atan2(dy, dx) + 2 * Math.PI) % (2 * Math.PI);
      candidates.sort((a, b) => Math.hypot(...a) - Math.hypot(...b) || angle(a) - angle(b));
      for (const [dx, dy] of candidates) {
        const raw = { x: p.x + dx * step.x, y: p.y + dy * step.y };
        const q = isHex(scene.grid) ? snapTokenCenter(raw, 1, scene.grid) : raw;
        if (q.x < 0 || q.y < 0 || q.x > scene.width || q.y > scene.height) continue;
        if (free(q)) return q;
      }
    }
    return p;
  }

  addNote(text: string, at: { x: number; y: number; fontSize: number }, hidden = false): void {
    const s = this.state;
    const scene = this.viewScene;
    if (!scene || !s.me || !text.trim()) return;
    const note: DrawingItem = {
      id: randomId(12),
      sceneId: scene.id,
      kind: "drawing",
      z: this.nextZ(scene.id, "drawing"),
      owner: s.me.userId,
      shape: "text",
      points: [at.x, at.y],
      color: s.drawOpts.color,
      width: at.fontSize,
      fill: false,
      text: text.trim(),
      ...(hidden && this.isGm ? { hidden: true } : {}),
    };
    this.change({ upsert: [note] });
  }

  // ---------------------------------------------------------------- everything else

  setTool(tool: ToolId): void {
    if (tool === "fog" && !this.isGm) return;
    const s = this.state;
    // "Player view" belongs to the fog tool; leaving the tool leaves the preview.
    this.store.set({ tool, ...(tool !== "fog" && s.fogOpts.preview ? { fogOpts: { ...s.fogOpts, preview: false } } : {}) });
  }

  select(ids: string[]): void {
    const cur = this.state.selection;
    if (cur.length === ids.length && cur.every((id, i) => id === ids[i])) return;
    this.store.set({ selection: ids });
  }

  setPanel(panel: PanelId | null): void {
    this.store.set((s) => ({ panel, unread: panel === "chat" ? 0 : s.unread }));
  }

  sendChat(text: string): void {
    const t = text.trim();
    if (!t) return;
    const m = /^\/(?:r|roll)\s+(.+)$/i.exec(t);
    if (m) this.roll(m[1]);
    else this.send({ t: "chat", text: t });
  }

  roll(expr: string, opts: { private?: boolean; label?: string } = {}): void {
    this.send({ t: "roll", expr, ...opts });
  }

  upsertScene(scene: Scene): void {
    this.scenePending.set(scene.id, (this.scenePending.get(scene.id) ?? 0) + 1);
    this.store.set((s) => ({ scenes: { ...s.scenes, [scene.id]: scene } }));
    this.send({ t: "scene.upsert", scene });
  }

  deleteScene(id: string): void {
    this.send({ t: "scene.delete", id });
  }

  activateScene(id: string): void {
    this.store.set({ viewSceneId: id, selection: [] });
    this.refreshUndoFlags();
    this.send({ t: "scene.activate", id });
  }

  viewSceneLocally(id: string): void {
    this.store.set({ viewSceneId: id, selection: [] });
    this.refreshUndoFlags();
  }

  updateRoom(update: { name?: string; settings?: Partial<RoomSettings> }): void {
    const room = this.state.room;
    if (room) {
      this.store.set({
        room: { ...room, name: update.name ?? room.name, settings: { ...room.settings, ...update.settings } },
      });
    }
    this.send({ t: "room.update", ...update });
  }

  /** Changes initiative: shown at once, confirmed (or corrected) by the server. */
  initiativeOp(op: InitOp): void {
    this.initPending++;
    this.store.set((s) => ({ initiative: applyInitOp(s.initiative, op) }));
    this.send({ t: "initiative.op", op });
  }

  renameAsset(id: string, name: string): void {
    const asset = this.state.assets[id];
    if (asset) this.store.set((s) => ({ assets: { ...s.assets, [id]: { ...asset, name } } }));
    this.send({ t: "asset.rename", id, name });
  }

  deleteAsset(id: string): void {
    this.store.set((s) => {
      const assets = { ...s.assets };
      delete assets[id];
      return { assets };
    });
    this.send({ t: "asset.delete", id });
  }

  setProfile(name: string, color: string): void {
    this.profile = { ...this.profile, name, color };
    saveProfile(this.profile);
    const me = this.state.me;
    if (me) this.store.set({ me: { ...me, name, color } });
    this.send({ t: "profile", name, color });
  }

  get profileInfo(): Profile {
    return this.profile;
  }

  async upload(files: File[], kind: AssetKind): Promise<Asset[]> {
    const out: Asset[] = [];
    this.store.set((s) => ({ uploading: s.uploading + files.length }));
    for (const file of files) {
      try {
        const asset = await uploadImage(this.roomId, file, kind, this.profile.uid);
        this.store.set((s) => ({ assets: { ...s.assets, [asset.id]: asset } }));
        out.push(asset);
      } catch (err) {
        this.toast(`${file.name}: ${(err as Error).message}`, "error");
      } finally {
        this.store.set((s) => ({ uploading: s.uploading - 1 }));
      }
    }
    return out;
  }

  /** Uploads token images and places them in a row starting at `at`. */
  async uploadTokens(files: File[], at?: Point): Promise<void> {
    const scene = this.viewScene;
    const assets = await this.upload(files, "token");
    let x = at?.x;
    for (const asset of assets) {
      const p = x !== undefined && at ? { x, y: at.y } : undefined;
      this.addToken({ assetId: asset.id, label: "" }, p);
      if (x !== undefined && scene) x += scene.grid.size;
    }
  }

  toast(text: string, kind: Toast["kind"] = "info"): void {
    this.pushToast({ kind, text }, kind === "error" ? 6000 : 3500);
  }

  private pushToast(t: Omit<Toast, "id">, ttl: number): void {
    const id = ++this.toastSeq;
    this.store.set((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }));
    setTimeout(() => this.dismissToast(id), ttl);
  }

  dismissToast(id: number): void {
    this.store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  }
}
