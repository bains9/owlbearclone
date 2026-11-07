// The background sounds themselves (shared/sounds.ts), made in the browser with no sound files, as the
// weather's rain and wind are: nothing to download or store, and a sound never repeats. Each is a few
// beds of filtered noise that run all the time, and one-off sounds (a drip, a clink, thunder) scheduled
// at uneven times a little ahead of when they play. Works on any audio context: a page's, or an offline
// one that renders it to measure (scratch checks of how loud each is, and its small-speaker content).

import type { SoundOption, StingId } from "../shared/sounds";

type Rand = () => number;
type NoiseKind = "white" | "pink" | "brown";
type Space = "room" | "hall" | "cave" | "church";
type Filter = [BiquadFilterType, number, number];

const lp = (f: number, q = 0.7): Filter => ["lowpass", f, q];
const hp = (f: number, q = 0.7): Filter => ["highpass", f, q];
const bp = (f: number, q = 1): Filter => ["bandpass", f, q];

const NOISE_SECONDS = 9;
const SPACES: Record<Space, { seconds: number; tone: number }> = {
  room: { seconds: 0.8, tone: 0.35 },
  hall: { seconds: 2.2, tone: 0.22 },
  cave: { seconds: 3.2, tone: 0.14 },
  church: { seconds: 5, tone: 0.16 },
};

interface Pluck {
  buffer: AudioBuffer;
  rate: number;
}

interface Shared {
  noise: Partial<Record<NoiseKind, AudioBuffer>>;
  impulse: Partial<Record<Space, AudioBuffer>>;
  plucks: Map<string, Pluck>;
  scatters: Map<string, AudioBuffer>;
}

const sharedByContext = new WeakMap<BaseAudioContext, Shared>();

function sharedOf(c: BaseAudioContext): Shared {
  let s = sharedByContext.get(c);
  if (!s) {
    s = { noise: {}, impulse: {}, plucks: new Map(), scatters: new Map() };
    sharedByContext.set(c, s);
  }
  return s;
}

/** Stereo noise that loops without a seam: its end is faded into its start. */
function makeNoise(c: BaseAudioContext, kind: NoiseKind): AudioBuffer {
  const sr = c.sampleRate;
  const len = Math.round(sr * NOISE_SECONDS);
  const tail = Math.round(sr * 0.25);
  const buffer = c.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const raw = new Float32Array(len + tail);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let last = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "white") raw[i] = w;
      else if (kind === "pink") {
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        raw[i] = b0 + b1 + b2 + w * 0.1848;
      } else {
        last = (last + 0.02 * w) / 1.02;
        raw[i] = last;
      }
    }
    const out = buffer.getChannelData(ch);
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const x = i < tail ? raw[i]! * (i / tail) + raw[len + i]! * (1 - i / tail) : raw[i]!;
      out[i] = x;
      peak = Math.max(peak, Math.abs(x));
    }
    for (let i = 0; i < len; i++) out[i] = out[i]! * (0.95 / (peak || 1));
  }
  return buffer;
}

/** How a space answers: noise dying away, its high notes first. */
function makeImpulse(c: BaseAudioContext, space: Space): AudioBuffer {
  const { seconds, tone } = SPACES[space];
  const len = Math.round(c.sampleRate * seconds);
  const buffer = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch);
    let y = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      y += (tone * (1 - 0.7 * t) + 0.02) * (Math.random() * 2 - 1 - y);
      d[i] = y * Math.exp(-5 * t) * (1 - t);
    }
  }
  return buffer;
}

/**
 * A plucked string (Karplus-Strong): a burst of noise going round a short delay, losing its high notes
 * each time. Made once for each note, and played a little faster or slower to be exactly in tune.
 */
function pluckOf(c: BaseAudioContext, midi: number, seconds: number, damp: number, soft: number): Pluck {
  const plucks = sharedOf(c).plucks;
  const key = `${midi}|${seconds}|${damp}|${soft}`;
  const found = plucks.get(key);
  if (found) return found;
  const sr = c.sampleRate;
  const f = 440 * 2 ** ((midi - 69) / 12);
  const period = Math.max(2, Math.round(sr / f - 0.5));
  const len = Math.round(sr * seconds);
  const buffer = c.createBuffer(1, len, sr);
  const d = buffer.getChannelData(0);
  let prev = 0;
  for (let i = 0; i < period; i++) {
    const w = Math.random() * 2 - 1;
    prev += soft * (w - prev);
    d[i] = prev;
  }
  for (let i = period; i < len; i++) d[i] = damp * 0.5 * (d[i - period]! + (i > period ? d[i - period - 1]! : 0));
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]!));
  const fade = Math.round(len * 0.05);
  for (let i = 0; i < len; i++) {
    const end = i > len - fade ? (len - i) / fade : 1;
    d[i] = (d[i]! / (peak || 1)) * end;
  }
  const made = { buffer, rate: f / (sr / (period + 0.5)) };
  plucks.set(key, made);
  return made;
}

type Range = readonly [number, number];
const SCATTER_SECONDS = 11;

/**
 * Many small sounds at random across a stretch that loops: rain's thousand drops cost no more than
 * one sound does. Each is added straight into the buffer, wrapping round its end so there's no seam.
 */
function scatter(c: BaseAudioContext, key: string, perSecond: number, one: (write: (n: number, value: number) => void) => void): AudioBuffer {
  const scatters = sharedOf(c).scatters;
  const found = scatters.get(key);
  if (found) return found;
  const len = Math.round(c.sampleRate * SCATTER_SECONDS);
  const buffer = c.createBuffer(2, len, c.sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const count = Math.round(perSecond * SCATTER_SECONDS);
  for (let i = 0; i < count; i++) {
    const at = Math.floor(Math.random() * len);
    const pan = Math.random();
    const l = Math.cos((pan * Math.PI) / 2);
    const r = Math.sin((pan * Math.PI) / 2);
    one((n, value) => {
      const p = (at + n) % len;
      left[p] = left[p]! + value * l;
      right[p] = right[p]! + value * r;
    });
  }
  scatters.set(key, buffer);
  return buffer;
}

const between = ([a, b]: Range) => a + Math.random() * (b - a);

/** Tiny dry ticks: rain on leaves, sparks from a fire, ice on a cloak. */
function ticksBuffer(c: BaseAudioContext, perSecond: number, pitch: Range, level: Range, ring: Range): AudioBuffer {
  return scatter(c, `ticks ${perSecond} ${pitch} ${level} ${ring}`, perSecond, (write) => {
    const sr = c.sampleRate;
    const f = (2 * Math.PI * between(pitch)) / sr;
    // Most are small, a few much bigger.
    const a = level[0] + (level[1] - level[0]) * Math.random() ** 3;
    const samples = Math.round(between(ring) * sr);
    const phase = Math.random() * 6.28;
    for (let n = 0; n < samples * 5; n++) write(n, a * Math.exp(-n / samples) * Math.sin(f * n + phase));
  });
}

/** Small bubbles of air in water: pure notes sweeping up as each one closes. */
function bubblesBuffer(c: BaseAudioContext, perSecond: number, pitch: Range, level: Range): AudioBuffer {
  return scatter(c, `bubbles ${perSecond} ${pitch} ${level}`, perSecond, (write) => {
    const sr = c.sampleRate;
    const from = between(pitch);
    const rise = 1 + Math.random() * 1.2;
    const a = between(level);
    const samples = Math.round((0.03 + Math.random() * 0.05) * sr);
    let phase = 0;
    for (let n = 0; n < samples; n++) {
      const t = n / samples;
      phase += (2 * Math.PI * from * (1 + (rise - 1) * t)) / sr;
      write(n, a * Math.min(1, n / (sr * 0.002)) * (1 - t) ** 2 * Math.sin(phase));
    }
  });
}

interface Timer {
  next: number;
  /** Plays what's due at t, and says how long until the next. */
  step: (t: number) => number;
}

interface Placing {
  pan?: number;
  space?: Space;
  wet?: number;
  dry?: number;
}

/** What every recipe makes its sound from. */
export class SoundKit {
  readonly sources: AudioScheduledSourceNode[] = [];
  readonly timers: Timer[] = [];
  private readonly spaces = new Map<Space, ConvolverNode>();

  constructor(
    readonly c: BaseAudioContext,
    readonly out: AudioNode,
    readonly rand: Rand,
  ) {}

  r(a: number, b: number): number {
    return a + this.rand() * (b - a);
  }

  chance(p: number): boolean {
    return this.rand() < p;
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rand() * list.length)]!;
  }

  gain(value = 1): GainNode {
    const g = this.c.createGain();
    g.gain.value = value;
    return g;
  }

  filter([type, frequency, q]: Filter): BiquadFilterNode {
    const f = this.c.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  }

  private buffer(kind: NoiseKind): AudioBuffer {
    const s = sharedOf(this.c);
    return (s.noise[kind] ??= makeNoise(this.c, kind));
  }

  /** How a space answers (sent to the sound's output, so it fades with the sound). */
  verb(space: Space): AudioNode {
    let v = this.spaces.get(space);
    if (!v) {
      const s = sharedOf(this.c);
      v = this.c.createConvolver();
      v.buffer = s.impulse[space] ??= makeImpulse(this.c, space);
      v.connect(this.out);
      this.spaces.set(space, v);
    }
    return v;
  }

  /** Sends a sound out: panned, as it is, with some of it into a space. */
  place(node: AudioNode, how: Placing = {}): void {
    const { pan = 0, space, wet = 0.3, dry = 1 } = how;
    const panner = this.c.createStereoPanner();
    panner.pan.value = pan;
    node.connect(panner);
    if (dry === 1) panner.connect(this.out);
    else if (dry > 0) panner.connect(this.gain(dry)).connect(this.out);
    if (space) panner.connect(this.gain(wet)).connect(this.verb(space));
  }

  /** Filters one after another, from a node; the last is returned to carry on from. */
  through(from: AudioNode, filters: Filter[]): { end: AudioNode; made: BiquadFilterNode[] } {
    let end = from;
    const made: BiquadFilterNode[] = [];
    for (const spec of filters) {
      const f = this.filter(spec);
      end = end.connect(f);
      made.push(f);
    }
    return { end, made };
  }

  /** A bed of noise that runs until the sound stops. */
  noise(kind: NoiseKind, filters: Filter[], level: number, how: Placing & { rate?: number } = {}): { gain: GainNode; filters: BiquadFilterNode[] } {
    const src = this.c.createBufferSource();
    src.buffer = this.buffer(kind);
    src.loop = true;
    src.playbackRate.value = how.rate ?? this.r(0.97, 1.03);
    const { end, made } = this.through(src, filters);
    const gain = this.gain(level);
    end.connect(gain);
    this.place(gain, how);
    src.start(this.c.currentTime, this.r(0, NOISE_SECONDS - 0.1));
    this.sources.push(src);
    return { gain, filters: made };
  }

  /** A stretch made beforehand, looping until the sound stops. */
  loopOf(buffer: AudioBuffer, how: Placing = {}): void {
    const src = this.c.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    this.place(src, how);
    src.start(this.c.currentTime, this.r(0, SCATTER_SECONDS - 0.1));
    this.sources.push(src);
  }

  ticks(perSecond: number, pitch: Range, level: Range, ring: Range): void {
    this.loopOf(ticksBuffer(this.c, perSecond, pitch, level, ring));
  }

  /** A slow swing up and down in something (a bed's loudness, a filter's pitch). */
  wobble(param: AudioParam, rate: number, depth: number): void {
    const o = this.c.createOscillator();
    o.frequency.value = rate;
    o.connect(this.gain(depth)).connect(param);
    o.start(this.c.currentTime + this.r(0, 0.05));
    this.sources.push(o);
  }

  /** Noise for a one-off sound. */
  shot(kind: NoiseKind, t: number, seconds: number): AudioBufferSourceNode {
    const src = this.c.createBufferSource();
    src.buffer = this.buffer(kind);
    src.loop = true;
    src.start(t, this.r(0, NOISE_SECONDS - 0.1));
    src.stop(t + seconds + 0.05);
    return src;
  }

  osc(type: OscillatorType, frequency: number, t: number): OscillatorNode {
    const o = this.c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(frequency, t);
    o.start(t);
    return o;
  }

  /** A gain that strikes and dies away. */
  struck(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.gain(0.0001);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  /** Something to happen over and over, after an uneven wait each time. */
  every(min: number, max: number, play: (t: number) => void, first = this.r(0, max * 0.5)): void {
    this.loop(first, (t) => {
      play(t);
      return this.r(min, max);
    });
  }

  /** Something that says each time how long until it's next due (a tune). */
  loop(first: number, step: (t: number) => number): void {
    this.timers.push({ next: this.c.currentTime + first, step });
  }

  /**
   * Schedules everything due before `until`. A page that slept (a hidden tab, say) skips what it
   * missed rather than playing it all at once.
   */
  pump(now: number, until: number): void {
    for (const timer of this.timers) {
      if (timer.next < now - 0.05) timer.next = now + this.r(0, 0.5);
      let guard = 0;
      while (timer.next < until && guard++ < 50_000) {
        const t = timer.next;
        timer.next = t + Math.max(timer.step(t), 0);
      }
    }
  }
}

