// The party at the top of Tokens & images, for the GM and players alike: each character from their
// sheet (party.ts), in the token they'll have on the map, to place with a click. The GM can choose
// a character's figure (their class's, or any other), or give them a picture of their own instead,
// for every room. Who plays whom is picked here too, by the player (I play them) or the GM, for
// every room: per-player sight sees through it.

import { useEffect, useRef, useState } from "preact/hooks";
import { ImagePlus, PersonStanding, Sunrise, Undo2, UserRound, UserRoundCheck } from "lucide-preact";
import { SCRIPT_VERSION, type Character, type CharacterPlayer } from "../../shared/characters";
import { classFigureOf, figureOf } from "../npcs/pcTokens";
import { PC_FIGURE_CHOICES } from "../npcs/table";
import {
  NEW_DAY_UNDO_MS,
  characterPictureUrl,
  clearCharacterPicture,
  drawCharacter,
  newPartyDay,
  placeCharacter,
  setCharacterFigure,
  setCharacterPicture,
  setCharacterPlayer,
  undoNewDay,
} from "../party";
import { cx, useRoom, useRoomState } from "./common";

/** A character's token, small: their picture, or their figure drawn. */
function Preview(props: { c: Character }) {
  const room = useRoom();
  const ref = useRef<HTMLCanvasElement>(null);
  const { c } = props;
  useEffect(() => {
    if (c.picture || !ref.current) return;
    void drawCharacter(ref.current, c, Math.ceil(56 * (window.devicePixelRatio || 1))).catch(() => undefined);
  }, [c.id, c.race, c.culture, c.cls, c.cls2, c.subclass, c.picture, c.figure]);
  return c.picture ? (
    <img class="party-preview" src={characterPictureUrl(room.roomId, c)} alt="" />
  ) : (
    <canvas ref={ref} class="party-preview" aria-hidden="true" />
  );
}

/**
 * GM: who plays a character, a player at the table or nobody (a native list over the button, like
 * the figure's). It shows the first of the browsers playing them; picking a player adds theirs.
 */
function PlayedBy(props: { c: Character; busy: boolean; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const room = useRoom();
  const { c, busy, act } = props;
  const here = useRoomState((s) => s.players);
  const players = c.players ?? [];
  const choices: CharacterPlayer[] = [];
  for (const p of [...players, ...here.filter((h) => h.role !== "gm" && !h.display)]) {
    if (!choices.some((x) => x.userId === p.userId)) choices.push({ userId: p.userId, name: p.name });
  }
  const names = players.map((p) => p.name).join(", ");
  return (
    <span class={cx("icon-btn party-figure", players.length > 0 && "active")} title={names ? `Played by ${names} (every room)` : "Who plays them: nobody yet"}>
      <UserRound size={16} />
      <select
        aria-label={`Who plays ${c.name}`}
        disabled={busy}
        value={players[0]?.userId ?? ""}
        onChange={(e) => {
          const pick = choices.find((p) => p.userId === e.currentTarget.value) ?? null;
          void act(() => setCharacterPlayer(room, c, !!pick, pick));
        }}
      >
        <option value="">Nobody</option>
        {choices.map((p) => (
          <option key={p.userId} value={p.userId}>
            {p.name}
          </option>
        ))}
      </select>
    </span>
  );
}

function PartyRow(props: { c: Character; gm: boolean }) {
  const room = useRoom();
  const { c, gm } = props;
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      room.toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const who = [c.player, c.summary || [c.race, c.cls].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  const classFigure = classFigureOf(c);
  const nameOf = (icon: string) => PC_FIGURE_CHOICES.find((f) => f.icon === icon)?.name ?? icon;
  // Who plays them, picked in this list: this browser ("you"), and the names the others joined under.
  const meId = useRoomState((s) => s.me?.userId);
  const players = c.players ?? [];
  const mine = !gm && players.some((p) => p.userId === meId);
  const playedBy = players.map((p) => (!gm && p.userId === meId ? "you" : p.name)).join(", ");
  return (
    <li class="party-row">
      <button class="party-place" disabled={busy} title={`Place ${c.name} in the middle of your view`} onClick={() => void act(() => placeCharacter(room, c))}>
        <Preview c={c} />
        <span class="party-text">
          <span class="party-name">{c.name}</span>
          <span class="small muted">{who}</span>
          {playedBy && <span class="small muted">Played by {playedBy}</span>}
        </span>
      </button>
      {!gm && (
        <span class="party-gm">
          <button
            class={cx("icon-btn", mine && "active")}
            disabled={busy}
            aria-pressed={mine}
            title={mine ? `You play ${c.name} (click if you don't)` : `I play ${c.name}`}
            aria-label={mine ? `You play ${c.name}` : `I play ${c.name}`}
            onClick={() => void act(() => setCharacterPlayer(room, c, !mine))}
          >
            {mine ? <UserRoundCheck size={16} /> : <UserRound size={16} />}
          </button>
        </span>
      )}
      {gm && (
        <span class="party-gm">
          <PlayedBy c={c} busy={busy} act={act} />
          {/* The figure: a native list over the button, so it opens the browser's own picker. */}
          <span class="icon-btn party-figure" title={`Their figure: ${nameOf(figureOf(c))} (every room)`}>
            <PersonStanding size={16} />
            <select
              aria-label={`Figure for ${c.name}`}
              disabled={busy}
              value={figureOf(c) === classFigure ? "" : figureOf(c)}
              onChange={(e) => {
                const figure = e.currentTarget.value;
                void act(() => setCharacterFigure(room, c, figure || null));
              }}
            >
              <option value="">Their class's: {nameOf(classFigure)}</option>
              {PC_FIGURE_CHOICES.filter((f) => f.icon !== classFigure).map((f) => (
                <option key={f.icon} value={f.icon}>
                  {f.name}
                </option>
              ))}
            </select>
          </span>
          <button class="icon-btn" disabled={busy} title="Use a picture of your own for their token (every room)" aria-label={`Picture for ${c.name}`} onClick={() => file.current?.click()}>
            <ImagePlus size={16} />
          </button>
          {c.picture && (
            <button class="icon-btn" disabled={busy} title="Back to their figure" aria-label={`Figure for ${c.name}`} onClick={() => void act(() => clearCharacterPicture(room, c))}>
              <Undo2 size={16} />
            </button>
          )}
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (f) void act(() => setCharacterPicture(room, c, f));
            }}
          />
        </span>
      )}
    </li>
  );
}

