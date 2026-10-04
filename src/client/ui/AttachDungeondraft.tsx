import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Scene, SceneMapData } from "../../shared/types";
import type { ScenePatch } from "../../shared/protocol";
import { fileUrl } from "../api";
import { ATTACH_TEXT, AttachError, checkAttached, cleanUpSidecars, prepareAttach, uploadSidecar } from "../dd/attach";
import type { AttachReport, FitResult, VttMeta } from "../dd/extract";
import { canUnpack, unpackPng } from "../dd/pngBox";
import { decodeSidecar } from "../dd/sidecar";
import type { SeasonSidecar } from "../dd/sidecar";
import { touchedSidecars } from "../importScenes";
import { isDungeondraftFile, isVttFile, parseUniversalVtt } from "../mapImport";
import { Modal, cx, useRoom, useRoomState } from "./common";
import { DD_UI, attachChecks, comparePanels, dialogTitle, fitCheck, gridDiffers, levelWhy, localDataState, needsAnyway, sidecarLabel } from "./ddText";
import type { Check } from "./ddText";

/** What a prepare gives the dialog (attach.ts prepareAttach). */
type Prepared = Awaited<ReturnType<typeof prepareAttach>>;

/**
 * Attaching a scene's Dungeondraft project file (design 2.1 C, 2.2, 2.7), or looking at the data
 * it has (Check…, "Use it with this picture"). Opened through store.attachDD. The picture is the
 * scene's own asset; the file is read by the GM's dd worker and never uploaded, only the compiled
 * sidecar is. Attaching is one undoable step (the data, the picture's rectangle and the grid).
 */
