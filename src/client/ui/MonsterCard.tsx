// GM: a monster's or NPC's card on the map, from stats entered by hand (shared/tokenStats.ts): HP with
// damage and healing, AC, initiative, and attacks as one-tap rolls, the same as a character's card.
// Attacks roll two d10 to hit: both tens is a critical hit, and its damage button then rolls the crit's
// damage until it's rolled. Rolls go in the chat in the GM's dice, or tick Hidden for only the GM to see.
import { useState } from "preact/hooks";
import { ChevronDown, ChevronUp, Dices, EyeOff, Pencil, Plus, X } from "lucide-preact";
import { INITIATIVE_DIE, TO_HIT_DIE, attackLabel, withModifier } from "../../shared/characters";
import { attackDamage, changedHp, draftOf, isBlank, statsFromDraft, type StatsDraft, type TokenStats } from "../../shared/tokenStats";
import type { TokenItem } from "../../shared/types";
import { critPending, useCardFolded } from "./CharacterCard";
import { cx, useRoom, useRoomState } from "./common";

const HIDDEN_ROLLS = "tabletop-monster-rolls-hidden";
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function loadHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_ROLLS) === "1";
  } catch {
    return false;
  }
}

function saveHidden(on: boolean): void {
  try {
    localStorage.setItem(HIDDEN_ROLLS, on ? "1" : "0");
  } catch {
    // It lasts as long as the page.
  }
}

/** The name a token's rolls go under: its label, or its picture's name without "Monster: ". */
function useWho(t: TokenItem): string {
  const asset = useRoomState((s) => (t.assetId ? s.assets[t.assetId] : undefined));
  return t.label || asset?.name.replace(/^(Monster|NPC): /, "") || "Monster";
}

/** Filling in a token's stats. */
function StatsForm(props: { token: TokenItem; who: string; stats: TokenStats | undefined }) {
  const room = useRoom();
  const { token: t, stats } = props;
  const [draft, setDraft] = useState<StatsDraft>(() => draftOf(stats));
  const [problem, setProblem] = useState<string | null>(null);
  const close = () => room.store.set({ statsEditing: null });
  const set = (part: Partial<StatsDraft>) => setDraft({ ...draft, ...part });
  const setRow = (i: number, part: Partial<StatsDraft["attacks"][number]>) => set({ attacks: draft.attacks.map((a, j) => (j === i ? { ...a, ...part } : a)) });
  const save = (e: Event) => {
    e.preventDefault();
    const made = statsFromDraft(draft, stats);
    if ("error" in made) {
      setProblem(made.error);
      return;
    }
    room.setTokenStats(t.id, isBlank(made.stats) ? null : made.stats);
    close();
  };
  return (
    <form class="character-card monster-form" onSubmit={save} onPointerDown={(e) => e.stopPropagation()}>
      <div class="character-head">
        <div class="character-name">{props.who}: stats</div>
        <button type="button" class="icon-btn" title="Close without saving" aria-label="Close without saving" onClick={close}>
          <X size={16} />
        </button>
      </div>
      <div class="monster-fields">
        <label>
          <span>Max HP</span>
          <input type="number" min={0} value={draft.maxHp} onInput={(e) => set({ maxHp: e.currentTarget.value })} />
        </label>
        <label>
          <span>HP now</span>
          <input type="number" value={draft.hp} placeholder="Full" onInput={(e) => set({ hp: e.currentTarget.value })} />
        </label>
        <label>
          <span>AC</span>
          <input value={draft.ac} maxLength={24} onInput={(e) => set({ ac: e.currentTarget.value })} />
        </label>
        <label title="Added to the d10 for initiative">
          <span>Initiative</span>
          <input type="number" value={draft.init} placeholder="+0" onInput={(e) => set({ init: e.currentTarget.value })} />
        </label>
      </div>
      <div class="monster-attack-head small muted">
        <span>Attack</span>
        <span title="Added to the two d10">To hit</span>
        <span>Damage</span>
        <span />
      </div>
      {draft.attacks.map((a, i) => (
        <div class="monster-attack-row" key={i}>
          <input value={a.name} maxLength={40} placeholder="Longsword" aria-label="Attack's name" onInput={(e) => setRow(i, { name: e.currentTarget.value })} />
          <input type="number" value={a.toHit} placeholder="+0" aria-label={`${a.name || "Attack"}: added to the two d10 to hit`} onInput={(e) => setRow(i, { toHit: e.currentTarget.value })} />
          <input value={a.damage} placeholder="1d8+1" aria-label={`${a.name || "Attack"}: damage dice`} onInput={(e) => setRow(i, { damage: e.currentTarget.value })} />
          <button type="button" class="icon-btn" title="Take this attack out" aria-label={`Take ${a.name || "this attack"} out`} onClick={() => set({ attacks: draft.attacks.filter((_, j) => j !== i) })}>
            <X size={14} />
          </button>
        </div>
      ))}
      <button type="button" class="link-btn small" onClick={() => set({ attacks: [...draft.attacks, { name: "", toHit: "", damage: "" }] })}>
        <Plus size={12} /> Add an attack
      </button>
      {problem && <p class="error-text small">{problem}</p>}
      <div class="monster-form-actions">
        <button class="btn btn-sm btn-primary">Save</button>
        {stats && (
          <button
            type="button"
            class="btn btn-sm"
            title="Take these stats off this token"
            onClick={() => {
              room.setTokenStats(t.id, null);
              close();
            }}
          >
            Remove stats
          </button>
        )}
      </div>
    </form>
  );
}

