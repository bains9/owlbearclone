// The GM's changes to the campaign's calendar (shared/calendar.ts), through the Worker
// (worker/calendarRoutes.ts): a day on, an event, the region, the weather; and bringing it in
// from Fantasy Calendar. Each answers with the calendar as kept, shown here at once and told to
// everyone in the room.

import type { CalEvent, Calendar } from "../shared/calendar";
import type { RoomClient } from "./room/client";

export interface CalendarPatch {
  today?: number;
  name?: string;
  climate?: string;
  /** A new seed: the weather from here on rolled afresh. */
  newWeather?: true;
  /** A day whose weather is rolled again (epoch). */
  reroll?: number;
  /** The GM's own words for a day's weather (null takes them away). */
  note?: { epoch: number; text: string | null };
  upsert?: CalEvent[];
  delete?: string[];
}

async function answer(room: RoomClient, res: Response): Promise<{ calendar: Calendar; version: number; notes?: string[] }> {
  const data = (await res.json().catch(() => ({}))) as { error?: string; calendar?: Calendar; version?: number; notes?: string[] };
  if (!res.ok || !data.calendar || typeof data.version !== "number") throw new Error(data.error ?? `The calendar couldn't be changed (${res.status}).`);
  room.calendarChanged(data.calendar, data.version);
  return { calendar: data.calendar, version: data.version, notes: data.notes };
}

const headers = { "Content-Type": "application/json" };

export function patchCalendar(room: RoomClient, patch: CalendarPatch): Promise<{ calendar: Calendar; version: number }> {
  return fetch("/api/calendar", { method: "PATCH", headers, body: JSON.stringify(patch), credentials: "same-origin" }).then((res) => answer(room, res));
}

/** Brings a calendar in from Fantasy Calendar by its link, or from a file's contents (its export, or one from here). */
export function importCalendar(room: RoomClient, from: { link: string } | { data: unknown }): Promise<{ calendar: Calendar; notes?: string[] }> {
  return fetch("/api/calendar/import", { method: "POST", headers, body: JSON.stringify(from), credentials: "same-origin" }).then((res) => answer(room, res));
}

export async function deleteCalendar(room: RoomClient): Promise<void> {
  const res = await fetch("/api/calendar", { method: "DELETE", credentials: "same-origin" });
  const data = (await res.json().catch(() => ({}))) as { error?: string; version?: number };
  if (!res.ok) throw new Error(data.error ?? `The calendar couldn't be taken away (${res.status}).`);
  room.calendarChanged(null, data.version ?? 0);
}

/** A fresh id for an event made here. */
export function eventId(): string {
  return `e${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
