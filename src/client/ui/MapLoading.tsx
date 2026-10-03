import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { CloudOff, LoaderCircle } from "lucide-preact";
import { BALDR_LINES, nextLine } from "../room/loadingLines";
import { overlayAt, overlayDue, seasonNoteAt, seasonNoteDue, seasonNoteTop, trackLoad, trackSeason, withLine } from "../room/mapLoading";
import type { LoadTrack, MapLoad, Overlay, SeasonTrack } from "../room/mapLoading";
import { cx, useRoom, useRoomState } from "./common";

/**
 * Over the board: "Loading map…" (and a line about Baldr) while the scene's map picture
 * downloads, after a moment so a map the browser already has never flickers it; "Couldn't
 * load the map…" while it's tried again and once it's been given up on; and "Making the
 * season…" in a corner while its seasonal look is made. Only Try again takes a click: the
 * board under it works as usual.
 */
export function MapLoading() {
  const room = useRoom();
  const load = useRoomState((s) => s.mapLoad);
  const [, setTick] = useState(0);
  const seen = useRef<MapLoad | null>(null);
  const track = useRef<LoadTrack | null>(null);
  const season = useRef<SeasonTrack | null>(null);
  /** What the overlay last showed, kept on it while it fades out. */
  const last = useRef<Overlay | null>(null);

  const now = performance.now();
  if (load !== seen.current) {
    seen.current = load;
    track.current = trackLoad(track.current, load, now);
    season.current = trackSeason(season.current, load.season, now);
  }
  // The line is picked (and remembered on the device) only once someone can see it.
  track.current = withLine(track.current, now, nextLine);
  const overlay = overlayAt(track.current, now);
  const note = seasonNoteAt(season.current, now);
  if (overlay.kind !== "hidden") last.current = overlay;

  // Comes back when a wait runs out (the overlay or the note is due to show).
  const waits = [overlayDue(track.current, now), seasonNoteDue(season.current, now)].filter((d): d is number => d !== null);
  const wait = waits.length ? Math.min(...waits) : null;
  useEffect(() => {
    if (wait === null) return;
    const t = setTimeout(() => setTick((n) => n + 1), wait + 5);
    return () => clearTimeout(t);
  });

  // On a phone, the note keeps below a tool's options bar, which comes and goes with the
  // tool and wraps to any height, rather than sitting under it.
  const noteRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = noteRef.current;
    const area = el?.parentElement;
    if (!el || !area) return;
    const narrow = window.matchMedia("(max-width: 760px)");
    let bar: HTMLElement | null = null;
    const ro = new ResizeObserver(() => place());
    const place = () => {
      const now = area.querySelector<HTMLElement>(":scope > .tool-options");
      if (now !== bar) {
        if (bar) ro.unobserve(bar);
        bar = now;
        if (bar) ro.observe(bar);
      }
      const top = seasonNoteTop(bar?.isConnected ? { top: bar.offsetTop, height: bar.offsetHeight } : null, narrow.matches);
      el.style.top = top === null ? "" : `${top}px`;
      // The zoom buttons go down to the bottom corner while the bar's there: the note takes theirs.
      el.style.right = top === null ? "" : "10px";
    };
    place();
    const mo = new MutationObserver(place);
    mo.observe(area, { childList: true });
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", place);
    };
  }, []);

  const card = last.current;
  return (
    <>
      <div class={cx("map-loading", overlay.kind !== "hidden" && "shown")} role="status" aria-live="polite">
        {card?.kind === "loading" && (
          <div class="map-loading-card">
            <LoaderCircle class="map-loading-icon spin" size={28} aria-hidden="true" />
            <strong>Loading map…</strong>
            <span class="map-loading-line">{BALDR_LINES[card.line] ?? ""}</span>
          </div>
        )}
        {card?.kind === "retrying" && (
          <div class="map-loading-card">
            <LoaderCircle class="map-loading-icon spin" size={28} aria-hidden="true" />
            <strong>Couldn't load the map, trying again…</strong>
          </div>
        )}
        {card?.kind === "failed" && (
          <div class="map-loading-card failed">
            <CloudOff class="map-loading-icon" size={28} aria-hidden="true" />
            <strong>Couldn't load the map. Check the connection, then try again.</strong>
            <button class="btn btn-primary" onClick={() => room.board?.retryMap()}>
              Try again
            </button>
          </div>
        )}
      </div>
      <div class={cx("board-season-note", note && "shown")} role="status" ref={noteRef}>
        <LoaderCircle class="spin" size={14} aria-hidden="true" />
        Making the season…
      </div>
    </>
  );
}
