// The GM's own monsters, NPCs or tokens, at the top of those tabs in Tokens & images
// (shared/library.ts): the pictures they uploaded there, or filed there from a room's own list, for
// every room. A click places one in the middle of the view, or drag it onto the map; under each,
// rename it, move it to another tab, or take it out of the library.
import { useState } from "preact/hooks";
import { FolderInput, Pencil, Trash } from "lucide-preact";
import { SHELVES, isShelf, libraryFileUrl, shelfLabel, shelfName, type LibraryEntry, type Shelf } from "../../shared/library";
import { LIBRARY_DRAG_TYPE, filterEntries, libraryDragData, placeFromLibrary, removeEntry, renameEntry, shelveEntry } from "../library";
import { loadAddHidden } from "../monsters/place";
import { ConfirmDialog, PromptDialog, cx, useRoom, useRoomState } from "./common";

/** `label`: the Quick token box, for naming one of Your tokens as it's clicked (as a room's upload is). */
export function LibraryShelf(props: { shelf: Shelf; label?: string }) {
  const room = useRoom();
  const library = useRoomState((s) => s.library);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<LibraryEntry | null>(null);
  const [removing, setRemoving] = useState<LibraryEntry | null>(null);
  const { shelf } = props;
  const label = shelfLabel(shelf);
  const tokens = shelf === "token";
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      room.toast((err as Error).message, "error");
    }
  };
  if (!library) return <p class="small muted shelf-empty">Reading {label.toLowerCase()}…</p>;
  const all = library.filter((e) => e.shelf === shelf);
  const shown = filterEntries(all, query);
  const others = SHELVES.filter((s) => s !== shelf);
  return (
    <div class="shelf">
      <h4 class="shelf-head">
        {label} <span class="muted small">({all.length}, every room)</span>
      </h4>
      {all.length === 0 ? (
        tokens ? (
          <p class="small muted shelf-empty">
            None yet. Click <strong>Upload</strong>, or drop pictures on the map: they're kept here, for every room.
          </p>
        ) : (
          <p class="small muted shelf-empty">
            None yet. Click <strong>Upload</strong> to add pictures here, or move uploads from <strong>Tokens</strong> (<strong>Select</strong>, then{" "}
            <strong>Move to {shelfName(shelf)}</strong>).
          </p>
        )
      ) : (
        <>
          {all.length > 8 && (
            <input class="shelf-filter" value={query} placeholder={`Find in ${label.toLowerCase()}`} aria-label={`Find in ${label.toLowerCase()}`} onInput={(e) => setQuery(e.currentTarget.value)} />
          )}
          <div class="asset-grid">
            {shown.map((e) => (
              <div key={e.id} class="asset-wrap">
                <button
                  class={cx("asset", busy === e.id && "busy")}
                  title={`${e.name}: click to place, or drag onto the map`}
                  draggable
                  onDragStart={(ev) => {
                    // Your tokens are never hidden as they go on, as a room's uploads aren't.
                    ev.dataTransfer?.setData(LIBRARY_DRAG_TYPE, libraryDragData(e.id, !tokens && loadAddHidden()));
                    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => {
                    setBusy(e.id);
                    const placing = tokens ? placeFromLibrary(room, e.id, undefined, false, false, props.label ?? "") : placeFromLibrary(room, e.id);
                    void placing.finally(() => setBusy(null));
                  }}
                >
                  <img src={libraryFileUrl(e.id)} alt={e.name} loading="lazy" draggable={false} />
                  <span class="asset-name">{e.name}</span>
                </button>
                <div class="asset-actions">
                  <button class="icon-btn" title="Rename" aria-label={`Rename ${e.name}`} onClick={() => setRenaming(e)}>
                    <Pencil size={14} />
                  </button>
                  {/* Moving one: a native list over the button, as a room's own pictures have. */}
                  <span class="icon-btn party-figure" title={`Move to ${others.map(shelfName).join(" or ")}`}>
                    <FolderInput size={14} />
                    <select
                      aria-label={`Move ${e.name} to ${others.map(shelfName).join(" or ")}`}
                      value=""
                      onChange={(ev) => {
                        const to = ev.currentTarget.value;
                        ev.currentTarget.value = "";
                        if (isShelf(to) && to !== shelf) void act(() => shelveEntry(room, e, to));
                      }}
                    >
                      <option value="">Move to…</option>
                      {others.map((s) => (
                        <option key={s} value={s}>
                          {shelfName(s)}
                        </option>
                      ))}
                    </select>
                  </span>
                  <button class="icon-btn danger" title="Take out of the library" aria-label={`Take ${e.name} out of the library`} onClick={() => setRemoving(e)}>
                    <Trash size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {shown.length === 0 && <p class="small muted">None match.</p>}
        </>
      )}
      {!tokens && <h4 class="shelf-head">Built in</h4>}
      {renaming && (
        <PromptDialog
          title="Rename"
          label="Name"
          initial={renaming.name}
          confirmLabel="Rename"
          onConfirm={(name) => void act(() => renameEntry(room, renaming, name))}
          onClose={() => setRenaming(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Take it out of ${label.toLowerCase()}?`}
          message={
            <>
              <strong>{removing.name}</strong> leaves {label.toLowerCase()} in every room. Tokens of it already on maps stay, and a room that has used it keeps
              its picture in its own list.
            </>
          }
          confirmLabel="Take it out"
          danger
          onConfirm={() => void act(() => removeEntry(room, removing))}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