// ------------------------------------------------------------ one-off sounds

/** A fire's pop: a tick with a little body to it. */
function pop(k: SoundKit, t: number, level: number): void {
  const sum = k.gain(1);
  const src = k.shot("white", t, 0.1);
  k.through(src, [bp(k.r(1400, 3200), 1.6)]).end.connect(k.struck(t, level, 0.0006, k.r(0.015, 0.04))).connect(sum);
  k.through(src, [bp(k.r(350, 800), 2.5)]).end.connect(k.struck(t, level * 0.7, 0.001, k.r(0.04, 0.09))).connect(sum);
  k.place(sum, { pan: k.r(-0.5, 0.5) });
}

/** A drop of water: a pure note sweeping up, as the bubble it leaves closes. */
function drip(k: SoundKit, t: number, f: number, level: number, how: Placing): void {
  const o = k.osc("sine", f, t);
  const end = t + k.r(0.04, 0.07);
  o.frequency.exponentialRampToValueAtTime(f * k.r(1.5, 2.3), end);
  o.stop(end + 0.12);
  const g = k.struck(t, level, 0.002, k.r(0.05, 0.11));
  o.connect(g);
  k.place(g, how);
}

/** Struck metal or glass: notes that aren't in tune with each other, the high ones dying first. */
function metal(k: SoundKit, t: number, f: number, ratios: number[], decay: number, level: number, how: Placing): void {
  const sum = k.gain(1);
  ratios.forEach((ratio, i) => {
    const o = k.osc("sine", f * ratio, t);
    const d = decay / (1 + i * 0.35);
    o.stop(t + d + 0.05);
    o.connect(k.struck(t, level / (1 + i) ** 0.6, 0.0015, d)).connect(sum);
  });
  k.place(sum, how);
}

const GLASS = [1, 1.52, 2.31, 3.07];
const LINK = [1, 1.41, 2.13];
const ANVIL = [1, 1.48, 2.51, 3.31];
const BLADE = [1, 1.37, 1.91, 2.63, 3.71];
const BELL = [0.5, 1, 1.19, 1.5, 2, 2.51, 2.99, 4.02];
const CHIME = [1, 2.76, 5.4];

function clink(k: SoundKit, t: number, level: number): void {
  const how = { pan: k.r(-0.7, 0.7), space: "room" as const, wet: 0.5 };
  metal(k, t, k.r(1500, 2600), GLASS, k.r(0.12, 0.26), level, how);
  if (k.chance(0.35)) metal(k, t + k.r(0.09, 0.18), k.r(1500, 2600), GLASS, k.r(0.1, 0.2), level * 0.7, how);
}

/** Something wooden knocked: a mug set down, a boot on boards, a rope block against a mast. */
function knock(k: SoundKit, t: number, level: number, how: Placing): void {
  const f = k.r(180, 420);
  const sum = k.gain(1);
  const o = k.osc("triangle", f, t);
  o.frequency.exponentialRampToValueAtTime(f * 0.8, t + 0.05);
  o.stop(t + 0.12);
  o.connect(k.struck(t, level, 0.001, k.r(0.05, 0.09))).connect(sum);
  const src = k.shot("white", t, 0.04);
  k.through(src, [bp(k.r(900, 1600), 1.5)]).end.connect(k.struck(t, level * 0.3, 0.0008, 0.018)).connect(sum);
  k.place(sum, how);
}

/** Wood taking strain: a low buzz of tiny slips, ringing in the wood. */
function creak(k: SoundKit, t: number, level: number, how: Placing): void {
  const dur = k.r(0.5, 1.6);
  const o = k.osc("sawtooth", k.r(16, 34), t);
  o.frequency.linearRampToValueAtTime(k.r(28, 62), t + dur * k.r(0.4, 0.8));
  o.frequency.linearRampToValueAtTime(k.r(14, 40), t + dur);
  o.stop(t + dur + 0.05);
  const g = k.gain(0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + dur * 0.25);
  g.gain.setValueAtTime(level, t + dur * 0.7);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(k.filter(bp(k.r(500, 1300), 7))).connect(g);
  o.connect(k.filter(bp(k.r(190, 300), 5))).connect(g);
  k.place(g, how);
}

const BIRD_LEVEL: [number, number] = [0.03, 0.11];

function bird(k: SoundKit, t: number): void {
  const notes: [number, number, number, number][] = [];
  let at = 0;
  const kind = Math.floor(k.rand() * 4);
  if (kind === 0) {
    // A trill.
    const f = k.r(3200, 5200);
    const n = Math.round(k.r(7, 16));
    for (let i = 0; i < n; i++) {
      notes.push([at, 0.035, i % 2 ? f : f * 1.14, i % 2 ? f * 1.14 : f]);
      at += 0.05;
    }
  } else if (kind === 1) {
    // Slow whistles.
    const f = k.r(2200, 3400);
    const n = Math.round(k.r(2, 4));
    for (let i = 0; i < n; i++) {
      notes.push([at, 0.22, f, f * k.r(1.1, 1.35)]);
      at += k.r(0.3, 0.42);
    }
  } else if (kind === 2) {
    // Quick chirps, falling.
    const n = Math.round(k.r(3, 7));
    for (let i = 0; i < n; i++) {
      notes.push([at, 0.06, k.r(5200, 6400), k.r(3200, 3900)]);
      at += k.r(0.09, 0.14);
    }
  } else {
    // A wandering warble.
    let f = k.r(2600, 3800);
    const n = Math.round(k.r(6, 12));
    for (let i = 0; i < n; i++) {
      const to = Math.min(5600, Math.max(2200, f * k.r(0.82, 1.22)));
      const d = k.r(0.07, 0.12);
      notes.push([at, d, f, to]);
      f = to;
      at += d + k.r(0.01, 0.03);
    }
  }
  const level = k.r(...BIRD_LEVEL);
  const o = k.osc("sine", notes[0]![2], t);
  o.stop(t + at + 0.1);
  const g = k.gain(0);
  for (const [s, d, from, to] of notes) {
    o.frequency.setValueAtTime(from, t + s);
    o.frequency.exponentialRampToValueAtTime(to, t + s + d);
    g.gain.setValueAtTime(0, t + s);
    g.gain.linearRampToValueAtTime(level, t + s + d * 0.25);
    g.gain.setValueAtTime(level, t + s + d * 0.7);
    g.gain.linearRampToValueAtTime(0, t + s + d);
  }
  o.connect(g);
  k.place(g, { pan: k.r(-0.85, 0.85), space: "hall", wet: 0.35 });
}

function cuckoo(k: SoundKit, t: number): void {
  const pan = k.r(-0.8, 0.8);
  const n = Math.round(k.r(3, 6));
  for (let i = 0; i < n; i++) {
    const at = t + i * 0.95;
    for (const [f, off, d] of [
      [659, 0, 0.2],
      [523, 0.28, 0.3],
    ] as const) {
      const o = k.osc("triangle", f, at + off);
      o.stop(at + off + d + 0.05);
      const g = k.gain(0);
      g.gain.setValueAtTime(0, at + off);
      g.gain.linearRampToValueAtTime(0.05, at + off + 0.03);
      g.gain.setTargetAtTime(0, at + off + d * 0.5, d * 0.25);
      o.connect(g);
      k.place(g, { pan, space: "hall", wet: 0.8, dry: 0.6 });
    }
  }
}

function woodpecker(k: SoundKit, t: number): void {
  const pan = k.r(-0.9, 0.9);
  const n = Math.round(k.r(9, 17));
  for (let i = 0; i < n; i++) knock(k, t + i * 0.052, 0.09 * (1 - (0.3 * i) / n), { pan, space: "hall", wet: 0.6 });
}

function cricket(k: SoundKit, t: number, f: number, level: number, pan: number): void {
  const o = k.osc("sine", f, t);
  const g = k.gain(0);
  const pulses = Math.round(k.r(2, 4));
  for (let i = 0; i < pulses; i++) {
    const at = t + i * 0.034;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.005);
    g.gain.setValueAtTime(level, at + 0.015);
    g.gain.linearRampToValueAtTime(0, at + 0.021);
  }
  o.stop(t + pulses * 0.034 + 0.02);
  o.connect(g);
  k.place(g, { pan });
}

function owl(k: SoundKit, t: number): void {
  const pan = k.r(-0.8, 0.8);
  const f = k.r(330, 410);
  let at = t;
  for (const d of [0.38, 0.2, 0.2, 0.6]) {
    const o = k.osc("triangle", f * 1.03, at);
    o.frequency.exponentialRampToValueAtTime(f * 0.94, at + d);
    o.stop(at + d + 0.1);
    const g = k.gain(0);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.12, at + d * 0.3);
    g.gain.setTargetAtTime(0, at + d * 0.6, d * 0.18);
    o.connect(g);
    k.place(g, { pan, space: "hall", wet: 0.9, dry: 0.7 });
    at += d + 0.13;
  }
}

function wolf(k: SoundKit, t: number): void {
  const f = k.r(300, 360);
  const rise = k.r(1, 1.6);
  const hold = k.r(2.2, 3.6);
  const fall = k.r(1.3, 2);
  const o = k.osc("sawtooth", f, t);
  const top = f * k.r(1.55, 1.8);
  o.frequency.exponentialRampToValueAtTime(top, t + rise);
  o.frequency.setValueAtTime(top, t + rise + hold);
  o.frequency.exponentialRampToValueAtTime(f * 1.05, t + rise + hold + fall);
  o.stop(t + rise + hold + fall + 0.1);
  const vibrato = k.osc("sine", 4.6, t);
  vibrato.stop(t + rise + hold + fall + 0.1);
  vibrato.connect(k.gain(6)).connect(o.frequency);
  const g = k.gain(0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.1, t + rise);
  g.gain.setValueAtTime(0.1, t + rise + hold * 0.7);
  g.gain.linearRampToValueAtTime(0, t + rise + hold + fall);
  o.connect(k.filter(lp(1400))).connect(k.filter(bp(900, 1.2))).connect(g);
  k.place(g, { pan: k.r(-0.8, 0.8), space: "hall", wet: 1, dry: 0.3 });
}

function frog(k: SoundKit, t: number): void {
  const f = k.r(95, 175);
  const pulses = Math.round(k.r(6, 16));
  const gap = 1 / k.r(22, 32);
  const o = k.osc("sawtooth", f, t);
  o.frequency.linearRampToValueAtTime(f * 0.88, t + pulses * gap);
  o.stop(t + pulses * gap + 0.05);
  const g = k.gain(0);
  const level = k.r(0.16, 0.36);
  for (let i = 0; i < pulses; i++) {
    const at = t + i * gap;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + gap * 0.3);
    g.gain.linearRampToValueAtTime(0, at + gap * 0.85);
  }
  o.connect(k.filter(bp(k.r(650, 1150), 3))).connect(g);
  k.place(g, { pan: k.r(-0.9, 0.9), space: "hall", wet: 0.2 });
}

function peeper(k: SoundKit, t: number): void {
  const f = k.r(2300, 3000);
  const o = k.osc("sine", f, t);
  o.frequency.exponentialRampToValueAtTime(f * 1.2, t + 0.14);
  o.stop(t + 0.2);
  const g = k.gain(0);
  const level = k.r(0.04, 0.1);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + 0.05);
  g.gain.linearRampToValueAtTime(0, t + 0.16);
  o.connect(g);
  k.place(g, { pan: k.r(-1, 1) });
}

function gull(k: SoundKit, t: number, space: Space = "hall"): void {
  const pan = k.r(-0.9, 0.9);
  const n = Math.round(k.r(3, 6));
  const level = k.r(0.03, 0.08);
  let at = t;
  for (let i = 0; i < n; i++) {
    const d = k.r(0.22, 0.36);
    const f = k.r(850, 1050);
    const o = k.osc("sawtooth", f, at);
    o.frequency.exponentialRampToValueAtTime(f * k.r(1.45, 1.7), at + d * 0.3);
    o.frequency.exponentialRampToValueAtTime(f * 1.05, at + d);
    o.stop(at + d + 0.05);
    const g = k.struck(at, level, 0.025, d);
    o.connect(k.filter(bp(1800, 2))).connect(g);
    k.place(g, { pan, space, wet: 0.7, dry: 0.8 });
    at += d + k.r(0.08, 0.28);
  }
}

