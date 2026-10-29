// The party on the map: a character from their sheet (shared/characters.ts) placed as a token
// linked to the sheet, in their full-body figure (npcs/pcArt.ts) or the picture the GM chose for
// them. The picture is drawn (or fetched) and uploaded to the room the first time someone places
// them, then reused by that person (a player sees only their own uploads, so each uploads their own).

import { characterLabel, type Character } from "../shared/characters";
import type { Point } from "../shared/geometry";
import type { TokenItem } from "../shared/types";
import { prepareImage } from "./api";
import { ART_PX, npcSquares } from "./npcs/npcs";
import { drawPcArt } from "./npcs/pcArt";
import { classesOf, figureOf, raceOf } from "./npcs/pcTokens";
import { NPCS_LOAD_FAILED, loadNpcs } from "./npcs/place";
import type { RoomClient } from "./room/client";

type Drawn = Pick<Character, "id" | "name" | "picture" | "race" | "culture" | "cls" | "subclass" | "cls2" | "subclass2" | "figure">;

/**
 * The name a character's token picture is uploaded under: per picture, and for a figure, per what
 * it's drawn from (their sheet, race, classes and figure), so a new picture, a sheet that changes
 * their race or a class, or another figure is uploaded anew, and two characters with one name
 * don't share a token.
 */
export function characterAssetName(c: Drawn): string {
  const who = c.name.slice(0, 40);
  if (c.picture) return `${who} · picture ${c.picture.slice(0, 8)}`;
  // FNV-1a, 32 bits, written short.
  let h = 0x811c9dc5;
  for (const ch of [c.id, c.race, c.culture, c.cls, c.subclass, c.cls2, c.subclass2, figureOf(c)].join("|")) {
    h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  }
  return `${who} · figure ${(h >>> 0).toString(36)}`;
}

/** Where the picture the GM chose for a character is, for this room's pages. */
export function characterPictureUrl(roomId: string, c: Pick<Character, "id" | "picture">): string {
  return `/api/characters/${encodeURIComponent(c.id)}/picture?room=${encodeURIComponent(roomId)}&v=${encodeURIComponent(c.picture ?? "")}`;
}

/** Draws a character's figure token onto a canvas `px` across (for the list's previews, and to upload). */
export async function drawCharacter(canvas: HTMLCanvasElement, c: Character, px = ART_PX): Promise<void> {
  const icons = await loadNpcs();
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser couldn't draw the token.");
  drawPcArt(ctx, raceOf(c), classesOf(c), figureOf(c), icons, px);
}

async function figureFile(c: Character): Promise<File> {
  const canvas = document.createElement("canvas");
  await drawCharacter(canvas, c);
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  let blob = await encode("image/webp");
  if (!blob || blob.type !== "image/webp") blob = await encode("image/png");
  if (!blob) throw new Error("This browser couldn't draw the token.");
  return new File([blob], `${characterAssetName(c)}.${blob.type === "image/webp" ? "webp" : "png"}`, { type: blob.type });
}

async function pictureFile(roomId: string, c: Character): Promise<File> {
  const res = await fetch(characterPictureUrl(roomId, c), { credentials: "same-origin" });
  if (!res.ok) throw new Error("Their picture couldn't be fetched.");
  const blob = await res.blob();
  const ext = blob.type.split("/")[1] ?? "png";
  return new File([blob], `${characterAssetName(c)}.${ext}`, { type: blob.type });
}

/** Pictures being uploaded, by room and name, so a second click waits for the first. */
const making = new Map<string, Promise<string | null>>();

/** The id of a character's token picture in this room, uploaded first if it hasn't one. */
function characterAsset(room: RoomClient, c: Character): Promise<string | null> {
  const name = characterAssetName(c);
  const have = Object.values(room.state.assets)
    .filter((a) => a.kind === "token" && a.name === name)
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  if (have) return Promise.resolve(have.id);
  const key = `${room.roomId}|${name}`;
  let job = making.get(key);
  if (!job) {
    job = (async () => {
      try {
        const file = c.picture ? await pictureFile(room.roomId, c) : await figureFile(c);
        const [asset] = await room.upload([file], "token");
        return asset?.id ?? null;
      } catch (err) {
        room.toast(err instanceof Error && err.message ? `${c.name}: ${err.message}` : NPCS_LOAD_FAILED, "error");
        return null;
      } finally {
        making.delete(key);
      }
    })();
    making.set(key, job);
  }
  return job;
}

/**
 * Puts a character on the scene in view, at `at` (where they were dropped; with `free`, not
 * snapped) or in the middle of the view: a token named after them, linked to their sheet,
 * sized by their race. The first time in a room takes a moment (their picture is uploaded).
 */
export async function placeCharacter(room: RoomClient, c: Character, at?: Point, free = false): Promise<TokenItem | null> {
  const sceneId = room.state.viewSceneId;
  const assetId = await characterAsset(room, c);
  const scene = room.viewScene;
  if (!assetId || !scene) return null;
  if (scene.id !== sceneId) {
    room.toast(`${characterLabel(c)} is ready. You moved to another scene, so place them again here.`);
    return null;
  }
  return room.addToken({ assetId, label: characterLabel(c), size: npcSquares(raceOf(c)), color: classesOf(c)[0].color, character: c.id }, at, free);
}

/** GM: gives a character a picture of the GM's own for their token, in every room, instead of their figure. */
export async function setCharacterPicture(room: RoomClient, c: Character, file: File): Promise<void> {
  const { blob } = await prepareImage(file, "token");
  const res = await fetch(`/api/characters/${encodeURIComponent(c.id)}/picture`, {
    method: "PUT",
    headers: { "Content-Type": blob.type || "application/octet-stream" },
    body: blob,
    credentials: "same-origin",
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `The picture couldn't be saved (${res.status}).`);
  }
  await room.refreshParty();
}

/** GM: chooses a character's figure (an icon of PC_FIGURE_CHOICES) for every room; null goes back to their class's. */
export async function setCharacterFigure(room: RoomClient, c: Character, figure: string | null): Promise<void> {
  const res = await fetch(`/api/characters/${encodeURIComponent(c.id)}/figure`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ figure }),
    credentials: "same-origin",
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `The figure couldn't be saved (${res.status}).`);
  }
  await room.refreshParty();
}

/** GM: marks one of a character's ranged weapons as matched to their strength (its damage adds their STR bonus), or not. */
export async function setCharacterStrMatched(room: RoomClient, c: Character, weapon: string, matched: boolean): Promise<void> {
  const res = await fetch(`/api/characters/${encodeURIComponent(c.id)}/str-matched`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ weapon, matched }),
    credentials: "same-origin",
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `That couldn't be saved (${res.status}).`);
  }
  await room.refreshParty();
}

/** GM: back to their figure. */
export async function clearCharacterPicture(room: RoomClient, c: Character): Promise<void> {
  const res = await fetch(`/api/characters/${encodeURIComponent(c.id)}/picture`, { method: "DELETE", credentials: "same-origin" });
  if (!res.ok) throw new Error(`The picture couldn't be removed (${res.status}).`);
  await room.refreshParty();
}
