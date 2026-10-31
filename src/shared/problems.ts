// What failed on someone's device, told to the GM (31 October 2026, from Par's "do all"): a bar or
// panel that couldn't be shown (ui/common.tsx Guard), or an error on the page. Otherwise it's only
// in that device's own console, and nobody knows a player's tablet couldn't show their card. The
// room keeps the last few (worker/room.ts) and sends them to the GM (More › Problems on devices).

export interface Problem {
  /** When it last happened (ms). */
  at: number;
  /** Who saw it: their name in the room. */
  name: string;
  /** Their device in a few words: "iPad · Safari". */
  device: string;
  /** What couldn't be shown: "the character card", "the page". */
  where: string;
  message: string;
  /** How many times it's happened (the same person, device, place and message). */
  times: number;
}

/** How many the room keeps, newest first. */
export const MAX_PROBLEMS = 20;
/** The longest each part may be, in characters. */
export const PROBLEM_LIMITS = { where: 60, message: 300, device: 40 } as const;

/** The list with a problem added at the top: the same one again counts up instead of filling the list. */
export function addProblem(list: readonly Problem[], p: Omit<Problem, "times">): Problem[] {
  const same = list.find((x) => x.name === p.name && x.device === p.device && x.where === p.where && x.message === p.message);
  const rest = list.filter((x) => x !== same);
  return [{ ...p, times: (same?.times ?? 0) + 1 }, ...rest].slice(0, MAX_PROBLEMS);
}

/**
 * A device in a few words from its browser's user agent: "iPad · Safari", "Android phone · Chrome",
 * "Windows · Edge". An iPad asks for desktop pages as a Mac: `touch` (more than one touch point)
 * tells them apart.
 */
export function deviceOf(ua: string, touch = false): string {
  const system = /iPad/.test(ua)
    ? "iPad"
    : /iPhone|iPod/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? /Mobile/.test(ua)
          ? "Android phone"
          : "Android tablet"
        : /Macintosh/.test(ua)
          ? touch
            ? "iPad"
            : "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux"
                : "a device";
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "a browser";
  return `${system} · ${browser}`;
}
