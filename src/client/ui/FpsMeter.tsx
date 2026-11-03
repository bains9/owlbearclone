// A frame-rate readout, for seeing how the board runs on a given device (a player's tablet, say)
// rather than guessing: add ?fps to a room's link (?fps=0 takes it away again; the tab remembers
// either). Top right, once a second: frames a second, the slowest frame, and how long the board
// spent drawing in that second.

import { useEffect, useState } from "preact/hooks";
import { fpsWanted } from "../fps";
import { useRoom } from "./common";

export interface FpsReading {
  fps: number;
  /** The slowest frame, in ms. */
  worst: number;
  /** Time the board spent drawing, in ms (over the second). */
  drawing: number;
  draws: number;
}

export function FpsMeter() {
  const room = useRoom();
  const [on] = useState(() => typeof location !== "undefined" && fpsWanted(location.search));
  const [reading, setReading] = useState<FpsReading | null>(null);
  useEffect(() => {
    if (!on) return;
    let frames = 0;
    let worst = 0;
    let last = performance.now();
    let started = last;
    let raf = 0;
    const tick = (now: number) => {
      frames++;
      worst = Math.max(worst, now - last);
      last = now;
      if (now - started >= 1000) {
        const board = room.board?.drawStats() ?? { ms: 0, draws: 0 };
        setReading({ fps: Math.round((frames * 1000) / (now - started)), worst: Math.round(worst), drawing: Math.round(board.ms), draws: board.draws });
        frames = 0;
        worst = 0;
        started = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, room]);
  if (!on || !reading) return null;
  const slow = reading.fps < 40 || reading.worst > 50;
  return (
    <div class={`fps-meter${slow ? " slow" : ""}`} title="Frames a second · the slowest frame · the board's drawing in that second (?fps=0 in the link takes this away)">
      {reading.fps} fps · slowest {reading.worst} ms · drawing {reading.drawing} ms ({reading.draws})
    </div>
  );
}
