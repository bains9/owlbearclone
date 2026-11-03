// Room settings › Character sheets (GM): where the party's character sheets are read from, the
// Apps Script web app the GM deploys in their Google account (scripts/character-sheets.gs). Kept
// on the server for every room (worker/characters.ts); saving reads the sheets at once and says
// who it found.

import { useEffect, useState } from "preact/hooks";
import { useRoom, useRoomState } from "./common";

export function CharacterSheetsSettings() {
  const room = useRoom();
  const party = useRoomState((s) => s.party);
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    void fetch("/api/characters/source", { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<{ source: string | null }>) : null))
      .then((d) => {
        setSaved(d?.source ?? "");
        setDraft(d?.source ?? "");
      })
      .catch(() => setSaved(""));
  }, []);

  const save = async (source: string) => {
    if (busy) return;
    setBusy(true);
    setNote(source ? { text: "Reading the character sheets…", error: false } : null);
    try {
      const res = await fetch("/api/characters/source", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; source?: string | null; party?: { characters: { name: string }[]; error?: string } };
      if (!res.ok) {
        setNote({ text: data.error ?? `That couldn't be saved (${res.status}).`, error: true });
        return;
      }
      setSaved(data.source ?? "");
      setDraft(data.source ?? "");
      const found = data.party?.characters ?? [];
      setNote(
        !source
          ? null
          : data.party?.error
            ? { text: data.party.error, error: true }
            : { text: found.length ? `Found ${found.length}: ${found.map((c) => c.name).join(", ")}.` : "It answered, but found no character sheets in its folder.", error: false },
      );
      await room.refreshParty();
    } catch {
      setNote({ text: "That couldn't be saved: Tabletop couldn't be reached.", error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3>Character sheets</h3>
      <p class="small muted">
        The party's tokens, cards, HP bars and rolls come from their character sheets in Google Sheets, read by a small script in your Google account.
        Paste the script's web app address here (see <a href="/guide#character-sheets" target="_blank" rel="noopener">Character sheets</a> in the guide).
      </p>
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          void save(draft.trim());
        }}
      >
        <input
          type="url"
          value={draft}
          placeholder="https://script.google.com/macros/s/…/exec"
          aria-label="The character sheets' script address"
          disabled={busy || saved === null}
          onInput={(e) => setDraft(e.currentTarget.value)}
        />
        <button class="btn btn-sm" disabled={busy || saved === null || draft.trim() === saved}>
          Save
        </button>
      </form>
      {saved ? (
        <button class="link-btn small" disabled={busy} onClick={() => void save("")}>
          Stop reading the character sheets
        </button>
      ) : null}
      {note ? (
        <p class={note.error ? "small error-text" : "small"}>{note.text}</p>
      ) : (
        party?.configured && <p class="small muted">{party.characters.length ? `Reading ${party.characters.map((c) => c.name).join(", ")}.` : "No character sheets read yet."}</p>
      )}
    </>
  );
}
