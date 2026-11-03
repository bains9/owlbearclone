// Voice chat: what the browsers and the Room say to each other to set up calls.
//
// The talking itself goes straight between browsers (WebRTC, audio only, one connection
// for each pair of people). The Room only passes on the messages that set those
// connections up, says who's in voice, and hands out the servers browsers use to find a
// way to each other through home routers.

import type { Role } from "./types";

/** How many browser tabs can be in voice in one room: every pair is a connection of its own. */
export const MAX_VOICE = 8;

/** Longest offer or answer passed on (an audio-only one is a few kilobytes). */
export const MAX_SDP = 16 * 1024;
export const MAX_CANDIDATE = 1024;

/** Signals one tab may send another in a window before the rest are dropped. */
export const RTC_BURST = 300;
export const RTC_WINDOW_MS = 10_000;
/** Joins and mute changes one tab may make in that window (push to talk sends two a press). */
export const VOICE_BURST = 40;

/** Someone in voice chat: one browser tab. */
export interface VoicePeer {
  connId: string;
  userId: string;
  name: string;
  color: string;
  /** So the GM is marked, and a player who takes the name "GM" isn't mistaken for them. */
  role: Role;
  muted: boolean;
}

/** A server a browser uses to find a way through to another (STUN), or to relay through (TURN). */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** One step of setting up a call between two tabs: an offer or answer, or a route to try. */
export type RtcSignal =
  | { sdp: { type: "offer" | "answer"; sdp: string } }
  | { ice: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null; usernameFragment?: string | null } };

/** What a tab sends the table's voice chat (worker/voiceHub.ts). */
export type VoiceClientMsg =
  /** Joins voice chat (on), leaves it, or says whether this tab's microphone is muted. */
  | { t: "voice"; on: boolean; muted?: boolean }
  /** To another tab in voice, about the call between the two. */
  | { t: "rtc"; to: string; d: RtcSignal }
  /** This person's new name or colour. */
  | { t: "profile"; name: string; color: string }
  /** The room this tab is in now (the GM moved the game): deleting it takes the tab out of voice. */
  | { t: "room"; id: string };

/** What the table's voice chat sends a tab. */
export type VoiceServerMsg =
  /** As the tab connects: its connId here, and whether the server took it for the GM. */
  | { t: "voice.hello"; you: { connId: string; role: Role } }
  /** Who's in voice chat: as the tab connects, and whenever it changes. */
  | { t: "voice"; peers: VoicePeer[] }
  /** To a tab joining voice chat: the servers its browser uses to reach the others. */
  | { t: "ice"; servers: IceServer[] }
  /** To a tab joining voice chat that can't, and why. */
  | { t: "voice.refused"; message: string }
  /** From another tab in voice, about the call between the two. */
  | { t: "rtc"; from: string; d: RtcSignal };

/** Cloudflare's STUN server: free, and enough for most home networks. */
export const STUN_ONLY: IceServer[] = [{ urls: ["stun:stun.cloudflare.com:3478"] }];

/** A signal as a tab sent it, kept to the fields a browser reads, or null when it isn't one. */
export function cleanSignal(raw: unknown): RtcSignal | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.sdp !== undefined) {
    const s = r.sdp as Record<string, unknown> | null;
    if (!s || typeof s !== "object") return null;
    if (s.type !== "offer" && s.type !== "answer") return null;
    if (typeof s.sdp !== "string" || !s.sdp || s.sdp.length > MAX_SDP) return null;
    return { sdp: { type: s.type, sdp: s.sdp } };
  }
  if (r.ice !== undefined) {
    const c = r.ice as Record<string, unknown> | null;
    if (!c || typeof c !== "object") return null;
    if (typeof c.candidate !== "string" || c.candidate.length > MAX_CANDIDATE) return null;
    const mid = c.sdpMid ?? null;
    if (mid !== null && (typeof mid !== "string" || mid.length > 64)) return null;
    const index = c.sdpMLineIndex ?? null;
    if (index !== null && (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 64)) return null;
    const ufrag = c.usernameFragment ?? null;
    if (ufrag !== null && (typeof ufrag !== "string" || ufrag.length > 256)) return null;
    return { ice: { candidate: c.candidate, sdpMid: mid, sdpMLineIndex: index, usernameFragment: ufrag } };
  }
  return null;
}

/**
 * The servers in Cloudflare's answer that a browser can use: a list or a single entry,
 * each with its addresses, and the username and password for TURN. Addresses on port
 * 53 are left out, because browsers block that port.
 */
export function usableIceServers(raw: unknown): IceServer[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const out: IceServer[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const urls = (Array.isArray(e.urls) ? e.urls : [e.urls]).filter(
      (u): u is string => typeof u === "string" && /^(stun|turns?):/.test(u) && !/:53(\?|$)/.test(u),
    );
    if (!urls.length) continue;
    const server: IceServer = { urls };
    if (typeof e.username === "string") server.username = e.username;
    if (typeof e.credential === "string") server.credential = e.credential;
    // A relay without its password can't be used.
    if (urls.some((u) => u.startsWith("turn")) && (!server.username || !server.credential)) continue;
    out.push(server);
  }
  return out;
}
