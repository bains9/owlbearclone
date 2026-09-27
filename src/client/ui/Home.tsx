import { useEffect, useState } from "preact/hooks";
import { Copy, LogOut, Plus, Trash } from "lucide-preact";
import type { RoomSummary } from "../../shared/types";
import { api, roomUrl } from "../api";
import { ConfirmDialog, copyText, timeAgo } from "./common";
import { Logo } from "./Logo";

export function Home() {
  const [me, setMe] = useState<{ gm: boolean; configured: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.title = "Tabletop";
    api
      .me()
      .then(setMe)
      .catch((e: Error) => setError(e.message));
  }, []);
  if (error) {
    return (
      <div class="center-page">
        <div class="card">
          <p class="error-text">{error}</p>
          <button class="btn" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!me) return <div class="center-page muted">Loading…</div>;
  if (me.gm) return <GmHome onSignedOut={() => setMe({ ...me, gm: false })} />;
  return <Welcome configured={me.configured} onSignedIn={() => setMe({ ...me, gm: true })} />;
}

function roomIdFrom(text: string): string | null {
  const t = text.trim();
  const m = t.match(/\/r\/([A-Za-z0-9]{1,64})/) ?? t.match(/^([A-Za-z0-9]{6,64})$/);
  return m ? m[1] : null;
}

function Welcome(props: { configured: boolean; onSignedIn: () => void }) {
  const [link, setLink] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roomId = roomIdFrom(link);

  const login = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      props.onSignedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="center-page">
      <div class="home">
        <div class="home-brand">
          <Logo size={44} />
          <div>
            <h1>Tabletop</h1>
            <p class="muted">A private virtual tabletop.</p>
          </div>
        </div>

        <form
          class="card"
          onSubmit={(e) => {
            e.preventDefault();
            if (roomId) location.href = `/r/${roomId}`;
          }}
        >
          <h2>Join a game</h2>
          <p class="muted small">Paste the room link your GM sent you.</p>
          <div class="row">
            <input
              value={link}
              placeholder="https://…/r/…"
              onInput={(e) => setLink(e.currentTarget.value)}
              aria-label="Room link"
            />
            <button class="btn btn-primary" disabled={!roomId}>
              Join
            </button>
          </div>
        </form>

        <form class="card" onSubmit={login}>
          <h2>GM sign in</h2>
          {!props.configured && (
            <p class="error-text small">The GM password hasn't been set on the server yet.</p>
          )}
          <div class="row">
            <input
              type="password"
              value={password}
              placeholder="GM password"
              autoComplete="current-password"
              onInput={(e) => setPassword(e.currentTarget.value)}
              aria-label="GM password"
            />
            <button class="btn btn-primary" disabled={busy || !password || !props.configured}>
              Sign in
            </button>
          </div>
          {error && <p class="error-text small">{error}</p>}
        </form>
      </div>
    </div>
  );
}

function GmHome(props: { onSignedOut: () => void }) {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<RoomSummary | null>(null);

  const load = () =>
    api
      .listRooms()
      .then(setRooms)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
  }, []);

  const create = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const room = await api.createRoom(name.trim() || "New room");
      location.href = `/r/${room.id}`;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div class="center-page">
      <div class="home home-wide">
        <div class="home-brand">
          <Logo size={40} />
          <div class="grow">
            <h1>Your rooms</h1>
            <p class="muted">Signed in as the GM.</p>
          </div>
          <button
            class="btn"
            onClick={async () => {
              await api.logout().catch(() => undefined);
              props.onSignedOut();
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>

        <form class="card" onSubmit={create}>
          <h2>New room</h2>
          <div class="row">
            <input
              value={name}
              maxLength={60}
              placeholder="Room name, e.g. Curse of Strahd"
              onInput={(e) => setName(e.currentTarget.value)}
              aria-label="Room name"
            />
            <button class="btn btn-primary" disabled={busy}>
              <Plus size={16} /> Create
            </button>
          </div>
          {error && <p class="error-text small">{error}</p>}
        </form>

        <div class="card">
          {rooms === null ? (
            <p class="muted">Loading…</p>
          ) : rooms.length === 0 ? (
            <p class="muted">No rooms yet. Create one above.</p>
          ) : (
            <ul class="room-list">
              {rooms.map((r) => (
                <li key={r.id}>
                  <a class="room-link" href={`/r/${r.id}`}>
                    <span class="room-link-name">{r.name}</span>
                    <span class="muted small">Last opened {timeAgo(r.lastUsed)}</span>
                  </a>
                  <button
                    class="icon-btn"
                    title="Copy invite link"
                    aria-label="Copy invite link"
                    onClick={async () => {
                      if (await copyText(roomUrl(r.id))) {
                        setCopied(r.id);
                        setTimeout(() => setCopied(null), 1500);
                      }
                    }}
                  >
                    {copied === r.id ? <span class="small">Copied</span> : <Copy size={16} />}
                  </button>
                  <button class="icon-btn danger" title="Delete room" aria-label="Delete room" onClick={() => setDeleting(r)}>
                    <Trash size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {deleting && (
        <ConfirmDialog
          title="Delete room?"
          message={
            <>
              <strong>{deleting.name}</strong> and everything in it (scenes, tokens, uploaded images, chat) will be
              deleted for good. Anyone still in the room is disconnected.
            </>
          }
          confirmLabel="Delete room"
          danger
          onConfirm={async () => {
            try {
              await api.deleteRoom(deleting.id);
            } catch (err) {
              setError((err as Error).message);
            }
            await load();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
