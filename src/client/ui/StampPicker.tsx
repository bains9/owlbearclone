// The Build tool's object picker: the chosen object and the last few picked stay on the bar;
// everything else (Tabletop's sixteen and Dungeon's 135, in folding groups, with a search)
// opens from the chosen object, so the bar is no wider than it was with sixteen.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { ChevronDown, ChevronRight, Search } from "lucide-preact";
import { stampName, type StampId } from "../../shared/terrain";
import { drawStamp } from "../room/buildArt";
import { OBJECT_COUNT, OBJECT_GROUPS, groupOf, searchObjects } from "./objectGroups";

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

function ObjectButton(props: { id: StampId; active: boolean; onPick: (id: StampId) => void }) {
  const name = stampName(props.id);
  return (
    <button class={`stamp-btn${props.active ? " active" : ""}`} title={name} aria-label={name} aria-pressed={props.active} onClick={() => props.onPick(props.id)}>
      <StampIcon id={props.id} />
    </button>
  );
}

export function StampPicker(props: { value: StampId; placing: boolean; recent: StampId[]; onPick: (id: StampId) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState(() => groupOf(props.value));
  /** Pixels the popover moves left so its right edge stays on screen (the picker sits far right). */
  const [shift, setShift] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const found = useMemo(() => searchObjects(query), [query]);

  useLayoutEffect(() => {
    if (!open || !root.current || !pop.current) return;
    const left = root.current.getBoundingClientRect().left;
    const width = pop.current.getBoundingClientRect().width;
    setShift(Math.max(0, left + width - (window.innerWidth - 8)));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setGroup(groupOf(props.value));
    search.current?.focus();
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);

  const pick = (id: StampId) => {
    props.onPick(id);
    setOpen(false);
    setQuery("");
  };
  const active = (id: StampId) => props.placing && props.value === id;
  const recent = props.recent.filter((id) => id !== props.value);

  return (
    <div class="stamp-picker" ref={root}>
      <button
        class={`stamp-current${props.placing ? " active" : ""}${open ? " open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${stampName(props.value)}: choose from all ${OBJECT_COUNT} objects`}
        onClick={() => setOpen(!open)}
      >
        <StampIcon id={props.value} />
        <span class="stamp-current-name">{stampName(props.value)}</span>
        <ChevronDown size={14} />
      </button>
      {recent.length > 0 && (
        <div class="stamp-recent" role="group" aria-label="Recent objects">
          {recent.map((id) => (
            <ObjectButton key={id} id={id} active={active(id)} onPick={pick} />
          ))}
        </div>
      )}
      {open && (
        <div class="stamp-popover" role="dialog" aria-label="Objects" ref={pop} style={{ left: `${-shift}px` }}>
          <label class="stamp-search">
            <Search size={14} />
            <input
              ref={search}
              type="search"
              placeholder={`Search ${OBJECT_COUNT} objects`}
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && found.length) pick(found[0]);
              }}
            />
          </label>
          {query.trim() ? (
            found.length ? (
              <div class="stamp-grid" role="group" aria-label="Objects found">
                {found.map((id) => (
                  <ObjectButton key={id} id={id} active={active(id)} onPick={pick} />
                ))}
              </div>
            ) : (
              <p class="stamp-none">No object is called that.</p>
            )
          ) : (
            OBJECT_GROUPS.map((g) => {
              const isOpen = g.name === group;
              return (
                <section key={g.name} class="stamp-group">
                  <button class="stamp-group-head" aria-expanded={isOpen} onClick={() => setGroup(isOpen ? "" : g.name)}>
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span>{g.name}</span>
                    <span class="stamp-group-count">{g.ids.length}</span>
                  </button>
                  {isOpen && (
                    <div class="stamp-grid" role="group" aria-label={g.name}>
                      {g.ids.map((id) => (
                        <ObjectButton key={id} id={id} active={active(id)} onPick={pick} />
                      ))}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
