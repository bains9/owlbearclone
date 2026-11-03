// GM: what failed on people's devices (shared/problems.ts), from More › Problems on devices: who,
// on what, what couldn't be shown and why, newest first. Cleared for everyone with Clear the list.

import { useRoom, useRoomState, Modal } from "./common";

export function ProblemsDialog(props: { onClose: () => void }) {
  const room = useRoom();
  const problems = useRoomState((s) => s.problems);
  return (
    <Modal title="Problems on devices" onClose={props.onClose} width={560}>
      {problems.length ? (
        <>
          <p class="small muted">
            Something on someone's screen couldn't be shown, so it was left out and the rest carried on. A reload often fixes it; if it keeps happening, these
            say where to look.
          </p>
          <ul class="problems-list">
            {problems.map((p) => (
              <li key={`${p.at}-${p.name}-${p.where}`}>
                <div>
                  <strong>{p.where.charAt(0).toUpperCase() + p.where.slice(1)}</strong> couldn't be shown for {p.name} <span class="muted">({p.device})</span>
                </div>
                <div class="small problem-message">{p.message}</div>
                <div class="small muted">
                  {new Date(p.at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
                  {p.times > 1 ? ` · ${p.times} times` : ""}
                </div>
              </li>
            ))}
          </ul>
          <div class="dialog-actions">
            <button class="btn btn-sm" onClick={() => room.clearProblems()}>
              Clear the list
            </button>
          </div>
        </>
      ) : (
        <p class="small muted">Nothing has failed on anyone's device.</p>
      )}
    </Modal>
  );
}
