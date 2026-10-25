// Voice chat in the browser: the microphone, a call to each other tab in voice, and who's talking.
//
// Every pair of tabs in voice has its own WebRTC connection carrying audio both ways. The
// Room passes on the messages that set those up (shared/voice.ts). Both tabs of a pair start
// their call as soon as they see each other in voice, and "perfect negotiation" settles it
// when their offers cross: the tab with the higher connId is the polite one, which gives way.

import type { ClientMsg } from "../../shared/protocol";
import { STUN_ONLY } from "../../shared/voice";
import type { IceServer, RtcSignal, VoicePeer } from "../../shared/voice";

export type VoiceStatus = "off" | "starting" | "on";
export type LinkState = "connecting" | "connected" | "failed";
/** open: the microphone is on unless muted; ptt: push to talk, on only while its key (or the talk button) is held. */
export type VoiceMode = "open" | "ptt";

export interface VoiceState {
  /** off; starting: the browser is asking for the microphone; on: in voice chat. */
  status: VoiceStatus;
  /** Chosen in this browser, or null for the default: an open microphone for the GM, push to talk for players. */
  mode: VoiceMode | null;
  /** With an open microphone: muted. */
  muted: boolean;
  /** With push to talk: the key or button is held. */
  talking: boolean;
  /** Push to talk's key, by its place on the keyboard (KeyboardEvent.code), chosen in this browser. */
  talkKey: string;
  /** Everyone in voice chat (this tab too, once the server has it), as the server last said. */
  peers: VoicePeer[];
  /** The tabs heard talking just now (connIds), this one included. */
  speaking: string[];
  /** How the call to each other tab in voice is going. */
  links: Record<string, LinkState>;
  /** Each person's volume (by userId), from 0 to 1: missing is full. */
  volumes: Record<string, number>;
  /** The browser wouldn't play the others' sound until the page is clicked. */
  blocked: boolean;
}

/** What a Voice needs from the room it's in. */
export interface VoiceHost {
  get(): VoiceState;
  set(patch: Partial<VoiceState>): void;
  /** This tab's connId, once connected. */
  myId(): string | null;
  isGm(): boolean;
  /** Sends at once, or returns false when not connected. */
  send(msg: ClientMsg): boolean;
  toast(text: string): void;
}

/** Louder than this (the root mean square of the samples) counts as talking. */
const SPEAKING_LEVEL = 0.015;
/** How long someone stays lit after they were last heard, so the light doesn't flicker between words. */
const SPEAKING_HOLD_MS = 350;
/** How many times a call that failed looks for another route before it gives up. */
const MAX_RESTARTS = 3;
/** This tab's own microphone among the speaking meters. */
const SELF = "self";
/** Push to talk's key unless another is chosen: left Shift. */
export const DEFAULT_TALK_KEY = "ShiftLeft";
const TALK_KEY_KEY = "tabletop.voiceTalkKey";
const MODIFIERS = ["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"];
const VOLUMES_KEY = "tabletop.voiceVolumes";
const MODE_KEY = "tabletop.voiceMode";

export function voiceInitial(): VoiceState {
  return {
    status: "off",
    mode: loadMode(),
    muted: false,
    talking: false,
    talkKey: loadTalkKey(),
    peers: [],
    speaking: [],
    links: {},
    volumes: loadVolumes(),
    blocked: false,
  };
}

/** The mode in use: the one chosen in this browser, or the default for the GM or a player. */
export function voiceMode(v: VoiceState, gm: boolean): VoiceMode {
  return v.mode ?? (gm ? "open" : "ptt");
}

interface Link {
  pc: RTCPeerConnection;
  userId: string;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  answerPending: boolean;
  /** Signals from the other tab, handled one at a time in the order they came. */
  chain: Promise<void>;
  audio: HTMLAudioElement;
  restarts: number;
}

interface Meter {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  data: Float32Array<ArrayBuffer>;
  heard: number;
}

