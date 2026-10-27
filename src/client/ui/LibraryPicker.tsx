// The Build tool's pickers for objects and floors: the chosen item and the last few picked stay
// on the bar; everything else opens from the chosen item in a popover, in folding groups with
// a search, so the bar is no wider than it was with Tabletop's own sixteen objects.

import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { ChevronDown, ChevronRight, Search } from "lucide-preact";
import { MAX_FOUND, libraryCount, libraryGroupOf, libraryPartOf, searchLibrary, type LibraryGroup } from "./library";

export interface LibraryPickerProps<T extends string> {
  /** What it picks, for its labels: "objects", "floors". */
  noun: string;
  groups: readonly LibraryGroup<T>[];
  value: T;
  /** Whether the value is in use (placing objects, painting rather than erasing): it's marked on the bar. */
  active: boolean;
  recent: readonly T[];
  name: (id: T) => string;
  icon: (id: T) => ComponentChildren;
  /** The class each item's button has, beside "lib-btn" (objects sit on a light ground, floors fill theirs). */
  itemClass: string;
  onPick: (id: T) => void;
}

function Item<T extends string>(props: { id: T; active: boolean; name: string; icon: ComponentChildren; itemClass: string; onPick: (id: T) => void }) {
  return (
    <button
      class={`lib-btn ${props.itemClass}${props.active ? " active" : ""}`}
      title={props.name}
      aria-label={props.name}
      aria-pressed={props.active}
      onClick={() => props.onPick(props.id)}
    >
      {props.icon}
    </button>
  );
}

export function LibraryPicker<T extends string>(props: LibraryPickerProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState(() => libraryGroupOf(props.groups, props.value));
  // The open part of the open group, for a group that folds again (Dungeon's categories).
  const [part, setPart] = useState(() => libraryPartOf(props.groups, props.value));
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const count = libraryCount(props.groups);
  const found = useMemo(() => searchLibrary(props.groups, props.name, query), [props.groups, props.name, query]);

  // The popover is placed on screen from the button rather than hung under it, so the Build bar
  // (which scrolls sideways on phones, and so clips what hangs out of it) can't cut it off; and
  // moved left when the button is near the right edge. Set before it's first painted.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const p = pop.current;
      if (!root.current || !p) return;
      const at = root.current.getBoundingClientRect();
      p.style.top = `${at.bottom + 8}px`;
      p.style.left = `${Math.max(16, Math.min(at.left, window.innerWidth - p.getBoundingClientRect().width - 16))}px`;
    };
    place();
    // A turned phone, a resized window, or a keyboard that resizes the page.
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setGroup(libraryGroupOf(props.groups, props.value));
    setPart(libraryPartOf(props.groups, props.value));
    // Not on a touch screen, where the keyboard would come up over the groups.
    if (!window.matchMedia("(pointer: coarse)").matches) search.current?.focus();
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

  const pick = (id: T) => {
    props.onPick(id);
    setOpen(false);
    setQuery("");
  };
  const marked = (id: T) => props.active && props.value === id;
  const recent = props.recent.filter((id) => id !== props.value);
  const item = (id: T) => <Item key={id} id={id} active={marked(id)} name={props.name(id)} icon={props.icon(id)} itemClass={props.itemClass} onPick={pick} />;

  return (
    <div class="lib-picker" ref={root}>
      <button
        class={`lib-current ${props.itemClass}${props.active ? " active" : ""}${open ? " open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${props.name(props.value)}: choose from all ${count} ${props.noun}`}
        onClick={() => setOpen(!open)}
      >
        {props.icon(props.value)}
        <span class="lib-current-name">{props.name(props.value)}</span>
        <ChevronDown size={14} />
      </button>
      {recent.length > 0 && (
        <div class="lib-recent" role="group" aria-label={`Recent ${props.noun}`}>
          {recent.map(item)}
        </div>
      )}
      {open && (
        <div class="lib-popover" role="dialog" aria-label={props.noun[0].toUpperCase() + props.noun.slice(1)} ref={pop}>
          <label class="lib-search">
            <Search size={14} />
            <input
              ref={search}
              type="search"
              placeholder={`Search ${count} ${props.noun}`}
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && found.length) pick(found[0]);
              }}
            />
          </label>
          {query.trim() ? (
            found.length ? (
              <>
                {found.length > MAX_FOUND && (
                  <p class="lib-none">
                    The first {MAX_FOUND} of {found.length}: type more to narrow it.
                  </p>
                )}
                <div class="lib-grid" role="group" aria-label={`${props.noun} found`}>
                  {found.slice(0, MAX_FOUND).map(item)}
                </div>
              </>
            ) : (
              <p class="lib-none">Nothing is called that.</p>
            )
          ) : (
            props.groups.map((g) => {
              const isOpen = g.name === group;
              return (
                <section key={g.name} class="lib-group">
                  <button class="lib-group-head" aria-expanded={isOpen} onClick={() => setGroup(isOpen ? "" : g.name)}>
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span>{g.name}</span>
                    <span class="lib-group-count">{g.ids.length}</span>
                  </button>
                  {isOpen &&
                    (g.parts ? (
                      g.parts.map((p) => {
                        const partOpen = p.name === part;
                        return (
                          <section key={p.name} class="lib-part">
                            <button class="lib-group-head lib-part-head" aria-expanded={partOpen} onClick={() => setPart(partOpen ? "" : p.name)}>
                              {partOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              <span>{p.name}</span>
                              <span class="lib-group-count">{p.ids.length}</span>
                            </button>
                            {partOpen && (
                              <div class="lib-grid" role="group" aria-label={`${g.name}: ${p.name}`}>
                                {p.ids.map(item)}
                              </div>
                            )}
                          </section>
                        );
                      })
                    ) : (
                      <div class="lib-grid" role="group" aria-label={g.name}>
                        {g.ids.map(item)}
                      </div>
                    ))}
                </section>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
