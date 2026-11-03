// Whether this tab shows the frame-rate readout (ui/FpsMeter.tsx): ?fps in a room's link turns it
// on, ?fps=0 off, and the tab remembers either.

const KEY = "tabletop-fps";

export function fpsWanted(search: string): boolean {
  const q = new URLSearchParams(search);
  try {
    if (q.has("fps")) sessionStorage.setItem(KEY, q.get("fps") === "0" ? "0" : "1");
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    // No storage (a private window, say): the link alone.
    return q.has("fps") && q.get("fps") !== "0";
  }
}
