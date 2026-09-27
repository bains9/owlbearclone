import { randomId } from "../shared/ids";

export interface Profile {
  /** Stable id for this browser, so your tokens and drawings stay yours across visits. */
  uid: string;
  name: string;
  color: string;
}

export const PLAYER_COLORS = [
  "#e4572e",
  "#f3a712",
  "#e8d33f",
  "#5bba6f",
  "#29bf9b",
  "#4f9dde",
  "#6c63ff",
  "#b45fd6",
  "#e45fa5",
  "#9aa3ad",
];

const KEY = "tabletop.profile";

export function loadProfile(): Profile {
  let stored: Partial<Profile> = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Profile>;
  } catch {
    // storage unavailable (private mode, blocked site data): fall through to a fresh profile
  }
  const profile: Profile = {
    uid: typeof stored.uid === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(stored.uid) ? stored.uid : randomId(16),
    name: typeof stored.name === "string" ? stored.name : "",
    color:
      typeof stored.color === "string" && /^#[0-9a-f]{6}$/i.test(stored.color)
        ? stored.color
        : PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)],
  };
  if (profile.uid !== stored.uid) saveProfile(profile);
  return profile;
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // not persisted; the profile still works for this visit
  }
}
