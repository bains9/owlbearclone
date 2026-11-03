// Update from Dungeon (the button on a scene brought in From Dungeon): Dungeon draws the map as it
// is now, and the scenes brought in with that one (one batch) get their levels' new pictures in
// place (importScenes.ts: planDungeonUpdate, applyDungeonUpdate). Levels are matched by name; when
// the map's levels have changed, or a scene shows a picture of the GM's own, the dialog says what
// will happen and waits for Update. Tokens, fog and drawings stay where they are, and the old
// pictures are deleted once nothing uses them, so updating doesn't pile up copies.

import { useEffect, useRef, useState } from "preact/hooks";
import { MAP_MAX_SIDE } from "../api";
import { withBridge, type DungeonBridge } from "../dungeonBridge";
import { applyDungeonUpdate, detailOf, isDungeonScene, planDungeonUpdate, readDungeonFile, withPairs, type DungeonDrawing, type DungeonPlan, type UpdateResult } from "../importScenes";
import { Modal, useRoom, useRoomState } from "./common";

const say = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function UpdateFromDungeonDialog(props: { batch: string; onClose: () => void }) {
  const room = useRoom();
  const scenes = useRoomState((s) => s.scenes);
  const assets = useRoomState((s) => s.assets);
  // The scenes brought in together, as they are when the dialog opens (the update reads them again).
  const [batch] = useState(() =>
    Object.values(scenes)
      .filter((s) => s.dungeon?.batch === props.batch)
      .sort((a, b) => a.dungeon!.index - b.dungeon!.index),
  );
  const own = batch.filter(isDungeonScene);
  const [lighting, setLighting] = useState(() => own.some((s) => s.dungeon.lighting));
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planned, setPlanned] = useState<{ plan: DungeonPlan; drawing: DungeonDrawing } | null>(null);
  // Levels with no scene to bring in as new ones: those new in Dungeon, to begin with.
  const [bringIn, setBringIn] = useState<Set<number>>(new Set());
  // Scenes whose level has gone, given another level instead (a renamed one): guessed, to begin with.
  const [pairs, setPairs] = useState<Map<string, number>>(new Map());
  const [result, setResult] = useState<UpdateResult | null>(null);
  const bridge = useRef<DungeonBridge | null>(null);
  useEffect(
    () => () => {
      bridge.current?.close();
      bridge.current = null;
    },
    [],
  );

  const apply = async (plan: DungeonPlan, drawing: DungeonDrawing, levels: ReadonlySet<number>) => {
    setWorking("Updating…");
    const r = await applyDungeonUpdate(room, plan, drawing, { lighting, covered: true, bringIn: levels, onProgress: setWorking });
    if (!r.notes.length && !r.added.length) {
      room.toast(r.updated.length === 1 ? `Updated ${r.updated[0].name} from Dungeon.` : `Updated ${r.updated.length} scenes from Dungeon.`);
      props.onClose();
      return;
    }
    setResult(r);
  };

  /** Dungeon draws the map; the update goes ahead at once unless something needs the GM's say. */
  const draw = async () => {
    if (working || !own.length) return;
    setError(null);
    setWorking("Dungeon is drawing the map…");
    try {
      const map = own[0].dungeon.map;
      const { file, name } = await withBridge(bridge, (b) =>
        b.file(map, detailOf(own[0], assets), MAP_MAX_SIDE, lighting, (level, of) => {
          if (of > 1) setWorking(`Dungeon is drawing level ${level} of ${of}…`);
        }),
      );
      const drawing = await readDungeonFile(file, name);
      if (!drawing.maps.length) throw new Error(`Dungeon's drawing couldn't be read (${drawing.errors.join("; ") || "no levels in it"}), so nothing was changed.`);
      const plan = planDungeonUpdate(batch, drawing.levels);
      if (plan.unusual) {
        const guessed = new Map(plan.left.flatMap((l) => (l.guess !== undefined ? [[l.scene.id, l.guess] as const] : [])));
        setPairs(guessed);
        const paired = new Set(guessed.values());
        setBringIn(new Set(plan.unplaced.filter((u) => u.isNew && !paired.has(u.level)).map((u) => u.level)));
        setPlanned({ plan, drawing });
        return;
      }
      await apply(plan, drawing, new Set());
    } catch (e) {
      setError(say(e));
    } finally {
      setWorking(null);
    }
  };

  const confirm = async () => {
    if (!planned || working) return;
    try {
      const plan = withPairs(planned.plan, pairs);
      const paired = new Set(pairs.values());
      await apply(plan, planned.drawing, new Set([...bringIn].filter((l) => !paired.has(l))));
    } catch (e) {
      setError(say(e));
    } finally {
      setWorking(null);
    }
  };

  if (result) {
    return (
      <Modal title="Updated from Dungeon" onClose={props.onClose}>
        <div class="confirm-message">
          {result.updated.length > 0 && (
            <p>
              {result.updated.length === 1 ? "Updated" : `Updated ${result.updated.length} scenes`}: <strong>{result.updated.map((s) => s.name).join(", ")}</strong>.
            </p>
          )}
          {result.added.length > 0 && (
            <p>
              New scenes: <strong>{result.added.map((s) => s.name).join(", ")}</strong>.
            </p>
          )}
          {result.notes.length > 0 && (
            <ul class="small">
              {result.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </div>
        <div class="dialog-actions">
          <button class="btn btn-primary" onClick={props.onClose}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  if (planned) {
    const { plan, drawing } = planned;
    const levelName = (i: number) => drawing.levels[i] || drawing.maps[i]?.name || `Level ${i + 1}`;
    return (
      <Modal title="Update from Dungeon" onClose={() => !working && props.onClose()}>
        <div class="confirm-message">
          <p>Dungeon's map has changed since these scenes came in. This is what Update will do:</p>
          {plan.matched.length > 0 && (
            <p>
              <strong>New pictures:</strong>{" "}
              {plan.matched.map((m) => (m.scene.dungeon.level === levelName(m.level) ? m.scene.name : `${m.scene.name} (${levelName(m.level)})`)).join(", ")}.
            </p>
          )}
          {plan.left.some((l) => l.why === "picture") && (
            <p>
              <strong>Left as they are:</strong>{" "}
              {plan.left
                .filter((l) => l.why === "picture")
                .map((l) => `${l.scene.name} (it shows a picture of your own)`)
                .join(", ")}
              .
            </p>
          )}
          {plan.left
            .filter((l) => l.why === "gone")
            .map((l) => (
              <label key={l.scene.id} class="field">
                <span>
                  {l.scene.name}: its level "{l.scene.dungeon?.level}" isn't in Dungeon's map any more. Give it the picture of
                </span>
                <select
                  value={pairs.get(l.scene.id) ?? ""}
                  disabled={!!working}
                  onChange={(e) => {
                    const next = new Map(pairs);
                    const v = e.currentTarget.value;
                    if (v === "") next.delete(l.scene.id);
                    else next.set(l.scene.id, Number(v));
                    setPairs(next);
                  }}
                >
                  <option value="">No level: leave it as it is</option>
                  {plan.unplaced
                    .filter((u) => u.level === pairs.get(l.scene.id) || ![...pairs.values()].includes(u.level))
                    .map((u) => (
                      <option key={u.level} value={u.level}>
                        {levelName(u.level)}
                        {u.isNew ? " (new or renamed)" : ""}
                      </option>
                    ))}
                </select>
              </label>
            ))}
          {plan.unplaced.some((u) => ![...pairs.values()].includes(u.level)) && (
            <>
              <p class="small muted">Levels with no scene here; tick those to bring in as new scenes:</p>
              {plan.unplaced.filter((u) => ![...pairs.values()].includes(u.level)).map((u) => (
                <label key={u.level} class="check">
                  <input
                    type="checkbox"
                    checked={bringIn.has(u.level)}
                    disabled={!!working}
                    onChange={(e) => {
                      const next = new Set(bringIn);
                      if (e.currentTarget.checked) next.add(u.level);
                      else next.delete(u.level);
                      setBringIn(next);
                    }}
                  />{" "}
                  {levelName(u.level)} {u.isNew ? "(new in Dungeon)" : "(not in this room)"}
                </label>
              ))}
            </>
          )}
          {working && <p class="small">{working}</p>}
          {error && <p class="small error-text">{error}</p>}
        </div>
        <div class="dialog-actions">
          <button class="btn" disabled={!!working} onClick={props.onClose}>
            Cancel
          </button>
          <button class="btn btn-primary" disabled={!!working} onClick={() => void confirm()}>
            Update
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Update from Dungeon" onClose={() => !working && props.onClose()}>
      <div class="confirm-message">
        {own.length ? (
          <p>
            Dungeon draws the map as it is now, and {own.length === 1 ? "this scene gets its new picture" : "these scenes get their new pictures"}:{" "}
            <strong>{own.map((s) => s.name).join(", ")}</strong>.
          </p>
        ) : (
          <p>These scenes all show pictures of your own now, so there's nothing to update from Dungeon.</p>
        )}
        <p class="small muted">
          Tokens, fog and drawings stay where they are, and so does the grid. The old pictures are deleted once no scene uses them. If the map's levels
          have changed, you'll see what will happen before anything does. This page pauses for a moment while Dungeon draws.
        </p>
        <label class="check">
          <input type="checkbox" checked={lighting} disabled={!!working} onChange={(e) => setLighting(e.currentTarget.checked)} /> Paint Dungeon's
          lighting into the picture
        </label>
        {working && <p class="small">{working}</p>}
        {error && <p class="small error-text">{error}</p>}
      </div>
      <div class="dialog-actions">
        <button class="btn" disabled={!!working} onClick={props.onClose}>
          Cancel
        </button>
        <button class="btn btn-primary" disabled={!!working || !own.length} onClick={() => void draw()}>
          {error ? "Try again" : "Update"}
        </button>
      </div>
    </Modal>
  );
}
