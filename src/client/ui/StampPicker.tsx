// The Build tool's object picker (LibraryPicker): Tabletop's sixteen and Dungeon's 135.

import { useEffect, useRef } from "preact/hooks";
import { stampName, type StampId } from "../../shared/terrain";
import { drawStamp } from "../room/buildArt";
import { LibraryPicker } from "./LibraryPicker";
import { OBJECT_GROUPS } from "./objectGroups";

/** A small picture of an object. */
export function StampIcon(props: { id: StampId; px?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = props.px ?? 26;
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const px = size * (window.devicePixelRatio || 1);
    canvas.width = px;
    canvas.height = px;
    ctx.setTransform(px, 0, 0, px, px / 2, px / 2);
    drawStamp(ctx, props.id);
  }, [props.id, size]);
  return <canvas ref={ref} class="stamp-icon" style={{ width: `${size}px`, height: `${size}px` }} aria-hidden="true" />;
}

const icon = (id: StampId) => <StampIcon id={id} />;

export function StampPicker(props: { value: StampId; placing: boolean; recent: StampId[]; onPick: (id: StampId) => void }) {
  return (
    <LibraryPicker
      noun="objects"
      groups={OBJECT_GROUPS}
      value={props.value}
      active={props.placing}
      recent={props.recent}
      name={stampName}
      icon={icon}
      itemClass="object"
      onPick={props.onPick}
    />
  );
}