export function MonsterCard(props: { token: TokenItem }) {
  const room = useRoom();
  const { token: t } = props;
  const stats = useRoomState((s) => s.tokenStats[t.id]);
  const editing = useRoomState((s) => s.statsEditing === t.id);
  const messages = useRoomState((s) => s.messages);
  const me = useRoomState((s) => s.me?.userId);
  const who = useWho(t);
  const [folded, setFolded] = useCardFolded();
  const [amount, setAmount] = useState("");
  const [hidden, setHiddenState] = useState(loadHidden);
  if (editing || !stats) return <StatsForm key={t.id} token={t} who={who} stats={stats} />;

  const setHidden = (on: boolean) => {
    setHiddenState(on);
    saveHidden(on);
  };
  const roll = (expr: string, label: string) => room.roll(expr, { label, ...(hidden ? { private: true } : {}) });
  const share = stats.maxHp ? Math.max(0, Math.min(1, stats.hp / stats.maxHp)) : null;
  const change = (sign: 1 | -1) => {
    const n = Math.abs(Math.trunc(Number(amount)));
    if (!n) return;
    room.setTokenStats(t.id, { ...stats, hp: changedHp(stats, sign * n) });
    setAmount("");
  };
  return (
    <div class={cx("character-card monster-card", folded && "folded")} onPointerDown={(e) => e.stopPropagation()}>
      <div class="character-head">
        <div class="character-name">{who}</div>
        <div class="character-head-actions">
          {stats.attacks.length > 0 && (
            <button
              class="icon-btn"
              aria-expanded={!folded}
              title={folded ? "Open the card: attacks" : "Fold the card: name, HP and stats only"}
              aria-label={folded ? "Open the card" : "Fold the card"}
              onClick={() => setFolded(!folded)}
            >
              {folded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          )}
          <button class="icon-btn" title="Change its stats" aria-label="Change its stats" onClick={() => room.store.set({ statsEditing: t.id })}>
            <Pencil size={16} />
          </button>
        </div>
      </div>
      {share !== null && (
        <div class="character-hp" title="Hit points: only you see these">
          <div class="character-hp-bar">
            <div class={share > 0.5 ? "ok" : share > 0.25 ? "low" : "bad"} style={{ width: `${share * 100}%` }} />
          </div>
          <span>
            HP {stats.hp} / {stats.maxHp}
          </span>
        </div>
      )}
      {share !== null && (
        <form
          class="monster-hp-change"
          onSubmit={(e) => {
            e.preventDefault();
            change(-1);
          }}
        >
          <input type="number" min={0} value={amount} placeholder="HP" aria-label="How much damage or healing" onInput={(e) => setAmount(e.currentTarget.value)} />
          <button class="btn btn-sm" disabled={!amount} title="Take this off its HP">
            Damage
          </button>
          <button type="button" class="btn btn-sm" disabled={!amount} title="Add this to its HP, up to its most" onClick={() => change(1)}>
            Heal
          </button>
        </form>
      )}
      <div class="character-stats">
        {stats.ac && <span title="Armour class">AC {stats.ac}</span>}
        <button
          class="link-btn"
          title={`Roll initiative: a d10 ${stats.init ? `with ${signed(stats.init)} ` : ""}into the chat and the initiative list`}
          onClick={() => room.roll(withModifier(INITIATIVE_DIE, stats.init), { label: `${who}: initiative`, initiative: { tokenId: t.id }, ...(hidden ? { private: true } : {}) })}
        >
          Initiative {signed(stats.init)}
        </button>
        <label class="monster-hidden" title="Only you see this token's rolls, in the chat and on the map. Each device remembers.">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.currentTarget.checked)} />
          <EyeOff size={13} /> Hidden
        </label>
      </div>
      {!folded && stats.attacks.length > 0 && (
        <ul class="character-attacks">
          {stats.attacks.map((a, i) => {
            const hit = withModifier(TO_HIT_DIE, a.toHit);
            const crit = critPending(messages, me, who, a.name);
            const dmg = attackDamage(a, crit);
            return (
              <li key={`${i}:${a.name}`}>
                <span class="character-weapon">{a.name}</span>
                <button class="btn btn-sm" title={`Roll ${hit} to hit (a natural 20 is a critical hit, a natural 2 a critical failure)`} onClick={() => roll(hit, attackLabel(who, a.name, "to hit"))}>
                  <Dices size={13} /> {hit}
                </button>
                {dmg && (
                  <button
                    class={cx("btn btn-sm", crit && "crit")}
                    title={crit ? `Critical hit: the most its dice can roll, added. Roll ${dmg} damage` : `Roll ${dmg} damage`}
                    onClick={() => roll(dmg, attackLabel(who, a.name, crit ? "crit damage" : "damage"))}
                  >
                    {crit ? `Crit ${dmg}` : dmg}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