/** A wave coming in and drawing back: noise whose pitch climbs as it breaks, then foam hissing away. */
function wave(k: SoundKit, t: number, size: number): void {
  const rise = k.r(1.8, 3.2) * size;
  const fall = k.r(3.5, 6) * size;
  const pan = k.r(-0.4, 0.4);
  const body = k.shot("pink", t, rise + fall);
  const band = k.filter(bp(260, 0.6));
  band.frequency.setValueAtTime(260, t);
  band.frequency.exponentialRampToValueAtTime(1300, t + rise);
  band.frequency.exponentialRampToValueAtTime(420, t + rise + fall);
  const g = k.gain(0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.9 * size, t + rise);
  g.gain.setTargetAtTime(0, t + rise, fall * 0.3);
  body.connect(band).connect(g);
  k.place(g, { pan });
  const foam = k.shot("white", t + rise * 0.7, rise * 0.3 + fall);
  const hiss = k.gain(0);
  hiss.gain.setValueAtTime(0, t + rise * 0.7);
  hiss.gain.linearRampToValueAtTime(0.12 * size, t + rise + 0.3);
  hiss.gain.setTargetAtTime(0, t + rise + 0.3, fall * 0.28);
  k.through(foam, [hp(2800)]).end.connect(hiss);
  k.place(hiss, { pan: -pan });
}

function thunder(k: SoundKit, t: number): void {
  const dur = k.r(6, 13);
  const points = 96;
  const curve = new Float32Array(points);
  const speakers = new Float32Array(points);
  const onset = k.r(1, 7);
  let walk = 0.7;
  for (let i = 0; i < points; i++) {
    walk = Math.min(1, Math.max(0.25, walk + (k.rand() - 0.5) * 0.35));
    const shape = Math.min(1, i / onset) * Math.exp((-3.4 * i) / points) * (1 - i / (points - 1)) * walk;
    curve[i] = shape;
    speakers[i] = shape * shape;
  }
  const near = k.chance(0.45);
  const peak = near ? 1 : 0.6;
  const low = k.shot("brown", t, dur);
  const g = k.gain(0);
  g.gain.setValueCurveAtTime(curve, t, dur);
  k.through(low, [lp(k.r(160, 340))]).end.connect(k.gain(peak * 1.6)).connect(g);
  k.place(g, { pan: k.r(-0.3, 0.3), space: "hall", wet: 0.3 });
  // The part of it a laptop's or a tablet's small speakers can play.
  const mid = k.shot("pink", t, dur);
  const m = k.gain(0);
  m.gain.setValueCurveAtTime(speakers, t, dur);
  k.through(mid, [bp(k.r(280, 520), 0.7)]).end.connect(k.gain(peak * 1.1)).connect(m);
  k.place(m, { pan: k.r(-0.3, 0.3), space: "hall", wet: 0.3 });
  if (near) {
    const crack = k.shot("white", t, 0.35);
    const c = k.struck(t, 0.25, 0.002, k.r(0.1, 0.28));
    k.through(crack, [hp(1100)]).end.connect(c);
    k.place(c, { space: "hall", wet: 0.8 });
  }
}

/** A chain moved: a run of small struck links, somewhere down the corridor. */
function chains(k: SoundKit, t: number, space: Space): void {
  const pan = k.r(-0.8, 0.8);
  const n = Math.round(k.r(5, 12));
  let at = t;
  for (let i = 0; i < n; i++) {
    metal(k, at, k.r(2200, 4200), LINK, k.r(0.05, 0.12), k.r(0.02, 0.06), { pan, space, wet: 0.9, dry: 0.5 });
    at += k.r(0.04, 0.17);
  }
}

/** Stone dragged over stone. */
function scrape(k: SoundKit, t: number, space: Space): void {
  const dur = k.r(1.5, 3.2);
  const src = k.shot("brown", t, dur);
  const grit = k.shot("white", t, dur);
  const g = k.gain(0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.5, t + dur * 0.2);
  g.gain.setValueAtTime(0.4, t + dur * 0.75);
  g.gain.linearRampToValueAtTime(0, t + dur);
  const shudder = k.osc("sine", k.r(5, 11), t);
  shudder.stop(t + dur + 0.05);
  shudder.connect(k.gain(0.18)).connect(g.gain);
  k.through(src, [bp(k.r(260, 480), 1.5)]).end.connect(g);
  k.through(grit, [bp(k.r(1100, 1900), 2.5)]).end.connect(k.gain(0.06)).connect(g);
  k.place(g, { pan: k.r(-0.7, 0.7), space, wet: 1, dry: 0.4 });
}