export function AttachDungeondraft(props: { scene: Scene; files?: File[]; mode?: "attach" | "check"; onClose(): void }) {
  const room = useRoom();
  const s = props.scene;
  const mapAssetId = s.mapAssetId ?? "";
  const asset = useRoomState((st) => (s.mapAssetId ? st.assets[s.mapAssetId] : undefined));
  const dataAsset = useRoomState((st) => (s.mapData ? st.assets[s.mapData.assetId] : undefined));
  const dataState = useRoomState((st) => st.mapDataState[s.id]) ?? localDataState(s);
  const picSize = { width: asset?.width ?? s.width, height: asset?.height ?? s.height };
  const [mode, setMode] = useState<"attach" | "check">(props.mode ?? "attach");
  const fileRef = useRef<HTMLInputElement>(null);

  // The scene's picture, fetched once for the worker (decoded on the main thread by attach.ts).
  const [picture, setPicture] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(fileUrl(room.roomId, mapAssetId), { credentials: "same-origin" })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => live && setPicture(b))
      .catch(() => live && setError(ATTACH_TEXT.picture));
    return () => {
      live = false;
    };
  }, [room.roomId, mapAssetId]);

  // The files: the project file, and maybe its .dd2vtt (read for its grid and level clues only).
  const [dd, setDd] = useState<File | null>(null);
  const [vtt, setVtt] = useState<VttMeta | undefined>(undefined);
  const takeFiles = async (files: File[]) => {
    let project: File | null = null;
    let meta: VttMeta | undefined;
    for (const f of files) {
      if (await isDungeondraftFile(f)) project = f;
      else if (isVttFile(f)) {
        try {
          meta = parseUniversalVtt(await f.text(), f.name).vtt;
        } catch {
          // Not a Universal VTT file after all: the project file alone is enough.
        }
      }
    }
    if (meta) setVtt(meta);
    if (project) {
      setDd(project);
      setLevelKey(undefined);
      setShift(undefined);
      setResult(null);
      setError(null);
      setMode("attach");
    } else if (!dd) {
      setError("That isn't a Dungeondraft project file (its name ends in .dungeondraft_map).");
    }
  };
  const started = useRef(false);
  if (props.files?.length && !started.current) {
    started.current = true;
    queueMicrotask(() => void takeFiles(props.files!));
  }

  // The GM's choices, each of which runs the worker again (it keeps its last answer, so Compare is quick).
  const [levelKey, setLevelKey] = useState<string | undefined>(undefined);
  const [shift, setShift] = useState<[number, number] | undefined>(undefined);
  const [compare, setCompare] = useState(false);
  const [view, setView] = useState<"overlay" | "picture" | "compare">("overlay");
  const [setGrid, setSetGrid] = useState(true);
  const [result, setResult] = useState<Prepared | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode !== "attach" || !dd || !picture) return;
    const ctl = new AbortController();
    setProgress("Reading the project file…");
    prepareAttach(dd, picture, picSize, {
      vtt,
      mapRect: s.mapRect,
      levelKey,
      shift,
      compare,
      onProgress: (text) => !ctl.signal.aborted && setProgress(text),
      signal: ctl.signal,
    })
      .then((res) => {
        if (ctl.signal.aborted) return;
        setResult(res);
        setError(null);
      })
      .catch((e) => {
        // Closing the dialog cancels the worker: nothing to say then.
        if (ctl.signal.aborted) return;
        setError(e instanceof AttachError ? e.message : ATTACH_TEXT.failed);
      })
      .finally(() => !ctl.signal.aborted && setProgress(null));
    return () => ctl.abort();
    // picSize comes from the asset, which doesn't change while the dialog is open.
  }, [mode, dd, picture, vtt, levelKey, shift, compare]);

  // Check mode: the attached data against the scene's picture (2.4), by the object-centre fit.
  const [checked, setChecked] = useState<FitResult | { error: string } | null>(null);
  useEffect(() => {
    if (mode !== "check" || !s.mapData || !picture) return;
    let live = true;
    setChecked(null);
    setProgress("Checking the fit…");
    void checkAttached(fileUrl(room.roomId, s.mapData.assetId), picture, picSize).then((fit) => {
      if (!live) return;
      setChecked(fit);
      setProgress(null);
    });
    return () => {
      live = false;
    };
  }, [mode, picture, s.mapData?.assetId]);

  // What the worker gave for the current choices (shown until a refusal replaces it).
  const prepared = result && !error ? result : null;
  const report = prepared?.report;
  const checks: Check[] = report ? attachChecks(report, { gridSize: s.grid.size }) : [];
  const gridCheck = report ? gridDiffers(report, s.grid.size) : false;

  const attach = async () => {
    if (!result || !report || saving) return;
    setSaving(true);
    try {
      const side = await uploadSidecar(room, result.sidecar, sidecarLabel(s.name, report));
      // This tab's own: the clean-up leaves them alone, so undo still works.
      touchedSidecars.add(side.id);
      if (s.mapData) touchedSidecars.add(s.mapData.assetId);
      const old = s.mapData;
      const md: SceneMapData = { assetId: side.id, forAssetId: mapAssetId };
      // The GM's own settings for this scene's seasons carry over to the new data.
      if (old?.bare) md.bare = old.bare;
      if (old?.drawn) md.drawn = old.drawn;
      if (old?.packs) md.packs = old.packs;
      const patch: Omit<ScenePatch, "id"> = { mapData: md };
      if (vtt) {
        const r = vtt.resolution;
        patch.mapRect = [r.map_origin.x, r.map_origin.y, r.map_size.x, r.map_size.y];
      }
      if (gridCheck && setGrid) {
        const size = Math.round(report.gridPxPerSquare * 1000) / 1000;
        // A .dd2vtt's origin is in squares; only its fraction of a square moves the grid lines (mapImport.ts).
        const frac = (v: number) => Math.round((((-v % 1) + 1) % 1) * size * 100) / 100;
        patch.grid = { ...s.grid, type: "square", size, offsetX: vtt ? frac(vtt.resolution.map_origin.x) : 0, offsetY: vtt ? frac(vtt.resolution.map_origin.y) : 0 };
      }
      room.changeScene(s.id, patch, {});
      room.toast(DD_UI.attached);
      void cleanUpSidecars(room, touchedSidecars).catch(() => undefined);
      props.onClose();
    } catch (e) {
      setError(`The Dungeondraft data couldn't be saved (${(e as Error).message}). Try again.`);
      setSaving(false);
    }
  };

  const remove = () => {
    if (!s.mapData) return;
    touchedSidecars.add(s.mapData.assetId);
    room.setMapData(s.id, null);
    room.toast(DD_UI.removed);
    props.onClose();
  };

  /** Check mode: the data starts being used with this picture (paused), or comes off hold. */
  const useData = () => {
    const md = s.mapData;
    if (!md) return;
    const next: SceneMapData = { assetId: md.assetId, forAssetId: mapAssetId };
    if (md.bare) next.bare = md.bare;
    if (md.drawn) next.drawn = md.drawn;
    if (md.packs) next.packs = md.packs;
    touchedSidecars.add(md.assetId);
    room.setMapData(s.id, next);
    room.toast(DD_UI.attached);
    props.onClose();
  };

  const pickFile = () => fileRef.current?.click();
  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      multiple
      hidden
      onChange={(e) => {
        const files = [...(e.currentTarget.files ?? [])];
        e.currentTarget.value = "";
        if (files.length) void takeFiles(files);
      }}
    />
  );

  if (mode === "check") {
    const md = s.mapData;
    const fit = checked && !("error" in checked) ? checked : null;
    const fitLine: Check | null = checked ? ("error" in checked ? { mark: "warn", text: checked.error } : fitCheck(checked)) : null;
    const anyway = fit?.verdict === "no" || (checked !== null && "error" in checked);
    return (
      <Modal title={dialogTitle(s.name)} onClose={props.onClose} width={520}>
        <p class="small">
          {dataState === "paused"
            ? "The map picture has changed since this Dungeondraft data was attached, so seasons guess from the picture. Checked against the picture the scene has now:"
            : dataState === "hold"
              ? "This Dungeondraft data was attached but isn't used yet: it didn't seem to line up with the picture, or which level the picture shows was unclear. Checked against the picture:"
              : "This scene's Dungeondraft data, checked against its picture:"}
        </p>
        {md && <p class="small muted">{dataAsset?.name ?? "Dungeondraft data"}</p>}
        <ul class="dd-checks">
          {fitLine ? <CheckLine check={fitLine} /> : <li class="muted">{progress ?? "Checking the fit…"}</li>}
        </ul>
        {dataState === "hold" && <p class="small muted">To use another level, attach the project file again and pick it.</p>}
        {error && <p class="dd-error" role="alert">{error}</p>}
        <div class="dialog-actions dd-actions">
          <button class="btn btn-sm" onClick={pickFile}>
            Attach another file…
          </button>
          {md && (
            <button class="btn btn-sm" onClick={remove}>
              Remove
            </button>
          )}
          <button class="btn" onClick={props.onClose}>
            {dataState === "paused" || dataState === "hold" ? "Cancel" : "Done"}
          </button>
          {md && (dataState === "paused" || dataState === "hold") && (
            <button class="btn btn-primary" disabled={checked === null} onClick={useData}>
              {dataState === "paused" ? (anyway ? "Use it with this picture anyway" : "Use it with this picture") : anyway ? "Use it anyway" : "Use it"}
            </button>
          )}
        </div>
        {fileInput}
      </Modal>
    );
  }

  const levels = report?.levels ?? [];
  const chosen = levelKey ?? report?.level;
  return (
    <Modal title={dialogTitle(s.name)} onClose={props.onClose} width={560}>
      <p class="small">{DD_UI.intro}</p>
      <div class="row dd-file">
        <button class="btn btn-sm" onClick={pickFile} disabled={saving}>
          {DD_UI.chooseFile}
        </button>
        <span class="small muted dd-file-name">
          {dd ? dd.name : "It also takes the .dd2vtt export, for its level and grid."}
          {dd && vtt ? " + its .dd2vtt" : ""}
        </span>
      </div>
      {error && <p class="dd-error" role="alert">{error}</p>}
      {progress && !error && <p class="small muted dd-progress" aria-live="polite">{progress}</p>}
      {prepared && report && (
        <>
          {levels.length > 1 && (
            <fieldset class="dd-levels">
              <legend class="small">{DD_UI.levelQuestion}</legend>
              {levels.map((l, i) => (
                <label key={l.key} class="check">
                  <input type="radio" name="dd-level" checked={chosen === l.key} disabled={saving} onChange={() => setLevelKey(l.key)} />
                  <strong>{l.label}</strong>
                  {i === 0 && <span class="small muted">{levelWhy(l.why)}</span>}
                </label>
              ))}
            </fieldset>
          )}
          <ul class="dd-checks">
            {checks.map((c, i) => (
              <CheckLine key={i} check={c}>
                {c.action === "shift" && report.fit.shiftSq && (
                  <button class="link-btn" disabled={saving} onClick={() => setShift(report.fit.shiftSq)}>
                    Line it up that way
                  </button>
                )}
                {c.action === "grid" && (
                  <label class="check">
                    <input type="checkbox" checked={setGrid} disabled={saving} onChange={(e) => setSetGrid(e.currentTarget.checked)} /> Set the grid from the map
                  </label>
                )}
              </CheckLine>
            ))}
          </ul>
          <div class="seg dd-views" role="group" aria-label="Preview">
            {(["overlay", "picture", "compare"] as const).map((v) => (
              <button
                key={v}
                class={cx("seg-btn wide", view === v && "active")}
                aria-pressed={view === v}
                onClick={() => {
                  setView(v);
                  if (v === "compare") setCompare(true);
                }}
              >
                {v === "overlay" ? "Overlay" : v === "picture" ? "Picture only" : "Compare"}
              </button>
            ))}
          </div>
          <div class="dd-preview">
            {view === "overlay" && <Bitmap image={prepared.preview} alt="The picture with the map's layers over it" />}
            {view === "picture" && <img src={fileUrl(room.roomId, mapAssetId)} alt="The map picture" />}
            {view === "compare" &&
              (prepared.compare ? (
                <div class="dd-compare">
                  {comparePanels(report).map((p) => (
                    <Bitmap key={p.which} image={prepared.compare![p.which]} alt={p.alt} />
                  ))}
                </div>
              ) : (
                <p class="small muted">{progress ?? "Making the comparison…"}</p>
              ))}
          </div>
          <p class="small muted dd-legend">
            {view === "compare" ? (report.drawn === "green" ? DD_UI.compareGreen : DD_UI.compareCaption) : view === "overlay" ? DD_UI.legend : "The picture as it is."}
          </p>
        </>
      )}
      <div class="dialog-actions">
        <button class="btn" onClick={props.onClose} disabled={saving}>
          Cancel
        </button>
        <button class="btn btn-primary" disabled={!report || !!error || saving || !!progress} onClick={() => void attach()}>
          {saving ? "Attaching…" : needsAnyway(checks) ? "Attach anyway" : "Attach"}
        </button>
      </div>
      {fileInput}
    </Modal>
  );
}

