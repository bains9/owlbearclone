// WebSocket messages between the browser and the Room Durable Object.

import type { TemplateShape } from "./geometry";
import type { InitOp } from "./initiative";
import type { FxLook } from "./spellfx";
import type {
  Asset,
  ChatMessage,
  Initiative,
  Item,
  ItemPatch,
  Player,
  RoomInfo,
  RoomSettings,
  Scene,
  SceneDungeon,
  SceneMapData,
  SceneSeason,
} from "./types";

/**
 * The protocol version this build's browser code speaks (sent as v=). 3: objects turned to
 * any 5 degrees and sized in quarter squares. 4: compass roses (tokens with art "compass").
 * 5: Dungeon's objects and textures in built maps (stamps "d:<id>"; a chunk's tex and pal).
 * 6: objects off the grid (a stamp's column and row in sixteenths of a square), and up to 256
 * objects in a chunk.
 */
export const PROTOCOL_VERSION = 6;

/** What the measure tool draws: a plain ruler or a spell area template. */
export type MeasureShape = "ruler" | TemplateShape;
export const MEASURE_SHAPES: MeasureShape[] = ["ruler", "circle", "cone", "square", "beam"];

/** Ephemeral events: relayed to others, never stored. */
export type Ephemeral =
  /** A drag in progress. Tokens carry their centre; drawings carry their offset from the stored points. */
  | { k: "drag"; sceneId: string; moves: { id: string; x: number; y: number }[] }
  | { k: "ruler"; sceneId: string; points: number[] | null; label?: string; shape?: MeasureShape }
  /** The pointer: a point on its trail, or with ping, a click that marks a spot for a few seconds. */
  | { k: "pointer"; sceneId: string; x: number; y: number; ping?: boolean }
  /**
   * A spell effect played once (the Spells tool), in map pixels: from a (the caster, or a burst's
   * middle) to b (the target, or where a cone points); r is a burst's radius or a cone's length,
   * spread a cone's width in degrees, and seed makes everyone see the same sparks.
   */
  | { k: "fx"; sceneId: string; look: FxLook; a: [number, number]; b: [number, number]; r: number; spread?: number; color?: string; seed: number }
  /**
   * GM only, to table displays: the part of the live scene the GM is looking at, as
   * [x, y, width, height] in map pixels, or null to show the whole scene.
   */
  | { k: "view"; sceneId: string; rect: [number, number, number, number] | null };

export interface ItemOps {
  upsert?: Item[];
  patch?: ItemPatch[];
  delete?: string[];
}

/**
 * Some of a scene's settings: the ones left out stay as they are (a season of null turns it off;
 * a mapData or mapRect of null removes it).
 */
export type ScenePatch = Partial<Omit<Scene, "season" | "mapData" | "mapRect" | "wallTexture" | "bounds" | "dungeon">> & {
  id: string;
  /** null: no longer linked to Dungeon. */
  dungeon?: SceneDungeon | null;
  season?: SceneSeason | null;
  mapData?: SceneMapData | null;
  mapRect?: [number, number, number, number] | null;
  wallTexture?: string | null;
  /** null: back to the picture's own rectangle. */
  bounds?: [number, number, number, number] | null;
};

/** Everything a browser can ask the server to change. */
export type ClientAction =
  /** scene (GM only): a change to the scene itself, applied together with the items in one step. */
  | ({ t: "items"; scene?: ScenePatch } & ItemOps)
  /** Without create, a scene that no longer exists isn't brought back. */
  | { t: "scene.upsert"; scene: ScenePatch; create?: boolean }
  | { t: "scene.delete"; id: string }
  | { t: "scene.activate"; id: string }
  | { t: "asset.rename"; id: string; name: string }
  | { t: "asset.delete"; id: string }
  | { t: "room.update"; name?: string; settings?: Partial<RoomSettings> }
  /** GM only: sends everyone in this room to another of the GM's rooms (voice chat carries on). */
  | { t: "room.goto"; to: string }
  | { t: "initiative.op"; op: InitOp }
  | { t: "chat"; text: string }
  | { t: "roll"; expr: string; private?: boolean; label?: string }
  | { t: "profile"; name: string; color: string }
  /**
   * Cells of a scene's explore grid (shared/explore.ts, `key` its grid) the party has just seen;
   * with `who` (a sheet id), what that character has just seen, with per-player sight. With
   * `lit`, the cells just seen in colour (shared/explore.ts addExplored): the rest of `cells` were
   * seen only by nightvision.
   */
  | { t: "explore"; sceneId: string; key: string; cells: number[]; who?: string; lit?: number[] }
  /** GM only: the party forgets what it's explored of a scene. */
  | { t: "explore.reset"; sceneId: string };

