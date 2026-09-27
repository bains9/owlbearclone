import { useRef, useState } from "preact/hooks";
import { Pencil, Trash, Upload } from "lucide-preact";
import type { Asset, AssetKind } from "../../shared/types";
import { fileUrl } from "../api";
import { PLAYER_COLORS } from "../identity";
import { ConfirmDialog, PromptDialog, cx, useRoom, useRoomState } from "./common";

export function LibraryPanel() {
  const room = useRoom();
  const assets = useRoomState((s) => s.assets);
  const gm = useRoomState((s) => s.me?.role === "gm");
  const canAdd = useRoomState((s) => s.me?.role === "gm" || Boolean(s.room?.settings.playersCanAddTokens));
  const uploading = useRoomState((s) => s.uploading);
  const items = useRoomState((s) => s.items);
  const scenes = useRoomState((s) => s.scenes);
  const [tab, setTab] = useState<AssetKind>("token");
  const [label, setLabel] = useState("");
  const [renaming, setRenaming] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState<Asset | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const list = Object.values(assets)
    .filter((a) => a.kind === tab)
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

      <div class="library-head">
        {gm ? (
          <div class="seg">
            <button class={cx("seg-btn wide", tab === "token" && "active")} onClick={() => setTab("token")}>
              Tokens
            </button>
            <button class={cx("seg-btn wide", tab === "map" && "active")} onClick={() => setTab("map")}>
              Maps
            </button>
          </div>
        ) : (
          <h3>Your images</h3>
        )}
        <button class="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading > 0}>
          <Upload size={14} /> {uploading ? `Uploading ${uploading}…` : "Upload"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.currentTarget.files ?? [])];
            e.currentTarget.value = "";
            if (files.length) void room.upload(files, tab);
          }}
        />
      </div>
      {tab === "token" && (
        <p class="small muted">Click an image to place it, or drag it onto the map. You can also drop image files on the map.</p>
      )}
      {tab === "map" && <p class="small muted">Use maps from the Scenes panel.</p>}

      {list.length === 0 ? (
        <p class="muted small">Nothing uploaded yet.</p>
      ) : (
        <div class="asset-grid">
          {list.map((a) => (
            <div key={a.id} class="asset-wrap">
              <button
                class="asset"
                title={tab === "token" ? `${a.name}: click to place` : a.name}
                draggable={tab === "token"}
                onDragStart={(e) => {
                  e.dataTransfer?.setData("application/x-tabletop-asset", a.id);
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => {
                  if (tab === "token") room.addToken({ assetId: a.id, label: label.trim() });
                }}
              >
                <img src={fileUrl(room.roomId, a.id)} alt={a.name} loading="lazy" draggable={false} />
                <span class="asset-name">{a.name}</span>
              </button>
              <div class="asset-actions">
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
