// The GM's own monsters or NPCs, at the top of those tabs in Tokens & images (shared/library.ts):
// the pictures they uploaded there, or filed there from Tokens, for every room. A click places one
// in the middle of the view, or drag it onto the map; under each, rename it, move it to the other
// tab, or take it out of the library.
import { useState } from "preact/hooks";
import { ArrowLeftRight, Pencil, Trash } from "lucide-preact";
import { SHELVES, libraryFileUrl, shelfName, type LibraryEntry, type Shelf } from "../../shared/library";
import { LIBRARY_DRAG_TYPE, filterEntries, libraryDragData, placeFromLibrary, removeEntry, renameEntry, shelveEntry } from "../library";
import { loadAddHidden } from "../monsters/place";
import { ConfirmDialog, PromptDialog, cx, useRoom, useRoomState } from "./common";

export function LibraryShelf(props: { shelf: Shelf }) {
  const room = useRoom();
  const library = useRoomState((s) => s.library);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<LibraryEntry | null>(null);
  const [removing, setRemoving] = useState<LibraryEntry | null>(null);
  const { shelf } = props;
  const label = shelf === "monster" ? "Your monsters" : "Your NPCs";
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      room.toast((err as Error).message, "error");
    }
  };
  if (!library) return <p class="small muted shelf-empty">Reading your {shelf === "monster" ? "monsters" : "NPCs"}…</p>;
  const all = library.filter((e) => e.shelf === shelf);
  const shown = filterEntries(all, query);
  const other = SHELVES.find((s) => s !== shelf)!;
  return (
    <div class="shelf">
      <h4 class="shelf-head">
        {label} <span class="muted small">({all.length}, every room)</span>
      </h4>
      {all.length === 0 ? (
        <p class="small muted shelf-empty">
          None yet. Click <strong>Upload</strong> to add pictures here, or move uploads from <strong>Tokens</strong> (<strong>Select</strong>, then{" "}
          <strong>Move to {shelfName(shelf)}</strong>).
        </p>
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
                    ev.dataTransfer?.setData(LIBRARY_DRAG_TYPE, libraryDragData(e.id, loadAddHidden()));
                    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => {
                    setBusy(e.id);
                    void placeFromLibrary(room, e.id).finally(() => setBusy(null));
                  }}
                >
                  <img src={libraryFileUrl(e.id)} alt={e.name} loading="lazy" draggable={false} />
                  <span class="asset-name">{e.name}</span>
                </button>
                <div class="asset-actions">
                  <button class="icon-btn" title="Rename" aria-label={`Rename ${e.name}`} onClick={() => setRenaming(e)}>
                    <Pencil size={14} />
                  </button>
                  <button class="icon-btn" title={`Move to ${shelfName(other)}`} aria-label={`Move ${e.name} to ${shelfName(other)}`} onClick={() => void act(() => shelveEntry(room, e, other))}>
                    <ArrowLeftRight size={14} />
                  </button>
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
      <h4 class="shelf-head">Built in</h4>
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
          title={`Take it out of ${shelfName(shelf)}?`}
          message={
            <>
              <strong>{removing.name}</strong> leaves {shelfName(shelf)} in every room. Tokens of it already on maps stay, and a room that has used it keeps
              its picture in Tokens.
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
