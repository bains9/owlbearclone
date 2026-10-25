// The table's voice chat connection: one for the whole page. Room pages come and go as the GM
// moves the group from room to room (without reloading the page: nav.ts), and this stays, so
// calls never drop. It connects with the id of the first room opened, which is what lets it in
// (worker/voiceHub.ts).

import type { Role } from "../../shared/types";
import type { VoiceClientMsg, VoiceServerMsg } from "../../shared/voice";
import { randomId } from "../../shared/ids";
import type { Profile } from "../identity";
import { Store } from "../store";
import { Voice, voiceInitial } from "./voice";
import type { VoiceState } from "./voice";

/** How often the connection is checked, and how long without an answer before it's taken for dead. */
const PING_MS = 25_000;
const DEAD_MS = 60_000;

class VoiceLink {
  readonly store = new Store<VoiceState>(voiceInitial());
  readonly voice: Voice;
  private ws: WebSocket | null = null;
  private roomId: string | null = null;
  private profile: Profile | null = null;
  /** Names this tab to the server, so a reconnect replaces its old place in voice. */
  private readonly sid = randomId(16);
  private toaster: ((text: string) => void) | null = null;
  private attempts = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private heard = 0;
  /** Stopped (the room it was let in with is gone) until a room page attaches again. */
  private stopped = false;

  constructor() {
    this.voice = new Voice({
      get: () => this.store.state,
      set: (patch) => this.store.set(patch),
      myId: () => this.store.state.self?.connId ?? null,
      // Kept while reconnecting, so the GM's open microphone doesn't turn into push to talk.
      isGm: () => this.store.state.role === "gm",
      send: (msg) => this.send(msg),
      toast: (text) => this.toaster?.(text),
    });
  }

  /**
   * A room page opened: connects (with this room's id) unless it already is, and sends this
   * page's messages to that room's toasts. Returns the page's way out.
   */
  attach(roomId: string, profile: Profile, toast: (text: string) => void): () => void {
    const moved = this.roomId !== roomId;
    this.roomId = roomId;
    this.toaster = toast;
    this.profile = profile;
    this.stopped = false;
    if (moved) this.send({ t: "room", id: roomId });
    if (!this.ws && !this.retry) this.connect();
    return () => {
      if (this.toaster === toast) this.toaster = null;
    };
  }

  /** The room this page was let in with is gone: leaves voice chat and stops reconnecting. */
  stop(roomId: string): void {
    if (this.roomId !== roomId) return;
    this.voice.leave();
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.store.set({ self: null });
  }

  /** Back online, or the tab shown again: a connection waiting to retry tries now. */
  private wake = (): void => {
    if (this.ws || this.stopped || !this.retry) return;
    clearTimeout(this.retry);
    this.retry = null;
    this.connect();
  };

  /** This person's new name or colour, for everyone in voice. */
  setProfile(name: string, color: string): void {
    if (this.profile) this.profile = { ...this.profile, name, color };
    this.send({ t: "profile", name, color });
  }

  private connect(): void {
    const p = this.profile;
    if (!p || !this.roomId || this.stopped) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const qs = new URLSearchParams({ room: this.roomId, uid: p.uid, name: p.name, color: p.color, sid: this.sid });
    const ws = new WebSocket(`${proto}//${location.host}/api/voice/ws?${qs}`);
    this.ws = ws;
    this.heard = Date.now();
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.heard = Date.now();
      if (ev.data === "pong") return;
      try {
        this.onServer(JSON.parse(ev.data as string) as VoiceServerMsg);
      } catch {
        // Not one of ours.
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      // Until the server says hello again, this tab has no connId there.
      this.store.set({ self: null });
      if (this.stopped) return;
      const delay = Math.min(10_000, 500 * 2 ** this.attempts++) + Math.random() * 400;
      this.retry = setTimeout(() => {
        this.retry = null;
        this.connect();
      }, delay);
    };
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => this.check(), PING_MS);
      window.addEventListener("online", this.wake);
      document.addEventListener("visibilitychange", this.wake);
    }
  }

  /** A connection that stopped answering is dead even when it looks open: start again. */
  private check(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - this.heard > DEAD_MS) {
      // Start again at once rather than waiting for a close that may never come.
      this.ws = null;
      ws.close();
      this.store.set({ self: null });
      this.connect();
    } else {
      ws.send("ping");
    }
  }

  private onServer(msg: VoiceServerMsg): void {
    switch (msg.t) {
      case "voice.hello":
        this.attempts = 0;
        this.store.set({ self: msg.you, role: msg.you.role });
        this.voice.onHello();
        return;
      case "voice":
        this.voice.onPeers(msg.peers);
        return;
      case "ice":
        this.voice.onIce(msg.servers);
        return;
      case "rtc":
        this.voice.onSignal(msg.from, msg.d);
        return;
      case "voice.refused":
        this.voice.onRefused(msg.message);
        return;
    }
  }

  /** Sends at once, or returns false when not connected. */
  private send(msg: VoiceClientMsg): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN || !this.store.state.self) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }
}

/** The page's one voice chat connection. */
export const voiceLink = new VoiceLink();

/** The GM, as the voice chat server took this tab for. */
export function voiceRole(v: VoiceState): Role | null {
  return v.self?.role ?? null;
}
