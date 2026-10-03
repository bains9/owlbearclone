// The browser side of a room: holds the state, talks to the Room Durable Object
// over a WebSocket, applies the user's own changes immediately (optimistically),
// reconciles them with what the server confirms, and keeps an undo history.

import { randomId } from "../../shared/ids";
import { applyInitOp } from "../../shared/initiative";
import type { InitOp } from "../../shared/initiative";
import { applyOps, inverseOps, isEmptyOps } from "../../shared/ops";
import type { ItemMap } from "../../shared/ops";
import { canMove } from "../../shared/permissions";
import type { ClientAction, ClientMsg, Ephemeral, ItemOps, MeasureShape, ScenePatch, ServerMsg } from "../../shared/protocol";
import { CLOSE_DELETED, CLOSE_NOT_FOUND, PROTOCOL_VERSION } from "../../shared/protocol";
import { cellSpacing, isHex, snapTokenCenter } from "../../shared/geometry";
import type { Point } from "../../shared/geometry";
import type {
  Asset,
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
  SceneMapData,
  TokenItem,
} from "../../shared/types";
import type { FloorId, StampId } from "../../shared/terrain";
import { BUILD_ID } from "../../shared/build";
import { uploadImage } from "../api";
import type { Uploaded } from "../api";
import type { MapFile } from "../mapImport";
import { saveProfile } from "../identity";
import type { Profile } from "../identity";
import { Store } from "../store";
import { composeBuildUndo } from "./build";
import { canFold, pressX } from "./buildInput";
import type { SelectReturn, WheelPref } from "./buildInput";
import type { SceneDataState } from "./mapData";

export type ToolId = "select" | "draw" | "erase" | "fog" | "build" | "measure" | "pointer";

/** Tools only the GM has. */
export const GM_TOOLS: ToolId[] = ["fog", "build"];
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

/** How the Building and Terrain modes paint: drag out a rectangle or an oval, or brush. */
export type BuildShape = "rect" | "circle" | "brush";

/**
 * The Build tool (GM): painting floors, walls, doors and objects onto the grid. The
 * modes are named after Dungeondraft's tools, which the GM knows: Building, Wall,
 * Portal (doors), Terrain, Object and Select.
 */
