interface Entry {
  img: HTMLImageElement;
  state: "loading" | "ready" | "failed";
  waiters: Set<() => void>;
}

const cache = new Map<string, Entry>();
/** How many times each image has failed, for backing off retries. */
const failures = new Map<string, number>();
const MAX_RETRIES = 6;

/**
 * Returns the image if it has loaded, otherwise null (and calls onChange once it
 * loads, or when a failed load is about to be retried). Images are shared across
 * the whole page. A failed image is retried with back-off (2 s, 4 s, 8 s, ...), so a
 * blip in the connection doesn't leave a map blank for the rest of the session.
 */
export function getImage(url: string, onChange: () => void): HTMLImageElement | null {
  let entry = cache.get(url);
  if (!entry) {
    const img = new Image();
    img.decoding = "async";
    const e: Entry = { img, state: "loading", waiters: new Set() };
    img.onload = () => {
      e.state = "ready";
      failures.delete(url);
      for (const w of e.waiters) w();
      e.waiters.clear();
    };
    img.onerror = () => {
      e.state = "failed";
      const tries = (failures.get(url) ?? 0) + 1;
      failures.set(url, tries);
      // Let the board show its fallback now.
      for (const w of e.waiters) w();
      if (tries > MAX_RETRIES) {
        e.waiters.clear();
        return;
      }
      setTimeout(() => {
        // Forget the failure; whoever is waiting will ask again and start a new load.
        if (cache.get(url) === e) cache.delete(url);
        const waiting = [...e.waiters];
        e.waiters.clear();
        for (const w of waiting) w();
      }, 1000 * 2 ** tries);
    };
    img.src = url;
    cache.set(url, e);
    entry = e;
  }
  if (entry.state === "ready") return entry.img;
  entry.waiters.add(onChange);
  return null;
}

export function imageFailed(url: string): boolean {
  return cache.get(url)?.state === "failed";
}
