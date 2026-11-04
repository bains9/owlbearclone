import { useEffect, useRef, useState } from "preact/hooks";
import { Check, Compass, FolderInput, Pencil, Trash, Upload } from "lucide-preact";
import { isFiled, shelfName, type Shelf } from "../../shared/library";
import type { Asset } from "../../shared/types";
import { fileUrl } from "../api";
import { fileInLibrary, loadLibrary, uploadToLibrary } from "../library";
import { cleanUpSidecars } from "../dd/attach";
import { PLAYER_COLORS } from "../identity";
import { touchedSidecars } from "../importScenes";
import { ConfirmDialog, PromptDialog, cx, useRoom, useRoomState } from "./common";
import { LibraryShelf } from "./LibraryShelf";
import { MonstersSection } from "./MonstersSection";
import { NpcsSection } from "./NpcsSection";
import { PartySection } from "./PartySection";

export function LibraryPanel() {
  const room = useRoom();
  const assets = useRoomState((s) => s.assets);
  const gm = useRoomState((s) => s.me?.role === "gm");
  // Opening the Library is when Dungeondraft data no scene uses any more goes (design 2.8), apart from this tab's own.
  useEffect(() => {
    if (gm) void cleanUpSidecars(room, touchedSidecars).catch(() => undefined);
  }, [gm, room]);
  const canAdd = useRoomState((s) => s.me?.role === "gm" || Boolean(s.room?.settings.playersCanAddTokens));
  const uploading = useRoomState((s) => s.uploading);
  const items = useRoomState((s) => s.items);
  const scenes = useRoomState((s) => s.scenes);
  // The GM's own monsters and NPCs, for every room (library.ts): read when the panel opens.
  const library = useRoomState((s) => s.library);
  useEffect(() => {
    if (gm && room.state.library === null) void loadLibrary(room).catch(() => undefined);
  }, [gm, room]);
  // The GM's Monsters and NPCs tabs list their own pictures, then ready-made tokens.
  const [tab, setTab] = useState<"map" | "token" | "monsters" | "npcs">("token");
  const readyMade = tab === "monsters" || tab === "npcs";
  const shelf: Shelf | null = tab === "monsters" ? "monster" : tab === "npcs" ? "npc" : null;
  // GM, in Tokens: the pictures picked to move to Monsters or NPCs together (null: not picking).
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const showTab = (t: typeof tab) => {
    setTab(t);
    setPicked(null);
  };
  const move = (ids: string[], to: Shelf) => {
    setPicked(null);
    void fileInLibrary(room, ids, to);
  };
  const [label, setLabel] = useState("");
  const [renaming, setRenaming] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState<Asset | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Tokens leaves out the pictures filed under Monsters or NPCs.
  const list = Object.values(assets)
    .filter((a) => a.kind === tab && !(tab === "token" && isFiled(a, library)))
    .sort((a, b) => b.createdAt - a.createdAt);

  const usage = (a: Asset) => {
    const tokens = Object.values(items).filter((i) => i.kind === "token" && i.assetId === a.id).length;
    const maps = Object.values(scenes).filter((s) => s.mapAssetId === a.id).length;
    return { tokens, maps };
  };

  if (!canAdd) {
    return (
      <div class="panel-body">
        <p class="muted">The GM has turned off adding tokens for players.</p>
      </div>
    );
  }

  return (
    <div class="panel-body">
      {/* The party first: their own tokens, for the GM and players alike. */}
      <PartySection />
      <h3>Quick token</h3>
      <div class="row">
        <input
          value={label}
          maxLength={60}
          placeholder="Name (optional)"
          onInput={(e) => setLabel(e.currentTarget.value)}
          aria-label="New token name"
        />
      </div>
      <div class="quick-tokens">
        {PLAYER_COLORS.map((c) => (
          <button
            key={c}
            class="quick-token"
            style={{ background: c }}
            title="Add this token to the middle of the view"
            aria-label={`Add a ${c} token`}
            onClick={() => {
              room.addToken({ color: c, label: label.trim() });
              setLabel("");
            }}
          />
        ))}
      </div>
      {gm && (
        <div class="row map-aids">
          <button
            class="btn btn-sm"
            title="Add a compass rose to the middle of the view, then turn it so N points to the map's north"
            onClick={() => {
              // On a phone the panel covers the board, and the compass and its bar with it.
              if (room.addCompass() && window.matchMedia("(max-width: 760px)").matches) room.setPanel(null);
            }}
          >
            <Compass size={14} /> Compass
          </button>
          <span class="small muted">On the map for everyone. Turn it so N points north.</span>
        </div>
      )}

      <div class="library-head">
        {gm ? (
          <div class="seg">
            <button class={cx("seg-btn wide", tab === "token" && "active")} onClick={() => showTab("token")}>
              Tokens
            </button>
            <button class={cx("seg-btn wide", tab === "monsters" && "active")} onClick={() => showTab("monsters")}>
              Monsters
            </button>
            <button class={cx("seg-btn wide", tab === "npcs" && "active")} onClick={() => showTab("npcs")}>
              NPCs
            </button>
            <button class={cx("seg-btn wide", tab === "map" && "active")} onClick={() => showTab("map")}>
              Maps
            </button>
          </div>
        ) : (
          <h3>Your images</h3>
        )}
        <span class="library-buttons">
          {gm && tab === "token" && list.length > 0 && (
            <button
              class={cx("btn btn-sm", picked && "active")}
              title="Pick pictures to move to Monsters or NPCs, for every room"
              onClick={() => setPicked(picked ? null : new Set())}
            >
              <Check size={14} /> {picked ? "Done" : "Select"}
            </button>
          )}
          <button
            class="btn btn-sm"
            title={shelf ? `Upload pictures straight into ${shelfName(shelf)}, for every room` : undefined}
            onClick={() => fileRef.current?.click()}
            disabled={uploading > 0}
          >
            <Upload size={14} /> {uploading ? `Uploading ${uploading}…` : "Upload"}
          </button>
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.currentTarget.files ?? [])];
            e.currentTarget.value = "";
            if (!files.length) return;
            if (shelf) void uploadToLibrary(room, files, shelf);
            else if (!readyMade) void room.upload(files, tab);
          }}
        />
      </div>
      {tab === "token" && (
        <p class="small muted">Click an image to place it, or drag it onto the map. You can also drop image files on the map.</p>
      )}
      {tab === "map" && <p class="small muted">Use maps from the Scenes panel.</p>}

      {picked && (
        <div class="pick-bar" role="group" aria-label="Move the picked pictures">
          <span class="small">{picked.size} picked</span>
          <button class="btn btn-sm" onClick={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map((a) => a.id)))}>
            {picked.size === list.length ? "Pick none" : "Pick all"}
          </button>
          <button class="btn btn-sm btn-primary" disabled={!picked.size} onClick={() => move([...picked], "monster")}>
            Move to Monsters
          </button>
          <button class="btn btn-sm btn-primary" disabled={!picked.size} onClick={() => move([...picked], "npc")}>
            Move to NPCs
          </button>
        </div>
      )}
      {tab === "monsters" ? (
        <>
          <LibraryShelf shelf="monster" />
          <MonstersSection />
        </>
      ) : tab === "npcs" ? (
        <>
          <LibraryShelf shelf="npc" />
          <NpcsSection />
        </>
      ) : list.length === 0 ? (
        <p class="muted small">Nothing uploaded yet.</p>
      ) : (
        <div class="asset-grid">
          {list.map((a) => (
            <div key={a.id} class="asset-wrap">
              <button
                class={cx("asset", picked?.has(a.id) && "picked")}
                title={picked ? `${a.name}: click to pick` : tab === "token" ? `${a.name}: click to place` : a.name}
                aria-pressed={picked ? picked.has(a.id) : undefined}
                draggable={tab === "token" && !picked}
                onDragStart={(e) => {
                  e.dataTransfer?.setData("application/x-tabletop-asset", a.id);
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => {
                  if (picked) {
                    const next = new Set(picked);
                    if (!next.delete(a.id)) next.add(a.id);
                    setPicked(next);
                  } else if (tab === "token") room.addToken({ assetId: a.id, label: label.trim() });
                }}
              >
                <img src={fileUrl(room.roomId, a.id)} alt={a.name} loading="lazy" draggable={false} />
                <span class="asset-name">{a.name}</span>
              </button>
              {picked?.has(a.id) && (
                <span class="pick-mark" aria-hidden="true">
                  <Check size={14} />
                </span>
              )}
              <div class="asset-actions">
                {gm && tab === "token" && !picked && (
                  // Moving one: a native list over the button, as the Party's figure picker.
                  <span class="icon-btn party-figure" title="Move to Monsters or NPCs, for every room">
                    <FolderInput size={14} />
                    <select
                      aria-label={`Move ${a.name} to Monsters or NPCs`}
                      value=""
                      onChange={(e) => {
                        const to = e.currentTarget.value;
                        e.currentTarget.value = "";
                        if (to === "monster" || to === "npc") move([a.id], to);
                      }}
                    >
                      <option value="">Move to…</option>
                      <option value="monster">Monsters (every room)</option>
                      <option value="npc">NPCs (every room)</option>
                    </select>
                  </span>
                )}
                <button class="icon-btn" title="Rename" aria-label="Rename" onClick={() => setRenaming(a)}>
                  <Pencil size={14} />
                </button>
                <button class="icon-btn danger" title="Delete" aria-label="Delete" onClick={() => setDeleting(a)}>
                  <Trash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {renaming && (
        <PromptDialog
          title="Rename image"
          label="Name"
          initial={renaming.name}
          confirmLabel="Rename"
          onConfirm={(name) => room.renameAsset(renaming.id, name)}
          onClose={() => setRenaming(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete image?"
          message={(() => {
            const u = usage(deleting);
            const uses = [
              u.tokens ? `${u.tokens} token${u.tokens === 1 ? "" : "s"}` : "",
              u.maps ? `${u.maps} scene${u.maps === 1 ? "" : "s"}` : "",
            ].filter(Boolean);
            return (
              <>
                <strong>{deleting.name}</strong> will be deleted for good.
                {uses.length > 0 && ` It's in use by ${uses.join(" and ")}, which will show a blank instead.`}
              </>
            );
          })()}
          confirmLabel="Delete"
          danger
          onConfirm={() => room.deleteAsset(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
