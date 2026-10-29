// A character's card, over the selection bar when their token is selected (anyone at the table):
// HP, AC, initiative and spell points as their sheet has them now, their attacks as one-tap rolls
// (to hit, and damage) in the chat, and a link to open the sheet itself.

import { Dices, ExternalLink } from "lucide-preact";
import { TO_HIT_DIE, attackLabel, attackModifiers, characterLabel, damageDice, withModifier, type Character } from "../../shared/characters";
import { useRoom } from "./common";

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export function CharacterCard(props: { c: Character }) {
  const room = useRoom();
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
          <button class="link-btn" title="Roll initiative" onClick={() => roll(withModifier(TO_HIT_DIE, c.init ?? 0), `${who}: initiative`)}>
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
            return (
              <li key={i}>
                <span class="character-weapon" title={[a.range && `Range ${a.range}`, a.toHit && `To hit ${a.toHit}`, a.bonus].filter(Boolean).join(" · ")}>
                  {a.weapon}
                </span>
                <button class="btn btn-sm" title={`Roll ${hit} to hit`} onClick={() => roll(hit, attackLabel(who, a.weapon, "to hit"))}>
                  <Dices size={13} /> {hit}
                </button>
                {dmg && (
                  <button class="btn btn-sm" title={`Roll ${dmg} damage`} onClick={() => roll(dmg, attackLabel(who, a.weapon, "damage"))}>
                    {dmg}
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
