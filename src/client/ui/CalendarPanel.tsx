// The Calendar panel (shared/calendar.ts): the day the game is at, with its season, weather and
// moons; the month, with what's on each day; a day's events, and the party's log. The GM moves
// the day on, sets the region and the weather, adds and changes events (some the GM's eyes
// only), and brings the calendar in from Fantasy Calendar. The top bar's DateChip shows the date.

import { useEffect, useMemo, useState } from "preact/hooks";
import { CalendarDays, ChevronLeft, ChevronRight, Cloud, CloudDrizzle, CloudFog, CloudRain, CloudSnow, CloudSun, EyeOff, Pencil, RefreshCw, Snowflake, Sun, Trash2 } from "lucide-preact";
import {
  dateOf,
  dateText,
  epochOf,
  eventsOn,
  moonPhase,
  moonPhaseName,
  repeatRule,
  ruleSummary,
  seasonOf,
  weatherOf,
  type CalEvent,
  type Calendar,
  type Weather,
} from "../../shared/calendar";
import { deleteCalendar, eventId, importCalendar, patchCalendar } from "../calendar";
import { cx, useRoom, useRoomState } from "./common";

/** The date in the top bar: a click opens the panel. */
export function DateChip() {
  const room = useRoom();
  const cal = useRoomState((s) => s.calendar);
  const panel = useRoomState((s) => s.panel);
  if (!cal) return null;
  const d = dateOf(cal, cal.today);
  const w = weatherOf(cal, cal.today);
  return (
    <button class={cx("btn btn-sm date-chip hide-narrow", panel === "calendar" && "active")} title={`${dateText(cal, cal.today)} · ${cal.weatherNotes[String(cal.today)] ?? w.text}`} onClick={() => room.setPanel(panel === "calendar" ? null : "calendar")}>
      <CalendarDays size={14} /> {d.day} {cal.months[d.month]?.name}, Y{d.year} <WeatherIcon w={w} size={14} />
    </button>
  );
}

function WeatherIcon(props: { w: Weather; size: number }) {
  const { w, size } = props;
  if (w.precipitation !== "none") {
    if (w.kind === "snow") return <CloudSnow size={size} />;
    if (w.kind === "sleet") return <Snowflake size={size} />;
    return w.precipitation === "heavy" ? <CloudRain size={size} /> : <CloudDrizzle size={size} />;
  }
  if (w.clouds === "overcast") return <CloudFog size={size} />;
  if (w.clouds === "cloudy") return <Cloud size={size} />;
  if (w.clouds === "a few clouds") return <CloudSun size={size} />;
  return <Sun size={size} />;
}

/** A moon as it looks that night: the lit part by its phase (0 new, half way round full). */
function MoonIcon(props: { phase: number; granularity: number; color: string; size?: number }) {
  const r = 9;
  const f = props.phase / Math.max(2, props.granularity);
  const rx = r * Math.abs(Math.cos(2 * Math.PI * f));
  const lit = props.color;
  const dark = "#2a2d36";
  const half = f <= 0.5 ? `M${r},0 a${r},${r} 0 0 1 0,${2 * r} z` : `M${r},0 a${r},${r} 0 0 0 0,${2 * r} z`;
  const middleLit = f > 0.25 && f < 0.75;
  return (
    <svg width={props.size ?? 18} height={props.size ?? 18} viewBox={`0 0 ${2 * r} ${2 * r}`} aria-hidden="true">
      <circle cx={r} cy={r} r={r} fill={dark} />
      {f > 0 && <path d={half} fill={lit} />}
      {f > 0 && <ellipse cx={r} cy={r} rx={rx} ry={r} fill={middleLit ? lit : dark} />}
      <circle cx={r} cy={r} r={r - 0.5} fill="none" stroke="rgba(255,255,255,0.25)" />
    </svg>
  );
}

type Repeat = "none" | "yearly" | "monthly" | "everyDays";

interface Draft {
  id: string;
  name: string;
  text: string;
  category: string;
  gmOnly: boolean;
  days: number;
  repeat: Repeat;
  every: number;
  /** The rule kept as it was (from Fantasy Calendar), when the event has one. */
  rule?: { conditions: unknown[]; summary: string };
}