/** Something heavy and iron shutting, far off. */
function boom(k: SoundKit, t: number, level: number, space: Space): void {
  const f = k.r(70, 110);
  const sum = k.gain(1);
  const o = k.osc("sine", f * 1.6, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
  o.stop(t + 1.3);
  o.connect(k.struck(t, level, 0.004, 1.1)).connect(sum);
  const src = k.shot("pink", t, 0.5);
  k.through(src, [bp(k.r(240, 420), 1.2)]).end.connect(k.struck(t, level * 0.8, 0.002, 0.28)).connect(sum);
  k.place(sum, { pan: k.r(-0.6, 0.6), space, wet: 1, dry: 0.5 });
}

const VOWELS: readonly [number, number][] = [
  [730, 1090],
  [270, 2290],
  [530, 1840],
  [570, 840],
  [300, 870],
  [660, 1720],
];

/** One person saying something, too far off to make out, sent into a crowd. */
function talk(k: SoundKit, t: number, crowd: AudioNode): void {
  const base = k.chance(0.55) ? k.r(95, 135) : k.r(170, 230);
  const o = k.osc("sawtooth", base, t);
  const f1 = k.filter(bp(600, 5));
  const f2 = k.filter(bp(1400, 7));
  const g = k.gain(0);
  const level = k.r(0.05, 0.16);
  const syllables = Math.round(k.r(3, 9));
  let at = t;
  for (let i = 0; i < syllables; i++) {
    const d = k.r(0.1, 0.24);
    const [a, b] = k.pick(VOWELS);
    o.frequency.linearRampToValueAtTime(base * k.r(0.88, 1.18), at + d);
    f1.frequency.setTargetAtTime(a, at, 0.03);
    f2.frequency.setTargetAtTime(b, at, 0.03);
    const peak = level * k.r(0.5, 1);
    g.gain.setTargetAtTime(peak, at, 0.02);
    g.gain.setTargetAtTime(peak * 0.12, at + d * 0.7, 0.03);
    at += d;
  }
  g.gain.setTargetAtTime(0, at, 0.03);
  o.stop(at + 0.25);
  o.connect(f1).connect(g);
  o.connect(f2).connect(g);
  const panner = k.c.createStereoPanner();
  panner.pan.value = k.r(-0.85, 0.85);
  g.connect(panner).connect(crowd);
}

/** A crowd to send talk into: a little dulled by the distance, and in a space. */
function crowdBus(k: SoundKit, muffle: number, space: Space, wet: number, level = 1): AudioNode {
  const bus = k.gain(level);
  const dull = k.filter(lp(muffle));
  bus.connect(dull);
  k.place(dull, { space, wet });
  return bus;
}

/** A horse walking by, its hooves coming up and fading again as it crosses from one side to the other. */
function horse(k: SoundKit, t: number): void {
  const hits = Math.round(k.r(16, 30));
  const from = k.chance(0.5) ? -0.85 : 0.85;
  const beat = k.r(0.26, 0.31);
  for (let i = 0; i < hits; i++) {
    const across = i / (hits - 1);
    const near = Math.sin(across * Math.PI);
    const at = t + i * beat + (i % 2 ? 0.03 : 0);
    knock(k, at, (i % 2 ? 0.06 : 0.09) * (0.25 + 0.75 * near), { pan: from * (1 - 2 * across), space: "hall", wet: 0.3 });
  }
}

function anvil(k: SoundKit, t: number): void {
  const pan = k.r(-0.8, 0.8);
  const hits = Math.round(k.r(2, 5));
  const gap = k.r(0.55, 0.75);
  const f = k.r(1700, 2200);
  for (let i = 0; i < hits; i++) metal(k, t + i * gap, f, ANVIL, 0.45, 0.04, { pan, space: "hall", wet: 0.6, dry: 0.7 });
}

function drum(k: SoundKit, t: number, f: number, level: number, pan = 0): void {
  const sum = k.gain(1);
  const o = k.osc("sine", f * 2.2, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
  o.stop(t + 0.75);
  o.connect(k.struck(t, level * 0.6, 0.003, 0.6)).connect(sum);
  // The skin: what small speakers play of a drum too low for them.
  const skin = k.osc("triangle", f * 4.5, t);
  skin.frequency.exponentialRampToValueAtTime(f * 3.5, t + 0.06);
  skin.stop(t + 0.28);
  skin.connect(k.struck(t, level * 1.1, 0.002, 0.22)).connect(sum);
  const src = k.shot("white", t, 0.08);
  k.through(src, [bp(1100, 0.8)]).end.connect(k.struck(t, level * 0.5, 0.001, 0.035)).connect(sum);
  k.place(sum, { pan, space: "hall", wet: 0.3 });
}

function warHorn(k: SoundKit, t: number): void {
  const f = k.pick([98, 110, 123.5]);
  const hold = k.r(2.2, 3.8);
  const end = t + 0.7 + hold + 1.2;
  const g = k.gain(0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.1, t + 0.7);
  g.gain.setValueAtTime(0.1, t + 0.7 + hold);
  g.gain.linearRampToValueAtTime(0, end);
  const tone = k.filter(lp(500, 1.5));
  tone.frequency.setValueAtTime(500, t);
  tone.frequency.linearRampToValueAtTime(1300, t + 0.9);
  tone.frequency.linearRampToValueAtTime(800, end);
  for (const [ratio, detune] of [
    [1, -5],
    [1, 6],
    [1.5, 3],
  ] as const) {
    const o = k.osc("sawtooth", f * ratio * 0.94, t);
    o.frequency.exponentialRampToValueAtTime(f * ratio, t + 0.5);
    o.detune.value = detune;
    o.stop(end + 0.05);
    o.connect(tone);
  }
  tone.connect(g);
  k.place(g, { pan: k.r(-0.5, 0.5), space: "hall", wet: 0.9, dry: 0.6 });
}

function heartbeat(k: SoundKit, t: number, level: number): void {
  for (const [at, l] of [
    [0, 1],
    [0.3, 0.65],
  ] as const) {
    const sum = k.gain(1);
    const o = k.osc("sine", 72, t + at);
    o.frequency.exponentialRampToValueAtTime(48, t + at + 0.12);
    o.stop(t + at + 0.25);
    o.connect(k.struck(t + at, level * l, 0.008, 0.18)).connect(sum);
    // What small speakers play of it.
    const top = k.osc("triangle", 190, t + at);
    top.frequency.exponentialRampToValueAtTime(130, t + at + 0.1);
    top.stop(t + at + 0.16);
    top.connect(k.struck(t + at, level * l * 0.8, 0.006, 0.11)).connect(sum);
    k.place(sum);
  }
}

/** Breath shaped into syllables: words that can't quite be made out, off to one side. */
function whisper(k: SoundKit, t: number): void {
  const syllables = Math.round(k.r(5, 14));
  let at = t;
  const f1 = k.filter(bp(1200, 6));
  const f2 = k.filter(bp(2400, 8));
  const f3 = k.filter(hp(4200));
  const g = k.gain(0);
  const level = k.r(0.5, 1);
  for (let i = 0; i < syllables; i++) {
    const d = k.r(0.09, 0.22);
    const [a, b] = k.pick(VOWELS);
    f1.frequency.setTargetAtTime(a * 1.5, at, 0.02);
    f2.frequency.setTargetAtTime(b * 1.3, at, 0.02);
    g.gain.setTargetAtTime(level * k.r(0.4, 1), at, 0.02);
    g.gain.setTargetAtTime(0.02, at + d * 0.7, 0.025);
    at += d;
  }
  g.gain.setTargetAtTime(0, at, 0.05);
  const src = k.shot("white", t, at - t + 0.3);
  src.connect(f1).connect(g);
  src.connect(f2).connect(g);
  src.connect(f3).connect(k.gain(0.12)).connect(g);
  k.place(g, { pan: k.pick([-0.8, -0.6, 0.6, 0.8]), space: "cave", wet: 0.6, dry: 0.8 });
}

/** A held chord of buzzing notes, dulled and drifting: the floor under a dark place. */
function drone(k: SoundKit, freqs: number[], cutoff: number, level: number, space: Space, into?: AudioNode): void {
  const dull = k.filter(lp(cutoff, 1.2));
  const g = k.gain(level);
  dull.connect(g);
  if (into) g.connect(into);
  else k.place(g, { space, wet: 0.5 });
  k.wobble(dull.frequency, 0.05, cutoff * 0.3);
  k.wobble(g.gain, 0.08, level * 0.2);
  for (const f of freqs) {
    for (const cents of [-6, 5]) {
      const o = k.c.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = cents;
      o.connect(dull);
      o.start(k.c.currentTime);
      k.sources.push(o);
    }
  }
}

/** A plucked note. */
function pluck(k: SoundKit, t: number, midi: number, level: number, style: { seconds: number; damp: number; soft: number }, how: Placing): void {
  const { buffer, rate } = pluckOf(k.c, midi, style.seconds, style.damp, style.soft);
  const src = k.c.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  const g = k.gain(level);
  src.connect(g);
  k.place(g, how);
  src.start(t);
}

const HARP = { seconds: 3.5, damp: 0.9985, soft: 0.45 };
const LUTE = { seconds: 2, damp: 0.994, soft: 0.8 };

// ------------------------------------------------------------ what's in each sound

function rainBed(k: SoundKit, heavy: number): void {
  k.noise("white", [hp(1100), lp(8500)], 0.2 * heavy);
  const body = k.noise("pink", [bp(520, 0.5)], 0.5 * heavy);
  k.wobble(body.gain.gain, 0.07, 0.1 * heavy);
  k.wobble(body.gain.gain, 0.19, 0.06 * heavy);
  k.ticks(18, [2500, 7000], [0.02, 0.14], [0.0012, 0.003]);
}

function gusts(k: SoundKit, f: number, q: number, level: number, rateA: number, rateB: number, sweep: number): void {
  const bed = k.noise("white", [bp(f, q)], level);
  k.wobble(bed.filters[0]!.frequency, rateA, sweep);
  k.wobble(bed.filters[0]!.frequency, rateB, sweep * 0.5);
  k.wobble(bed.gain.gain, rateA * 1.3, level * 0.5);
  k.wobble(bed.gain.gain, rateB * 0.7, level * 0.25);
}

/** D dorian, in open fifths: as old as chant gets. */
const CHANT = [
  [50, 57, 62],
  [48, 55, 60],
  [53, 60, 65],
  [50, 57, 62],
  [55, 62, 67],
  [57, 64, 69],
  [53, 60, 65],
  [50, 57, 62],
];

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function chant(k: SoundKit): void {
  // "Ah", as three resonances of the voice.
  const voice = k.gain(1);
  const sung = k.gain(1);
  for (const [f, q, level] of [
    [650, 5, 1],
    [1080, 7, 0.6],
    [2650, 9, 0.22],
  ] as const) {
    voice.connect(k.filter(bp(f, q))).connect(k.gain(level)).connect(sung);
  }
  k.place(sung, { space: "hall", wet: 1, dry: 0.4 });
  let at = 0;
  k.every(
    8,
    11,
    (t) => {
      const chord = CHANT[at++ % CHANT.length]!;
      const end = t + 12;
      const g = k.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 3);
      g.gain.setValueAtTime(0.09, t + 7.5);
      g.gain.linearRampToValueAtTime(0, end);
      g.connect(voice);
      for (const midi of chord) {
        for (const cents of [-7, 6]) {
          const o = k.osc("sawtooth", hz(midi), t);
          o.detune.value = cents;
          o.stop(end + 0.05);
          o.connect(g);
        }
      }
    },
    0.1,
  );
}

const HARP_CHORDS = [
  [50, 57, 62, 65, 69, 74], // D minor
  [48, 55, 60, 64, 67, 72], // C
  [46, 53, 58, 62, 65, 70], // B flat
  [48, 55, 60, 64, 67, 72], // C
  [50, 57, 62, 65, 69, 74], // D minor
  [45, 52, 57, 60, 64, 69], // A minor
  [46, 53, 58, 62, 65, 70], // B flat
  [45, 52, 57, 61, 64, 69], // A major, leading home
];
const HARP_WALK = [0, 2, 3, 4, 5, 4, 3, 2];
const HARP_STEP = 0.42;

function harp(k: SoundKit): void {
  let step = 0;
  k.loop(0.2, (t) => {
    const round = Math.floor(step / HARP_WALK.length);
    const chord = HARP_CHORDS[round % HARP_CHORDS.length]!;
    const place = step % HARP_WALK.length;
    // Every so often it stops for a breath.
    const breath = round % HARP_CHORDS.length === HARP_CHORDS.length - 1 && place >= 5;
    if (!breath && (place === 0 || !k.chance(0.12))) {
      const midi = chord[HARP_WALK[place]!]!;
      pluck(k, t + k.r(0, 0.012), midi, (place === 0 ? 0.42 : 0.3) * k.r(0.85, 1.1), HARP, { pan: (midi - 60) / 40, space: "hall", wet: 0.5 });
      if (place === 4 && k.chance(0.35)) pluck(k, t + 0.2, chord[5]! + 12, 0.14, HARP, { pan: 0.3, space: "hall", wet: 0.7 });
    }
    step++;
    return HARP_STEP;
  });
}

/** Greensleeves (16th-century, and free to play): [note, eighths], then the chords beneath it. */
export const GREENSLEEVES: [number, number][] = [
  [69, 1],
  [72, 2], [74, 1], [76, 1.5], [77, 0.5], [76, 1],
  [74, 2], [71, 1], [67, 1.5], [69, 0.5], [71, 1],
  [72, 2], [69, 1], [69, 1.5], [68, 0.5], [69, 1],
  [71, 2], [68, 1], [64, 2], [69, 1],
  [72, 2], [74, 1], [76, 1.5], [77, 0.5], [76, 1],
  [74, 2], [71, 1], [67, 1.5], [69, 0.5], [71, 1],
  [72, 1.5], [71, 0.5], [69, 1], [68, 1.5], [66, 0.5], [68, 1],
  [69, 3], [69, 3],
  [79, 3], [79, 1.5], [78, 0.5], [76, 1],
  [74, 2], [71, 1], [67, 1.5], [69, 0.5], [71, 1],
  [72, 2], [69, 1], [69, 1.5], [68, 0.5], [69, 1],
  [71, 2], [68, 1], [64, 3],
  [79, 3], [79, 1.5], [78, 0.5], [76, 1],
  [74, 2], [71, 1], [67, 1.5], [69, 0.5], [71, 1],
  [72, 1.5], [71, 0.5], [69, 1], [68, 1.5], [66, 0.5], [68, 1],
  [69, 3], [69, 3],
];
const AM = [45, 57, 60, 64];
const G_MAJOR = [43, 55, 59, 62];
const E_MAJOR = [40, 56, 59, 64];
const C_MAJOR = [48, 55, 60, 64];
/** A chord for each half bar (three eighths), after the first note. */
export const GREENSLEEVES_CHORDS = [
  AM, AM, G_MAJOR, G_MAJOR, AM, AM, E_MAJOR, E_MAJOR, AM, AM, G_MAJOR, G_MAJOR, AM, E_MAJOR, AM, AM,
  C_MAJOR, C_MAJOR, G_MAJOR, G_MAJOR, AM, AM, E_MAJOR, E_MAJOR, C_MAJOR, C_MAJOR, G_MAJOR, G_MAJOR, AM, E_MAJOR, AM, AM,
];
const EIGHTH = 0.36;

function lute(k: SoundKit): void {
  const how = { space: "room" as const, wet: 0.5 };
  type Note = { at: number; midi: number; level: number; pan: number };
  const notes: Note[] = [];
  let at = 0;
  for (const [midi, length] of GREENSLEEVES) {
    notes.push({ at, midi, level: 0.5, pan: 0.15 });
    at += length;
  }
  GREENSLEEVES_CHORDS.forEach((chord, half) => {
    const on = 1 + half * 3;
    notes.push({ at: on, midi: chord[0]!, level: half % 2 ? 0.2 : 0.3, pan: -0.2 });
    chord.slice(1).forEach((midi, i) => notes.push({ at: on + 0.02 + i * 0.05, midi, level: 0.13, pan: -0.1 }));
  });
  notes.sort((a, b) => a.at - b.at);
  // A bar's rest before it comes round again.
  const total = at + 6;
  let i = 0;
  k.loop(0.3, (t) => {
    const note = notes[i]!;
    pluck(k, t + k.r(0, 0.008), note.midi, note.level * k.r(0.9, 1.05), LUTE, { ...how, pan: note.pan });
    i = (i + 1) % notes.length;
    const next = notes[i]!;
    return (i === 0 ? total - note.at + next.at : next.at - note.at) * EIGHTH;
  });
}

// A fast, bouncing little band. The feel is that of old hot swing and novelty bands; the tune is written
// for this, and isn't anyone else's.
const CANTINA_HEAD: [number, number][] = [[81, 0.5], [77, 0.5], [80, 0.5], [76, 0.5], [79, 0.5], [75, 0.5], [78, 0.5], [74, 0.5]];
const CANTINA_LEAP: [number, number][] = [[0, 0.5], [74, 0.5], [77, 0.5], [81, 0.5], [86, 1], [0, 1]];
const CANTINA_TURN: [number, number][] = [[82, 0.5], [81, 0.5], [79, 0.5], [77, 0.5], [76, 0.5], [79, 0.5], [73, 0.5], [76, 0.5]];
const CANTINA_HOME: [number, number][] = [[74, 1], [0, 1], [69, 0.5], [74, 0.5], [0, 1]];
/** [note, beats], 0 for a rest, four beats to a bar. */
export const CANTINA_TUNE: [number, number][][] = [
  CANTINA_HEAD,
  CANTINA_LEAP,
  [[82, 0.5], [79, 0.5], [81, 0.5], [77, 0.5], [79, 0.5], [75, 0.5], [77, 0.5], [74, 0.5]],
  [[73, 0.5], [76, 0.5], [79, 0.5], [82, 0.5], [81, 1], [0, 1]],
  CANTINA_HEAD,
  CANTINA_LEAP,
  CANTINA_TURN,
  CANTINA_HOME,
  [[77, 0.5], [79, 0.5], [81, 0.5], [84, 0.5], [0, 0.5], [81, 0.5], [0, 1]],
  [[76, 0.5], [79, 0.5], [82, 0.5], [86, 0.5], [0, 0.5], [82, 0.5], [0, 1]],
  [[74, 0.5], [77, 0.5], [82, 0.5], [86, 0.5], [84, 0.5], [82, 0.5], [81, 0.5], [79, 0.5]],
  [[81, 1], [73, 0.5], [76, 0.5], [81, 1], [0, 1]],
  CANTINA_HEAD,
  CANTINA_LEAP,
  CANTINA_TURN,
  CANTINA_HOME,
];

interface BandChord {
  /** The bass, bouncing between these on beats one and three. */
  bass: [number, number];
  /** The steel drum, off the beat. */
  stab: number[];
  /** What a solo can pick from. */
  solo: number[];
}
const D_MINOR: BandChord = { bass: [38, 45], stab: [77, 81], solo: [62, 65, 69, 72, 74, 77, 81] };
const G_MINOR: BandChord = { bass: [43, 38], stab: [74, 79], solo: [62, 67, 70, 74, 79, 82] };
const B_FLAT: BandChord = { bass: [46, 41], stab: [74, 77], solo: [62, 65, 70, 74, 77, 82] };
const A_SEVEN: BandChord = { bass: [45, 40], stab: [73, 79], solo: [61, 64, 67, 69, 73, 76, 79] };
const F_MAJOR: BandChord = { bass: [41, 48], stab: [72, 77], solo: [60, 65, 69, 72, 77, 81] };
const C_SEVEN: BandChord = { bass: [36, 43], stab: [70, 76], solo: [60, 64, 67, 70, 72, 76, 79] };
export const CANTINA_CHORDS: BandChord[] = [
  D_MINOR, D_MINOR, G_MINOR, A_SEVEN, D_MINOR, D_MINOR, A_SEVEN, D_MINOR,
  F_MAJOR, C_SEVEN, B_FLAT, A_SEVEN, D_MINOR, D_MINOR, A_SEVEN, D_MINOR,
];
const CANTINA_BEAT = 60 / 216;
const SWING = 0.6;
const BAND_BASS = { seconds: 0.7, damp: 0.99, soft: 0.35 };

/** Where a beat falls with a swing: the second eighth of each pair comes a little late. */
export function swung(beat: number): number {
  const whole = Math.floor(beat);
  const part = beat - whole;
  return whole + (part < 0.5 ? (part * SWING) / 0.5 : SWING + ((part - 0.5) * (1 - SWING)) / 0.5);
}

/** A steel drum's note: its octave nearly as strong as the note, a clang dying fast. Made once for each. */
function panOf(c: BaseAudioContext, midi: number): Pluck {
  const plucks = sharedOf(c).plucks;
  const key = `pan ${midi}`;
  const found = plucks.get(key);
  if (found) return found;
  const sr = c.sampleRate;
  const len = Math.round(sr * 0.7);
  const buffer = c.createBuffer(1, len, sr);
  const d = buffer.getChannelData(0);
  const w = (2 * Math.PI * hz(midi)) / sr;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const tone =
      Math.exp(-t * 4) * Math.sin(w * i) + 0.75 * Math.exp(-t * 6) * Math.sin(2 * w * i) + 0.3 * Math.exp(-t * 11) * Math.sin(3 * w * i) + 0.12 * Math.exp(-t * 20) * Math.sin(4.02 * w * i);
    d[i] = 0.5 * tone * Math.min(1, t / 0.002) * Math.min(1, (len - i) / (sr * 0.03));
  }
  const made = { buffer, rate: 1 };
  plucks.set(key, made);
  return made;
}

