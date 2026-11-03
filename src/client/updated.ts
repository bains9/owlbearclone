// Whether this page is older than the Tabletop the server runs: a page left open across an
// update. The update may have replaced its files, so a part it loads only when first wanted (the
// Monsters and NPCs lists, the Dungeondraft reader, the guide) may not load any more. Reloading
// the page is what fixes that, not checking the connection or changing browsers, so that's what
// it says then.

import { BUILD_ID } from "../shared/build";

/** What a part that couldn't load says on an out-of-date page; `toDo` is what reloading lets you do ("use the monsters"). */
export function updatedText(toDo: string): string {
  return `Tabletop has been updated. Reload this page to ${toDo}.`;
}

/** How long the server gets to answer before the page stops waiting (a half-dead connection). */
const ASK_MS = 5000;

/**
 * What the server says about this page: it runs a different Tabletop ("updated"), the same one
 * ("current"), or it couldn't be asked ("unreachable": offline, an error, no answer in time).
 */
export type PageState = "updated" | "current" | "unreachable";

/** Once the server has said it's different, this page stays out of date until it's reloaded. */
let outdated = false;

/** Asked after something failed to load (GET /api/build), so the message can say what will fix it. */
export async function pageState(): Promise<PageState> {
  if (outdated) return "updated";
  try {
    const r = await fetch("/api/build", { cache: "no-store", signal: AbortSignal.timeout(ASK_MS) });
    const build = r.ok ? ((await r.json()) as { build?: unknown }).build : undefined;
    if (typeof build !== "string") return outdated ? "updated" : "unreachable";
    if (build !== BUILD_ID) outdated = true;
    return outdated ? "updated" : "current";
  } catch {
    return outdated ? "updated" : "unreachable";
  }
}

export async function pageOutdated(): Promise<boolean> {
  return (await pageState()) === "updated";
}

/** Why something couldn't load: the page is out of date, or (as far as the page can tell) the connection. */
export type LoadFailure = "updated" | "failed";

export async function loadFailure(): Promise<LoadFailure> {
  return (await pageOutdated()) ? "updated" : "failed";
}
