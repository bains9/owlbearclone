// A character's card, over the selection bar when their token is selected (anyone at the table):
// HP, AC, initiative and spell points as their sheet has them now, their attacks as one-tap rolls
// (to hit, and damage) in the chat, and a link to open the sheet itself. After your own natural 20
// to hit with an attack (a critical hit), its damage button rolls the crit's damage until you roll it.

import { Dices, ExternalLink } from "lucide-preact";
import {
  INITIATIVE_DIE,
  TO_HIT_DIE,
  attackLabel,
  attackModifiers,
  characterLabel,
  critDamage,
  critOf,
  damageDice,
  withModifier,
  type Character,
} from "../../shared/characters";
import type { ChatMessage } from "../../shared/types";
import { cx, useRoom, useRoomState } from "./common";

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** Whether your last roll with an attack was a critical hit to hit, its damage not rolled yet. */
function critPending(messages: readonly ChatMessage[], userId: string | undefined, who: string, weapon: string): boolean {
  const hit = attackLabel(who, weapon, "to hit");
  const damage = [attackLabel(who, weapon, "damage"), attackLabel(who, weapon, "crit damage")];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind !== "roll" || m.userId !== userId) continue;
    if (m.text === hit) return critOf(m) === "hit";
    if (damage.includes(m.text)) return false;
  }
  return false;
}

export function CharacterCard(props: { c: Character }) {
  const room = useRoom();
  const messages = useRoomState((s) => s.messages);
  const me = useRoomState((s) => s.me?.userId);
  const { c } = props;
  const who = characterLabel(c);
  const share = c.hp !== null && c.maxHp ? Math.max(0, Math.min(1, c.hp / c.maxHp)) : null;
  const roll = (expr: string, label: string) => room.roll(expr, { label });
  return (
    <div class="character-card" onPointerDown={(e) => e.stopPropagation()}>
      <div class="character-head">
        <div>
          <div class="character-name">{c.name}</div>
          <div class="small muted">{[c.player, c.summary].filter(Boolean).join(" · ")}</div>
        </div>
        <a class="icon-btn" href={c.url} target="_blank" rel="noopener noreferrer" title="Open the character sheet" aria-label="Open the character sheet">
          <ExternalLink size={16} />
        </a>
      </div>
      {share !== null && (
        <div class="character-hp" title="Hit points, from the sheet">
          <div class="character-hp-bar">
            <div class={share > 0.5 ? "ok" : share > 0.25 ? "low" : "bad"} style={{ width: `${share * 100}%` }} />
          </div>
          <span>
            HP {c.hp} / {c.maxHp}
          </span>
        </div>
      )}
      <div class="character-stats">
        {c.ac && (
          <span title="Combat AC (with a shield on the attack's side)">
            AC {c.ac}
            {c.acShield && c.acShield !== c.ac ? ` (${c.acShield})` : ""}
          </span>
        )}
        {c.init !== null && (
          <button class="link-btn" title="Roll initiative" onClick={() => roll(withModifier(INITIATIVE_DIE, c.init ?? 0), `${who}: initiative`)}>
            Initiative {signed(c.init)}
          </button>
        )}
        {c.sp !== null && c.maxSp !== null && (
          <span title="Spell points">
            SP {c.sp} / {c.maxSp}
          </span>
        )}
      </div>
      {c.attacks.length > 0 && (
        <ul class="character-attacks">
          {c.attacks.map((a, i) => {
            const mods = attackModifiers(a);
            const dice = damageDice(a);
            const hit = withModifier(TO_HIT_DIE, mods.toHit);
            const dmg = dice ? withModifier(dice, mods.damage) : null;
            const crit = dice && critPending(messages, me, who, a.weapon) ? critDamage(a) : null;
            return (
              <li key={i}>
                <span class="character-weapon" title={[a.range && `Range ${a.range}`, a.toHit && `To hit ${a.toHit}`, a.bonus].filter(Boolean).join(" · ")}>
                  {a.weapon}
                </span>
                <button class="btn btn-sm" title={`Roll ${hit} to hit (a natural 20 is a critical hit, a natural 2 a critical failure)`} onClick={() => roll(hit, attackLabel(who, a.weapon, "to hit"))}>
                  <Dices size={13} /> {hit}
                </button>
                {dmg && (
                  <button
                    class={cx("btn btn-sm", crit && "crit")}
                    title={crit ? `Critical hit: roll ${crit} damage (the weapon's die at its most added)` : `Roll ${dmg} damage`}
                    onClick={() => (crit ? roll(crit, attackLabel(who, a.weapon, "crit damage")) : roll(dmg, attackLabel(who, a.weapon, "damage")))}
                  >
                    {crit ? `Crit ${crit}` : dmg}
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