function cantinaBand(k: SoundKit): void {
  const band = k.gain(1);
  k.place(band, { space: "room", wet: 0.35 });
  // A square wave's odd harmonics, a little bright: as near as one voice gets to a hot clarinet.
  const reed = k.filter(lp(3000, 0.9));
  reed.connect(band);
  const brush = k.filter(hp(5000));
  brush.connect(band);
  const snap = k.filter(bp(1800, 1.2));
  snap.connect(band);
  const play = (t: number, { buffer, rate }: Pluck, level: number) => {
    const src = k.c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.connect(k.gain(level)).connect(band);
    src.start(t);
  };
  // Short and punchy, each note gone before the next: that's most of the bounce.
  const blown = (t: number, seconds: number, midi: number) => {
    const held = seconds * 0.62;
    const level = 0.085 * k.r(0.85, 1.05);
    const g = k.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.012);
    g.gain.setValueAtTime(level, t + held * 0.75);
    g.gain.linearRampToValueAtTime(0, t + held);
    g.connect(reed);
    const top = k.osc("square", hz(midi), t);
    top.detune.value = k.r(-4, 4);
    top.stop(t + held + 0.02);
    top.connect(g);
    // A reedy voice underneath, an octave down, to give it some edge.
    const under = k.osc("sawtooth", hz(midi - 12), t);
    under.detune.value = k.r(-4, 4);
    under.stop(t + held + 0.02);
    under.connect(k.gain(0.35)).connect(g);
  };
  let walk = 3;
  /** A bar of solo: eighths wandering through the chord, with room to breathe. */
  const soloBar = (chord: BandChord): [number, number][] => {
    const line: [number, number][] = [];
    for (let i = 0; i < 8; i++) {
      walk = Math.max(0, Math.min(chord.solo.length - 1, walk + k.pick([-2, -1, 1, 2])));
      line.push([k.chance(0.2) ? 0 : chord.solo[walk]!, 0.5]);
    }
    return line;
  };
  let bar = 0;
  k.loop(0.2, (t) => {
    const place = bar % CANTINA_TUNE.length;
    const chord = CANTINA_CHORDS[place]!;
    // The tune, then solos on it: the reed for eight bars, the steel drum for eight.
    const soloing = Math.floor(bar / CANTINA_TUNE.length) % 2 === 1;
    const steel = soloing && place >= 8;
    const at = (beat: number) => t + swung(beat) * CANTINA_BEAT;
    play(at(0), pluckOf(k.c, chord.bass[0], BAND_BASS.seconds, BAND_BASS.damp, BAND_BASS.soft), 0.42);
    play(at(2), pluckOf(k.c, chord.bass[1], BAND_BASS.seconds, BAND_BASS.damp, BAND_BASS.soft), 0.36);
    for (const beat of [1, 3]) {
      for (const midi of chord.stab) play(at(beat), panOf(k.c, midi), 0.13);
      const rim = k.shot("white", at(beat), 0.08);
      rim.connect(k.struck(at(beat), 0.1, 0.001, 0.04)).connect(snap);
    }
    for (let eighth = 0; eighth < 8; eighth++) {
      const on = at(eighth / 2);
      const stroke = k.shot("white", on, 0.05);
      stroke.connect(k.struck(on, eighth % 2 ? 0.02 : 0.035, 0.001, 0.028)).connect(brush);
    }
    let beat = 0;
    for (const [midi, length] of soloing ? soloBar(chord) : CANTINA_TUNE[place]!) {
      if (midi) {
        if (steel) play(at(beat), panOf(k.c, midi + 12), 0.3);
        else blown(at(beat), at(beat + length) - at(beat), midi);
      }
      beat += length;
    }
    bar++;
    return CANTINA_BEAT * 4;
  });
}

/**
 * A slow chant written for this, in D with a flattened second: [note, beats], 0 for a rest, four beats to
 * a bar, and two bars at the end for the strings and the bell alone.
 */
export const THRONE_TUNE: [number, number][][] = [
  [[50, 2], [50, 1], [51, 1]],
  [[50, 3], [0, 1]],
  [[51, 2], [53, 1], [51, 1]],
  [[50, 3], [0, 1]],
  [[53, 2], [54, 1], [53, 1]],
  [[51, 2], [49, 1], [51, 1]],
  [[50, 1], [53, 1], [57, 2]],
  [[55, 1], [53, 1], [51, 1], [50, 1]],
  [[0, 4]],
  [[0, 4]],
];
const THRONE_D = [38, 45, 50];
const THRONE_E_FLAT = [39, 46, 51];
const THRONE_B_FLAT_MINOR = [41, 46, 49];
export const THRONE_CHORDS = [THRONE_D, THRONE_D, THRONE_E_FLAT, THRONE_D, THRONE_B_FLAT_MINOR, THRONE_E_FLAT, THRONE_D, THRONE_D, THRONE_D, THRONE_D];
const THRONE_BEAT = 1;

function darkThrone(k: SoundKit): void {
  k.noise("pink", [lp(500)], 0.04);
  // Men's voices on "oh", as three resonances of the voice.
  const voices = k.gain(1);
  const sung = k.gain(1);
  for (const [f, q, level] of [
    [430, 5, 1],
    [800, 7, 0.55],
    [2500, 9, 0.12],
  ] as const) {
    voices.connect(k.filter(bp(f, q))).connect(k.gain(level)).connect(sung);
  }
  k.place(sung, { space: "hall", wet: 1, dry: 0.5 });
  const strings = k.filter(lp(650, 0.8));
  k.place(strings, { space: "hall", wet: 0.6 });

  /** Saws together, swelling and fading as one: a section of a choir, or of strings. */
  const section = (t: number, end: number, notes: [number, number][], level: number, attack: number, release: number, into: AudioNode) => {
    const g = k.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setValueAtTime(level, Math.max(t + attack, end - release));
    g.gain.linearRampToValueAtTime(0, end);
    g.connect(into);
    for (const [midi, cents] of notes) {
      const f = hz(midi);
      const o = k.osc("sawtooth", f * 0.985, t);
      o.frequency.exponentialRampToValueAtTime(f, t + Math.min(0.2, attack));
      o.detune.value = cents;
      o.stop(end + 0.05);
      o.connect(g);
    }
  };

  let bar = 0;
  k.loop(0.1, (t) => {
    const place = bar % THRONE_TUNE.length;
    const chord = THRONE_CHORDS[place]!;
    const barLength = THRONE_BEAT * 4;
    // The chord, overlapping the next as it fades.
    section(t, t + barLength + 1.5, chord.flatMap((midi) => [[midi, -7], [midi, 6]] as [number, number][]), 0.05, 1.2, 1.5, voices);
    section(t, t + barLength + 1, [[chord[0]! , -4], [chord[0]! + 12, 5]], 0.09, 0.9, 1, strings);
    // The chant over it: three voices together, and one an octave down.
    let beat = 0;
    for (const [midi, beats] of THRONE_TUNE[place]!) {
      if (midi) {
        const on = t + beat * THRONE_BEAT;
        section(on, on + beats * THRONE_BEAT + 0.3, [[midi, -8], [midi, 1], [midi, 9], [midi - 12, 3]], 0.085, 0.25, 0.35, voices);
      }
      beat += beats;
    }
    if (place === 0 || place === 4) boom(k, t, 0.22, "hall");
    if (place === 2 || place === 6) boom(k, t, 0.12, "hall");
    if (place === 8) metal(k, t, 98, BELL, 7, 0.09, { pan: -0.2, space: "hall", wet: 1, dry: 0.5 });
    bar++;
    return barLength;
  });
}

// ------------------------------------------------------------ plainchant

/**
 * Real plainchant, long out of anyone's copyright: the melodies are medieval. Written as chant is written
 * down (gabc, with the C clef on the top line): a syllable, its notes in brackets, one letter for each
 * place on the stave, a capital only being a differently drawn note. A dot holds a note, "ix" marks a flat.
 * One string for each breath, one list for each verse, which the two sides of the choir take in turn.
 * From the Graduale Romanum and the Liber Usualis, as transcribed on GregoBase.
 */
export const DIES_IRAE: string[][] = [
  ["Di(f)es(e) i(f)rae,(d) di(e)es(c) il(d)la,(d.)", "Sol(f)vet(fg) sae(fe)clum(dc) in(e) fa(f)víl(e)la:(d.)", "Te(a)ste(cd) Da(d)vid(dc) cum(e) Si(f)býl(e)la.(d.)"],
  ["Quan(f)tus(e) tre(f)mor(d) est(e) fu(c)tú(d)rus,(d.)", "Quan(f)do(fg) ju(fe)dex(dc) est(e) ven(f)tú(e)rus,(d.)", "Cun(a)cta(cd) stri(d)cte(dc) dis(e)cus(f)sú(e)rus!(d.)"],
  ["Tu(h)ba(j) mi(j)rum(igh) spar(hvGF)gens(g) so(h)num(hd..)", "Per(f) se(e)púl(f)cra(d) re(e)gi(c)ó(d)num,(d.)", "Co(f)get(gh) o(hvGF)mnes(evDC) an(e)te(f) thro(e)num.(d.)"],
  ["Mors(h) stu(j)pé(j)bit(igh) et(hvGF) na(g)tú(h)ra,(hd..)", "Cum(f) re(e)súr(f)get(d) cre(e)a(c)tú(d)ra,(d.)", "Ju(f)di(gh)cán(hvGF)ti(evDC) re(e)spon(f)sú(e)ra.(d.)"],
  ["Li(h)ber(gf) scri(g)ptus(h_d) pro(dc)fe(a)ré(cd)tur,(d.)", "In(fe) quo(d) to(c)tum(a) con(c)ti(d)né(f)tur,(ecd.)", "Un(h)de(f) mun(g)dus(d) ju(c)di(d)cé(f)tur.(ecd.)"],
  ["Ju(h)dex(gf) er(g)go(h_d) cum(dc) se(a)dé(cd)bit,(d.)", "Quid(fe)quid(d) la(c)tet(a) ap(c)pa(d)ré(f)bit:(ecd.)", "Nil(h) in(f)úl(g)tum(d) re(c)ma(d)né(f)bit.(ecd.)"],
];
const ELEISON = "e(hvGFEf)lé(g)i(f)son.(f)";
const KYRIE_VERSE = ["Ky(ixfg!hi)ri(h)e(hg)", ELEISON];
const CHRISTE_VERSE = ["Chris(ixfg!hi)te(hg)", ELEISON];
/** From the Mass for the Dead, in the Cistercians' book. */
export const KYRIE: string[][] = [KYRIE_VERSE, KYRIE_VERSE, KYRIE_VERSE, CHRISTE_VERSE, CHRISTE_VERSE, CHRISTE_VERSE, KYRIE_VERSE, KYRIE_VERSE, ["Ky(j)ri(f)e(fixji!jkJIHG)", ELEISON]];
/** The opening of the same Mass. */
export const REQUIEM: string[][] = [
  ["Ré(ffg)qui(f)em(f) ae(fg'h)tér(hggfg)nam(gf..)", "do(fg'h)na(hg) e(h)is(ixhjHG'hw!ivHG') Dó(f)mi(fg!hvGF'g)ne:(gf..)"],
  ["et(hg~) lux(hvGF') per(h)pé(gh)tu(gf)a(f.)", "lú(hg)ce(h)at(ixhjHG'hw!ivHG) e(fg!hvGF'g)is.(gf..)"],
];