const MARKS: Record<Check["mark"], string> = { ok: "✓", warn: "⚠", ask: "?", info: "·" };

function CheckLine(props: { check: Check; children?: ComponentChildren }) {
  const c = props.check;
  return (
    <li class={cx("dd-check", `dd-${c.mark}`)}>
      <span class="dd-mark" aria-hidden="true">
        {MARKS[c.mark]}
      </span>
      <span>
        {c.text} {props.children}
      </span>
    </li>
  );
}

/** An ImageData drawn into a canvas that scales to the dialog's width. */
function Bitmap(props: { image: ImageData; alt: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = props.image.width;
    canvas.height = props.image.height;
    ctx.putImageData(props.image, 0, 0);
  }, [props.image]);
  return <canvas ref={ref} role="img" aria-label={props.alt} />;
}

// ---------------------------------------------------------------- a scene's sidecar, for the controls

/** Decoded sidecars by asset id (a tab keeps a few: the Season box and the editor read META and the object count). */
const sidecars = new Map<string, Promise<SeasonSidecar | null>>();
const SIDECARS_KEPT = 6;

function loadSidecar(roomId: string, assetId: string): Promise<SeasonSidecar | null> {
  let p = sidecars.get(assetId);
  if (p) return p;
  p = (async () => {
    try {
      if (!canUnpack()) return null;
      const res = await fetch(fileUrl(roomId, assetId), { credentials: "same-origin" });
      if (!res.ok) return null;
      return decodeSidecar(await unpackPng(await res.blob()));
    } catch {
      return null;
    }
  })();
  sidecars.set(assetId, p);
  void p.then((sc) => {
    // A failure isn't kept: the next look tries again.
    if (!sc) sidecars.delete(assetId);
  });
  while (sidecars.size > SIDECARS_KEPT) {
    const oldest = sidecars.keys().next().value;
    if (oldest === undefined) break;
    sidecars.delete(oldest);
  }
  return p;
}

/**
 * A scene's Dungeondraft sidecar, fetched and decoded once per tab, for what the Season controls
 * and the scene editor's row show (whether it has bare trees or pack items, how many things).
 * undefined while loading or with no data; null when it couldn't be read.
 */
export function useSidecar(roomId: string, assetId: string | undefined): SeasonSidecar | null | undefined {
  const [sc, setSc] = useState<SeasonSidecar | null | undefined>(undefined);
  useEffect(() => {
    setSc(undefined);
    if (!assetId) return;
    let live = true;
    void loadSidecar(roomId, assetId).then((v) => live && setSc(v));
    return () => {
      live = false;
    };
  }, [roomId, assetId]);
  return assetId ? sc : undefined;
}