export function CalendarPanel() {
  const room = useRoom();
  const gm = useRoomState((s) => s.me?.role === "gm");
  const cal = useRoomState((s) => s.calendar);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [view, setView] = useState<{ year: number; month: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [log, setLog] = useState("");
  // The panel opens on today; it follows the day as the GM moves it, until a day is picked.
  useEffect(() => {
    if (!cal) return;
    if (picked === null) {
      const d = dateOf(cal, cal.today);
      setView({ year: d.year, month: d.month });
    }
  }, [cal?.today, cal, picked]);
  const act = (what: () => Promise<unknown>, then?: () => void) => {
    setBusy(true);
    what()
      .then(() => then?.())
      .catch((err: Error) => room.toast(err.message, "error"))
      .finally(() => setBusy(false));
  };
  if (!cal) return gm ? <CalendarSetup busy={busy} act={act} /> : <p class="small muted">The GM hasn't set up the calendar yet.</p>;

  const today = cal.today;
  const shown = picked ?? today;
  const d = dateOf(cal, today);
  const v = view ?? { year: d.year, month: d.month };
  const season = seasonOf(cal, today);
  const weather = weatherOf(cal, today);
  const note = cal.weatherNotes[String(today)];
  const monthStart = epochOf(cal, v.year, v.month, 1);
  const monthLen = cal.months[v.month]?.length ?? 30;
  const W = Math.max(1, cal.weekdays.length);
  const firstWeekday = dateOf(cal, monthStart).weekday;
  const byDay = useMemo(() => {
    const out = new Map<number, CalEvent[]>();
    for (let i = 0; i < monthLen; i++) out.set(monthStart + i, eventsOn(cal, monthStart + i, gm));
    return out;
  }, [cal, monthStart, monthLen, gm]);
  const catOf = (id: string) => cal.categories.find((c) => c.id === id);
  const moveMonth = (by: number) => {
    let m = v.month + by;
    let y = v.year;
    if (m < 0) {
      m = cal.months.length - 1;
      y--;
    } else if (m >= cal.months.length) {
      m = 0;
      y++;
    }
    setView({ year: y, month: m });
  };
  const edit = (e: CalEvent) =>
    setDraft({
      id: e.id,
      name: e.name,
      text: e.text,
      category: e.category,
      gmOnly: e.gmOnly,
      days: e.days,
      repeat: e.when.kind === "rule" ? "none" : "none",
      every: 7,
      rule: e.when.kind === "rule" ? { conditions: e.when.conditions, summary: e.when.summary } : undefined,
    });
  const add = () => setDraft({ id: eventId(), name: "", text: "", category: cal.logCategory, gmOnly: false, days: 1, repeat: "none", every: 7 });
  const save = (dr: Draft) => {
    const at = dateOf(cal, shown);
    const when: CalEvent["when"] = dr.rule
      ? { kind: "rule", conditions: dr.rule.conditions, summary: dr.rule.summary }
      : dr.repeat === "none"
        ? { kind: "date", year: at.year, month: at.month, day: at.day }
        : { kind: "rule", conditions: repeatRule(dr.repeat, { month: at.month, day: at.day }, dr.every, shown), summary: ruleSummary(cal, repeatRule(dr.repeat, { month: at.month, day: at.day }, dr.every, shown)) };
    const e: CalEvent = { id: dr.id, name: dr.name.trim() || "Event", text: dr.text.trim(), category: dr.category, gmOnly: dr.gmOnly, when, days: Math.max(1, Math.round(dr.days) || 1) };
    act(() => patchCalendar(room, { upsert: [e] }), () => setDraft(null));
  };
  const addLog = () => {
    const text = log.trim();
    if (!text) return;
    const at = dateOf(cal, today);
    const e: CalEvent = { id: eventId(), name: text.slice(0, 200), text: "", category: cal.logCategory, gmOnly: false, when: { kind: "date", year: at.year, month: at.month, day: at.day }, days: 1 };
    act(() => patchCalendar(room, { upsert: [e] }), () => setLog(""));
  };
  const dayEvents = byDay.get(shown) ?? eventsOn(cal, shown, gm);

  return (
    <div class="calendar">
      <section class="cal-today">
        <div class="cal-today-head">
          <div>
            <div class="cal-date">{dateText(cal, today)}</div>
            <div class="small muted">
              {cal.seasons[season.index]?.name ?? ""}, day {season.day} · {cal.climate}
            </div>
          </div>
          {gm && (
            <span class="cal-day-buttons">
              <button class="icon-btn" title="A day back" aria-label="A day back" disabled={busy} onClick={() => act(() => patchCalendar(room, { today: today - 1 }))}>
                <ChevronLeft size={16} />
              </button>
              <button class="icon-btn" title="A day on" aria-label="A day on" disabled={busy} onClick={() => act(() => patchCalendar(room, { today: today + 1 }))}>
                <ChevronRight size={16} />
              </button>
            </span>
          )}
        </div>
        <div class="cal-weather">
          <WeatherIcon w={weather} size={18} />
          <span>{note ?? weather.text}</span>
          {gm && (
            <button class="icon-btn" title="Roll today's weather again" aria-label="Roll today's weather again" disabled={busy} onClick={() => act(() => patchCalendar(room, { reroll: today, note: { epoch: today, text: null } }))}>
              <RefreshCw size={14} />
            </button>
          )}
        </div>
        {cal.moons.length > 0 && (
          <div class="cal-moons">
            {cal.moons.map((m) => {
              const phase = moonPhase(m, today);
              return (
                <span key={m.name} class="cal-moon" title={`${m.name}: ${moonPhaseName(phase, m.granularity)} (a ${m.cycle}-day cycle)`}>
                  <MoonIcon phase={phase} granularity={m.granularity} color={m.color} /> {m.name} <span class="muted">{moonPhaseName(phase, m.granularity)}</span>
                </span>
              );
            })}
          </div>
        )}
        {gm && <GmDayControls cal={cal} busy={busy} act={act} />}
      </section>

      {gm && (
        <section class="cal-log">
          <label class="field">
            <span class="small">The party's log for today</span>
            <span class="cal-log-row">
              <input value={log} placeholder="What happened" maxLength={200} onInput={(e) => setLog(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && addLog()} />
              <button class="btn btn-sm" disabled={busy || !log.trim()} onClick={addLog}>
                Log it
              </button>
            </span>
          </label>
        </section>
      )}

      <section class="cal-month">
        <div class="cal-month-head">
          <button class="icon-btn" title="The month before" aria-label="The month before" onClick={() => moveMonth(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button class="link-btn cal-month-name" title="Back to today" onClick={() => { setPicked(null); setView(null); }}>
            {cal.months[v.month]?.name}, Year {v.year}
          </button>
          <button class="icon-btn" title="The month after" aria-label="The month after" onClick={() => moveMonth(1)}>
            <ChevronRight size={16} />
          </button>
        </div>
        <div class="cal-grid" style={{ gridTemplateColumns: `repeat(${W}, 1fr)` }}>
          {cal.weekdays.map((w) => (
            <div key={w} class="cal-weekday" title={w}>
              {w.slice(0, 2)}
            </div>
          ))}
          {Array.from({ length: firstWeekday - 1 }, (_, i) => (
            <div key={`pad${i}`} />
          ))}
          {Array.from({ length: monthLen }, (_, i) => {
            const epoch = monthStart + i;
            const list = byDay.get(epoch) ?? [];
            return (
              <button
                key={epoch}
                class={cx("cal-day", epoch === today && "today", epoch === shown && "picked", epoch < today && "past")}
                title={list.map((e) => e.name).join("\n") || undefined}
                onClick={() => setPicked(epoch)}
              >
                <span class="cal-day-num">{i + 1}</span>
                {list.length > 0 && (
                  <span class="cal-dots">
                    {list.slice(0, 4).map((e) => (
                      <span key={e.id} class="cal-dot" style={{ background: catOf(e.category)?.color ?? "#8a8f98" }} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section class="cal-day-list">
        <div class="cal-day-list-head">
          <strong>{dateText(cal, shown)}</strong>
          {gm && !draft && (
            <button class="btn btn-sm" disabled={busy} onClick={add}>
              Add an event
            </button>
          )}
        </div>
        {shown !== today && <p class="small muted">{weatherOf(cal, shown).text}</p>}
        {draft && <EventForm cal={cal} draft={draft} busy={busy} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} />}
        {dayEvents.length === 0 && !draft && <p class="small muted">Nothing on this day.</p>}
        <ul class="cal-events">
          {dayEvents.map((e) => {
            const cat = catOf(e.category);
            return (
              <li key={e.id} class={cx("cal-event", e.gmOnly && "gm-only")}>
                <span class="cal-dot" style={{ background: cat?.color ?? "#8a8f98" }} />
                <div class="cal-event-body">
                  <div class="cal-event-name">
                    {e.name}
                    {e.gmOnly && <EyeOff size={12} aria-label="The GM's eyes only" />}
                  </div>
                  <div class="small muted">
                    {[cat?.name, e.when.kind === "rule" ? e.when.summary : null, e.days > 1 ? `${e.days} days` : null].filter(Boolean).join(" · ")}
                  </div>
                  {e.text && <div class="small cal-event-text">{e.text}</div>}
                </div>
                {gm && (
                  <span class="cal-event-actions">
                    <button class="icon-btn" title="Change it" aria-label="Change it" disabled={busy} onClick={() => edit(e)}>
                      <Pencil size={14} />
                    </button>
                    <button class="icon-btn" title="Take it off the calendar" aria-label="Take it off the calendar" disabled={busy} onClick={() => act(() => patchCalendar(room, { delete: [e.id] }))}>
                      <Trash2 size={14} />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {gm && <CalendarSettings cal={cal} busy={busy} act={act} />}
    </div>
  );
}

function GmDayControls(props: { cal: Calendar; busy: boolean; act: (what: () => Promise<unknown>, then?: () => void) => void }) {
  const room = useRoom();
  const { cal, busy, act } = props;
  const d = dateOf(cal, cal.today);
  const [year, setYear] = useState(String(d.year));
  const [month, setMonth] = useState(d.month);
  const [day, setDay] = useState(String(d.day));
  const [note, setNote] = useState(cal.weatherNotes[String(cal.today)] ?? "");
  useEffect(() => {
    setYear(String(d.year));
    setMonth(d.month);
    setDay(String(d.day));
    setNote(cal.weatherNotes[String(cal.today)] ?? "");
  }, [cal.today, d.year, d.month, d.day, cal.weatherNotes]);
  const go = () => {
    const y = Number(year), dd = Number(day);
    if (!Number.isInteger(y) || !Number.isInteger(dd) || dd < 1) return room.toast("A whole year and day, please.", "error");
    act(() => patchCalendar(room, { today: epochOf(cal, y, month, Math.min(dd, cal.months[month]?.length ?? dd)) }));
  };
  return (
    <details class="cal-gm">
      <summary class="small">Set the date, region and weather</summary>
      <div class="cal-set-date">
        <input class="cal-num" value={day} aria-label="Day" inputMode="numeric" onInput={(e) => setDay(e.currentTarget.value)} />
        <select value={month} aria-label="Month" onChange={(e) => setMonth(Number(e.currentTarget.value))}>
          {cal.months.map((m, i) => (
            <option key={i} value={i}>
              {m.name}
            </option>
          ))}
        </select>
        <input class="cal-num" value={year} aria-label="Year" inputMode="numeric" onInput={(e) => setYear(e.currentTarget.value)} />
        <button class="btn btn-sm" disabled={busy} onClick={go}>
          Go to this day
        </button>
      </div>
      <label class="field">
        <span class="small">The region the party is in</span>
        <select value={cal.climate} onChange={(e) => act(() => patchCalendar(room, { climate: e.currentTarget.value }))}>
          {cal.climates.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label class="field">
        <span class="small">Today's weather in your own words (blank: as rolled)</span>
        <span class="cal-log-row">
          <input value={note} maxLength={500} placeholder={weatherOf(cal, cal.today).text} onInput={(e) => setNote(e.currentTarget.value)} />
          <button class="btn btn-sm" disabled={busy} onClick={() => act(() => patchCalendar(room, { note: { epoch: cal.today, text: note.trim() || null } }))}>
            Keep
          </button>
        </span>
      </label>
      <button class="btn btn-sm" disabled={busy} title="A fresh roll of the weather for every day from here on" onClick={() => act(() => patchCalendar(room, { newWeather: true }))}>
        <RefreshCw size={14} /> New weather for the whole calendar
      </button>
    </details>
  );
}

function EventForm(props: { cal: Calendar; draft: Draft; busy: boolean; onChange: (d: Draft) => void; onSave: (d: Draft) => void; onCancel: () => void }) {
  const { cal, draft, busy } = props;
  const set = (change: Partial<Draft>) => props.onChange({ ...draft, ...change });
  return (
    <div class="cal-form">
      <label class="field">
        <span class="small">What</span>
        <input value={draft.name} maxLength={200} onInput={(e) => set({ name: e.currentTarget.value })} />
      </label>
      <label class="field">
        <span class="small">More about it</span>
        <textarea rows={3} value={draft.text} maxLength={8000} onInput={(e) => set({ text: e.currentTarget.value })} />
      </label>
      <div class="cal-form-row">
        <label class="field">
          <span class="small">Kind</span>
          <select value={draft.category} onChange={(e) => set({ category: e.currentTarget.value })}>
            <option value="">(none)</option>
            {cal.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span class="small">Days</span>
          <input class="cal-num" value={draft.days} inputMode="numeric" onInput={(e) => set({ days: Number(e.currentTarget.value) || 1 })} />
        </label>
      </div>
      {draft.rule ? (
        <p class="small muted">Comes round: {draft.rule.summary}.</p>
      ) : (
        <div class="cal-form-row">
          <label class="field">
            <span class="small">Comes round</span>
            <select value={draft.repeat} onChange={(e) => set({ repeat: e.currentTarget.value as Repeat })}>
              <option value="none">Once, on this day</option>
              <option value="yearly">Every year on this day</option>
              <option value="monthly">Every month on this day</option>
              <option value="everyDays">Every so many days from this day</option>
            </select>
          </label>
          {draft.repeat === "everyDays" && (
            <label class="field">
              <span class="small">Every</span>
              <input class="cal-num" value={draft.every} inputMode="numeric" onInput={(e) => set({ every: Number(e.currentTarget.value) || 1 })} />
            </label>
          )}
        </div>
      )}
      <label class="check small">
        <input type="checkbox" checked={draft.gmOnly} onChange={(e) => set({ gmOnly: e.currentTarget.checked })} />
        <span>The GM's eyes only</span>
      </label>
      <div class="dialog-actions">
        <button class="btn btn-sm btn-primary" disabled={busy || !draft.name.trim()} onClick={() => props.onSave(draft)}>
          Keep it
        </button>
        <button class="btn btn-sm" disabled={busy} onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** GM, before there's a calendar: start a plain one, or bring one in from Fantasy Calendar. */
function CalendarSetup(props: { busy: boolean; act: (what: () => Promise<unknown>, then?: () => void) => void }) {
  const room = useRoom();
  return (
    <div class="calendar">
      <p class="small muted">The campaign's calendar: the day the game is at, the moons, the seasons, the weather, and what happens when. Everyone in your rooms sees it.</p>
      <button class="btn btn-sm" disabled={props.busy} onClick={() => props.act(() => patchCalendar(room, { today: 0 }))}>
        Start a plain calendar
      </button>
      <FantasyCalendarImport busy={props.busy} act={props.act} />
    </div>
  );
}

function FantasyCalendarImport(props: { busy: boolean; act: (what: () => Promise<unknown>, then?: () => void) => void; source?: string }) {
  const room = useRoom();
  const [link, setLink] = useState(props.source ? `https://app.fantasy-calendar.com/calendars/${props.source}` : "");
  const bring = (from: { link: string } | { data: unknown }) =>
    props.act(async () => {
      const { notes } = await importCalendar(room, from);
      room.toast(notes?.length ? `The calendar is in. ${notes.join(" ")}` : "The calendar is in.");
    });
  const file = (f: File | undefined) => {
    if (!f) return;
    f.text().then((text) => {
      try {
        bring({ data: JSON.parse(text) });
      } catch {
        room.toast("That file isn't JSON.", "error");
      }
    });
  };
  return (
    <div class="cal-import">
      <label class="field">
        <span class="small">{props.source ? "Bring the changes over from Fantasy Calendar again" : "Bring in a calendar from Fantasy Calendar (a public one's link)"}</span>
        <span class="cal-log-row">
          <input value={link} placeholder="https://app.fantasy-calendar.com/calendars/…" onInput={(e) => setLink(e.currentTarget.value)} />
          <button class="btn btn-sm" disabled={props.busy || !/[a-f0-9]{32}/.test(link)} onClick={() => bring({ link })}>
            {props.source ? "Sync" : "Bring it in"}
          </button>
        </span>
      </label>
      <label class="field">
        <span class="small">Or from a file: Fantasy Calendar's export, or one kept from here</span>
        <input type="file" accept=".json,application/json" disabled={props.busy} onChange={(e) => file(e.currentTarget.files?.[0])} />
      </label>
      {props.source && <p class="small muted">A sync brings Fantasy Calendar's events over again (changed there, changed here) and keeps the events made here, the day, the region and the weather.</p>}
    </div>
  );
}

function CalendarSettings(props: { cal: Calendar; busy: boolean; act: (what: () => Promise<unknown>, then?: () => void) => void }) {
  const room = useRoom();
  const [sure, setSure] = useState(false);
  return (
    <details class="cal-gm">
      <summary class="small">Bring in, keep a copy, or take away</summary>
      <FantasyCalendarImport busy={props.busy} act={props.act} source={props.cal.source?.fc} />
      <div class="cal-form-row">
        <a class="btn btn-sm" href="/api/calendar/export" download>
          Keep a copy (a file)
        </a>
        {sure ? (
          <span class="cal-log-row">
            <span class="small">Take the whole calendar away?</span>
            <button class="btn btn-sm btn-danger" disabled={props.busy} onClick={() => props.act(() => deleteCalendar(room), () => setSure(false))}>
              Yes, take it away
            </button>
            <button class="btn btn-sm" onClick={() => setSure(false)}>
              No
            </button>
          </span>
        ) : (
          <button class="btn btn-sm" disabled={props.busy} onClick={() => setSure(true)}>
            Take the calendar away
          </button>
        )}
      </div>
    </details>
  );
}
