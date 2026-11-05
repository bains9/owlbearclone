// Handouts: the campaign notes (or parts of them) the GM has shown here, newest first, for everyone
// in the room. Each page cleans a handout before showing it (safeHtml.ts), and for players its links
// to the GM's notes are only words. The GM can take one back.
import { useMemo } from "preact/hooks";
import { X } from "lucide-preact";
import type { Handout } from "../../shared/vault";
import { safeHtml } from "../safeHtml";
import { useRoom, useRoomState } from "./common";

function HandoutView(props: { h: Handout; gm: boolean }) {
  const room = useRoom();
  const { h, gm } = props;
  const html = useMemo(() => safeHtml(h.html, { players: true }), [h.html]);
  return (
    <article class="handout">
      <header class="handout-head">
        <h3>{h.title}</h3>
        <span class="small muted">{new Date(h.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
        {gm && (
          <button class="icon-btn" title="Take it back: the players no longer have it" aria-label={`Take back ${h.title}`} onClick={() => room.removeHandout(h.id)}>
            <X size={16} />
          </button>
        )}
      </header>
      {/* Cleaned by safeHtml: only plain formatting, links to the web and the vault's own pictures. */}
      <div class="note-body" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}

export function HandoutsPanel() {
  const handouts = useRoomState((s) => s.handouts);
  const gm = useRoomState((s) => s.me?.role === "gm");
  return (
    <div class="panel-body">
      {handouts.length === 0 ? (
        <p class="small muted">
          {gm
            ? "Nothing shown yet. Open Campaign notes and click Show to players on a note (or highlight part of one first)."
            : "Nothing here yet. When the GM shows you a note, a map or a letter, it's here."}
        </p>
      ) : (
        handouts.map((h) => <HandoutView key={h.id} h={h} gm={gm} />)
      )}
    </div>
  );
}
