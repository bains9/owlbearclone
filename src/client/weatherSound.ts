// A soft rain or wind on wet or windy days (shared/calendar.ts weatherOf), made here from noise
// (no sound files): rain is noise through a high band, wind a low rumble that swells and fades.
// Off unless this device turned it on (Calendar panel), since a browser only plays after a click.

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
let playing: { rain: GainNode; wind: GainNode; gust: OscillatorNode } | null = null;

function noise(c: AudioContext): AudioBufferSourceNode {
  const seconds = 4;
  const buffer = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    // Pink-ish: white noise smoothed a little, so it isn't harsh.
    const white = Math.random() * 2 - 1;
    last = (last + 0.05 * white) / 1.05;
    data[i] = last * 4;
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  return src;
}

function start(): void {
  if (playing) return;
  ctx ??= new AudioContext();
  const c = ctx;
  const rainSrc = noise(c);
  const rainBand = c.createBiquadFilter();
  rainBand.type = "bandpass";
  rainBand.frequency.value = 1800;
  rainBand.Q.value = 0.6;
  const rain = c.createGain();
  rain.gain.value = 0;
  rainSrc.connect(rainBand).connect(rain).connect(c.destination);
  rainSrc.start();
  const windSrc = noise(c);
  const windLow = c.createBiquadFilter();
  windLow.type = "lowpass";
  windLow.frequency.value = 320;
  const wind = c.createGain();
  wind.gain.value = 0;
  // The wind swells and fades every few seconds.
  const gust = c.createOscillator();
  gust.frequency.value = 0.12;
  const gustDepth = c.createGain();
  gustDepth.gain.value = 0.5;
  const swell = c.createGain();
  swell.gain.value = 0.5;
  gust.connect(gustDepth).connect(swell.gain);
  windSrc.connect(windLow).connect(swell).connect(wind).connect(c.destination);
  windSrc.start();
  gust.start();
  playing = { rain, wind, gust };
}

/** Plays the weather's sound (after a click, as browsers require), or fades it to nothing when the day is dry and still. */
export function playWeatherSound(w: Weather | null): void {
  if (!w) return stopWeatherSound();
  const rainLevel = w.precipitation === "none" || w.kind === "snow" ? 0 : w.precipitation === "heavy" ? 0.35 : 0.14;
  const windLevel = { calm: 0, "light wind": 0.05, breezy: 0.14, windy: 0.3, gale: 0.5 }[w.wind];
  if (!rainLevel && !windLevel) return stopWeatherSound();
  start();
  if (!playing || !ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const t = ctx.currentTime;
  playing.rain.gain.setTargetAtTime(rainLevel, t, 1.5);
  playing.wind.gain.setTargetAtTime(windLevel, t, 1.5);
}

export function stopWeatherSound(): void {
  if (!playing || !ctx) return;
  const t = ctx.currentTime;
  playing.rain.gain.setTargetAtTime(0, t, 0.8);
  playing.wind.gain.setTargetAtTime(0, t, 0.8);
}