export class Voice {
  private mic: MediaStream | null = null;
  private stopFakeMic: (() => void) | null = null;
  private links = new Map<string, Link>();
  private servers: IceServer[] = STUN_ONLY;
  private audio: AudioContext | null = null;
  private meters = new Map<string, Meter>();
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private sink: HTMLElement | null = null;
  /** Whether the server was last told this tab is muted (null: not in voice). */
  private told: boolean | null = null;
  /** The next list of who's in voice is how things stood as this tab connected, not a change. */
  private snapshot = true;
  /** This page has had that first list: a reconnect's doesn't announce voice chat again. */
  private announced = false;
  /** Development builds only (RoomPage sets it): ?fakemic in the address plays a tone instead of the microphone. */
  allowFakeMic = false;

  constructor(private readonly host: VoiceHost) {}

  /** Asks for the microphone and joins voice chat. */
  async join(): Promise<void> {
    if (this.host.get().status !== "off") return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.host.toast("Voice chat needs a browser that can use a microphone, on a secure (https) page.");
      return;
    }
    this.host.set({ status: "starting" });
    // Made during the click, so the browser lets it run.
    if (!this.audio) this.audio = newAudioContext();
    void this.audio?.resume().catch(() => {});
    let mic: MediaStream;
    try {
      mic = await this.openMic();
    } catch (err) {
      if (this.host.get().status === "starting") this.host.set({ status: "off" });
      this.host.toast(micError(err));
      return;
    }
    if (this.host.get().status !== "starting") {
      // Left while the browser was asking.
      for (const t of mic.getTracks()) t.stop();
      return;
    }
    this.mic = mic;
    for (const track of mic.getAudioTracks()) {
      track.onended = () => {
        if (this.mic !== mic) return;
        this.host.toast("Your microphone stopped, so you've left voice chat.");
        this.leave();
      };
    }
    this.host.set({ status: "on", talking: false, blocked: false });
    this.meter(SELF, mic);
    this.applyMic(true);
    // Before the map's shortcuts, so a talk key the map also uses only talks.
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("keyup", this.onKey, true);
    window.addEventListener("blur", this.letGo);
    document.addEventListener("visibilitychange", this.letGo);
  }

  /** Push to talk: its key held down, unless that's typing into a box or a shortcut with Ctrl, Alt or Cmd. */
  private onKey = (e: KeyboardEvent): void => {
    const v = this.host.get();
    if (v.status !== "on" || voiceMode(v, this.host.isGm()) !== "ptt") return;
    // On a Mac, a key let go while Cmd is down sends no key-up: Cmd's own key-up lets go instead.
    if (e.type === "keyup" && e.key === "Meta" && !MODIFIERS.includes(v.talkKey)) this.setTalking(false);
    if (e.code !== v.talkKey) return;
    if (e.type === "keyup") {
      this.setTalking(false);
      return;
    }
    if (typing(e.target)) return;
    const modifier = MODIFIERS.includes(e.code);
    if (!modifier && (e.ctrlKey || e.metaKey || e.altKey)) return;
    // A modifier still does its usual job (Shift-click, say); any other key only talks.
    if (!modifier) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    if (!e.repeat) this.setTalking(true);
  };

  /** Push to talk's key, remembered in this browser (not Esc, or Caps Lock, which some computers treat as on and off). */
  setTalkKey(code: string): void {
    if (!usableTalkKey(code)) return;
    this.setTalking(false);
    this.host.set({ talkKey: code });
    try {
      localStorage.setItem(TALK_KEY_KEY, code);
    } catch {
      // Private browsing, say: the choice lasts until the page closes.
    }
  }

  /** The page lost the keyboard (another window, another tab): a held key's release would never come. */
  private letGo = (): void => {
    if (this.host.get().talking) this.setTalking(false);
  };

  leave(): void {
    if (this.host.get().status === "off") return;
    this.host.send({ t: "voice", on: false });
    this.shutdown();
    this.host.set({ status: "off", muted: false, talking: false, links: {}, speaking: [], blocked: false });
  }

  /** With an open microphone: mutes it, or turns it back on. */
  setMuted(muted: boolean): void {
    this.host.set({ muted });
    this.applyMic();
  }

  /** Push to talk on Shift, held right now: the map takes a click or drag as a plain one, so tokens still move. */
  shiftTalks(): boolean {
    const v = this.host.get();
    return v.talking && v.status === "on" && v.talkKey.startsWith("Shift") && voiceMode(v, this.host.isGm()) === "ptt";
  }

  /** With push to talk: the key or button pressed (true) or let go. */
  setTalking(talking: boolean): void {
    if (this.host.get().talking === talking) return;
    this.host.set({ talking });
    this.applyMic();
  }

  /** Push to talk or an open microphone, remembered in this browser. */
  setMode(mode: VoiceMode): void {
    this.host.set({ mode, muted: false, talking: false });
    saveMode(mode);
    this.applyMic();
  }

  /**
   * Turns the microphone on or off for what's chosen (an open microphone unless muted, or
   * push to talk while it's held), and tells the others when that changed.
   */
  private applyMic(force = false): void {
    const v = this.host.get();
    const live = v.status === "on" && (voiceMode(v, this.host.isGm()) === "open" ? !v.muted : v.talking);
    for (const track of this.mic?.getAudioTracks() ?? []) track.enabled = live;
    if (v.status !== "on") return;
    if (!force && this.told === !live) return;
    if (this.host.send({ t: "voice", on: true, muted: !live })) this.told = !live;
  }

  /** One person's volume, from 0 to 1, for every tab of theirs, remembered in this browser. */
  setVolume(userId: string, volume: number): void {
    const v = Math.min(1, Math.max(0, volume));
    const volumes = { ...this.host.get().volumes, [userId]: v };
    if (v === 1) delete volumes[userId];
    this.host.set({ volumes });
    saveVolumes(volumes);
    for (const link of this.links.values()) if (link.userId === userId) link.audio.volume = v;
  }

  /**
   * Plays the others' sound after the browser held it back (Brave does, until the page is
   * clicked). Called from a click or key press: if the browser still says no, it stays held.
   */
  unblock(): void {
    void this.audio?.resume().catch(() => {});
    const plays = [...this.links.values()].filter((l) => l.audio.srcObject).map((l) => l.audio.play());
    void Promise.allSettled(plays).then((done) => this.setHeld(done.some((p) => p.status === "rejected")));
  }

  /** Whether the others' sound is held back; while it is, the next click or key press anywhere tries again. */
  private setHeld(held: boolean): void {
    if (this.host.get().blocked !== held) this.host.set({ blocked: held });
    if (held && this.host.get().status === "on") {
      document.addEventListener("pointerdown", this.onGesture, true);
      document.addEventListener("keydown", this.onGesture, true);
    } else {
      document.removeEventListener("pointerdown", this.onGesture, true);
      document.removeEventListener("keydown", this.onGesture, true);
    }
  }

  private onGesture = (): void => this.unblock();

  // ------------------------------------------------------------ from the server

  /** A new connection: the old one's calls belong to connIds that are gone, so start again. */
  onHello(): void {
    for (const id of [...this.links.keys()]) this.drop(id);
    this.host.set({ peers: [], links: {}, speaking: [] });
    this.told = null;
    this.snapshot = true;
    if (this.host.get().status === "on") this.applyMic(true);
  }

  onPeers(peers: VoicePeer[]): void {
    const me = this.host.myId();
    const v = this.host.get();
    const ids = new Set(peers.map((p) => p.connId));
    this.host.set({ peers });
    // Someone not in voice hears that it's on: once when the page connects, then whenever it starts.
    const snapshot = this.snapshot;
    this.snapshot = false;
    const others = peers.filter((p) => p.connId !== me);
    if (v.status === "off" && others[0]) {
      const join = "Join from the Chat & dice panel.";
      if (snapshot && !this.announced) {
        const who = others.length === 1 ? `${others[0].name} is` : `${others[0].name} and ${others.length - 1} more are`;
        this.host.toast(`${who} in voice chat. ${join}`);
      } else if (!snapshot && v.peers.length === 0) {
        this.host.toast(`${others[0].name} started voice chat. ${join}`);
      }
    }
    if (snapshot) this.announced = true;
    if (v.status !== "on") {
      // This tab only says it's joining once it's on, so the server having it now is a join
      // from before (it left while that was on the way): say it's out again.
      if (me && ids.has(me)) this.host.send({ t: "voice", on: false });
      for (const id of [...this.links.keys()]) this.drop(id);
      return;
    }
    for (const id of [...this.links.keys()]) if (!ids.has(id)) this.drop(id);
    // Calls start once the server has this tab in voice.
    if (v.status !== "on" || !me || !ids.has(me)) return;
    for (const p of peers) if (p.connId !== me && !this.links.has(p.connId)) this.open(p);
    for (const p of peers) {
      const link = this.links.get(p.connId);
      if (link && link.userId === p.userId) link.audio.volume = this.volumeFor(p.userId);
    }
  }

  onIce(servers: IceServer[]): void {
    this.servers = servers.length ? servers : STUN_ONLY;
    for (const link of this.links.values()) {
      try {
        link.pc.setConfiguration({ iceServers: this.servers });
      } catch {
        // A browser that won't change them keeps the ones it has.
      }
    }
  }

  onSignal(from: string, d: RtcSignal): void {
    const v = this.host.get();
    const me = this.host.myId();
    if (v.status !== "on" || !me) return;
    let link = this.links.get(from);
    if (!link) {
      const peer = v.peers.find((p) => p.connId === from);
      if (!peer || !v.peers.some((p) => p.connId === me)) return;
      link = this.open(peer);
    }
    const l = link;
    l.chain = l.chain.then(() => this.apply(from, l, d)).catch((err: unknown) => console.warn("voice: a signal failed", err));
  }

  onRefused(message: string): void {
    this.shutdown();
    this.host.set({ status: "off", muted: false, talking: false, links: {}, speaking: [], blocked: false });
    this.host.toast(message);
  }

  dispose(): void {
    this.shutdown();
    this.sink?.remove();
    this.sink = null;
  }

  // ------------------------------------------------------------ calls

  private open(peer: VoicePeer): Link {
    const pc = new RTCPeerConnection({ iceServers: this.servers });
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.volume = this.volumeFor(peer.userId);
    this.sinkEl().append(audio);
    const link: Link = {
      pc,
      userId: peer.userId,
      polite: (this.host.myId() ?? "") > peer.connId,
      makingOffer: false,
      ignoreOffer: false,
      answerPending: false,
      chain: Promise.resolve(),
      audio,
      restarts: 0,
    };
    const id = peer.connId;
    this.links.set(id, link);
    this.setLink(id, "connecting");
    if (this.mic) for (const track of this.mic.getAudioTracks()) pc.addTrack(track, this.mic);
    pc.onnegotiationneeded = async () => {
      try {
        link.makingOffer = true;
        await pc.setLocalDescription();
        this.sendDescription(id, pc.localDescription);
      } catch (err) {
        console.warn("voice: an offer failed", err);
      } finally {
        link.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate: c }) => {
      if (!c?.candidate) return;
      this.host.send({
        t: "rtc",
        to: id,
        d: { ice: { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, usernameFragment: c.usernameFragment } },
      });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = stream;
      audio.play().catch(() => {
        if (this.links.get(id) === link) this.setHeld(true);
      });
      this.meter(id, stream);
    };
    pc.onconnectionstatechange = () => {
      if (this.links.get(id) !== link) return;
      const s = pc.connectionState;
      if (s === "connected") {
        link.restarts = 0;
        this.setLink(id, "connected");
      } else if (s === "failed") {
        // The route stopped working (a network change, say): look for another, a few times.
        if (link.restarts < MAX_RESTARTS) {
          link.restarts++;
          pc.restartIce();
          this.setLink(id, "connecting");
        } else {
          this.setLink(id, "failed");
        }
      } else if (s === "disconnected" || s === "connecting") {
        this.setLink(id, "connecting");
      }
    };
    return link;
  }

  /** An offer, answer or route from the other tab of a call. */
  private async apply(from: string, link: Link, d: RtcSignal): Promise<void> {
    if (this.links.get(from) !== link) return;
    const pc = link.pc;
    if ("sdp" in d) {
      const desc = d.sdp;
      const ready = !link.makingOffer && (pc.signalingState === "stable" || link.answerPending);
      const collision = desc.type === "offer" && !ready;
      link.ignoreOffer = !link.polite && collision;
      if (link.ignoreOffer) return;
      link.answerPending = desc.type === "answer";
      try {
        await pc.setRemoteDescription(desc);
      } finally {
        link.answerPending = false;
      }
      if (desc.type === "offer") {
        await pc.setLocalDescription();
        this.sendDescription(from, pc.localDescription);
      }
      return;
    }
    try {
      await pc.addIceCandidate(d.ice);
    } catch (err) {
      // A route for an offer this tab ignored.
      if (!link.ignoreOffer) throw err;
    }
  }

  private sendDescription(to: string, desc: RTCSessionDescription | null): void {
    if (!desc || (desc.type !== "offer" && desc.type !== "answer")) return;
    this.host.send({ t: "rtc", to, d: { sdp: { type: desc.type, sdp: desc.sdp } } });
  }

  private drop(id: string): void {
    const link = this.links.get(id);
    if (!link) return;
    this.links.delete(id);
    const pc = link.pc;
    pc.onnegotiationneeded = null;
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.close();
    link.audio.srcObject = null;
    link.audio.remove();
    this.unmeter(id);
    const { [id]: _gone, ...links } = this.host.get().links;
    this.host.set({ links });
  }

  private setLink(id: string, state: LinkState): void {
    const links = this.host.get().links;
    if (links[id] !== state) this.host.set({ links: { ...links, [id]: state } });
  }

  private shutdown(): void {
    this.told = null;
    this.setHeld(false);
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("keyup", this.onKey, true);
    window.removeEventListener("blur", this.letGo);
    document.removeEventListener("visibilitychange", this.letGo);
    for (const id of [...this.links.keys()]) this.drop(id);
    for (const id of [...this.meters.keys()]) this.unmeter(id);
    const mic = this.mic;
    this.mic = null;
    for (const t of mic?.getTracks() ?? []) {
      t.onended = null;
      t.stop();
    }
    this.stopFakeMic?.();
    this.stopFakeMic = null;
    void this.audio?.close().catch(() => {});
    this.audio = null;
  }

  private volumeFor(userId: string): number {
    return this.host.get().volumes[userId] ?? 1;
  }

  /** Where the others' audio elements live: out of sight, but in the page, which some browsers need to play them. */
  private sinkEl(): HTMLElement {
    if (!this.sink) {
      this.sink = document.createElement("div");
      this.sink.hidden = true;
      this.sink.className = "voice-sink";
      document.body.append(this.sink);
    }
    return this.sink;
  }

  private async openMic(): Promise<MediaStream> {
    // Development only, ?fakemic: a tone instead of the microphone, so two tabs on one
    // computer can test a call without a microphone or the browser asking.
    if (this.allowFakeMic && this.audio && new URLSearchParams(location.search).has("fakemic")) {
      const ctx = this.audio;
      const tone = ctx.createOscillator();
      const pulse = ctx.createOscillator();
      const gain = ctx.createGain();
      const depth = ctx.createGain();
      const out = ctx.createMediaStreamDestination();
      tone.frequency.value = 300 + Math.round(Math.random() * 300);
      pulse.frequency.value = 0.5;
      gain.gain.value = 0.1;
      depth.gain.value = 0.1;
      pulse.connect(depth).connect(gain.gain);
      tone.connect(gain).connect(out);
      tone.start();
      pulse.start();
      this.stopFakeMic = () => {
        tone.stop();
        pulse.stop();
      };
      return out.stream;
    }
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  }

  // ------------------------------------------------------------ who's talking

  private meter(id: string, stream: MediaStream): void {
    const ctx = this.audio;
    if (!ctx) return;
    this.unmeter(id);
    try {
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.meters.set(id, { source, analyser, data: new Float32Array(analyser.fftSize), heard: 0 });
    } catch {
      return;
    }
    this.meterTimer ??= setInterval(() => this.listen(), 100);
  }

  private unmeter(id: string): void {
    const m = this.meters.get(id);
    if (!m) return;
    this.meters.delete(id);
    m.source.disconnect();
    if (!this.meters.size && this.meterTimer) {
      clearInterval(this.meterTimer);
      this.meterTimer = null;
    }
  }

  private listen(): void {
    const now = performance.now();
    // A browser can hold the sound back without play() saying so: an audio element with a call
    // in it that isn't playing is held.
    if (!this.host.get().blocked && [...this.links.values()].some((l) => l.audio.srcObject && l.audio.paused)) this.setHeld(true);
    const v = this.host.get();
    const me = this.host.myId();
    const speaking: string[] = [];
    for (const [id, m] of this.meters) {
      m.analyser.getFloatTimeDomainData(m.data);
      let sum = 0;
      for (const x of m.data) sum += x * x;
      if (Math.sqrt(sum / m.data.length) > SPEAKING_LEVEL) m.heard = now;
      if (now - m.heard >= SPEAKING_HOLD_MS) continue;
      if (id !== SELF) speaking.push(id);
      else if (me && this.mic?.getAudioTracks().some((t) => t.enabled)) speaking.push(me);
    }
    speaking.sort();
    const old = v.speaking;
    if (old.length !== speaking.length || speaking.some((id, i) => id !== old[i])) this.host.set({ speaking });
  }
}

