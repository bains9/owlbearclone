// The Build tool's floor picker (LibraryPicker): Tabletop's own floors and Dungeon's textures
// for the tool in use. A texture takes Dungeon 30 to 100 ms to make, so each picture shows its
// flat colour first and is made in turn, one at a time, between frames.

import { useEffect, useRef, useState } from "preact/hooks";
import type { FloorId } from "../../shared/terrain";
import { floorPattern } from "../room/buildArt";
import { WALL_TEXTURES, makeTexture, textureChoice, textureMade, textureName, texturePattern, textureSwatch } from "../room/dungeonTextures";
import { FLOOR_GROUPS, floorName, type FloorChoice, type FloorTool } from "./floorGroups";
import type { LibraryGroup } from "./library";
import { LibraryPicker } from "./LibraryPicker";

/** Textures waiting to be made for the picker, and the pictures to draw when each is. */
const waiting = new Map<string, Set<() => void>>();
let scheduled = false;

function makeNext(): void {
  scheduled = false;
  const next = waiting.entries().next();
  if (next.done) return;
  const [id, done] = next.value;
  waiting.delete(id);
  makeTexture(id);
  for (const f of done) f();
  if (waiting.size) schedule();
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(makeNext, 0);
}

/** Calls `then` once a texture is made, making it soon if it isn't yet; returns a way to stop waiting. */
function whenMade(id: string, then: () => void): () => void {
  if (textureMade(id)) {
    then();
    return () => {};
  }
  let list = waiting.get(id);
  if (!list) waiting.set(id, (list = new Set()));
  list.add(then);
  schedule();
  return () => {
    list.delete(then);
    if (!list.size) waiting.delete(id);
  };
}

/**
 * A swatch of a floor or wall: one of Dungeon's textures (`texture`, its colour until it's
 * made), or else `plain`, which fills it some other way.
 */
function Swatch(props: { texture: string | null; plain: (ctx: CanvasRenderingContext2D, px: number) => void; plainKey: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [made, setMade] = useState(0);
  const texture = props.texture;
  useEffect(() => (texture ? whenMade(texture, () => setMade((n) => n + 1)) : undefined), [texture]);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const px = 22 * (window.devicePixelRatio || 1);
    canvas.width = px;
    canvas.height = px;
    if (!texture) {
      props.plain(ctx, px);
      return;
    }
    // A swatch shows a little more than a square of Dungeon's textures, which are finer than Tabletop's.
    ctx.fillStyle = textureMade(texture) ? texturePattern(ctx, texture, px * 0.75, 0, 0) : textureSwatch(texture);
    ctx.fillRect(0, 0, px, px);
  }, [texture, props.plainKey, made]);
  return <canvas ref={ref} class="floor-icon" aria-hidden="true" />;
}

/** A swatch of a floor: one square of Tabletop's texture, or one of Dungeon's. */
export function FloorIcon(props: { id: FloorChoice }) {
  const plain = (ctx: CanvasRenderingContext2D, px: number) => {
    ctx.fillStyle = floorPattern(ctx, props.id as FloorId, px, 0, 0);
    ctx.fillRect(0, 0, px, px);
  };
  return <Swatch texture={textureChoice(props.id)} plain={plain} plainKey={props.id} />;
}

const icon = (id: FloorChoice) => <FloorIcon id={id} />;

export function FloorPicker(props: { tool: FloorTool; value: FloorChoice; painting: boolean; recent: FloorChoice[]; onPick: (id: FloorChoice) => void }) {
  return (
    <LibraryPicker
      noun="floors"
      groups={FLOOR_GROUPS[props.tool]}
      value={props.value}
      active={props.painting}
      recent={props.recent}
      name={floorName}
      icon={icon}
      itemClass="floor"
      onPick={props.onPick}
    />
  );
}

/** A scene's walls: Tabletop's plain ones, or one of Dungeon's wall textures ("t:wall-brick"). */
export type WallChoice = "plain" | `t:${string}`;

const WALL_GROUPS: LibraryGroup<WallChoice>[] = [
  { name: "Tabletop", ids: ["plain"] },
  { name: "Dungeon's walls", ids: WALL_TEXTURES.map((id): WallChoice => `t:${id}`) },
];

const wallName = (id: WallChoice) => (id === "plain" ? "Plain walls" : textureName(id.slice(2)));

function WallIcon(props: { id: WallChoice }) {
  const plain = (ctx: CanvasRenderingContext2D, px: number) => {
    ctx.fillStyle = "#1d1a17";
    ctx.fillRect(0, 0, px, px);
  };
  return <Swatch texture={props.id === "plain" ? null : props.id.slice(2)} plain={plain} plainKey={props.id} />;
}

const wallIcon = (id: WallChoice) => <WallIcon id={id} />;

/** The walls' look for the whole scene: everyone sees it, and Undo puts it back. */
export function WallPicker(props: { value: WallChoice; onPick: (id: WallChoice) => void }) {
  return (
    <LibraryPicker
      noun="wall styles"
      groups={WALL_GROUPS}
      value={props.value}
      active={true}
      recent={[]}
      name={wallName}
      icon={wallIcon}
      itemClass="floor"
      onPick={props.onPick}
    />
  );
}