/**
 * GM: a new day for the whole party: nothing prayed for and ki full on every card, and, ticked,
 * everyone's spell points back to full on their sheets. It asks first, since it changes every
 * sheet, and can be taken back for half an hour after.
 */
function NewPartyDay() {
  const room = useRoom();
  const count = useRoomState((s) => s.party?.characters.length ?? 0);
  const undo = useRoomState((s) => s.newDayUndo);
  const [rest, setRest] = useState(true);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  // Undo goes when its half hour is up.
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => room.store.set({ newDayUndo: null }), Math.max(0, undo.at + NEW_DAY_UNDO_MS - Date.now()));
    return () => clearTimeout(t);
  }, [undo, room]);
  const go = async () => {
    setAsking(false);
    setBusy(true);
    try {
      const { error } = await newPartyDay(room, rest);
      if (error) room.toast(error, "error");
      else room.toast(rest ? "A new day: prayers cleared, ki full, and spell points back to full on the sheets." : "A new day: prayers cleared and ki full.");
    } finally {
      setBusy(false);
    }
  };
  const back = async () => {
    setBusy(true);
    try {
      const error = await undoNewDay(room);
      room.toast(error ?? "The new day is taken back: prayers, ki and spell points as they were.", error ? "error" : undefined);
    } finally {
      setBusy(false);
    }
  };
  const who = `${count} character${count === 1 ? "" : "s"}`;
  return (
    <div class="party-day">
      {asking ? (
        <div class="party-day-ask" role="group" aria-label="Start a new day?">
          <span class="small">
            A new day for {who}: prayers cleared and ki full{rest ? ", and spell points back to full on their sheets" : ""}.
          </span>
          <span class="party-day-buttons">
            <button class="btn btn-sm btn-primary" onClick={() => void go()}>
              Start the new day
            </button>
            <button class="btn btn-sm" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </span>
        </div>
      ) : (
        <button class="btn btn-sm" disabled={busy || !count} title="Every character: nothing prayed for, and ki full" onClick={() => setAsking(true)}>
          <Sunrise size={14} /> New day for the party
        </button>
      )}
      <label class="check small">
        <input type="checkbox" checked={rest} onChange={(e) => setRest(e.currentTarget.checked)} />
        <span>and spell points back to full on their sheets</span>
      </label>
      {undo && !asking && (
        <button class="btn btn-sm" disabled={busy} title="Prayers, ki and spell points as they were before it" onClick={() => void back()}>
          <Undo2 size={14} /> Undo the new day ({new Date(undo.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})
        </button>
      )}
    </div>
  );
}

export function PartySection() {
  const party = useRoomState((s) => s.party);
  const gm = useRoomState((s) => s.me?.role === "gm");
  if (!party) return null;
  if (!party.configured) {
    return gm ? (
      <div class="party">
        <h3>Party</h3>
        <p class="small muted">Link the party's character sheets in Room settings › Character sheets, and their tokens show here.</p>
      </div>
    ) : null;
  }
  return (
    <div class="party">
      <h3>Party</h3>
      {party.error && <p class="small error-text">{party.error}</p>}
      {gm && !party.error && (party.scriptVersion ?? 0) < SCRIPT_VERSION && (
        <p class="small muted script-old">
          The character sheets' script is {party.scriptVersion ? `version ${party.scriptVersion}` : "an older version"}; version {SCRIPT_VERSION} is out. Put the new one in
          (Help › Set up the character sheets) for everything on the cards to work.
        </p>
      )}
      {party.characters.length ? (
        <>
          <ul class="party-list">
            {party.characters.map((c) => (
              <PartyRow key={c.id} c={c} gm={gm} />
            ))}
          </ul>
          {gm && <NewPartyDay />}
        </>
      ) : (
        !party.error && <p class="small muted">No character sheets in the folder yet.</p>
      )}
    </div>
  );
}