export interface BuildOptions {
  mode: "building" | "walls" | "doors" | "terrain" | "stamps" | "select";
  shape: { building: BuildShape; terrain: BuildShape };
  /**
   * What each paints: a room's floor (stone, wood or dirt), or grass, water or lava; or
   * "erase" (which takes the walls, doors and objects on those squares too).
   */
  floor: { building: Extract<FloorId, "s" | "w" | "d"> | "erase"; terrain: Extract<FloorId, "g" | "a" | "l"> | "erase" };
  /** Floor brush size in squares (1-5). */
  brush: number;
  /**
   * Floor: walls where stone, wood or dirt meets empty space, by scene, where the GM has
   * chosen. Otherwise on for a blank scene, off over an uploaded map (a patch shouldn't
   * get walled in).
   */
  walls: Record<string, boolean>;
  /** Walls: add them, or take them away (also where they'd be drawn automatically). */
  wallMode: "add" | "remove";
  /** Doors: what a click on a wall makes. */
  doorStyle: "open" | "door" | "secret";
  stamp: StampId;
  /** Objects: size in squares of the next one placed, ½ to 3 in quarter squares. */
  stampSize: number;
  /** Objects: degrees clockwise of the next one placed, 0-355 in 5° steps. */
  stampDeg: number;
  stampMode: "place" | "remove";
  /** Select: where X (or Back) goes back to. */
  selectReturn: SelectReturn | null;
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
  buildOpts: BuildOptions;
  measureOpts: MeasureOptions;
  /**
   * Set while the GM is lining the grid up by drawing a box on the map: how many
   * squares across the box will cover.
   */
  gridAlign: { cells: number } | null;
  /** Map files dropped or pasted onto the board, waiting in the new-scene dialog. */
  mapImport: File[] | null;
  /** GM: table displays follow this tab's view of the live scene (otherwise they show all of it). */
  displayFollow: boolean;
  /** The server is running a newer Tabletop than this tab: it should reload. */
  outdated: boolean;
  /** This device shows maps as drawn, without their season (a slow device, say). */
  seasonsOff: boolean;
  /** How much of each map (by asset id) is open ground, once a season has analysed it. */
  mapOutdoor: Record<string, number>;
  /** Each scene's Dungeondraft data state on this device (by scene id), for the Season notes (6.1). */
  mapDataState: Record<string, SceneDataState>;
  /** Build › Select: how many objects and doors are selected, and whether they can grow or shrink. */
  buildSel: { objects: number; doors: number; canGrow: boolean; canShrink: boolean };
  /** This tab holds objects copied in Build › Select (so Paste has something to paste). */
  buildClip: boolean;
  /** What this device's mouse wheel does over objects in the Build tool (remembered in the browser). */
  wheelTurns: WheelPref;
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

/** The buttons of Build › Select's bars. */
export type BuildAction =
  | "turnLeft"
  | "turnRight"
  | "turn90"
  | "smaller"
  | "bigger"
  | "duplicate"
  | "copy"
  | "paste"
  | "delete"
  | "deselect";

/** What the board exposes to the rest of the app. */
export interface BoardApi {
  viewCenter(): Point;
  centerOn(p: Point): void;
  fit(): void;
  zoomBy(factor: number): void;
  /** Build › Select: does what a button in its bars does. */
  buildAction(a: BuildAction): void;
  /** Build › Select: selects nothing. */
  clearBuildSelection(): void;
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
  /**
   * A change to the scene itself that belongs to the same step (covering it in fog, a
   * new map): just the settings it changed, as they were before and after.
   */
  scene?: { before: ScenePatch; after: ScenePatch };
  /** Undo and redo worked out when they're used, from the items as they are then (build steps). */
  steps?: { undo: (items: ItemMap) => ItemOps; redo: (items: ItemMap) => ItemOps };
  /** Build steps that fold into this one (a burst of turning): which burst, and when the last came. */
  coalesce?: { key: string; at: number };
}

const MAX_MESSAGES = 300;
const MAX_UNDO = 200;
/** Big changes (clearing a scene's fog, say) are sent in pieces of this many operations. */
const OPS_PER_MESSAGE = 1000;
/** How long a ping may go unanswered before the connection is treated as dead. */
const PING_TIMEOUT_MS = 20_000;
/**
 * How long to wait for a connection to open and the room to arrive. Generous: the
 * room can be several megabytes, and a slow connection may take a while to fetch it.
 */
const HELLO_TIMEOUT_MS = 120_000;

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

/**
 * The settings that say which map a scene shows: what fog covers or uncovers. (Not the
 * grid, so undoing Cover all doesn't also undo a later grid alignment.)
 */
const MAP_FIELDS: (keyof Scene)[] = ["mapAssetId", "width", "height"];

/** A scene with some settings changed. A scene we don't have is only added when it's new. */
function mergeScene(scenes: Record<string, Scene>, patch: ScenePatch, create: boolean): Record<string, Scene> {
  const cur = scenes[patch.id];
  if (!cur && !create) return scenes;
  // A setting given as undefined never reaches the server (JSON leaves it out), so it
  // changes nothing here either.
  const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as ScenePatch;
  const next = { ...cur, ...set } as Scene & {
    season?: Scene["season"] | null;
    mapData?: Scene["mapData"] | null;
    mapRect?: Scene["mapRect"] | null;
  };
  // A season of null means "turned off": the scene simply has none. The same for the
  // Dungeondraft data and the picture's rectangle: null removes them.
  if (next.season === null) delete next.season;
  if (next.mapData === null) delete next.mapData;
  if (next.mapRect === null) delete next.mapRect;
  // As on the server: a new picture (or none) drops the old one's rectangle unless the
  // change brings its own.
  if (cur && set.mapAssetId !== undefined && set.mapAssetId !== cur.mapAssetId && set.mapRect === undefined) {
    delete next.mapRect;
  }
  return { ...scenes, [patch.id]: next as Scene };
}

const SEASONS_OFF_KEY = "tabletop-seasons-off";
const WHEEL_TURNS_KEY = "tabletop-wheel-turns";

/** Whether this device has seasonal looks turned off (remembered in the browser). */
function loadSeasonsOff(): boolean {
  try {
    return localStorage.getItem(SEASONS_OFF_KEY) === "1";
  } catch {
    return false;
  }
}

/** What this device's mouse wheel does over objects (remembered in the browser; "auto" to begin with). */
function loadWheelTurns(): WheelPref {
  try {
    const v = localStorage.getItem(WHEEL_TURNS_KEY);
    return v === "always" || v === "never" ? v : "auto";
  } catch {
    return "auto";
  }
}

/**
 * Reloads the page for a newer version, unless it only just did (and was still told it's
 * out of date, perhaps an old copy of the page on its way out): then it tries again later.
 */
function reloadOnce(): void {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem("tabletop-reloaded") ?? 0);
    sessionStorage.setItem("tabletop-reloaded", String(Date.now()));
  } catch {
    // No storage: go by time alone.
  }
  if (Date.now() - last < 60_000) setTimeout(() => location.reload(), 120_000);
  else location.reload();
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
  /** Connections in a row that timed out waiting for the room: each waits twice as long as the last. */
  private helloTimeouts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastPong = 0;
  private pingSentAt = 0;
  private connectedAt = 0;
  /** Names this browser tab to the server, which remembers the last seq it applied from it. */
  private readonly sid = randomId(16);
  private seq = 0;
  private pending = new Map<string, Pending>();
  /**
   * Every change we've sent, or will send once connected, that the server hasn't
   * confirmed yet, in seq order. After a reconnect the server says which of them it
   * already has; the rest are applied again on top of the fresh state and resent
   * under the same seq, so none is lost and none is applied twice.
   */
  private unacked: { seq: number; action: ClientAction }[] = [];
  /** Scene id -> seq of our latest change to it that the server hasn't echoed yet. */
  private scenePending = new Map<string, number>();
  /** Seq of our latest initiative change the server hasn't echoed yet (0: none). */
  private initPending = 0;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private ephListeners = new Set<(from: string, e: Ephemeral) => void>();
  private toastSeq = 0;

  /** A table display: shows the live scene as players see it, and never changes anything. */
  readonly display: boolean;

  constructor(
    readonly roomId: string,
    private profile: Profile,
    private readonly displayKey: string | null = null,
  ) {
    this.display = displayKey !== null;
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
      buildOpts: {
        mode: "building",
        shape: { building: "rect", terrain: "brush" },
        floor: { building: "s", terrain: "g" },
        brush: 1,
        walls: {},
        wallMode: "add",
        doorStyle: "door",
        stamp: "table",
        stampSize: 1,
        stampDeg: 0,
        stampMode: "place",
        selectReturn: null,
      },
      measureOpts: { shape: "ruler", keep: false },
      textPrompt: null,
      mapImport: null,
      displayFollow: false,
      outdated: false,
      // A table display always shows the season, like any player's screen: one opened in the
      // GM's own browser mustn't take on the GM's "seasons off" for this device.
      seasonsOff: displayKey === null && loadSeasonsOff(),
      mapOutdoor: {},
      mapDataState: {},
      buildSel: { objects: 0, doors: 0, canGrow: false, canShrink: false },
      buildClip: false,
      wheelTurns: displayKey === null ? loadWheelTurns() : "auto",
      gridAlign: null,
      selection: [],
      panel: typeof window !== "undefined" && window.innerWidth >= 900 && displayKey === null ? "chat" : null,
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
    // v: the protocol version this code speaks (3: objects at any angle and size). b: its
    // build, so the server can say when this tab is out of date.
    const qs = new URLSearchParams({
      uid: p.uid,
      name: p.name,
      color: p.color,
      sid: this.sid,
      v: String(PROTOCOL_VERSION),
      b: BUILD_ID,
    });
    if (this.displayKey !== null) qs.set("display", this.displayKey);
    const ws = new WebSocket(`${proto}//${location.host}/api/rooms/${this.roomId}/ws?${qs}`);
    this.ws = ws;
    this.ready = false;
    this.connectedAt = Date.now();
    this.pingSentAt = 0;
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
   * room isn't a dead one, so only an unanswered ping counts as dead. Until the room
   * has arrived there's no pinging: a pong would queue behind a big room on a slow
   * connection, so only the (much longer) hello timeout applies.
   */
  private checkHeartbeat(): void {
    const ws = this.ws;
    if (!ws) return;
    if (!this.ready) {
      const wait = HELLO_TIMEOUT_MS * 2 ** Math.min(this.helloTimeouts, 4);
      if (ws.readyState <= WebSocket.OPEN && Date.now() - this.connectedAt > wait) {
        this.helloTimeouts++;
        this.restart();
      }
      return;
    }
    if (ws.readyState !== WebSocket.OPEN) return;
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
    } else if (ws.readyState === WebSocket.OPEN && this.ready) {
      // Back from sleep, the socket may be dead without knowing it. Ask, and give up
      // on it quickly if there's no answer. (Still loading the room: the hello
      // timeout looks after that.)
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

  /**
   * Makes a change: shows it here at once, sends it (or, offline, keeps it for the
   * next connection), and keeps it until the server confirms it.
   */
  private submit(action: ClientAction, seq = ++this.seq): void {
    if (this.display) return;
    this.unacked.push({ seq, action });
    this.effect(action, seq);
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ...action, seq } as ClientMsg));
    }
  }

  /** What a change looks like here before the server has confirmed it. */
  private effect(action: ClientAction, seq: number): void {
    switch (action.t) {
      case "items": {
        const { scene } = action;
        this.markPending(action, seq);
        if (scene) this.scenePending.set(scene.id, seq);
        this.store.set((s) => {
          const items = applyOps(s.items, action);
          const selection = s.selection.filter((id) => items[id]);
          return {
            items,
            selection: selection.length === s.selection.length ? s.selection : selection,
            ...(scene ? { scenes: mergeScene(s.scenes, scene, false) } : {}),
          };
        });
        return;
      }
      case "scene.upsert":
        this.scenePending.set(action.scene.id, seq);
        this.store.set((s) => ({ scenes: mergeScene(s.scenes, action.scene, !!action.create) }));
        return;
      case "initiative.op":
        this.initPending = seq;
        this.store.set((s) => ({ initiative: applyInitOp(s.initiative, action.op) }));
        return;
      case "room.update": {
        const room = this.state.room;
        if (room) {
          this.store.set({
            room: { ...room, name: action.name ?? room.name, settings: { ...room.settings, ...action.settings } },
          });
        }
        return;
      }
      case "asset.rename": {
        const asset = this.state.assets[action.id];
        if (asset) this.store.set((s) => ({ assets: { ...s.assets, [action.id]: { ...asset, name: action.name } } }));
        return;
      }
      case "asset.delete":
        this.store.set((s) => {
          const assets = { ...s.assets };
          delete assets[action.id];
          return { assets };
        });
        return;
      default:
        return;
    }
  }

  /** The server has handled every change up to and including `seq`. */
  private confirm(seq: number): void {
    let n = 0;
    while (n < this.unacked.length && this.unacked[n].seq <= seq) n++;
    if (n) this.unacked.splice(0, n);
  }

  /**
   * Whether a scene from the server should replace ours: not while a change of ours to
   * it is unconfirmed, unless this is the echo of (or correction to) that change.
   */
  private sceneSettled(id: string, echoSeq: number | undefined): boolean {
    const waiting = this.scenePending.get(id);
    if (waiting === undefined) return true;
    if (echoSeq === undefined || echoSeq < waiting) return false;
    this.scenePending.delete(id);
    return true;
  }

  sendEph(e: Ephemeral): void {
    if (this.display) return;
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
        this.helloTimeouts = 0;
        const scenes = toMap(msg.scenes);
        const items = toMap(msg.items);
        const gm = msg.you.role === "gm";
        const view =
          gm && s.viewSceneId && scenes[s.viewSceneId] ? s.viewSceneId : (msg.activeSceneId ?? msg.scenes[0]?.id ?? null);
        this.pending.clear();
        this.scenePending.clear();
        this.initPending = 0;
        // Changes the server never got (lost with the old connection, or made offline):
        // apply them again on top of the fresh state and send them.
        const replay = this.unacked.filter((u) => u.seq > (msg.lastSeq ?? 0));
        this.unacked = [];
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
          tool: !gm && GM_TOOLS.includes(s.tool) ? "select" : s.tool,
        });
        document.title = `${msg.room.name} · Tabletop`;
        this.ready = true;
        for (const u of replay) this.submit(u.action, u.seq);
        this.refreshUndoFlags();
        return;
      }

      case "items":
        this.applyServerItems(msg);
        return;

      case "scene.upsert": {
        // While an edit of ours to this scene is unconfirmed, older versions (our own
        // earlier edits, or someone else's the server ordered before ours) are stale.
        const echo = msg.by === s.me?.connId ? msg.seq : undefined;
        if (!this.sceneSettled(msg.scene.id, echo)) return;
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

      case "initiative": {
        // As with scenes: keep our own unconfirmed change until its echo arrives.
        if (this.initPending) {
          const echo = msg.by === s.me?.connId ? msg.seq : undefined;
          if (echo === undefined || echo < this.initPending) return;
          this.initPending = 0;
        }
        this.store.set({ initiative: msg.initiative });
        return;
      }

      case "ack":
        this.confirm(msg.seq);
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

      case "outdated":
        // A newer Tabletop is running. A table display (nothing to lose, and nobody at it
        // to click anything) reloads itself; anyone else gets a reload button.
        if (this.display) {
          reloadOnce();
        } else if (!s.outdated) {
          this.store.set({ outdated: true });
          this.toast("Tabletop has been updated. Reload this page to get the new version.");
        }
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
    if (mine) this.confirm(seq);
    const scene = msg.scene && this.sceneSettled(msg.scene.id, mine ? seq : undefined) ? msg.scene : null;

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
    this.store.set({
      items: next,
      selection: selection.length === s.selection.length ? s.selection : selection,
      // In the same update as the items, so the map never shows between the two.
      ...(scene ? { scenes: { ...s.scenes, [scene.id]: scene } } : {}),
    });
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

  /**
   * A change whose undo and redo are worked out when they're used, from the state as it
   * is then (a build step, which must never put back more than it changed). With a
   * `coalesce` key, it folds into the step on top when that one is from the same burst
   * (turning with the mouse wheel, say), so one undo takes back the whole burst.
   */
  changeWith(ops: ItemOps, sceneId: string, steps: NonNullable<UndoEntry["steps"]>, coalesce?: string): void {
    if (isEmptyOps(ops)) return;
    const now = Date.now();
    const top = this.undoStack.at(-1);
    if (coalesce !== undefined && top?.steps && canFold(top, coalesce, sceneId, now, !this.redoStack.length)) {
      top.steps = composeBuildUndo(top.steps, steps);
      top.coalesce = { key: coalesce, at: now };
    } else {
      this.undoStack.push({
        sceneId,
        redo: ops,
        undo: inverseOps(this.state.items, ops),
        steps,
        ...(coalesce !== undefined ? { coalesce: { key: coalesce, at: now } } : {}),
      });
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

  /**
   * Sends item changes: in pieces when there are many, but with a scene change all in
   * one message, which the server applies completely or not at all. (A scene step only
   * touches one scene's items, and the server takes a whole scene's worth at once.)
   */
  private applyLocal(ops: ItemOps, scene?: ScenePatch): void {
    if (scene) {
      this.submit({ t: "items", ...ops, scene });
      return;
    }
    for (const chunk of chunkOps(ops, OPS_PER_MESSAGE)) this.submit({ t: "items", ...chunk });
  }

  private refreshUndoFlags(): void {
    const view = this.state.viewSceneId;
    const canUndo = this.undoStack.some((e) => e.sceneId === view);
    const canRedo = this.redoStack.some((e) => e.sceneId === view);
    if (canUndo !== this.state.canUndo || canRedo !== this.state.canRedo) this.store.set({ canUndo, canRedo });
  }

  /** Undoes your latest change on the scene you're looking at (never on a scene you can't see). */
  undo(): void {
    // As in Dungeondraft, undo and redo leave nothing selected in Build › Select.
    this.board?.clearBuildSelection();
    const view = this.state.viewSceneId;
    const i = this.undoStack.findLastIndex((e) => e.sceneId === view);
    if (i < 0) return;
    const [entry] = this.undoStack.splice(i, 1);
    this.redoStack.push(entry);
    this.applyStep(entry.steps ? entry.steps.undo(this.state.items) : entry.undo, entry.scene?.before);
    this.refreshUndoFlags();
  }

  redo(): void {
    this.board?.clearBuildSelection();
    const view = this.state.viewSceneId;
    const i = this.redoStack.findLastIndex((e) => e.sceneId === view);
    if (i < 0) return;
    const [entry] = this.redoStack.splice(i, 1);
    this.undoStack.push(entry);
    this.applyStep(entry.steps ? entry.steps.redo(this.state.items) : entry.redo, entry.scene?.after);
    this.refreshUndoFlags();
  }

  /** Applies item changes together with a scene change: players never see one without the other. */
  private applyStep(ops: ItemOps, scene?: ScenePatch): void {
    if (!scene || !this.state.scenes[scene.id]) return this.applyLocal(ops);
    this.applyLocal(ops, scene);
  }

  /** Changes some of a scene's settings and its items as one undoable step. */
  changeScene(id: string, change: Omit<ScenePatch, "id">, ops: ItemOps): void {
    const current = this.state.scenes[id];
    if (!current) return;
    // A setting given as undefined is left alone (as the server would), never cleared.
    const set = Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined)) as Omit<ScenePatch, "id">;
    // A new picture (or none) makes the rectangle stale (2.8): it goes in the same step, so
    // undoing the change puts it back.
    if (set.mapAssetId !== undefined && set.mapAssetId !== current.mapAssetId && current.mapRect && !("mapRect" in set)) {
      set.mapRect = null;
    }
    // Only the settings this changes: undo puts those back and leaves the rest alone.
    // Covering or uncovering also records the map it was done on, so undoing it after
    // the map was swapped puts that map back rather than uncovering the new one.
    const keys = new Set(Object.keys(set) as (keyof Scene)[]);
    if (keys.has("fogCover")) for (const k of MAP_FIELDS) keys.add(k);
    const before: ScenePatch = { id };
    const after: ScenePatch = { id };
    for (const k of keys) {
      // A setting the scene doesn't have (no season yet) is recorded as null, so undoing it
      // turns it off again (a missing key would leave it as it was).
      (before as Record<string, unknown>)[k] = current[k] ?? null;
      (after as Record<string, unknown>)[k] = (k in set ? (set as Record<string, unknown>)[k] : current[k]) ?? null;
    }
    this.undoStack.push({ sceneId: id, redo: ops, undo: inverseOps(this.state.items, ops), scene: { before, after } });
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
    this.changeScene(sceneId, { fogCover: cover }, ids.length ? { delete: ids } : {});
  }

  /**
   * Attaches, changes or (with null) removes a scene's Dungeondraft data for seasons, in one
   * undoable step. also: the picture's rectangle in its map, set in the same step.
   */
  setMapData(sceneId: string, md: SceneMapData | null, also: Pick<ScenePatch, "mapRect"> = {}): void {
    this.changeScene(sceneId, { ...also, mapData: md }, {});
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

  /** Seasonal looks on this device: off shows every map as drawn (players still see seasons). */
  setSeasonsOff(off: boolean): void {
    // A table display has no such setting (and mustn't change the one it shares with the GM's tabs).
    if (this.display) return;
    try {
      if (off) localStorage.setItem(SEASONS_OFF_KEY, "1");
      else localStorage.removeItem(SEASONS_OFF_KEY);
    } catch {
      // Not remembered, but still applies until the page reloads.
    }
    this.store.set({ seasonsOff: off });
  }

  /** What this device's mouse wheel does over objects in the Build tool. */
  setWheelTurns(v: WheelPref): void {
    if (this.display) return;
    try {
      if (v === "auto") localStorage.removeItem(WHEEL_TURNS_KEY);
      else localStorage.setItem(WHEEL_TURNS_KEY, v);
    } catch {
      // Not remembered, but still applies until the page reloads.
    }
    this.store.set({ wheelTurns: v });
  }

  /**
   * Picks a tool. A change of tool other than X's forgets where X would go back to, and the
   * Build tool starts with no tokens selected (so Delete and the arrow keys never reach a
   * selection that can't be seen there). X passes the Build mode and the way back with it,
   * so the board never sees the new tool in the old mode.
   */
  setTool(tool: ToolId, x?: { mode: BuildOptions["mode"]; selectReturn: SelectReturn | null }): void {
    if (GM_TOOLS.includes(tool) && !this.isGm) return;
    const s = this.state;
    const build = s.buildOpts;
    this.store.set({
      tool,
      // "Player view" belongs to the fog tool; leaving the tool leaves the preview.
      ...(tool !== "fog" && s.fogOpts.preview ? { fogOpts: { ...s.fogOpts, preview: false } } : {}),
      ...(x ? { buildOpts: { ...build, ...x } } : build.selectReturn ? { buildOpts: { ...build, selectReturn: null } } : {}),
      ...(tool === "build" && s.selection.length ? { selection: [] } : {}),
    });
  }

  /**
   * Picks one of the Build tool's modes from its bar. Select remembers the mode it was
   * picked from, for Back and X; picking any other mode forgets it.
   */
  setBuildMode(mode: BuildOptions["mode"]): void {
    const o = this.state.buildOpts;
    if (mode === o.mode) return;
    const selectReturn: SelectReturn | null = mode === "select" ? { tool: "build", buildMode: o.mode } : null;
    this.store.set({ buildOpts: { ...o, mode, selectReturn } });
  }

  /** X: Build › Select, and from there back to where you were (see pressX). */
  toggleBuildSelect(): void {
    const s = this.state;
    const scene = this.viewScene;
    const r = pressX({
      tool: s.tool,
      mode: s.buildOpts.mode,
      ret: s.buildOpts.selectReturn,
      gm: this.isGm,
      hex: !!scene && isHex(scene.grid),
    });
    if (!r) return;
    if ("toast" in r) {
      this.toast(r.toast, "error");
      return;
    }
    this.setTool(r.tool, { mode: r.mode, selectReturn: r.ret });
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
    else this.submit({ t: "chat", text: t });
  }

  roll(expr: string, opts: { private?: boolean; label?: string } = {}): void {
    this.submit({ t: "roll", expr, ...opts });
  }

  createScene(scene: Scene): void {
    this.submit({ t: "scene.upsert", scene, create: true });
  }

  /** Changes some of a scene's settings; the rest stay as they are, whoever else is changing them. */
  updateScene(id: string, set: Omit<ScenePatch, "id">): void {
    if (!this.state.scenes[id]) return;
    this.submit({ t: "scene.upsert", scene: { ...set, id } });
  }

  deleteScene(id: string): void {
    this.submit({ t: "scene.delete", id });
  }

  activateScene(id: string): void {
    this.store.set({ viewSceneId: id, selection: [] });
    this.refreshUndoFlags();
    this.submit({ t: "scene.activate", id });
  }

  viewSceneLocally(id: string): void {
    this.store.set({ viewSceneId: id, selection: [] });
    this.refreshUndoFlags();
  }

  updateRoom(update: { name?: string; settings?: Partial<RoomSettings> }): void {
    this.submit({ t: "room.update", ...update });
  }

  /** Changes initiative: shown at once, confirmed (or corrected) by the server. */
  initiativeOp(op: InitOp): void {
    this.submit({ t: "initiative.op", op });
  }

  renameAsset(id: string, name: string): void {
    this.submit({ t: "asset.rename", id, name });
  }

  deleteAsset(id: string): void {
    this.submit({ t: "asset.delete", id });
  }

  setProfile(name: string, color: string): void {
    this.profile = { ...this.profile, name, color };
    saveProfile(this.profile);
    const me = this.state.me;
    if (me) this.store.set({ me: { ...me, name, color } });
    this.submit({ t: "profile", name, color });
  }

  get profileInfo(): Profile {
    return this.profile;
  }

  async upload(files: File[], kind: "map" | "token"): Promise<Asset[]> {
    const done = await this.uploadEach(files.map((file) => ({ file })), kind);
    return done.map((d) => d.asset);
  }

  /** Uploads map images, keeping each one's map details alongside what was uploaded. */
  async uploadMaps(maps: MapFile[]): Promise<(Uploaded & { map: MapFile })[]> {
    const done = await this.uploadEach(maps.map((map) => ({ file: map.image, name: map.name, map })), "map");
    return done.map((d) => ({ ...d, map: d.map! }));
  }

  private async uploadEach<T extends { file: File; name?: string; map?: MapFile }>(
    list: T[],
    kind: "map" | "token",
  ): Promise<(Uploaded & T)[]> {
    const out: (Uploaded & T)[] = [];
    this.store.set((s) => ({ uploading: s.uploading + list.length }));
    for (const entry of list) {
      try {
        const up = await uploadImage(this.roomId, entry.file, kind, this.profile.uid, entry.name);
        this.store.set((s) => ({ assets: { ...s.assets, [up.asset.id]: up.asset } }));
        out.push({ ...entry, ...up });
      } catch (err) {
        this.toast(`${entry.name ?? entry.file.name}: ${(err as Error).message}`, "error");
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
