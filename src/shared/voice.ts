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

/**
 * One step of setting up a call between two tabs: an offer or answer, or a route to try; or
 * whether this tab is whispering to the other (only they hear it, and only they are told).
 */
export type RtcSignal =
  | { sdp: { type: "offer" | "answer"; sdp: string } }
  | { ice: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null; usernameFragment?: string | null } }
  | { whisper: boolean };

/** What a tab sends the table's voice chat (worker/voiceHub.ts). */
export type VoiceClientMsg =
  /** Joins voice chat (on), leaves it, or says whether this tab's microphone is muted. */
  | { t: "voice"; on: boolean; muted?: boolean }
  /** To another tab in voice, about the call between the two. */
  | { t: "rtc"; to: string; d: RtcSignal }
  /** This person's new name or colour. */
  | { t: "profile"; name: string; color: string }
  /** The room this tab is in now (the GM moved the game): deleting it takes the tab out of voice. */
  | { t: "room"; id: string }
  /** How a call is going, for the voice chat's record (finding why calls drop). */
  | { t: "voice.report"; r: CallReport }
  /** Fresh relay passwords, for a call looking for another route (they run out after hours). */
  | { t: "voice.ice" };

/** What happened to a call between two tabs, as one of them saw it. */
export type CallKind =
  /** Connected for the first time. */
  | "up"
  /** Was connected and isn't now. */
  | "lost"
  /** Connected again after that. */
  | "back"
  /** Found no way through (yet: it keeps trying). */
  | "failed"
  /** Still not through after a while, with nothing heard. */
  | "slow";

const CALL_KINDS: readonly CallKind[] = ["up", "lost", "back", "failed", "slow"];

/** One call's news, for the voice chat's record. Never what's said: just how the call is doing. */
export interface CallReport {
  kind: CallKind;
  /** The other tab (its connId). */
  peer: string;
  /** How long it took (up, back, failed, slow), or how long it had been up (lost), in ms. */
  ms: number;
  /** Tries at another route since it was last connected. */
  tries: number;
  /** This tab had a relay (TURN) to try. */
  turn: boolean;
  /** The route in use, as each end's kind of address and how it carries: "host/udp", "srflx/udp", "relay/tls". */
  local?: string;
  remote?: string;
  /** Every kind of address each end found. */
  mine?: string[];
  theirs?: string[];
}

/** A kind of address and how it carries ("relay/udp"), or null when it isn't one. */
function cleanRoute(raw: unknown): string | null {
  return typeof raw === "string" && /^[a-z]{1,8}\/[a-z?]{1,4}$/.test(raw) ? raw : null;
}

/** A call's report as a tab sent it, kept to what the record holds, or null when it isn't one. */
export function cleanReport(raw: unknown): CallReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!CALL_KINDS.includes(r.kind as CallKind)) return null;
  if (typeof r.peer !== "string" || !r.peer || r.peer.length > 32) return null;
  if (typeof r.ms !== "number" || !Number.isFinite(r.ms) || r.ms < 0) return null;
  if (typeof r.tries !== "number" || !Number.isInteger(r.tries) || r.tries < 0) return null;
  const out: CallReport = { kind: r.kind as CallKind, peer: r.peer, ms: Math.min(Math.round(r.ms), 1e9), tries: Math.min(r.tries, 1e6), turn: r.turn === true };
  const local = cleanRoute(r.local);
  const remote = cleanRoute(r.remote);
  if (local) out.local = local;
  if (remote) out.remote = remote;
  for (const k of ["mine", "theirs"] as const) {
    const list = Array.isArray(r[k]) ? (r[k] as unknown[]).map(cleanRoute).filter((x): x is string => !!x) : [];
    if (list.length) out[k] = [...new Set(list)].slice(0, 12).sort();
  }
  return out;
}

/** An entry in the voice chat's record: who, which browser, and what happened. */
export interface VoiceLogEntry {
  at: number;
  /**
   * join, leave: voice chat; gone: the tab's connection closed while in voice; replaced: it
   * came back on a new connection while the old one was still in; turn-failed: Cloudflare
   * gave no relay passwords; call: one end's news about a call.
   */
  ev: "join" | "leave" | "gone" | "replaced" | "turn-failed" | "call";
  who?: string;
  user?: string;
  conn?: string;
  browser?: string;
  /** The close code, for gone. */
  code?: number;
  error?: string;
  /** For call: the report, with the other person's name. */
  call?: CallReport & { peerName?: string };
}

/** The browser and system from a User-Agent, in a few words ("Chrome 131, Windows"), for the record. */
export function browserOf(ua: string): string {
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /CrOS/.test(ua)
        ? "ChromeOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  const browsers: [string, RegExp][] = [
    ["Discord", /discord\/(\d+)/i],
    ["Edge", /Edg(?:A|iOS)?\/(\d+)/],
    ["Opera", /OPR\/(\d+)/],
    ["Samsung Internet", /SamsungBrowser\/(\d+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/(\d+)/],
    ["Chrome", /(?:Chrome|CriOS)\/(\d+)/],
    ["Safari", /Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari/],
  ];
  let name = "";
  for (const [n, re] of browsers) {
    const m = re.exec(ua);
    if (m) {
      name = `${n} ${m[1]}`;
      break;
    }
  }
  return [name || "another browser", os].filter(Boolean).join(", ").slice(0, 60);
}

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

/** How many entries the voice chat's record keeps: the newest. */
export const VOICE_LOG_KEEP = 2000;
/** Reports one tab may send in a window before the rest are dropped. */
export const REPORT_BURST = 40;

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
  if (r.whisper !== undefined) return typeof r.whisper === "boolean" ? { whisper: r.whisper } : null;
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
