// WebSocket messages between the browser and the Room Durable Object.

import type { TemplateShape } from "./geometry";
import type { InitOp } from "./initiative";
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
} from "./types";

/** What the measure tool draws: a plain ruler or a spell area template. */
export type MeasureShape = "ruler" | TemplateShape;
export const MEASURE_SHAPES: MeasureShape[] = ["ruler", "circle", "cone", "square", "beam"];

/** Ephemeral events: relayed to others, never stored. */
export type Ephemeral =
  /** A drag in progress. Tokens carry their centre; drawings carry their offset from the stored points. */
  | { k: "drag"; sceneId: string; moves: { id: string; x: number; y: number }[] }
  | { k: "ruler"; sceneId: string; points: number[] | null; label?: string; shape?: MeasureShape }
  | { k: "pointer"; sceneId: string; x: number; y: number }
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

/** Some of a scene's settings: the ones left out stay as they are. */
export type ScenePatch = Partial<Scene> & { id: string };

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
  | { t: "initiative.op"; op: InitOp }
  | { t: "chat"; text: string }
  | { t: "roll"; expr: string; private?: boolean; label?: string }
  | { t: "profile"; name: string; color: string };

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
    }
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
  /** The change with this seq (and every one before it) has been handled. */
  | { t: "ack"; seq: number }
  | { t: "error"; message: string }
  | { t: "closed"; reason: "deleted" | "notfound" };

/** WebSocket close codes the client treats as final (no reconnect). */
export const CLOSE_NOT_FOUND = 4404;
export const CLOSE_DELETED = 4410;