export interface ChantNote {
  midi: number;
  beats: number;
}
export interface ChantSyllable {
  text: string;
  notes: ChantNote[];
}

/** Where each letter sits with the C clef on the top line: d is the D below middle C, the home of the Dies Irae. */
const STAVE = "abcdefghijklm";
const STAVE_MIDI = [45, 47, 48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65];
const B_FLAT_MIDI = 58;

/** One breath of chant, read. The last note of a breath is always held; a flat lasts to the end of it. */
export function readChant(line: string): ChantSyllable[] {
  const syllables: ChantSyllable[] = [];
  let flat = false;
  for (const [, text, marks] of line.matchAll(/([^\s()]*)\(([^)]*)\)/g)) {
    const notes: ChantNote[] = [];
    let dots = 0;
    for (let p = 0; p < marks!.length; p++) {
      const mark = marks![p]!;
      if (marks![p + 1] === "x") {
        flat ||= mark === "i";
        p++;
      } else if (mark === ".") {
        const held = notes[notes.length - 1 - dots++];
        if (held) held.beats = 2;
      } else if (mark === "_") {
        notes[notes.length - 1]!.beats = 1.4;
      } else {
        const place = STAVE.indexOf(mark.toLowerCase());
        if (place < 0) continue;
        dots = 0;
        notes.push({ midi: mark.toLowerCase() === "i" && flat ? B_FLAT_MIDI : STAVE_MIDI[place]!, beats: 1 });
      }
    }
    syllables.push({ text: text!, notes });
  }
  const last = syllables[syllables.length - 1]?.notes.at(-1);
  if (last) last.beats = Math.max(last.beats, 2);
  return syllables;
}

type Vowel = "a" | "e" | "i" | "o" | "u";

/** What a syllable is sung on, and what comes before it. Latin says "ae" as "e", and y as i, and the u after q isn't sung. */
export function soundsOf(text: string): { vowel: Vowel; onset: string } {
  const plain = text.normalize("NFD").replace(/[^a-zA-Z]/g, "").toLowerCase().replace(/qu/g, "q").replace(/ae/g, "e").replace(/y/g, "i");
  const at = plain.search(/[aeiou]/);
  if (at < 0) return { vowel: "a", onset: plain };
  return { vowel: plain[at] as Vowel, onset: plain.slice(0, at) };
}

/**
 * The resonances of a low male voice on each vowel: [pitch, level]. The sound under them falls away with
 * pitch, so the higher ones are lifted to make up some of that (see VOICE_LIFT).
 */
const VOWEL_SHAPES: Record<Vowel, [number, number][]> = {
  a: [[600, 1], [1040, 0.45], [2250, 0.35], [2450, 0.35], [2750, 0.1]],
  e: [[400, 1], [1620, 0.25], [2400, 0.35], [2800, 0.25], [3100, 0.13]],
  i: [[260, 1], [1750, 0.12], [2600, 0.16], [3050, 0.08], [3340, 0.04]],
  o: [[400, 1], [750, 0.28], [2400, 0.09], [2600, 0.1], [2900, 0.01]],
  u: [[350, 1], [600, 0.1], [2400, 0.03], [2675, 0.04], [2950, 0.02]],
};
const VOICE_WIDTHS = [90, 100, 120, 120, 130];
const VOICE_LIFT = 0.7;
const CHOIR_VOICES = 8;
const CHANT_BEAT = 0.46;

interface Choir {
  voices: GainNode;
  shape: GainNode;
  parts: { filter: BiquadFilterNode; level: GainNode }[];
  hiss: AudioNode;
  burst: AudioNode;
}

/** One side of the choir: everything it sings goes through the shape of a vowel, and the swell of the line. */
function choirOf(k: SoundKit, pan: number): Choir {
  const voices = k.gain(1);
  const shape = k.gain(0);
  const parts = VOICE_WIDTHS.map(() => {
    const filter = k.filter(bp(500, 5));
    const level = k.gain(0);
    voices.connect(filter).connect(level).connect(shape);
    return { filter, level };
  });
  // Well back in the church, but with the tune still plain through the ring of it.
  k.place(shape, { pan, space: "church", wet: 0.7, dry: 0.7 });
  const edges = k.gain(1);
  k.place(edges, { pan, space: "church", wet: 0.8, dry: 0.5 });
  const hiss = k.filter(hp(4200));
  hiss.connect(edges);
  const burst = k.filter(bp(2200, 1.2));
  burst.connect(edges);
  return { voices, shape, parts, hiss, burst };
}

/** Sings one breath from this moment, and says how long it takes. */
function singBreath(k: SoundKit, choir: Choir, line: string, start: number): number {
  const syllables = readChant(line);
  const sung: { at: number; midi: number }[] = [];
  const { gain } = choir.shape;
  gain.setValueAtTime(0.0001, start);
  let at = start;
  syllables.forEach((syllable, i) => {
    const { vowel, onset } = soundsOf(syllable.text);
    VOWEL_SHAPES[vowel].forEach(([f, level], part) => {
      const { filter, level: g } = choir.parts[part]!;
      const glide = i === 0 ? 0.001 : 0.03;
      filter.frequency.setTargetAtTime(f, at - 0.02, glide);
      filter.Q.setTargetAtTime(f / VOICE_WIDTHS[part]!, at - 0.02, glide);
      g.gain.setTargetAtTime(level * (f / 400) ** VOICE_LIFT, at - 0.02, glide);
    });
    // The voice lifts a little at the top of the line, as it would.
    const swell = 0.85 + (syllable.notes[0]!.midi - 48) * 0.022;
    // A consonant: the sound closing for a moment, and a hiss or a small burst of breath.
    const sibilant = /[sfxz]/.test(onset);
    const stopped = /[tdpbcgkq]/.test(onset);
    if (i > 0) gain.setTargetAtTime(swell * (sibilant || stopped ? 0.2 : onset ? 0.5 : 0.75), at - 0.04, 0.012);
    gain.setTargetAtTime(swell, at + 0.012, i === 0 ? 0.05 : 0.028);
    if (sibilant) k.shot("white", at - 0.05, 0.1).connect(k.struck(at - 0.05, 0.05, 0.015, 0.06)).connect(choir.hiss);
    else if (stopped) k.shot("white", at, 0.03).connect(k.struck(at, 0.04, 0.001, 0.018)).connect(choir.burst);
    for (const note of syllable.notes) {
      sung.push({ at, midi: note.midi });
      at += note.beats * CHANT_BEAT * k.r(0.97, 1.03);
    }
  });
  gain.setTargetAtTime(0.0001, at - 0.12, 0.09);
  const end = at + 0.35;
  // Everyone on the same note, none of them quite together: that's what makes it a choir.
  for (let v = 0; v < CHOIR_VOICES; v++) {
    const base = k.r(-12, 12);
    const late = k.r(0, 0.03);
    // Starting a moment apart, or they would all crack out in step at the top of each line.
    const o = k.osc("sawtooth", hz(sung[0]!.midi), start + k.r(0, 0.012));
    o.detune.setValueAtTime(base, start);
    for (const { at: on, midi } of sung.slice(1)) {
      o.frequency.setTargetAtTime(hz(midi), on - 0.025 + late, 0.035);
      o.detune.setTargetAtTime(base + k.r(-5, 5), on, 0.2);
    }
    o.stop(end);
    o.connect(k.gain(0.05)).connect(choir.voices);
  }
  // And the air in their voices.
  k.shot("pink", start, end - start).connect(k.gain(0.05)).connect(choir.voices);
  return at - start;
}

function plainchant(k: SoundKit): void {
  k.noise("pink", [lp(800)], 0.03);
  const sides = [choirOf(k, -0.35), choirOf(k, 0.35)];
  const pieces = [DIES_IRAE, REQUIEM, KYRIE];
  let piece = 0;
  let verse = 0;
  let breath = 0;
  let side = 0;
  k.loop(0.3, (t) => {
    const verses = pieces[piece]!;
    const seconds = singBreath(k, sides[side]!, verses[verse]![breath]!, t);
    if (++breath < verses[verse]!.length) return seconds + 0.6;
    breath = 0;
    side = 1 - side;
    if (++verse < verses.length) return seconds + 1.5;
    // The end of a chant, then quiet, and a bell before the next.
    verse = 0;
    piece = (piece + 1) % pieces.length;
    const wait = k.r(11, 15);
    metal(k, t + seconds + wait - 5, 147, BELL, 7, 0.07, { pan: -0.3, space: "church", wet: 1, dry: 0.4 });
    return seconds + wait;
  });
}

// ------------------------------------------------------------ the big brass

/**
 * Low brass written for this, lower than brass goes: a root, its fifth and the octave, with no third and
 * nothing above, the way a trailer's braam is, so it's dark rather than sad. They only ever fall.
 */
const BWAH_C = [24, 31, 36];
const BWAH_A_FLAT = [20, 27, 32];
const BWAH_F = [17, 24, 29];
export const BWAH_PHRASES: { chords: number[][]; then: number }[] = [
  { chords: [BWAH_C], then: 24 },
  { chords: [BWAH_C, BWAH_A_FLAT], then: 28 },
  { chords: [BWAH_C], then: 22 },
  { chords: [BWAH_C, BWAH_A_FLAT, BWAH_F], then: 30 },
];
/** How far a hit sags as it runs out of breath, the foghorn's fall: two semitones. */
export const BWAH_FALL = 2 ** (-2 / 12);
/** How long the sub under a hit takes to dive the octave onto its lowest note. */
const BWAH_SUB_DROP = 0.6;

/** The build into a hit. Long enough too that the first arrives once a newly added sound has faded in. */
export const BWAH_BUILD = 1.6;
/** Nothing at all, just before it. */
export const BWAH_SILENCE = 0.16;
const BWAH_HIT = 3.6;
const BWAH_LAST = 5;
const BWAH_GAP = 4.6;
const BWAH_CLOCK = 0.125;

export interface BwahEvent {
  at: number;
  what: "build" | "hit" | "back" | "tick" | "tock" | "pulse";
  chord?: number[];
  seconds?: number;
}

/**
 * The same every time, with no chance in it: everyone who started together hears each hit together.
 * After the hits the clock starts up, quickening, with low strings pushing under it from a third of the
 * way through, and all of it gets louder until it cuts dead for the next.
 */
export function bwahScore(): { events: BwahEvent[]; seconds: number } {
  const events: BwahEvent[] = [];
  let at = 0;
  for (const { chords, then } of BWAH_PHRASES) {
    events.push({ at, what: "build" });
    let hit = at + BWAH_BUILD;
    chords.forEach((chord, i) => {
      if (i) hit += BWAH_GAP;
      events.push({ at: hit, what: "hit", chord, seconds: i === chords.length - 1 ? BWAH_LAST : BWAH_HIT });
    });
    const back = hit + BWAH_LAST - 1;
    const cut = back + then + BWAH_BUILD - BWAH_SILENCE;
    events.push({ at: back, what: "back", seconds: cut - back });
    let beats = 0;
    for (let n = 0; back + n * BWAH_CLOCK < cut - 0.05; n++) {
      const t = back + n * BWAH_CLOCK;
      const through = (t - back) / (cut - back);
      if (n % (through < 0.45 ? 4 : through < 0.9 ? 2 : 1) === 0) events.push({ at: t, what: beats++ % 2 ? "tock" : "tick" });
      if (through > 0.35 && n % 4 === 0) events.push({ at: t, what: "pulse" });
    }
    at = back + then;
  }
  // The last clock runs on into the first build, as the piece comes round.
  const seconds = at;
  return { events: events.map((e) => ({ ...e, at: e.at % seconds })).sort((a, b) => a.at - b.at), seconds };
}

const SHEPARD_VOICES = 6;
const SHEPARD_OCTAVE_SECONDS = 12;
const SHEPARD_STEP = 1.5;

/**
 * One of the tones of a rise that never gets anywhere: each climbs six octaves, coming in from nothing at
 * the bottom and going to nothing at the top, while others take its place. What's heard is forever going up.
 */
export function shepardVoice(phase: number): { hz: number; level: number } {
  return { hz: 55 * 2 ** (phase * SHEPARD_VOICES), level: Math.sin(Math.PI * phase) ** 2 };
}

