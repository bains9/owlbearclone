// Plays what's on in a room (its settings' sounds, chosen by the GM) on this device, at this device's
// own volume. A browser plays only after a click on the page: until then the sound is held, the page
// says so (ui/SoundPanel.tsx SoundHeldNotice), and the next click or key starts it.

import { buildSound, type RunningSound } from "./soundEngine";
import type { RoomSounds } from "../shared/sounds";

const VOLUME_KEY = "tabletop-sound-volume";
const MUTED_KEY = "tabletop-sound-muted";

/** Well clear of voice chat, but plainly there: the first weather sound was too quiet to hear at all. */
export const DEFAULT_VOLUME = 0.7;

/** How far ahead one-off sounds are scheduled, and how often: enough to ride out a busy page. */
const LOOKAHEAD = 2;
const PUMP_MS = 400;
/** Long enough to fade out in, then its nodes go. */
const FADE_OUT_S = 3;
/** A browser that's about to allow it takes a moment: no notice for that. */
const HELD_AFTER_MS = 500;
const PREVIEW = "preview";

export interface SoundState {
  volume: number;
  muted: boolean;
  /** The browser is holding the sound back until a click. */
  held: boolean;
  /** The sound being heard on this device only. */
  preview: string | null;
}

interface Layer {
  id: string;
  gain: GainNode;
  sound: RunningSound;
}

function loadNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // No storage: this page only.
  }
}

let state: SoundState | null = null;
const listeners = new Set<() => void>();

export function soundState(): SoundState {
  return (state ??= { volume: loadNumber(VOLUME_KEY, DEFAULT_VOLUME), muted: loadNumber(MUTED_KEY, 0) === 1, held: false, preview: null });
}

function setState(patch: Partial<SoundState>): void {
  state = { ...soundState(), ...patch };
  for (const l of listeners) l();
}

export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The slider's 0 to 1 as loudness, so its middle sounds like the middle. */
export function volumeGain(volume: number): number {
  return Math.min(1, Math.max(0, volume)) ** 1.7;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let wanted: RoomSounds = {};
const layers = new Map<string, Layer>();
let timer: ReturnType<typeof setInterval> | null = null;
let heldTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function context(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
  } catch {
    return null; // No Web Audio here: silence.
  }
  master = ctx.createGain();
  master.gain.value = volumeGain(soundState().volume);
  // Four sounds at once, or thunder over the top of them, stay inside what speakers can play.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 8;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  master.connect(limiter).connect(ctx.destination);
  ctx.onstatechange = checkHeld;
  return ctx;
}

const GESTURES = ["pointerdown", "pointerup", "click", "touchend", "keydown"];

function onGesture(): void {
  unlockSound();
}

function listenForGesture(on: boolean): void {
  if (on === listening) return;
  listening = on;
  for (const g of GESTURES) {
    if (on) window.addEventListener(g, onGesture, true);
    else window.removeEventListener(g, onGesture, true);
  }
}

/** Called from a click or key (Safari plays only sound started in the gesture itself). */
export function unlockSound(): void {
  if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
}

function checkHeld(): void {
  const waiting = layers.size > 0 && !!ctx && ctx.state !== "running";
  listenForGesture(waiting);
  if (heldTimer !== null) clearTimeout(heldTimer);
  heldTimer = null;
  if (!waiting) {
    if (soundState().held) setState({ held: false });
    return;
  }
  void ctx!.resume().catch(() => {});
  heldTimer = setTimeout(() => {
    heldTimer = null;
    if (layers.size > 0 && ctx && ctx.state !== "running" && !soundState().held) setState({ held: true });
  }, HELD_AFTER_MS);
}

function pump(): void {
  if (!ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;
  for (const layer of layers.values()) layer.sound.pump(now, now + LOOKAHEAD);
}

function addLayer(key: string, id: string, level: number): void {
  const c = context();
  if (!c || !master) return;
  const gain = c.createGain();
  gain.gain.value = 0;
  gain.connect(master);
  const sound = buildSound(id, c, gain);
  if (!sound) {
    gain.disconnect();
    return;
  }
  gain.gain.setTargetAtTime(level, c.currentTime, 0.6);
  layers.set(key, { id, gain, sound });
  timer ??= setInterval(pump, PUMP_MS);
  pump();
}

function removeLayer(key: string): void {
  const layer = layers.get(key);
  if (!layer || !ctx) return;
  layers.delete(key);
  const now = ctx.currentTime;
  layer.gain.gain.cancelScheduledValues(now);
  layer.gain.gain.setTargetAtTime(0, now, FADE_OUT_S / 5);
  layer.sound.stop(now + FADE_OUT_S);
  setTimeout(() => layer.gain.disconnect(), (FADE_OUT_S + 0.2) * 1000);
  if (!layers.size && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function apply(): void {
  // Muted makes nothing at all, so a slow device gets the work back.
  const on = soundState().muted ? {} : wanted;
  for (const key of [...layers.keys()]) if (key !== PREVIEW && !(key in on)) removeLayer(key);
  for (const [id, level] of Object.entries(on)) {
    const layer = layers.get(id);
    if (layer) layer.gain.gain.setTargetAtTime(level, ctx!.currentTime, 0.15);
    else addLayer(id, id, level);
  }
  checkHeld();
}

/** What the room has on. */
export function setRoomSounds(sounds: RoomSounds): void {
  wanted = sounds;
  apply();
}

/** The GM dragging a sound's slider: heard at once, sent to the room when let go. */
export function setSoundLevelHere(id: string, level: number): void {
  const layer = layers.get(id);
  if (layer && ctx) layer.gain.gain.setTargetAtTime(level, ctx.currentTime, 0.05);
}

/** Hears a sound on this device only, or with null stops. */
export function previewSound(id: string | null): void {
  if (soundState().preview === id) return;
  removeLayer(PREVIEW);
  if (id) {
    addLayer(PREVIEW, id, 1);
    unlockSound();
  }
  setState({ preview: id });
  checkHeld();
}

export function setSoundVolume(volume: number): void {
  const v = Math.min(1, Math.max(0, volume));
  save(VOLUME_KEY, String(v));
  setState({ volume: v });
  if (master && ctx) master.gain.setTargetAtTime(volumeGain(v), ctx.currentTime, 0.04);
}

export function setSoundMuted(muted: boolean): void {
  save(MUTED_KEY, muted ? "1" : "0");
  setState({ muted });
  apply();
}