/**
 * Every change carries a seq that counts up within one browser tab (the `sid` the
 * tab connects with). The server remembers the last seq it applied for each tab, so
 * after a reconnect the tab resends only what the server never got, and a change
 * that arrives twice (once late on the old connection, once resent) applies once.
 */
export type ClientMsg = (ClientAction & { seq: number }) | { t: "eph"; e: Ephemeral };

export type ServerMsg =
  | {
      t: "hello";
      you: Player;
      room: RoomInfo;
      scenes: Scene[];
      activeSceneId: string | null;
      items: Item[];
      assets: Asset[];
      messages: ChatMessage[];
      initiative: Initiative;
      players: Player[];
      /** The last seq from this tab the server has applied (0 for none). */
      lastSeq: number;
      /** The build of Tabletop the server is running. */
      build?: string;
      /**
       * What the party and its characters have explored of the scenes sent (shared/explore.ts), by
       * exploreSlot: the grid's key and its bits as text, and those seen in colour (`lit`) when kept.
       */
      explored?: Record<string, { key: string; bits: string; lit?: string }>;
    }
  /**
   * Cells the party (or with `who`, that character) has just explored of a scene (each sent once),
   * and with `lit`, those just seen in colour; with bits (and litBits), all it's explored of it (to
   * players, when it becomes the live scene); with reset, every explored map of the scene is forgotten.
   */
  | { t: "explore"; sceneId: string; key: string; who?: string; cells?: number[]; lit?: number[]; bits?: string; litBits?: string; reset?: boolean }
  /**
   * Item changes, and the scene change made with them, if any. `by` is the connId
   * that caused them. `seq` is present only on the copy sent back to that
   * connection, and it then also carries corrections for anything the server refused.
   */
  | ({ t: "items"; by: string; seq?: number; refused?: string[]; scene?: Scene } & ItemOps)
  /** by and seq: the connection and change this came from (the sender uses them to recognise its own echo). */
  | { t: "scene.upsert"; scene: Scene; by?: string; seq?: number }
  | { t: "scene.delete"; id: string; by?: string; seq?: number }
  /** GMs get the id only. Players also get the scene and its visible items. */
  | { t: "scene.active"; id: string | null; scene?: Scene | null; items?: Item[] }
  | { t: "asset.upsert"; asset: Asset }
  | { t: "asset.delete"; id: string }
  | { t: "room"; room: RoomInfo }
  /** Players get a copy without entries for tokens they can't see; turn is -1 when it's one of those. */
  | { t: "initiative"; initiative: Initiative; by?: string; seq?: number }
  | { t: "chat"; message: ChatMessage }
  | { t: "players"; players: Player[] }
  | { t: "eph"; from: string; e: Ephemeral }
  /** The GM sent everyone to another room: the tab goes there (its voice chat carries on). */
  | { t: "goto"; room: { id: string; name: string } }
  /** The change with this seq (and every one before it) has been handled. */
  | { t: "ack"; seq: number }
  | { t: "error"; message: string }
  /** The tab is running an older build than the server: it should reload. */
  | { t: "outdated" }
  | { t: "closed"; reason: "deleted" | "notfound" };

/** WebSocket close codes the client treats as final (no reconnect). */
export const CLOSE_NOT_FOUND = 4404;
export const CLOSE_DELETED = 4410;
