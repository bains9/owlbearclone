import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Dices, EyeOff, Send, UserPen, X } from "lucide-preact";
import type { ChatMessage, RollTerm } from "../../shared/types";
import { cx, useRoom, useRoomState } from "./common";
import { ProfileDialog } from "./RoomPage";
import { VoiceSection } from "./VoicePanel";
import { canAdd, canDouble, changeDie, doubled, poolExpr, poolSize } from "./dicePool";
import type { Pool } from "./dicePool";

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
  /** The dice picked to roll together. */
  const [pool, setPool] = useState<Pool>({});
  const firstDie = useRef<HTMLButtonElement>(null);
  /** Empties the pool; the focus, on a button that goes with it, moves to the first die. */
  const putBack = () => {
    setPool({});
    firstDie.current?.focus();
  };
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
  const bonus = mod === "+0" ? "" : mod;

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

      <VoiceSection />

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
        {/* Above the dice, so picking one never moves the button under the pointer. */}
        {poolSize(pool) === 0 ? (
          <p class="dice-hint">Click dice to pick them, then roll them together.</p>
        ) : (
          <div class="dice-row dice-pool" role="group" aria-label="Dice to roll">
            {DICE.filter((d) => pool[d]).map((d) => (
              <span key={d} class="pool-die">
                <button class="pool-step" title={`One d${d} fewer`} aria-label={`One d${d} fewer`} onClick={() => setPool((p) => changeDie(p, d, -1))}>
                  −
                </button>
                <span class="pool-count">
                  {pool[d]}d{d}
                </span>
                <button
                  class="pool-step"
                  title={`One more d${d}`}
                  aria-label={`One more d${d}`}
                  disabled={!canAdd(pool, d)}
                  onClick={() => setPool((p) => changeDie(p, d, 1))}
                >
                  +
                </button>
              </span>
            ))}
            {bonus && <span class="pool-bonus">{bonus}</span>}
            <span class="pool-actions">
              <button
                class="die-btn pool-double"
                disabled={!canDouble(pool)}
                title="Twice as many of every die (a critical hit)"
                onClick={() => setPool((p) => doubled(p))}
              >
                ×2
              </button>
              <button
                class="die-btn pool-roll"
                title={`Roll ${poolExpr(pool)}${bonus}`}
                onClick={() => {
                  roll(poolExpr(pool));
                  putBack();
                }}
              >
                Roll
              </button>
              <button class="icon-btn pool-clear" title="Put the picked dice back" aria-label="Put the picked dice back" onClick={putBack}>
                <X size={16} />
              </button>
            </span>
          </div>
        )}
        <div class="dice-row">
          {DICE.map((d, i) => (
            <button
              key={d}
              ref={i === 0 ? firstDie : undefined}
              class={cx("die-btn", Boolean(pool[d]) && "picked")}
              disabled={!canAdd(pool, d)}
              onClick={() => setPool((p) => changeDie(p, d, 1))}
              title={`Pick a d${d} to roll`}
              aria-label={pool[d] ? `d${d}, ${pool[d]} picked` : undefined}
            >
              d{d}
              {pool[d] ? <span class="die-count">{pool[d]}</span> : null}
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
            title="Bonus added to Roll, Advantage and Disadvantage"
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
