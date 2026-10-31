// A character's card, over the selection bar when their token is selected (anyone at the table):
// HP, AC, initiative and spell points as their sheet has them now, their attacks as one-tap rolls
// (to hit, and damage) in the chat, and a link to open the sheet itself. After your own natural 20
// to hit with an attack (a critical hit), its damage button rolls the crit's damage until you roll it.
// A rogue's card has a Sneak attack box: ticked, the next damage roll adds the sheet's sneak attack
// dice for that weapon (fewer when it's ranged or thrown, as the sheet has them), then unticks.
// A caster's card lists their spells, with what they've prayed for today: one the map can show is
// cast from their token with the Spells tool, any other from the card itself, as a line in the chat.

import { useState } from "preact/hooks";
import { Dices, ExternalLink } from "lucide-preact";
import {
  DAMAGE_ROLLS,
  INITIATIVE_DIE,
  MAX_PRAYED,
  castCost,
  spellCost,
  TO_HIT_DIE,
  attackLabel,
  attackWays,
  characterLabel,
  critOf,
  damageRoll,
  withModifier,
  type Character,
} from "../../shared/characters";
import { castList, highestLevel, type CastSpell } from "../../shared/spellfx";
import type { ChatMessage } from "../../shared/types";
import { castAs, castFromCard, castLevel, castingCost, mayPray, newPrayerDay, setCharacterStrMatched, setPrayed } from "../party";
import { cx, useRoom, useRoomState } from "./common";

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** Whether your last roll with an attack was a critical hit to hit, its damage not rolled yet. */
function critPending(messages: readonly ChatMessage[], userId: string | undefined, who: string, weapon: string): boolean {
  const hit = attackLabel(who, weapon, "to hit");
  const damage = DAMAGE_ROLLS.map((kind) => attackLabel(who, weapon, kind));
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind !== "roll" || m.userId !== userId) continue;
    if (m.text === hit) return critOf(m) === "hit";
    if (damage.includes(m.text)) return false;
  }
  return false;
}

/**
 * A character's spells that the Spells tool can show (from their sheet's Spells tab): a click picks
 * one to cast from their token. One that has to be prayed for (Pray or Memorize on the sheet) can
 * be cast as many times as it's been prayed for today: their player or the GM chooses that here,
 * and each cast uses one up. New day clears them.
 */
/** A spell with nothing on the map, cast from the card: at which level (for one that can take more points), then Cast. */
function CardCast(props: { c: Character; s: CastSpell; chosen: number | null; onLevel: (level: number) => void; onClose: () => void }) {
  const room = useRoom();
  const { c, s } = props;
  const own = s.sheet.level;
  const top = s.raise && own !== null ? Math.max(own, highestLevel(castList(c))) : null;
  const level = castLevel(c, s, props.chosen);
  const cost = castingCost({ entry: s, level });
  return (
    <div class="spell-cast">
      <span class="spell-cast-name">{s.name}</span>
      {own !== null && top !== null && top > own && (
        <label class="field inline">
          <span>Level</span>
          <select value={level ?? own} onChange={(e) => props.onLevel(Number(e.currentTarget.value))}>
            {Array.from({ length: top - own + 1 }, (_, i) => own + i).map((n) => (
              <option key={n} value={n}>
                {`${n} (${castCost(s.sheet.sp, own, n)} SP)`}
              </option>
            ))}
          </select>
        </label>
      )}
      <span class="small muted">
        {cost ? `${cost} SP` : "No SP"}
        {s.prayer ? `, 1 of ${s.left} prayed` : ""}
      </span>
      <button class="btn btn-sm btn-primary" onClick={() => castFromCard(room, c, s, props.chosen) && props.onClose()}>
        Cast
      </button>
      <button class="btn btn-sm" onClick={props.onClose}>
        Cancel
      </button>
    </div>
  );
}