function endlessRise(k: SoundKit, level: number, into: AudioNode): void {
  const tone = k.gain(level);
  tone.connect(into);
  const voices = Array.from({ length: SHEPARD_VOICES }, (_, i) => {
    const o = k.c.createOscillator();
    o.type = "triangle";
    const g = k.gain(0);
    o.connect(g).connect(tone);
    o.start(k.c.currentTime);
    k.sources.push(o);
    return { o, g, phase: i / SHEPARD_VOICES };
  });
  k.loop(0, (t) => {
    for (const v of voices) {
      const from = shepardVoice(v.phase);
      v.phase = (v.phase + SHEPARD_STEP / (SHEPARD_VOICES * SHEPARD_OCTAVE_SECONDS)) % 1;
      const to = shepardVoice(v.phase);
      v.o.frequency.setValueAtTime(from.hz, t);
      v.g.gain.setValueAtTime(from.level, t);
      // Off the top it's silent, and starts again at the bottom next time.
      if (to.hz > from.hz) {
        v.o.frequency.exponentialRampToValueAtTime(to.hz, t + SHEPARD_STEP);
        v.g.gain.linearRampToValueAtTime(to.level, t + SHEPARD_STEP);
      }
    }
    return SHEPARD_STEP;
  });
}

/** The air drawn in before a hit, rising until it stops dead. */
function suckBack(k: SoundKit, t: number): void {
  const rising = BWAH_BUILD - BWAH_SILENCE;
  const src = k.shot("pink", t, BWAH_BUILD);
  const tone = k.filter(lp(250, 1.5));
  tone.frequency.setValueAtTime(250, t);
  tone.frequency.exponentialRampToValueAtTime(5000, t + rising);
  const g = k.gain(0.01);
  g.gain.setValueAtTime(0.01, t);
  g.gain.exponentialRampToValueAtTime(1.6, t + rising);
  g.gain.linearRampToValueAtTime(0, t + rising + 0.02);
  src.connect(tone).connect(g);
  k.place(g);
}

/** What overdriving does to brass, making it snarl: the curve it's bent through. */
const RASP = Float32Array.from({ length: 1025 }, (_, i) => Math.tanh(2.2 * (i / 512 - 1)));

/**
 * The hit: a low brass section, closed at first and bursting open, the "b" and then the "wah". Two sections,
 * left and right, a little apart in tuning, played hard enough to rasp and flutter, with horns among them, the
 * floor shaking below, and a very big room around it.
 */
function bwah(k: SoundKit, t: number, chord: number[], seconds: number): void {
  const end = t + seconds;
  const note = (type: OscillatorType, midi: number, cents: number, into: AudioNode) => {
    const f = hz(midi);
    const o = k.osc(type, f * 0.96, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.16);
    // Sagging as it runs out of breath.
    o.frequency.setValueAtTime(f, end - 1.4);
    o.frequency.exponentialRampToValueAtTime(f * BWAH_FALL, end);
    o.detune.value = cents;
    o.stop(end + 0.05);
    o.connect(into);
  };
  for (const [pan, flutter, spread] of [
    [-0.4, 27, [-11, 4]],
    [0.4, 31, [-4, 12]],
  ] as const) {
    const mouth = k.filter(lp(60, 1.6));
    mouth.frequency.setValueAtTime(60, t);
    mouth.frequency.exponentialRampToValueAtTime(700, t + 0.25);
    mouth.frequency.exponentialRampToValueAtTime(220, end);
    for (const midi of chord) for (const cents of spread) note("sawtooth", midi, cents, mouth);
    const rasp = k.c.createWaveShaper();
    rasp.curve = RASP;
    const growl = k.gain(1);
    const shake = k.osc("sine", flutter, t);
    shake.stop(end + 0.05);
    shake.connect(k.gain(0.2)).connect(growl.gain);
    const g = k.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.42, t + 0.04);
    g.gain.setValueAtTime(0.42, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.24, t + seconds * 0.6);
    g.gain.linearRampToValueAtTime(0, end);
    mouth.connect(k.gain(0.35)).connect(rasp);
    rasp.connect(k.filter(lp(1800))).connect(growl);
    // Where brass this low bites, and what small speakers can play of it.
    rasp.connect(k.filter(bp(420, 0.9))).connect(k.gain(1.3)).connect(growl);
    growl.connect(g);
    k.place(g, { pan, space: "church", wet: 0.55 });
  }
  // Horns low down too, with the section rather than over it.
  const horns = k.filter(lp(900, 0.9));
  for (const [midi, cents] of [
    [chord[0]! + 12, -6],
    [chord[0]! + 12, 7],
    [chord[1]! + 12, -4],
    [chord[1]! + 12, 5],
  ] as const) {
    note("sawtooth", midi, cents, horns);
  }
  const swell = k.gain(0);
  swell.gain.setValueAtTime(0, t);
  swell.gain.linearRampToValueAtTime(0.16, t + 0.18);
  swell.gain.setValueAtTime(0.16, end - 1.2);
  swell.gain.linearRampToValueAtTime(0, end);
  horns.connect(swell);
  k.place(swell, { space: "church", wet: 0.9, dry: 0.6 });
  // The floor shaking: a pure tone diving from an octave above the lowest note down onto it, as a
  // trailer's sub drop does, then falling with the rest.
  const low = hz(chord[0]!);
  const floor = k.gain(0);
  floor.gain.setValueAtTime(0, t);
  floor.gain.linearRampToValueAtTime(0.22, t + 0.06);
  floor.gain.linearRampToValueAtTime(0.14, t + seconds * 0.6);
  floor.gain.linearRampToValueAtTime(0, end);
  const sub = k.osc("sine", low * 2, t);
  sub.frequency.exponentialRampToValueAtTime(low, t + BWAH_SUB_DROP);
  sub.frequency.setValueAtTime(low, end - 1.4);
  sub.frequency.exponentialRampToValueAtTime(low * BWAH_FALL, end);
  sub.stop(end + 0.05);
  sub.connect(floor);
  k.place(floor);
  boom(k, t, 0.18, "church");
  // Breath, hitting the mouthpieces.
  k.through(k.shot("white", t, 0.16), [bp(1300, 0.7)]).end.connect(k.struck(t, 0.2, 0.004, 0.14)).connect(k.out);
}

/** A low string section digging in, one short note. */
function stringPulse(k: SoundKit, t: number, midi: number, level: number, into: AudioNode): void {
  const tone = k.filter(lp(900, 0.8));
  for (const [m, cents] of [
    [midi, -7],
    [midi, 6],
    [midi + 12, -3],
  ] as const) {
    const o = k.osc("sawtooth", hz(m), t);
    o.detune.value = cents;
    o.stop(t + 0.35);
    o.connect(tone);
  }
  tone.connect(k.struck(t, level, 0.012, 0.28)).connect(into);
}

/** A watch: a click, with no body to it. */
function clockTick(k: SoundKit, t: number, f: number, level: number, into: AudioNode): void {
  k.through(k.shot("white", t, 0.02), [bp(f, 5)]).end.connect(k.struck(t, level, 0.001, 0.018)).connect(into);
}

function bigBrass(k: SoundKit): void {
  const { events, seconds } = bwahScore();
  const bed = k.gain(0);
  // Dry, so that it can stop dead: a room around it would ring on through the silence.
  k.place(bed);
  drone(k, [hz(24), hz(36), hz(43)], 240, 0.06, "church", bed);
  endlessRise(k, 0.18, bed);
  let i = 0;
  k.loop(0.05, (t) => {
    const e = events[i]!;
    if (e.what === "build") {
      suckBack(k, t);
      bed.gain.setTargetAtTime(0, t + BWAH_BUILD - BWAH_SILENCE, 0.015);
    } else if (e.what === "hit") {
      bwah(k, t, e.chord!, e.seconds!);
    } else if (e.what === "back") {
      bed.gain.setValueAtTime(0.0001, t);
      bed.gain.linearRampToValueAtTime(0.45, t + 3);
      // A hair before the cut: if rounding put this after it, the bed would stay up through the silence.
      bed.gain.linearRampToValueAtTime(1, t + e.seconds! - 0.02);
    } else if (e.what === "pulse") {
      stringPulse(k, t, 36, 0.3, bed);
    } else {
      clockTick(k, t, e.what === "tick" ? 3400 : 2700, 2.5, bed);
    }
    i = (i + 1) % events.length;
    return (i ? events[i]!.at : seconds) - e.at;
  });
}

const BATTLE_BIG = [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0];
const BATTLE_TOM = [0, 0, 0.6, 0, 0.5, 0, 0, 0.6, 0, 0, 0.6, 0, 0.7, 0.5, 0.8, 0.6];
const BATTLE_STEP = 60 / 76 / 2;

function warDrums(k: SoundKit): void {
  const roar = k.noise("pink", [bp(650, 1.2)], 0.6);
  k.wobble(roar.gain.gain, 0.09, 0.22);
  k.wobble(roar.gain.gain, 0.23, 0.12);
  k.noise("pink", [bp(1150, 2)], 0.25);
  let step = 0;
  k.loop(0.1, (t) => {
    const big = BATTLE_BIG[step % 16]!;
    const tom = BATTLE_TOM[step % 16]!;
    if (big) drum(k, t, 52, 0.5);
    if (tom) drum(k, t, 82, 0.34 * tom, k.chance(0.5) ? -0.35 : 0.35);
    step++;
    return BATTLE_STEP;
  });
  k.every(0.8, 2.6, (t) => {
    const how = { pan: k.r(-0.9, 0.9), space: "hall" as const, wet: 1, dry: 0.3 };
    metal(k, t, k.r(2600, 4200), BLADE, k.r(0.18, 0.35), k.r(0.02, 0.06), how);
    if (k.chance(0.4)) metal(k, t + k.r(0.14, 0.3), k.r(2600, 4200), BLADE, k.r(0.15, 0.3), k.r(0.015, 0.04), how);
  });
  k.every(24, 55, (t) => warHorn(k, t), k.r(4, 10));
}

interface Recipe {
  make(k: SoundKit): void;
}

