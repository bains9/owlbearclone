// Background sounds: the choice the GM has for a table (Sound in the top bar), chosen once for them.
// What's playing is part of a room's settings, so everyone in the room hears it and a page opened later
// joins in. Each browser makes the sounds itself (client/soundEngine.ts): nothing is downloaded.

export type SoundGroup = "Places" | "Outdoors" | "Weather" | "Mood";

export interface SoundOption {
  id: string;
  name: string;
  group: SoundGroup;
  /** What can be heard in it, in a few words. */
  blurb: string;
}

export const SOUND_GROUPS: SoundGroup[] = ["Places", "Outdoors", "Weather", "Mood"];

export const SOUNDS: SoundOption[] = [
  { id: "tavern", name: "Tavern", group: "Places", blurb: "Talk, mugs and a fire" },
  { id: "cantina", name: "Cantina", group: "Places", blurb: "A busy bar, a hot little band" },
  { id: "town", name: "Town street", group: "Places", blurb: "Voices, horses, a smith at work" },
  { id: "temple", name: "Temple", group: "Places", blurb: "Slow chanting, a far-off bell" },
  { id: "dungeon", name: "Dungeon", group: "Places", blurb: "Cold air, chains, stone shifting" },
  { id: "cave", name: "Cave", group: "Places", blurb: "Water dripping in a big dark space" },
  { id: "ship", name: "Ship at sea", group: "Places", blurb: "Waves, creaking timbers, gulls" },
  { id: "campfire", name: "Campfire", group: "Outdoors", blurb: "A crackling fire, crickets" },
  { id: "forest", name: "Forest by day", group: "Outdoors", blurb: "Leaves, birdsong, a woodpecker" },
  { id: "night", name: "Woods at night", group: "Outdoors", blurb: "Crickets, an owl, a far-off wolf" },
  { id: "swamp", name: "Swamp", group: "Outdoors", blurb: "Frogs, insects, bubbling mud" },
  { id: "river", name: "River", group: "Outdoors", blurb: "Running water" },
  { id: "shore", name: "Seashore", group: "Outdoors", blurb: "Waves breaking, gulls" },
  { id: "rain", name: "Steady rain", group: "Weather", blurb: "Rain, without thunder" },
  { id: "storm", name: "Thunderstorm", group: "Weather", blurb: "Heavy rain, wind and thunder" },
  { id: "wind", name: "Howling wind", group: "Weather", blurb: "Gusts on a bare hill or a ruin" },
  { id: "blizzard", name: "Blizzard", group: "Weather", blurb: "A freezing gale and driving snow" },
  { id: "battle", name: "War drums", group: "Mood", blurb: "Drums, horns, steel in the distance" },
  { id: "dread", name: "Dread", group: "Mood", blurb: "A low drone, a heartbeat, whispers" },
  { id: "throne", name: "Dark throne", group: "Mood", blurb: "A low choir, slow and menacing" },
  { id: "magic", name: "Magic", group: "Mood", blurb: "Shimmering chimes" },
  { id: "harp", name: "Quiet harp", group: "Mood", blurb: "A slow, gentle harp" },
  { id: "lute", name: "Minstrel's lute", group: "Mood", blurb: "Greensleeves, played on a lute" },
];

/** More than this at once is only noise, and more work for a slow device. */
export const MAX_SOUNDS = 4;

/** The quietest a sound can be set while it's still playing (taking it away is how to stop it). */
export const MIN_SOUND_LEVEL = 0.05;

/** What's playing in a room: a sound's id, and how loud the GM has set it (up to 1). */
export type RoomSounds = Record<string, number>;

const IDS = new Set(SOUNDS.map((s) => s.id));

export function soundOption(id: string): SoundOption | undefined {
  return SOUNDS.find((s) => s.id === id);
}

/** Only sounds that exist, within bounds; null when it isn't a list of sounds at all. */
export function sanitizeSounds(raw: unknown): RoomSounds | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: RoomSounds = {};
  let count = 0;
  for (const [id, level] of Object.entries(raw)) {
    if (count >= MAX_SOUNDS) break;
    if (!IDS.has(id) || typeof level !== "number" || !Number.isFinite(level)) continue;
    out[id] = Math.round(Math.min(1, Math.max(MIN_SOUND_LEVEL, level)) * 100) / 100;
    count++;
  }
  return out;
}

/** With this sound added to what's playing, or changed to this level. */
export function withSound(now: RoomSounds, id: string, level = 1): RoomSounds {
  if (!(id in now) && Object.keys(now).length >= MAX_SOUNDS) return now;
  return { ...now, [id]: level };
}

/** Without this sound. */
export function withoutSound(now: RoomSounds, id: string): RoomSounds {
  const { [id]: _gone, ...rest } = now;
  return rest;
}
