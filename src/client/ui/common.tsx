import { createContext } from "preact";
import type { ComponentChildren } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { X } from "lucide-preact";
import type { RoomClient, RoomState } from "../room/client";
import { useStore } from "../store";

export const RoomContext = createContext<RoomClient | null>(null);

export function useRoom(): RoomClient {
  const room = useContext(RoomContext);
  if (!room) throw new Error("useRoom outside a room");
  return room;
}

export function useRoomState<T>(select: (s: RoomState) => T): T {
  return useStore(useRoom().store, select);
}

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/** Whether a dialog's backdrop is the one on top (the highest layer, then the last opened). */
function onTop(backdrop: HTMLElement): boolean {
  const z = (e: HTMLElement) => Number(getComputedStyle(e).zIndex) || 0;
  let top: HTMLElement | null = null;
  for (const e of document.querySelectorAll<HTMLElement>(".modal-backdrop")) if (!top || z(e) >= z(top)) top = e;
  return !top || top === backdrop;
}

/** A dialog. above: opened over another dialog (the New scene window, say), which stays open beneath it. */
export function Modal(props: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  width?: number;
  above?: boolean;
}) {
  const { onClose } = props;
  const bodyRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape closes only the dialog on top.
      if (e.key === "Escape" && (!backdropRef.current || onTop(backdropRef.current))) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Browsers ignore autofocus on elements added after the page loaded, so focus the
  // dialog's field (or its main button) ourselves, with the caret at the end of any text.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const target = body.querySelector<HTMLElement>("[autofocus], textarea, input:not([type=hidden]), select, .btn-primary, .btn-danger");
    if (!target) return;
    target.focus();
    if (target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type === "text")) {
      const end = target.value.length;
      target.setSelectionRange(end, end);
    }
  }, []);
  return (
    <div
      ref={backdropRef}
      class={cx("modal-backdrop", props.above && "above")}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="modal" style={{ maxWidth: `${props.width ?? 420}px` }} role="dialog" aria-modal="true" aria-label={props.title}>
        <div class="modal-head">
          <h2>{props.title}</h2>
          <button class="icon-btn" onClick={onClose} aria-label="Close" title="Close">
            <X size={18} />
          </button>
        </div>
        <div class="modal-body" ref={bodyRef}>
          {props.children}
        </div>
      </div>
    </div>
  );
}

export function ConfirmDialog(props: {
  title: string;
  message: ComponentChildren;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <div class="confirm-message">{props.message}</div>
      <div class="dialog-actions">
        <button class="btn" onClick={props.onClose} disabled={busy}>
          Cancel
        </button>
        <button
          class={cx("btn", props.danger ? "btn-danger" : "btn-primary")}
          disabled={busy}
          autoFocus
          onClick={async () => {
            setBusy(true);
            try {
              await props.onConfirm();
            } finally {
              setBusy(false);
            }
            props.onClose();
          }}
        >
          {props.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function PromptDialog(props: {
  title: string;
  label: string;
  initial: string;
  confirmLabel: string;
  maxLength?: number;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(props.initial);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.select();
  }, []);
  const submit = (e: Event) => {
    e.preventDefault();
    if (!value.trim()) return;
    props.onConfirm(value.trim());
    props.onClose();
  };
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <form onSubmit={submit}>
        <label class="field">
          <span>{props.label}</span>
          <input
            ref={inputRef}
            value={value}
            maxLength={props.maxLength ?? 60}
            onInput={(e) => setValue(e.currentTarget.value)}
            autoFocus
          />
        </label>
        <div class="dialog-actions">
          <button type="button" class="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="btn btn-primary" disabled={!value.trim()}>
            {props.confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Swatches(props: {
  colors: string[];
  value: string | null;
  onPick: (color: string) => void;
  size?: "sm" | "md";
  custom?: boolean;
}) {
  return (
    <div class={cx("swatches", props.size === "sm" && "swatches-sm")}>
      {props.colors.map((c) => (
        <button
          key={c}
          type="button"
          class={cx("swatch", props.value?.toLowerCase() === c.toLowerCase() && "active")}
          style={{ background: c }}
          title={c}
          aria-label={`Colour ${c}`}
          onClick={() => props.onPick(c)}
        />
      ))}
      {props.custom && (
        <label class="swatch swatch-custom" title="Pick any colour">
          <input
            type="color"
            value={props.value ?? "#ffffff"}
            onChange={(e) => props.onPick(e.currentTarget.value)}
            aria-label="Pick any colour"
          />
        </label>
      )}
    </div>
  );
}

/** A text input that only reports its value when you press Enter or leave it. */
export function CommitInput(props: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  class?: string;
  disabled?: boolean;
  type?: "text" | "number";
  step?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(props.value);
  const focused = useRef(false);
  const cancelled = useRef(false);
  const unmounted = useRef(false);
  const latest = useRef(draft);
  latest.current = draft;
  // What the field was editing when it got focus. If the selection changes while
  // it's focused, the edit still goes to the item it was typed for.
  const target = useRef({ value: props.value, onCommit: props.onCommit });
  useEffect(() => {
    if (!focused.current) setDraft(props.value);
  }, [props.value]);
  useEffect(
    () => () => {
      // Removed while being typed in (the selection changed, a panel closed): some
      // browsers, Firefox among them, never send blur then, so save what was typed here.
      if (focused.current && !cancelled.current && latest.current !== target.current.value) {
        target.current.onCommit(latest.current);
      }
      unmounted.current = true;
    },
    [],
  );
  const commit = () => {
    if (unmounted.current) return;
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(props.value);
      return;
    }
    if (draft !== target.current.value) target.current.onCommit(draft);
  };
  return (
    <input
      class={props.class}
      type={props.type ?? "text"}
      step={props.step}
      value={draft}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      disabled={props.disabled}
      aria-label={props.ariaLabel ?? props.placeholder}
      onFocus={() => {
        focused.current = true;
        target.current = { value: props.value, onCommit: props.onCommit };
      }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onInput={(e) => setDraft(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString();
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