/** Keyed by shared/sounds.ts's ids. */
export const SOUND_RECIPES: Record<string, Recipe> = {
  tavern: {
    make(k) {
      const hum = k.noise("pink", [bp(650, 0.8)], 0.09, { space: "room", wet: 0.3 });
      k.wobble(hum.gain.gain, 3.3, 0.02);
      k.wobble(hum.gain.gain, 5.1, 0.012);
      k.noise("brown", [lp(300)], 0.14);
      const crowd = crowdBus(k, 2300, "room", 0.5);
      k.every(0.12, 0.38, (t) => talk(k, t, crowd));
      k.every(1.2, 4.5, (t) => clink(k, t, k.r(0.02, 0.06)));
      k.ticks(3, [1800, 5000], [0.015, 0.08], [0.0015, 0.004]);
      k.every(3, 9, (t) => knock(k, t, k.r(0.05, 0.11), { pan: k.r(-0.7, 0.7), space: "room", wet: 0.5 }));
      k.every(8, 20, (t) => creak(k, t, k.r(0.02, 0.05), { pan: k.r(-0.8, 0.8), space: "room", wet: 0.4 }));
    },
  },
  cantina: {
    make(k) {
      cantinaBand(k);
      const hum = k.noise("pink", [bp(650, 0.8)], 0.22, { space: "room", wet: 0.3 });
      k.wobble(hum.gain.gain, 3.3, 0.05);
      k.wobble(hum.gain.gain, 5.1, 0.03);
      const crowd = crowdBus(k, 2300, "room", 0.5, 2.6);
      k.every(0.14, 0.42, (t) => talk(k, t, crowd));
      k.every(0.8, 3, (t) => clink(k, t, k.r(0.05, 0.13)));
      k.every(4, 11, (t) => knock(k, t, k.r(0.05, 0.1), { pan: k.r(-0.7, 0.7), space: "room", wet: 0.5 }));
    },
  },
  town: {
    make(k) {
      gusts(k, 600, 1, 0.02, 0.07, 0.17, 150);
      k.noise("pink", [bp(800, 0.7)], 0.06);
      const crowd = crowdBus(k, 2000, "hall", 0.25);
      k.every(0.25, 0.7, (t) => talk(k, t, crowd));
      k.every(14, 32, (t) => horse(k, t), k.r(2, 8));
      k.every(9, 22, (t) => anvil(k, t), k.r(1, 6));
      k.every(45, 90, (t) => {
        for (let i = 0; i < 3; i++) metal(k, t + i * 1.6, 330, BELL, 4, 0.025, { pan: 0.5, space: "hall", wet: 1, dry: 0.5 });
      }, k.r(10, 30));
    },
  },
  temple: {
    make(k) {
      k.noise("pink", [lp(800)], 0.03);
      chant(k);
      k.every(22, 48, (t) => metal(k, t, k.pick([196, 147]), BELL, 7, 0.08, { pan: -0.3, space: "hall", wet: 1, dry: 0.5 }), k.r(4, 9));
    },
  },
  dungeon: {
    make(k) {
      drone(k, [55, 82.6, 110.3], 800, 0.06, "cave");
      const air = k.noise("pink", [bp(600, 0.6)], 0.18);
      k.wobble(air.gain.gain, 0.06, 0.06);
      k.every(9, 22, (t) => chains(k, t, "cave"), k.r(1, 5));
      k.every(18, 42, (t) => scrape(k, t, "cave"), k.r(5, 14));
      k.every(24, 60, (t) => boom(k, t, 0.18, "cave"), k.r(8, 22));
      k.every(3, 9, (t) => drip(k, t, k.r(900, 2200), k.r(0.04, 0.09), { pan: k.r(-0.8, 0.8), space: "cave", wet: 1, dry: 0.4 }));
    },
  },
  cave: {
    make(k) {
      const air = k.noise("brown", [lp(200)], 0.22);
      k.wobble(air.gain.gain, 0.05, 0.05);
      const breath = k.noise("pink", [bp(520, 0.6)], 0.18);
      k.wobble(breath.gain.gain, 0.09, 0.06);
      k.every(1, 4, (t) => {
        const how = { pan: k.r(-0.9, 0.9), space: "cave" as const, wet: 1, dry: 0.6 };
        drip(k, t, k.r(900, 2400), k.r(0.08, 0.2), how);
        if (k.chance(0.25)) drip(k, t + k.r(0.12, 0.3), k.r(900, 2400), k.r(0.05, 0.12), how);
      }, 0.3);
      k.every(30, 70, (t) => boom(k, t, 0.08, "cave"), k.r(12, 30));
    },
  },
  ship: {
    make(k) {
      k.noise("pink", [lp(280)], 0.22);
      gusts(k, 500, 2, 0.05, 0.07, 0.15, 120);
      k.every(3.5, 6.5, (t) => wave(k, t, 0.55), 0.1);
      k.every(2.5, 8, (t) => creak(k, t, k.r(0.05, 0.12), { pan: k.r(-0.8, 0.8), space: "room", wet: 0.5 }), 0.8);
      k.every(5, 12, (t) => knock(k, t, k.r(0.08, 0.16), { pan: k.r(-0.8, 0.8), space: "room", wet: 0.6 }));
      k.every(18, 45, (t) => gull(k, t, "room"), k.r(3, 10));
    },
  },
  campfire: {
    make(k) {
      const roar = k.noise("brown", [lp(420)], 0.28);
      // Slow and at odds with each other: a fire doesn't breathe evenly.
      k.wobble(roar.gain.gain, 0.23, 0.03);
      k.wobble(roar.gain.gain, 0.61, 0.02);
      const flame = k.noise("pink", [bp(1100, 0.6)], 0.18);
      k.wobble(flame.gain.gain, 0.37, 0.025);
      k.wobble(flame.gain.gain, 0.83, 0.015);
      k.ticks(9, [1800, 6500], [0.03, 0.3], [0.002, 0.006]);
      k.every(1.2, 5, (t) => pop(k, t, k.r(0.12, 0.28)), 0.4);
      k.every(0.7, 1.1, (t) => cricket(k, t, 4500, 0.012, -0.7));
      k.every(0.8, 1.3, (t) => cricket(k, t, 4150, 0.01, 0.7));
    },
  },
  forest: {
    make(k) {
      const leaves = k.noise("pink", [hp(1800), lp(9000)], 0.16);
      k.wobble(leaves.gain.gain, 0.11, 0.06);
      k.wobble(leaves.gain.gain, 0.27, 0.035);
      k.noise("pink", [lp(500)], 0.08);
      k.every(0.8, 3.2, (t) => bird(k, t), 0.3);
      k.every(30, 70, (t) => cuckoo(k, t), k.r(6, 15));
      k.every(25, 60, (t) => woodpecker(k, t), k.r(10, 25));
    },
  },
  night: {
    make(k) {
      k.noise("pink", [lp(700)], 0.05);
      k.every(0.55, 0.85, (t) => cricket(k, t, 4500, 0.1, -0.6), 0);
      k.every(0.65, 0.95, (t) => cricket(k, t, 4200, 0.08, 0.5));
      k.every(0.75, 1.1, (t) => cricket(k, t, 4850, 0.05, 0.1));
      k.every(14, 32, (t) => owl(k, t), k.r(3, 8));
      k.every(45, 110, (t) => wolf(k, t), k.r(15, 30));
      k.every(3, 9, (t) => frog(k, t));
    },
  },
  swamp: {
    make(k) {
      k.noise("pink", [lp(500)], 0.05);
      const insects = k.noise("white", [bp(3600, 8)], 0.12);
      k.wobble(insects.gain.gain, 17, 0.08);
      k.every(0.6, 2.2, (t) => frog(k, t), 0.2);
      k.every(0.25, 0.9, (t) => peeper(k, t));
      k.every(1.2, 4.5, (t) => {
        const how = { pan: k.r(-0.7, 0.7), space: "room" as const, wet: 0.3 };
        drip(k, t, k.r(150, 320), k.r(0.15, 0.3), how);
        if (k.chance(0.4)) drip(k, t + k.r(0.08, 0.2), k.r(180, 380), k.r(0.1, 0.22), how);
      });
    },
  },
  river: {
    make(k) {
      const flow = k.noise("pink", [bp(800, 0.5)], 0.45);
      k.wobble(flow.gain.gain, 0.4, 0.05);
      const chatter = k.noise("white", [bp(2400, 0.7)], 0.08);
      k.wobble(chatter.gain.gain, 1.7, 0.025);
      k.wobble(chatter.gain.gain, 3.1, 0.015);
      k.loopOf(bubblesBuffer(k.c, 26, [420, 1700], [0.015, 0.09]));
    },
  },
  shore: {
    make(k) {
      k.noise("pink", [lp(320)], 0.2);
      k.every(5.5, 9.5, (t) => wave(k, t, k.r(0.8, 1.2)), 0.1);
      k.every(9, 24, (t) => gull(k, t), k.r(3, 8));
    },
  },
  rain: { make: (k) => rainBed(k, 1) },
  storm: {
    make(k) {
      rainBed(k, 1.3);
      gusts(k, 420, 1.5, 0.07, 0.07, 0.17, 150);
      k.every(16, 38, (t) => thunder(k, t), k.r(2, 6));
    },
  },
  wind: {
    make(k) {
      gusts(k, 380, 1.6, 0.5, 0.06, 0.17, 160);
      gusts(k, 760, 3, 0.22, 0.09, 0.23, 260);
      gusts(k, 1300, 9, 0.08, 0.05, 0.13, 320);
      k.noise("pink", [lp(300)], 0.2);
    },
  },
  blizzard: {
    make(k) {
      gusts(k, 520, 1.2, 0.5, 0.11, 0.29, 240);
      gusts(k, 1050, 3.5, 0.28, 0.13, 0.37, 420);
      gusts(k, 1900, 10, 0.1, 0.08, 0.21, 500);
      const hiss = k.noise("white", [hp(4200)], 0.05);
      k.wobble(hiss.gain.gain, 0.31, 0.02);
      k.ticks(8, [4000, 8000], [0.01, 0.06], [0.0008, 0.002]);
    },
  },
  battle: { make: warDrums },
  throne: { make: darkThrone },
  gregorian: { make: plainchant },
  bwah: { make: bigBrass },
  dread: {
    make(k) {
      drone(k, [110, 116.5, 155.6], 900, 0.05, "cave");
      const glass = k.c.createOscillator();
      glass.frequency.value = 1760;
      const trembling = k.gain(0.006);
      k.wobble(trembling.gain, 0.13, 0.004);
      glass.connect(trembling);
      k.place(trembling, { space: "cave", wet: 0.7 });
      glass.start(k.c.currentTime);
      k.sources.push(glass);
      k.every(1.02, 1.12, (t) => heartbeat(k, t, 0.32), 0.2);
      k.every(5, 14, (t) => whisper(k, t), k.r(1, 4));
      k.every(14, 30, (t) => creak(k, t, k.r(0.05, 0.1), { pan: k.r(-0.9, 0.9), space: "cave", wet: 0.9, dry: 0.4 }));
    },
  },
  magic: {
    make(k) {
      for (const midi of [62, 69, 76, 78]) {
        const o = k.c.createOscillator();
        o.frequency.value = hz(midi);
        const g = k.gain(0.02);
        k.wobble(g.gain, k.r(0.06, 0.16), 0.014);
        o.connect(g);
        k.place(g, { pan: k.r(-0.5, 0.5), space: "hall", wet: 1, dry: 0.5 });
        o.start(k.c.currentTime);
        k.sources.push(o);
      }
      const breath = k.noise("white", [hp(6000)], 0.012);
      k.wobble(breath.gain.gain, 0.12, 0.007);
      const scale = [86, 88, 90, 93, 95, 98, 100, 102, 105];
      const chime = (t: number, midi: number, level: number) =>
        metal(k, t, hz(midi), CHIME, 1.4, level, { pan: k.r(-0.8, 0.8), space: "hall", wet: 1, dry: 0.6 });
      k.every(0.35, 1.6, (t) => chime(t, k.pick(scale), k.r(0.02, 0.06)), 0.1);
      k.every(9, 20, (t) => {
        const n = Math.round(k.r(8, 14));
        const from = Math.floor(k.r(0, 3));
        for (let i = 0; i < n; i++) chime(t + i * k.r(0.07, 0.11), scale[(from + i) % scale.length]!, 0.035);
      }, k.r(3, 8));
    },
  },
  harp: { make: harp },
  lute: { make: lute },
};

/**
 * How far each is turned up or down to match the others, from renderings of them: as loud on small
 * speakers as can be had (-20 dB above 300 Hz), not over -14 dB overall, nothing peaking over -3 dB.
 * A sound with only a little going on (a drip now and then) stays quieter overall: what's in it would
 * otherwise be far too sudden. Before the listener's own volume.
 */
export const SOUND_TRIMS: Record<string, number> = {
  tavern: 3.94,
  cantina: 0.9,
  throne: 1.78,
  gregorian: 2.3,
  bwah: 0.36,
  town: 6.17,
  temple: 3.63,
  dungeon: 1.58,
  cave: 3.02,
  ship: 2.45,
  campfire: 1.78,
  forest: 2.85,
  night: 3.2,
  swamp: 2.99,
  river: 2.57,
  shore: 1.53,
  rain: 1.53,
  storm: 0.84,
  wind: 2.09,
  blizzard: 1.55,
  battle: 0.92,
  dread: 1.48,
  magic: 4.17,
  harp: 1.4,
  lute: 1.33,
};

/** How long the church goes on ringing after a hit has stopped. */
const STING_TAIL = SPACES.church.seconds + 0.5;

/**
 * One hit on its own, on demand (the GM's button, shared/sounds.ts STINGS), from `at`: the air drawn in, a
 * moment of nothing, then the brass, as loud as a hit in the Bwah sound. Says when the hit lands, and when
 * the last of it has rung away.
 */
export function buildSting(id: StingId, c: BaseAudioContext, out: AudioNode, at: number, rand: Rand = Math.random, trimmed = true): { hit: number; done: number } {
  const trim = c.createGain();
  trim.gain.value = trimmed ? SOUND_TRIMS.bwah! : 1;
  trim.connect(out);
  const k = new SoundKit(c, trim, rand);
  const hit = at + BWAH_BUILD;
  if (id === "bwah") {
    suckBack(k, at);
    bwah(k, hit, BWAH_C, BWAH_LAST);
  }
  return { hit, done: hit + BWAH_LAST + STING_TAIL };
}

export interface RunningSound {
  /** Schedules what's due before `until`. */
  pump(now: number, until: number): void;
  /** Stops what runs all the time, at this time. */
  stop(at: number): void;
  kit: SoundKit;
}

/** Starts a sound on this context, into `out`. Nothing plays until something from it is pumped, but its beds. */
export function buildSound(id: SoundOption["id"], c: BaseAudioContext, out: AudioNode, rand: Rand = Math.random, trimmed = true): RunningSound | null {
  const recipe = SOUND_RECIPES[id];
  if (!recipe) return null;
  const trim = c.createGain();
  trim.gain.value = trimmed ? (SOUND_TRIMS[id] ?? 1) : 1;
  trim.connect(out);
  const kit = new SoundKit(c, trim, rand);
  recipe.make(kit);
  return {
    kit,
    pump: (now, until) => kit.pump(now, until),
    stop(at) {
      kit.timers.length = 0;
      for (const s of kit.sources) {
        try {
          s.stop(at);
        } catch {
          // Already stopped.
        }
      }
    },
  };
}