function CardSpells(props: { c: Character; tokenId: string | null }) {
  const room = useRoom();
  const { c, tokenId } = props;
  const [prayingFor, setPrayingFor] = useState<string | null>(null);
  // A spell with nothing on the map, picked to cast from the card (for this character only), and the level chosen.
  const [picked, setPicked] = useState<{ id: string; name: string; level: number | null } | null>(null);
  const list = castList(c);
  if (!list.length) return null;
  const can = mayPray(room, c);
  const praying = prayingFor === c.id && can;
  const castable = list.filter((s) => !s.locked);
  const locked = list.filter((s) => s.locked);
  // Prayed for by the sheet's name: Light (R) once, though it's cast as Light or its reverse.
  const prayers = castable.filter((s, i) => s.prayer && castable.findIndex((x) => x.sheet.name === s.sheet.name) === i);
  const pray = (spell: string, left: number) => void setPrayed(room, c, spell, left).catch((err: Error) => room.toast(err.message, "error"));
  const who = characterLabel(c);
  const casting = !praying && picked?.id === c.id ? castable.find((s) => s.name === picked.name && !s.onMap) : undefined;
  return (
    <div class="character-spells">
      <div class="character-spells-head">
        <span>Spells</span>
        {can && prayers.length > 0 && (
          <button class="link-btn" title={praying ? "Back to casting" : `Choose what ${who} has prayed for today, and how many times`} onClick={() => setPrayingFor(praying ? null : c.id)}>
            {praying ? "Done" : "Pray for today"}
          </button>
        )}
        {can && !praying && Object.keys(c.prayed ?? {}).length > 0 && (
          <button class="link-btn" title="A new day: nothing prayed for" onClick={() => void newPrayerDay(room, c).catch((err: Error) => room.toast(err.message, "error"))}>
            New day
          </button>
        )}
      </div>
      {praying ? (
        <ul class="character-prayers">
          {prayers.map((s) => (
            <li key={s.sheet.name}>
              <span title={s.sheet.prayer === "Memorize" ? "Memorised" : "Prayed for"}>{s.sheet.name}</span>
              <button class="icon-btn" aria-label={`One fewer ${s.sheet.name}`} disabled={s.left <= 0} onClick={() => pray(s.sheet.name, s.left - 1)}>
                −
              </button>
              <span class="prayed-count">{s.left}</span>
              <button class="icon-btn" aria-label={`One more ${s.sheet.name}`} disabled={s.left >= MAX_PRAYED} onClick={() => pray(s.sheet.name, s.left + 1)}>
                +
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div class="spell-chips">
          {castable.map((s) => {
            const cost = spellCost(s.sheet.sp);
            const broke = cost > 0 && c.sp !== null && cost > c.sp;
            const out = (s.prayer && s.left <= 0) || broke;
            const how = s.prayer ? (s.left <= 0 ? "Not prayed for today" : `Prayed for: ${s.left} left today`) : s.sheet.prayer === "Ask DM" ? "Ask the GM" : "";
            const pays = cost ? (broke ? `Costs ${cost} SP: not enough left` : `${cost} SP off their sheet`) : `${s.sheet.sp || "No"} SP`;
            const what = s.onMap ? `Cast ${s.name} from ${who}` : can ? `Cast ${s.name} as ${who}: nothing on the map, a line in the chat` : `Only the GM or ${who}'s player can cast ${s.name}`;
            return (
              <button
                key={s.name}
                class={cx("chip spell-chip", !s.onMap && "plain", out && "out", casting === s && "picked")}
                disabled={(s.onMap ? !tokenId : !can) || out}
                title={[what, pays, how].filter(Boolean).join(" · ")}
                onClick={() => (s.onMap ? tokenId && castAs(room, tokenId, s.name) : setPicked({ id: c.id, name: s.name, level: null }))}
              >
                {s.name}
                <span class="spell-sp">{s.sheet.sp}</span>
                {s.prayer && <span class="spell-left">{s.left <= 0 ? "–" : `×${s.left}`}</span>}
              </button>
            );
          })}
        </div>
      )}
      {casting && (
        <CardCast
          c={c}
          s={casting}
          chosen={picked?.level ?? null}
          onLevel={(level) => setPicked({ id: c.id, name: casting.name, level })}
          onClose={() => setPicked(null)}
        />
      )}
      {!praying && locked.length > 0 && <div class="small muted">Not castable yet: {locked.map((s) => s.name).join(", ")}</div>}
    </div>
  );
}

export function CharacterCard(props: { c: Character; tokenId?: string | null }) {
  const room = useRoom();
  const messages = useRoomState((s) => s.messages);
  const me = useRoomState((s) => s.me?.userId);
  const { c } = props;
  const who = characterLabel(c);
  const share = c.hp !== null && c.maxHp ? Math.max(0, Math.min(1, c.hp / c.maxHp)) : null;
  const roll = (expr: string, label: string) => room.roll(expr, { label });
  const gm = useRoomState((s) => s.me?.role === "gm");
  const ways = c.attacks.flatMap((a) => attackWays(a, { sneakRank: c.sneakRank, strBonus: c.strBonus, strMatched: c.strMatched }));
  const matchStr = (weapon: string, matched: boolean) =>
    void setCharacterStrMatched(room, c, weapon, matched).catch((err: Error) => room.toast(err.message, "error"));
  // Ticked for this character only (the card stays up when another token is picked).
  const [sneakFor, setSneakFor] = useState<string | null>(null);
  const sneak = sneakFor === c.id;
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
      {ways.some((w) => w.sneak) && (
        <label class="character-sneak" title="Tick it for a hit that's a sneak attack: the damage roll adds the sneak attack dice from the sheet, then it unticks">
          <input type="checkbox" checked={sneak} onChange={(e) => setSneakFor(e.currentTarget.checked ? c.id : null)} />
          Sneak attack
        </label>
      )}
      {ways.length > 0 && (
        <ul class="character-attacks">
          {ways.map((w, i) => {
            const hit = withModifier(TO_HIT_DIE, w.toHit);
            const crit = critPending(messages, me, who, w.name);
            const sneaking = sneak && !!w.sneak;
            const dmg = damageRoll(w, { crit, sneak: sneaking });
            const kind = crit ? (sneaking ? "crit sneak damage" : "crit damage") : sneaking ? "sneak damage" : "damage";
            return (
              <li key={`${i}:${w.name}`}>
                <span class="character-weapon" title={w.detail}>
                  {w.name}
                </span>
                {w.ranged && c.strBonus != null && (gm || w.strMatched) && (
                  <button
                    class={cx("str-match", w.strMatched && "on")}
                    disabled={!gm}
                    aria-pressed={w.strMatched}
                    title={
                      w.strMatched
                        ? `Matched to their strength: its damage adds their STR bonus (${signed(c.strBonus)})${gm ? ". Click to unmark it" : ""}`
                        : `GM: mark it as matched to their strength, so its damage adds their STR bonus (${signed(c.strBonus)})`
                    }
                    onClick={() => matchStr(w.weapon, !w.strMatched)}
                  >
                    STR
                  </button>
                )}
                <button class="btn btn-sm" title={`Roll ${hit} to hit (a natural 20 is a critical hit, a natural 2 a critical failure)`} onClick={() => roll(hit, attackLabel(who, w.name, "to hit"))}>
                  <Dices size={13} /> {hit}
                </button>
                {dmg && (
                  <button
                    class={cx("btn btn-sm", crit && "crit", sneaking && "sneak")}
                    title={[crit && "Critical hit: the most the weapon's dice can roll, added", sneaking && `Sneak attack: ${w.sneak} added`, `Roll ${dmg} damage`].filter(Boolean).join(". ")}
                    onClick={() => {
                      roll(dmg, attackLabel(who, w.name, kind));
                      if (sneaking) setSneakFor(null);
                    }}
                  >
                    {crit ? `Crit ${dmg}` : dmg}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <CardSpells c={c} tokenId={props.tokenId ?? null} />
    </div>
  );
}
