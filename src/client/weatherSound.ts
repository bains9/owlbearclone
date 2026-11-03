// A soft rain or wind on wet or windy days (shared/calendar.ts weatherOf), made here from noise
// (no sound files): rain is white noise through a high band (a hiss small speakers play well),
// wind is noise through a lower band whose pitch and loudness swell and fade, as gusts do. Off
// unless this device turned it on (Calendar panel); a browser only plays after a tap or click.

import type { Weather } from "../shared/calendar";

const KEY = "tabletop-weather-sound";

export function weatherSoundWanted(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setWeatherSoundWanted(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // No storage: this page only.
  }
}

let ctx: AudioContext | null = null;
let playing: WeatherGraph | null = null;

/**
 * Called in the tap or click that turns the sound on: Safari (an iPad, an iPhone) plays only sound
 * started in the gesture itself, not a moment after it.
 */
export function unlockWeatherSound(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    // No Web Audio here: silence.
  }
}

/** A sound turned on in an earlier visit can't start by itself: the first tap or key anywhere starts it. */
function resumeOnNextGesture(): void {
  const go = () => {
    unlockWeatherSound();
    window.removeEventListener("pointerdown", go, true);
    window.removeEventListener("keydown", go, true);
  };
  window.addEventListener("pointerdown", go, true);
  window.addEventListener("keydown", go, true);
}

/** How loud the rain and the wind are for a day's weather (0 to 1 of each's own full level). */
export function weatherSoundLevels(w: Weather): { rain: number; wind: number } {
  return {
    rain: w.precipitation === "none" || w.kind === "snow" ? 0 : w.precipitation === "heavy" ? 1 : 0.45,
    wind: { calm: 0, "light wind": 0.2, breezy: 0.45, windy: 0.75, gale: 1 }[w.wind],
  };
}

/** Why the weather makes no sound, or null when it does. */
export function weatherSoundQuiet(w: Weather | null): string | null {
  if (!w) return "no weather on this map";
  const l = weatherSoundLevels(w);
  if (l.rain || l.wind) return null;
  return w.precipitation !== "none" ? "snow falls quietly and there's no wind" : "a still, dry day";
}

export interface WeatherGraph {
  /** Their loudness: set to a 0–1 level times RAIN_GAIN or WIND_GAIN. */
  rain: GainNode;
  wind: GainNode;
}

/** The loudest each gets (the output's gain at a level of 1). */
export const RAIN_GAIN = 0.5;
export const WIND_GAIN = 1.4;

function noiseBuffer(c: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = c.createBuffer(1, Math.round(c.sampleRate * seconds), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** The rain and the wind, made on any audio context (a page's, or an offline one to measure), silent until their gains are set. */
export function buildWeatherGraph(c: BaseAudioContext, out: AudioNode): WeatherGraph {
  const buffer = noiseBuffer(c, 4);
  // Rain: a hiss, high enough for a tablet's or laptop's speakers.
  const rainSrc = c.createBufferSource();
  rainSrc.buffer = buffer;
  rainSrc.loop = true;
  const rainHigh = c.createBiquadFilter();
  rainHigh.type = "highpass";
  rainHigh.frequency.value = 900;
  const rainSoft = c.createBiquadFilter();
  rainSoft.type = "lowpass";
  rainSoft.frequency.value = 7000;
  const rain = c.createGain();
  rain.gain.value = 0;
  rainSrc.connect(rainHigh).connect(rainSoft).connect(rain).connect(out);
  rainSrc.start();
  // Wind: a band of noise round 500 Hz whose pitch and loudness swell every few seconds.
  const windSrc = c.createBufferSource();
  windSrc.buffer = buffer;
  windSrc.loop = true;
  windSrc.playbackRate.value = 0.83;
  const windBand = c.createBiquadFilter();
  windBand.type = "bandpass";
  windBand.frequency.value = 500;
  windBand.Q.value = 1.2;
  const gust = c.createOscillator();
  gust.frequency.value = 0.13;
  const pitch = c.createGain();
  pitch.gain.value = 220;
  gust.connect(pitch).connect(windBand.frequency);
  const swell = c.createGain();
  swell.gain.value = 0.65;
  const swellDepth = c.createGain();
  swellDepth.gain.value = 0.35;
  gust.connect(swellDepth).connect(swell.gain);
  const wind = c.createGain();
  wind.gain.value = 0;
  windSrc.connect(windBand).connect(swell).connect(wind).connect(out);
  windSrc.start();
  gust.start();
  return { rain, wind };
}

/** Plays the weather's sound (after a tap, as browsers require), or fades it to nothing when the day is dry and still. */
export function playWeatherSound(w: Weather | null): void {
  if (!w) return stopWeatherSound();
  const l = weatherSoundLevels(w);
  if (!l.rain && !l.wind) return stopWeatherSound();
  try {
    ctx ??= new AudioContext();
  } catch {
    return;
  }
  playing ??= buildWeatherGraph(ctx, ctx.destination);
  if (ctx.state === "suspended") {
    void ctx.resume();
    resumeOnNextGesture();
  }
  const t = ctx.currentTime;
  playing.rain.gain.setTargetAtTime(l.rain * RAIN_GAIN, t, 1.2);
  playing.wind.gain.setTargetAtTime(l.wind * WIND_GAIN, t, 1.2);
}

export function stopWeatherSound(): void {
  if (!playing || !ctx) return;
  const t = ctx.currentTime;
  playing.rain.gain.setTargetAtTime(0, t, 0.6);
  playing.wind.gain.setTargetAtTime(0, t, 0.6);
}
