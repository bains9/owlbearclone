// The dice thrown on the map (dice3d.ts): a layer over it, under the bars, never in the way of a
// click, where each roll this page gets is thrown in 3D (unless this device has them off).
import { useEffect, useRef } from "preact/hooks";
import { throwDice } from "../dice3d";
import { useRoom } from "./common";

export function DiceThrow() {
  const room = useRoom();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      room.onRoll((m) => {
        if (ref.current) void throwDice(ref.current, m);
      }),
    [room],
  );
  return <div class="dice-throw" ref={ref} aria-hidden="true" />;
}
