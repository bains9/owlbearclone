// The party at the top of Tokens & images, for the GM and players alike: each character from their
// sheet (party.ts), in the token they'll have on the map, to place with a click. The GM can choose
// a character's figure (their class's, or any other), or give them a picture of their own instead,
// for every room.

import { useEffect, useRef, useState } from "preact/hooks";
import { ImagePlus, PersonStanding, Undo2 } from "lucide-preact";
import type { Character } from "../../shared/characters";
import { classFigureOf, figureOf } from "../npcs/pcTokens";
import { PC_FIGURE_CHOICES } from "../npcs/table";
import { characterPictureUrl, clearCharacterPicture, drawCharacter, placeCharacter, setCharacterFigure, setCharacterPicture } from "../party";
import { useRoom, useRoomState } from "./common";

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
  return (
    <li class="party-row">
      <button class="party-place" disabled={busy} title={`Place ${c.name} in the middle of your view`} onClick={() => void act(() => placeCharacter(room, c))}>
        <Preview c={c} />
        <span class="party-text">
          <span class="party-name">{c.name}</span>
          <span class="small muted">{who}</span>
        </span>
      </button>
      {gm && (
        <span class="party-gm">
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
      {party.characters.length ? (
        <ul class="party-list">
          {party.characters.map((c) => (
            <PartyRow key={c.id} c={c} gm={gm} />
          ))}
        </ul>
      ) : (
        !party.error && <p class="small muted">No character sheets in the folder yet.</p>
      )}
    </div>
  );
}
