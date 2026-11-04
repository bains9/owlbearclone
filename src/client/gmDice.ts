// The villains' dice the GM picked for their own rolls (shared/diceSets.ts): read when the GM's
// Chat & dice opens, changed with the die at the end of their dice tray, and kept by the Worker
// for every room and device. The server stamps each roll with it; the page only paints the tray.
import { GM_DICE, isGmDice, type DiceSetId } from "../shared/diceSets";
import type { RoomClient } from "./room/client";

async function call(init?: RequestInit): Promise<DiceSetId> {
  let res: Response;
  try {
    res = await fetch("/api/gm-dice", { ...init, credentials: "same-origin" });
  } catch {
    throw new Error("Couldn't reach the server.");
  }
  const data = (await res.json().catch(() => ({}))) as { dice?: unknown; error?: string };
  if (!res.ok) throw new Error(data.error ?? `That didn't work (${res.status}).`);
  return isGmDice(data.dice) ? data.dice : GM_DICE;
}

/** GM: reads their pick into the room's state. */
export async function loadGmDice(room: RoomClient): Promise<void> {
  room.store.set({ gmDice: await call() });
}

/** GM: picks the villains' dice for their own rolls, from now on, in every room. */
export async function setGmDice(room: RoomClient, dice: DiceSetId): Promise<void> {
  const was = room.state.gmDice;
  room.store.set({ gmDice: dice });
  try {
    room.store.set({ gmDice: await call({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dice }) }) });
  } catch (err) {
    room.store.set({ gmDice: was });
    room.toast((err as Error).message, "error");
  }
}
