// Who sees a chat message, and the private ones typed in the chat box: `/w Name message` whispers
// to one person in the room (only the two of them see it, the GM included: as voice chat's
// Whisper), `/gm message` goes to the GM (the sender and the GM see it, as a roll sent To GM).
// The server keeps to these (worker/room.ts); the chat panel reads what's typed with them.

import type { ChatMessage, Role } from "./types";

/** Someone looking at the chat: their browser's id, their role, and whether they're a table display. */
export interface Viewer {
  userId: string;
  role: Role;
  display?: boolean;
}

/**
 * Whether someone sees a message: a whisper only its sender and the one it's to (never a table
 * display); a private roll or a message to the GM, the GM and its sender (a GM's, the GM alone);
 * the rest, everyone.
 */
export function canSeeMessage(m: ChatMessage, c: Viewer): boolean {
  if (m.to) return !c.display && (c.userId === m.userId || c.userId === m.to.userId);
  if (!m.private || c.role === "gm") return true;
  return m.role === "player" && c.userId === m.userId;
}

/** Someone in the room who can be whispered to. */
export interface Whisperee {
  userId: string;
  name: string;
  display?: boolean;
}

/**
 * What `/w Name message` (or `/whisper`) says: who it's to, among those in the room (the longest
 * name it starts with, any case, so "Sir Aldwyn" and "Sir" are told apart), and the message.
 * Null when it isn't a whisper; an error to show when it can't be sent (no such name, no message,
 * or yourself).
 */
export function whisperOf(text: string, people: readonly Whisperee[], me: string): { to: string; name: string; text: string } | { error: string } | null {
  const m = /^\/(?:w|whisper)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  const rest = (m[1] ?? "").trim();
  if (!rest) return { error: "Type a name after /w, then your message: /w Name message." };
  let best: Whisperee | null = null;
  for (const p of people) {
    const name = p.name.trim();
    if (p.display || !name || name.length > rest.length) continue;
    if (rest.slice(0, name.length).toLowerCase() !== name.toLowerCase()) continue;
    if (rest.length > name.length && !/\s/.test(rest[name.length])) continue;
    if (!best || name.length > best.name.trim().length) best = p;
  }
  if (!best) return { error: `Nobody called ${rest.split(/\s+/)[0]} is in the room to whisper to.` };
  if (best.userId === me) return { error: "That's you: whisper to someone else." };
  const said = rest.slice(best.name.trim().length).trim();
  if (!said) return { error: `Type your message after ${best.name.trim()}'s name.` };
  return { to: best.userId, name: best.name.trim(), text: said };
}

/** What `/gm message` says to the GM, or null when it isn't one; "" when there's no message. */
export function toGmOf(text: string): string | null {
  const m = /^\/gm(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return m ? (m[1] ?? "").trim() : null;
}
