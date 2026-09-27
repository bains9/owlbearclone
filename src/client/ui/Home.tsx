import { useEffect, useState } from "preact/hooks";
import { Copy, LogOut, Plus, Trash } from "lucide-preact";
import type { RoomSummary } from "../../shared/types";
import { api, roomUrl } from "../api";
import { ConfirmDialog, copyText, timeAgo } from "./common";
import { Logo } from "./Logo";

export function Home() {
  const [me, setMe] = useState<{ gm: boolean; configured: boolean; google: boolean } | null>(null);
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
  return <Welcome configured={me.configured} google={me.google} onSignedIn={() => setMe({ ...me, gm: true })} />;
}

/** Why Google sign-in sent someone back here without signing them in. */
const SIGNIN_PROBLEMS: Record<string, string> = {
  denied: "That Google account isn't one of this table's GMs. Try again and pick the account the GM uses.",
  cancelled: "Google sign-in was cancelled.",
  expired: "That sign-in took too long, or was started in another tab. Try again.",
  unverified: "That Google account's email address isn't verified with Google.",
  failed: "Google sign-in didn't work. Try again in a moment.",
  off: "Google sign-in isn't set up on this server.",
};

/** A sign-in problem passed back in the address, read once and then tidied out of it. */
function takeSigninProblem(): string | null {
  const params = new URLSearchParams(location.search);
  const reason = params.get("signin");
  if (!reason) return null;
  params.delete("signin");
  const rest = params.toString();
  history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + location.hash);
  return SIGNIN_PROBLEMS[reason] ?? SIGNIN_PROBLEMS.failed;
}

function roomIdFrom(text: string): string | null {
  const t = text.trim();
  const m = t.match(/\/r\/([A-Za-z0-9]{12})(?![A-Za-z0-9])/) ?? t.match(/^([A-Za-z0-9]{12})$/);
  return m ? m[1] : null;
}

function Welcome(props: { configured: boolean; google: boolean; onSignedIn: () => void }) {
  const [link, setLink] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => takeSigninProblem());
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
          {!props.configured && !props.google && (
            <p class="error-text small">GM sign-in hasn't been set up on the server yet.</p>
          )}
          {props.google && (
            <a class="btn full google-btn" href="/api/auth/google">
              <GoogleMark /> Sign in with Google
            </a>
          )}
          {props.google && props.configured && <p class="muted small or-line">or with the GM password</p>}
          {props.configured && (
            <div class="row">
              <input
                type="password"
                value={password}
                placeholder="GM password"
                autoComplete="current-password"
                onInput={(e) => setPassword(e.currentTarget.value)}
                aria-label="GM password"
              />
              <button class="btn btn-primary" disabled={busy || !password}>
                Sign in
              </button>
            </div>
          )}
          {error && <p class="error-text small">{error}</p>}
        </form>
      </div>
    </div>
  );
}

/** Google's "G", in its colours, for the sign-in button. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
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