/** Inputs that aren't typed into: a key pressed on one still talks. */
const NOT_TYPED = ["checkbox", "radio", "range", "button", "submit", "reset", "color", "file", "image"];

/** A key pressed in a box being typed into (not a checkbox or a slider, which keep the focus after a click). */
function typing(target: EventTarget | null): boolean {
  const el = target as (HTMLElement & { type?: string }) | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.tagName === "INPUT") return !NOT_TYPED.includes(String(el.type ?? "text").toLowerCase());
  return el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

/** A key push to talk can use. */
export function usableTalkKey(code: string): boolean {
  return /^[A-Za-z0-9]{1,24}$/.test(code) && code !== "Escape" && code !== "CapsLock";
}

function newAudioContext(): AudioContext | null {
  try {
    return new AudioContext();
  } catch {
    return null;
  }
}

/** What to tell someone whose microphone couldn't be opened. */
export function micError(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Tabletop isn't allowed to use your microphone. Allow it for this site in your browser (the icon at the left of the address bar), then click Join voice again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found. Plug one in, then click Join voice again.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "Your microphone couldn't be started. Another app may be using it.";
  }
  return "Your microphone couldn't be started.";
}

function loadTalkKey(): string {
  try {
    const v = localStorage.getItem(TALK_KEY_KEY);
    return v && usableTalkKey(v) ? v : DEFAULT_TALK_KEY;
  } catch {
    return DEFAULT_TALK_KEY;
  }
}

