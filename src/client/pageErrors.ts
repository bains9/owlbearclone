// Errors on the page while a room is open, told to the GM as "the page" (RoomClient.reportProblem,
// More › Problems on devices), as a bar that fails is (ui/common.tsx Guard). Only Tabletop's own:
// not a browser extension's script, and not what isn't a fault (the browser's note that resizing
// took two frames, a connection dropping).

import type { RoomClient } from "./room/client";

/** What isn't a fault worth telling the GM of. */
const NOT_FAULTS = [/ResizeObserver loop/, /^Script error\.?$/, /Failed to fetch|NetworkError|Load failed|network connection was lost/i, /^AbortError|aborted/i];

/** The message of an error on the page worth telling the GM of, or null: one from a script on this site (`origin`). */
export function pageErrorOf(e: { message?: string; filename?: string }, origin: string): string | null {
  const message = (e.message ?? "").trim();
  if (!message || NOT_FAULTS.some((r) => r.test(message))) return null;
  if (e.filename && !e.filename.startsWith(origin)) return null;
  return message;
}

/** Tells the room of errors on the page until the function it returns is called. */
export function watchPageErrors(room: Pick<RoomClient, "reportProblem">): () => void {
  const onError = (e: ErrorEvent) => {
    const message = pageErrorOf(e, location.origin);
    if (message) room.reportProblem("the page", e.error instanceof Error ? e.error : new Error(message));
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const reason: unknown = e.reason;
    const message = pageErrorOf({ message: reason instanceof Error ? `${reason.name === "Error" ? "" : `${reason.name}: `}${reason.message}` : String(reason) }, location.origin);
    if (message) room.reportProblem("the page", reason instanceof Error ? reason : new Error(message));
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
