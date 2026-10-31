// The party on the map: a character from their sheet (shared/characters.ts) placed as a token
// linked to the sheet, in their full-body figure (npcs/pcArt.ts) or the picture the GM chose for
// them. The picture is drawn (or fetched) and uploaded to the room the first time someone places
// them, then reused by that person (a player sees only their own uploads, so each uploads their own).

import { MAX_PRAYED, characterLabel, type Character, type CharacterPlayer } from "../shared/characters";
import { castList, type CastSpell } from "../shared/spellfx";
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

/**
 * Who plays a character, for every room (per-player sight sees through them). A player: this
 * browser plays them, or not. The GM: `who`, a player at the table, plays them, or with null,
 * nobody does.
 */
export async function setCharacterPlayer(room: RoomClient, c: Character, playing: boolean, who?: { userId: string; name: string } | null): Promise<void> {
  const me = room.profileInfo;
  const body = room.isGm ? { playing, userId: who?.userId ?? null, name: who?.name } : { playing, name: me.name };
  const res = await fetch(`/api/characters/${encodeURIComponent(c.id)}/player?room=${encodeURIComponent(room.roomId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Tabletop-User": me.uid },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; players?: Record<string, CharacterPlayer[]> };
  if (!res.ok) throw new Error(data.error ?? `That couldn't be saved (${res.status}).`);
  // Shown at once from the answer, without reading the sheets again (which can take seconds);
  // other pages see it with their next reading, within the minute.
  const party = room.state.party;
  const players = data.players;
  if (!party || !players) return;
  room.store.set({
    party: { ...party, characters: party.characters.map(({ players: _p, ...c }) => (players[c.id]?.length ? { ...c, players: players[c.id] } : c)) },
  });
}

/** Whether this page chooses what a character has prayed for: the GM's, or a browser playing them. */
export function mayPray(room: RoomClient, c: Character): boolean {
  return room.isGm || !!c.players?.some((p) => p.userId === room.state.me?.userId);
}

/**
 * Their player or the GM: how many casts of a spell (the sheet's name for it) a character has left
 * today; 0 takes it off. Shown here at once, and on other pages with their next reading.
 */
export async function setPrayed(room: RoomClient, c: Character, spell: string, left: number): Promise<void> {
  const n = Math.max(0, Math.min(MAX_PRAYED, left));
  const prayed = { ...(c.prayed ?? {}) };
  if (n) prayed[spell] = n;
  else delete prayed[spell];
  showPrayed(room, c.id, prayed);
  await putPrayed(room, c, { spell, left: n });
}

/** Their player or the GM: a new day, with nothing prayed for. */
export async function newPrayerDay(room: RoomClient, c: Character): Promise<void> {
  showPrayed(room, c.id, {});
  await putPrayed(room, c, { newDay: true });
}

function showPrayed(room: RoomClient, id: string, prayed: Record<string, number>): void {
  const party = room.state.party;
  if (!party) return;
  room.store.set({ party: { ...party, characters: party.characters.map((x) => (x.id === id ? { ...x, prayed } : x)) } });
}

async function putPrayed(room: RoomClient, c: Character, body: { spell: string; left: number } | { newDay: true }): Promise<void> {
  const res = await fetch(`/api/characters/${encodeURIComponent(c.id)}/prayed?room=${encodeURIComponent(room.roomId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Tabletop-User": room.profileInfo.uid },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; prayed?: Record<string, number> };
  if (!res.ok) {
    // Back to what the Worker has.
    void room.refreshParty();
    throw new Error(data.error ?? `That couldn't be saved (${res.status}).`);
  }
  if (data.prayed) showPrayed(room, c.id, data.prayed);
}

/** A spell picked from a character's card: the Spells tool, with that spell, cast from their token. */
export function castAs(room: RoomClient, tokenId: string, spell: string): void {
  room.store.set({ spellOpts: { ...room.state.spellOpts, spell, caster: tokenId } });
  room.setTool("spell");
}

/**
 * Casting as a character (the Spells tool's caster): who, and the spell as their list has it (none
 * when they don't have it). Null when no one is being cast as, or their token or sheet is gone.
 */
export function castingAs(room: RoomClient, spell: string): { token: TokenItem; character: Character; entry: CastSpell | null } | null {
  const id = room.state.spellOpts.caster;
  const token = id ? room.state.items[id] : undefined;
  if (token?.kind !== "token") return null;
  const character = room.characterOf(token);
  if (!character) return null;
  return { token, character, entry: castList(character).find((s) => s.name === spell) ?? null };
}

/** Why a character can't cast a spell now (it has to be prayed for, and none are left today), or null. */
export function cantCast(as: { character: Character; entry: CastSpell | null }): string | null {
  const e = as.entry;
  if (!e?.prayer || e.left > 0) return null;
  return `${characterLabel(as.character)} hasn't prayed for ${e.name} today, or has cast it as many times as prayed for. Pray for it on their card.`;
}

/** After casting as a character: one of the spell's prayers used up (when this page may say so). */
export function spendPrayer(room: RoomClient, as: { character: Character; entry: CastSpell | null }): void {
  const e = as.entry;
  if (!e?.prayer || !mayPray(room, as.character)) return;
  void setPrayed(room, as.character, e.sheet.name, e.left - 1).catch((err: Error) => room.toast(err.message, "error"));
}

/** GM: back to their figure. */
export async function clearCharacterPicture(room: RoomClient, c: Character): Promise<void> {
  const res = await fetch(`/api/characters/${encodeURIComponent(c.id)}/picture`, { method: "DELETE", credentials: "same-origin" });
  if (!res.ok) throw new Error(`The picture couldn't be removed (${res.status}).`);
  await room.refreshParty();
}
