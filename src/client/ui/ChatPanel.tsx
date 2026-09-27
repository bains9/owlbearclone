import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Dices, EyeOff, Send, UserPen } from "lucide-preact";
import type { ChatMessage, RollTerm } from "../../shared/types";
import { cx, useRoom, useRoomState } from "./common";
import { ProfileDialog } from "./RoomPage";

const DICE = [4, 6, 8, 10, 12, 20, 100];

export function ChatPanel() {
  const room = useRoom();
  const messages = useRoomState((s) => s.messages);
  const players = useRoomState((s) => s.players);
  const me = useRoomState((s) => s.me);
  const gm = me?.role === "gm";
  const [text, setText] = useState("");
  const [secret, setSecret] = useState(false);
  const [modifier, setModifier] = useState("");
  const [editProfile, setEditProfile] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const mod = /^[+-]?\d{1,4}$/.test(modifier.trim())
    ? (modifier.trim().startsWith("-") || modifier.trim().startsWith("+") ? modifier.trim() : `+${modifier.trim()}`)
    : "";
  const roll = (expr: string) => room.roll(expr + (mod === "+0" ? "" : mod), { private: secret });

  const send = (e: Event) => {
    e.preventDefault();
    if (!text.trim()) return;
    const m = /^\/(?:r|roll)\s+(.+)$/i.exec(text.trim());
    if (m) room.roll(m[1], { private: secret });
    else room.sendChat(text);
    setText("");
  };

  return (
    <div class="chat">
      <div class="chat-players">
        {players.map((p) => (
          <span key={p.connId} class="chip">
            <span class="dot" style={{ background: p.color }} />
            {p.name}
            {p.role === "gm" && <span class="gm-tag">GM</span>}
          </span>
        ))}
        <button class="icon-btn" title="Change your name or colour" aria-label="Change your name or colour" onClick={() => setEditProfile(true)}>
          <UserPen size={16} />
        </button>
      </div>

      <div
        class="chat-log"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {messages.length === 0 && <p class="muted small center">No messages yet. Say hi, or roll some dice.</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const grouped = prev && prev.userId === m.userId && m.kind === "chat" && prev.kind === "chat" && m.ts - prev.ts < 120_000;
          return <MessageView key={m.id} message={m} grouped={Boolean(grouped)} />;
        })}
      </div>

      <div class="dice-tray">
        <div class="dice-row">
          {DICE.map((d) => (
            <button key={d} class="die-btn" onClick={() => roll(`1d${d}`)} title={`Roll 1d${d}${mod}`}>
              d{d}
            </button>
          ))}
        </div>
        <div class="dice-row">
          <button class="die-btn wide" onClick={() => roll("2d20kh1")} title="Roll 2d20, keep the highest">
            Advantage
          </button>
          <button class="die-btn wide" onClick={() => roll("2d20kl1")} title="Roll 2d20, keep the lowest">
            Disadvantage
          </button>
          <input
            class="mod-input"
            value={modifier}
            placeholder="+0"
            maxLength={5}
            inputMode="numeric"
            title="Modifier added to the quick rolls"
            aria-label="Modifier"
            onInput={(e) => setModifier(e.currentTarget.value)}
          />
          <label class={cx("check", "secret-toggle", secret && "on")} title={gm ? "Only you see the result" : "Only you and the GM see the result"}>
            <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.currentTarget.checked)} />
            <EyeOff size={14} /> {gm ? "Hidden" : "To GM"}
          </label>
        </div>
      </div>

      <form class="chat-input" onSubmit={send}>
        <input
          value={text}
          maxLength={1000}
          placeholder="Message, or /r 2d6+3"
          onInput={(e) => setText(e.currentTarget.value)}
          aria-label="Message"
        />
        <button
          type="button"
          class="icon-btn"
          title="Roll what's typed as dice (e.g. 3d8+2)"
          aria-label="Roll typed dice"
          disabled={!text.trim()}
          onClick={() => {
            const expr = text.trim().replace(/^\/(?:r|roll)\s+/i, "");
            if (!expr) return;
            room.roll(expr, { private: secret });
            setText("");
          }}
        >
          <Dices size={18} />
        </button>
        <button class="icon-btn" title="Send" aria-label="Send" disabled={!text.trim()}>
          <Send size={18} />
        </button>
      </form>
      {editProfile && <ProfileDialog onClose={() => setEditProfile(false)} />}
    </div>
  );
}

function MessageView(props: { message: ChatMessage; grouped: boolean }) {
  const m = props.message;
  const time = new Date(m.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <div class={cx("msg", props.grouped && "grouped", m.private && "private")}>
      {!props.grouped && (
        <div class="msg-head">
          <span class="msg-name" style={{ color: m.color }}>
            {m.name}
          </span>
          {m.role === "gm" && <span class="gm-tag">GM</span>}
          {m.private && (
            <span class="private-tag" title="Only the roller and the GM see this">
              <EyeOff size={12} /> private
            </span>
          )}
          <span class="msg-time">{time}</span>
        </div>
      )}
      {m.kind === "roll" ? <RollView message={m} /> : <div class="msg-text">{m.text}</div>}
    </div>
  );
}

function dieClass(t: Extract<RollTerm, { kind: "dice" }>, v: number, dropped: boolean): string {
  if (dropped) return "die dropped";
  if (t.sides === "F") return v > 0 ? "die max" : v < 0 ? "die min" : "die";
  if (t.sides > 1 && v === t.sides) return "die max";
  if (t.sides > 1 && v === 1) return "die min";
  return "die";
}

export function RollView(props: { message: ChatMessage; compact?: boolean }) {
  const m = props.message;
  const r = m.roll;
  if (!r) return null;
  return (
    <div class={cx("roll", props.compact && "compact")}>
      {props.compact && (
        <span class="msg-name" style={{ color: m.color }}>
          {m.name}
          {m.private ? " (private)" : ""}
        </span>
      )}
      <div class="roll-main">
        <span class="roll-total">{r.total}</span>
        <span class="roll-expr">
          {m.text ? `${m.text} · ` : ""}
          {r.expr}
        </span>
      </div>
      {!props.compact && (
        <div class="roll-dice">
          {r.terms.map((t, i) => (
            <span key={i} class="term">
              {i > 0 && <span class="op">{t.sign < 0 ? "−" : "+"}</span>}
              {i === 0 && t.sign < 0 && <span class="op">−</span>}
              {t.kind === "num" ? (
                <span class="num">{t.value}</span>
              ) : (
                t.rolls.map((d, j) => (
                  <span key={j} class={dieClass(t, d.v, d.dropped)} title={t.notation}>
                    {t.sides === "F" ? (d.v > 0 ? "+" : d.v < 0 ? "−" : "0") : d.v}
                  </span>
                ))
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