/** A key's name for people, from its KeyboardEvent.code: "Left Shift", "T", "Space", "F2". */
export function keyName(code: string): string {
  const side = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code);
  if (side) {
    const name = { Shift: "Shift", Control: "Ctrl", Alt: "Alt", Meta: "Cmd" }[side[1] as "Shift"];
    return `${side[2]} ${name}`;
  }
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (digit) return code.startsWith("Numpad") ? `Numpad ${digit[1]}` : digit[1];
  const named: Record<string, string> = {
    Space: "Space",
    Backquote: "`",
    Tab: "Tab",
    CapsLock: "Caps Lock",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    ContextMenu: "Menu",
  };
  return named[code] ?? code.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function loadMode(): VoiceMode | null {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "open" || v === "ptt" ? v : null;
  } catch {
    return null;
  }
}

function saveMode(mode: VoiceMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Private browsing, say: the choice lasts until the page closes.
  }
}

function loadVolumes(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(VOLUMES_KEY) ?? "{}") as unknown;
    const out: Record<string, number> = {};
    if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw)) if (typeof v === "number" && v >= 0 && v < 1) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveVolumes(volumes: Record<string, number>): void {
  try {
    // The 50 most recently set are enough.
    const entries = Object.entries(volumes).slice(-50);
    localStorage.setItem(VOLUMES_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Private browsing, say: volumes last until the page closes.
  }
}
