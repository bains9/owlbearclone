// The Calendar panel (shared/calendar.ts): the day the game is at, with its season, weather and
// moons; the month, with what's on each day; a day's events, and the party's log. The GM moves
// the day on, sets the region and the weather, adds and changes events (some the GM's eyes
// only), and brings the calendar in from Fantasy Calendar. The top bar's DateChip shows the date.

import { useEffect, useMemo, useState } from "preact/hooks";
import { CalendarDays, ChevronLeft, ChevronRight, Cloud, CloudDrizzle, CloudFog, CloudRain, CloudSnow, CloudSun, EyeOff, Pencil, RefreshCw, Search, Snowflake, Sun, Trash2 } from "lucide-preact";
import {
  dateOf,
  TIMES_OF_DAY,
  INDOORS,
  dateText,
  dayLine,
  weatherHere,
  timeLine,
  epochOf,
  eventsOn,
  nextOccurrence,
  upcoming,
  moonPhase,
  moonPhaseName,
  repeatRule,
  ruleSummary,
  seasonOf,
  weatherOf,
  type CalEvent,
  type Calendar,
  type TimeOfDay,
  type Weather,
} from "../../shared/calendar";
import { deleteCalendar, eventId, importCalendar, logLine, patchCalendar } from "../calendar";
import { NewPartyDay } from "./PartySection";
import { outdoorKey } from "../room/seasons";
import { playWeatherSound, setWeatherSoundWanted, stopWeatherSound, unlockWeatherSound, weatherSoundQuiet, weatherSoundWanted } from "../weatherSound";
import { Volume2, VolumeX } from "lucide-preact";
import { cx, useRoom, useRoomState } from "./common";

/** The scene on show's own weather region, if it has one (INDOORS: no weather there). */
function useSceneRegion(): string | undefined {
  return useRoomState((s) => (s.viewSceneId ? s.scenes[s.viewSceneId]?.region : undefined));
}

/** Whether rain and snow reach the scene on show, and why (shared/calendar.ts weatherHere). */
function useWeatherHere(): ReturnType<typeof weatherHere> {
  const scene = useRoomState((s) => (s.viewSceneId ? s.scenes[s.viewSceneId] : undefined));
  const share = useRoomState((s) => {
    const sc = s.viewSceneId ? s.scenes[s.viewSceneId] : undefined;
    return sc?.mapAssetId ? s.mapOutdoor[outdoorKey(sc.mapAssetId, sc.mapData ? { assetId: sc.mapData.assetId } : undefined)] : undefined;
  });
  return weatherHere(scene, share);
}

/** Whether the scene on show is indoors or underground, where no rain or snow falls. */
function useIndoors(): boolean {
  return !useWeatherHere().on;
}

/**
 * GM: whether rain and snow fall on the map on show: Automatic (with its reason), Always or
 * Never, for when Automatic guesses wrong (a world map that reads as indoors, say).
 */
function WeatherHereControl() {
  const room = useRoom();
  const scene = useRoomState((s) => (s.viewSceneId ? s.scenes[s.viewSceneId] : undefined));
  const here = useWeatherHere();
  if (!scene) return null;
  const mode = scene.weather ?? (scene.region === INDOORS ? "off" : "auto");
  const set = (to: "auto" | "on" | "off") => {
    if (to === mode) return;
    room.updateScene(scene.id, { weather: to === "auto" ? null : to, ...(scene.region === INDOORS ? { region: null } : {}) });
  };
  return (
    <div class="cal-here">
      <span class="small">Weather on this map</span>
      <div class="seg" role="group" aria-label="Weather on this map">
        {(
          [
            ["auto", "Automatic"],
            ["on", "Always"],
            ["off", "Never"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} class={cx("seg-btn", mode === id && "active")} aria-pressed={mode === id} onClick={() => set(id)}>
            {label}
          </button>
        ))}
      </div>
      <span class="small muted">
        {here.auto ? `Automatic: ${here.on ? "rain and snow fall here" : "none here"}, as ${here.why}.` : here.on ? "Always: rain and snow fall here whatever the map." : "Never: no rain or snow on this map."}
      </span>
    </div>
  );
}

/** The date in the top bar: a click opens the panel. */
export function DateChip() {
  const room = useRoom();
  const cal = useRoomState((s) => s.calendar);
  const panel = useRoomState((s) => s.panel);
  const region = useSceneRegion();
  if (!cal) return null;
  const d = dateOf(cal, cal.today);
  const w = weatherOf(cal, cal.today, region === INDOORS ? undefined : region);
  return (
    <button class={cx("btn btn-sm date-chip hide-narrow", panel === "calendar" && "active")} title={`${dateText(cal, cal.today)} · ${cal.weatherNotes[String(cal.today)] ?? w.text}`} onClick={() => room.setPanel(panel === "calendar" ? null : "calendar")}>
      <CalendarDays size={14} /> {d.day} {cal.months[d.month]?.name}, Y{d.year} <WeatherIcon w={w} size={14} />
    </button>
  );
}

/**
 * The date on the map itself (top right), for everyone, table displays too, so every map says
 * what day it is without opening the panel. The GM can keep it to the panel (showOnMap).
 */
export function DateOverlay() {
  const room = useRoom();
  const cal = useRoomState((s) => s.calendar);
  const region = useSceneRegion();
  const here = useWeatherHere();
  if (!cal || cal.showOnMap === false) return null;
  const d = dateOf(cal, cal.today);
  const w = weatherOf(cal, cal.today, region === INDOORS ? undefined : region);
  const note = !here.on ? (here.auto ? "indoors" : "no weather on this map") : region ? undefined : cal.weatherNotes[String(cal.today)];
  const body = (
    <>
      <CalendarDays size={14} />
      <span class="date-overlay-day">
        {cal.weekdays[d.weekday - 1]} {d.day} {cal.months[d.month]?.name}, Year {d.year} · {cal.timeOfDay ?? "morning"}
      </span>
      <WeatherIcon w={w} size={14} />
      <span class="date-overlay-weather muted">{note ?? w.text}</span>
    </>
  );
  if (room.display) return <div class="date-overlay">{body}</div>;
  return (
    <button class="date-overlay" title={here.on ? "Open the calendar" : `No rain or snow here: ${here.why}. Open the calendar (GM: Weather on this map).`} onClick={() => room.setPanel("calendar")}>
      {body}
    </button>
  );
}

/**
 * A table display's day at a glance, for a minute after the day changes: the date and time, the
 * weather, the moons and what's on, big enough to read across the table.
 */
export function DayCard() {
  const cal = useRoomState((s) => s.calendar);
  const until = useRoomState((s) => s.dayCardUntil);
  const picked = useSceneRegion();
  const region = picked === INDOORS ? undefined : picked;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    const t = setTimeout(() => setNow(Date.now()), until - Date.now() + 50);
    return () => clearTimeout(t);
  }, [until]);
  if (!cal || until <= now) return null;
  const w = weatherOf(cal, cal.today, region);
  const events = eventsOn(cal, cal.today, false);
  return (
    <div class="day-card" aria-live="polite">
      <div class="day-card-date">{dateText(cal, cal.today)}</div>
      <div class="day-card-line">
        <WeatherIcon w={w} size={28} /> <span>{cal.weatherNotes[String(cal.today)] ?? w.text}</span>
      </div>
      {cal.moons.length > 0 && (
        <div class="day-card-moons">
          {cal.moons.map((m) => {
            const phase = moonPhase(m, cal.today);
            return (
              <span key={m.name} class="cal-moon">
                <MoonIcon phase={phase} granularity={m.granularity} color={m.color} size={28} /> {m.name}, {moonPhaseName(phase, m.granularity)}
              </span>
            );
          })}
        </div>
      )}
      {events.length > 0 && <div class="day-card-events">{events.map((e) => e.name).join(" · ")}</div>}
    </div>
  );
}

/** Rain and wind to hear, on this device only, once turned on here (a browser plays only after a click). */
export function WeatherSoundButton() {
  const cal = useRoomState((s) => s.calendar);
  const region = useSceneRegion();
  const indoors = useIndoors();
  const [on, setOn] = useState(weatherSoundWanted);
  const w = cal && !indoors ? weatherOf(cal, cal.today, region === INDOORS ? undefined : region) : null;
  useEffect(() => {
    if (on) playWeatherSound(w);
    else stopWeatherSound();
  }, [on, w?.text]);
  if (!cal) return null;
  return (
    <button
      class={cx("icon-btn", on && "active")}
      title={on ? `Rain and wind sound: on (this device)${weatherSoundQuiet(w) ? `, but quiet now: ${weatherSoundQuiet(w)}` : ""}` : "Rain and wind sound: off (this device)"}
      aria-label={on ? "Turn the weather's sound off" : "Turn the weather's sound on"}
      aria-pressed={on}
      onClick={() => {
        // Started in the tap itself, or Safari stays silent.
        if (!on) unlockWeatherSound();
        setWeatherSoundWanted(!on);
        setOn(!on);
      }}
    >
      {on ? <Volume2 size={14} /> : <VolumeX size={14} />}
    </button>
  );
}

/** Rain or snow falling over the map on a wet day (CSS, styles.css .weather-fx), unless the GM keeps the map dry. */
export function WeatherFx() {
  const cal = useRoomState((s) => s.calendar);
  const region = useSceneRegion();
  const indoors = useIndoors();
  if (!cal || cal.weatherOnMap === false || indoors) return null;
  const w = weatherOf(cal, cal.today, region);
  if (w.precipitation === "none") return null;
  return <div class={`weather-fx ${w.kind === "rain" ? "rain" : "snow"} ${w.precipitation}`} aria-hidden="true" />;
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
export function MoonIcon(props: { phase: number; granularity: number; color: string; size?: number }) {
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
  const [find, setFind] = useState("");
  const party = useRoomState((s) => s.party?.configured === true);
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
    act(() => logLine(room, text), () => setLog(""));
  };
  // The GM moving the day: a line in the chat says where the game is now.
  const moveDay = (epoch: number) => act(() => patchCalendar(room, { today: epoch }).then(({ calendar }) => room.sendChat(dayLine(calendar))));
  const setTime = (time: TimeOfDay) => {
    if ((cal.timeOfDay ?? "morning") === time) return;
    act(() => patchCalendar(room, { timeOfDay: time }).then(() => room.sendChat(timeLine(time))));
  };
  const goTo = (epoch: number) => {
    setPicked(epoch);
    const at = dateOf(cal, epoch);
    setView({ year: at.year, month: at.month });
  };
  const soon = useMemo(() => upcoming(cal, today, 30, gm).filter((x) => x.epoch !== today).slice(0, 8), [cal, today, gm]);
  const found = useMemo(() => {
    const q = find.trim().toLowerCase();
    if (!q) return [];
    return cal.events
      .filter((e) => (gm || !e.gmOnly) && e.name.toLowerCase().includes(q))
      .slice(0, 12)
      .map((e) => ({ event: e, epoch: nextOccurrence(cal, e, today) }));
  }, [cal, find, gm, today]);
  const dayWord = (epoch: number) => {
    const n = epoch - today;
    if (n === 0) return "today";
    if (n === 1) return "tomorrow";
    if (n === -1) return "yesterday";
    return n > 0 ? `in ${n} days` : `${-n} days ago`;
  };
  const dayEvents = byDay.get(shown) ?? eventsOn(cal, shown, gm);
  // Looking at another day or month: the Today button beside the date comes back.
  const away = shown !== today || v.year !== d.year || v.month !== d.month;
  const backToToday = () => {
    setPicked(null);
    setView(null);
  };

  return (
    <div class="panel-body calendar">
      <div class="cal-today-head">
        <div>
          <div class="cal-date">{dateText(cal, today)}</div>
          <div class="small muted">
            {cal.seasons[season.index]?.name ?? ""}, day {season.day} · {cal.timeOfDay ?? "morning"} · {cal.climate}
          </div>
        </div>
        {(gm || away) && (
          <span class="cal-day-buttons">
            {away && (
              <button class="btn btn-sm" title="Back to today" onClick={backToToday}>
                Today
              </button>
            )}
            {gm && (
              <>
                <button class="icon-btn" title="A day back" aria-label="A day back" disabled={busy} onClick={() => moveDay(today - 1)}>
                  <ChevronLeft size={16} />
                </button>
                <button class="icon-btn" title="A day on" aria-label="A day on" disabled={busy} onClick={() => moveDay(today + 1)}>
                  <ChevronRight size={16} />
                </button>
              </>
            )}
          </span>
        )}
      </div>
      <section class="cal-today">
        <div class="cal-weather">
          <WeatherIcon w={weather} size={18} />
          <span>{note ?? weather.text}</span>
          <WeatherSoundButton />
          {gm && (
            <button class="icon-btn" title="Roll today's weather again" aria-label="Roll today's weather again" disabled={busy} onClick={() => act(() => patchCalendar(room, { reroll: today, note: { epoch: today, text: null } }))}>
              <RefreshCw size={14} />
            </button>
          )}
        </div>
        {gm && <WeatherHereControl />}
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
        {gm && (
          <div class="seg full cal-times" role="group" aria-label="Time of day">
            {TIMES_OF_DAY.map((t) => (
              <button key={t} class={cx("seg-btn", (cal.timeOfDay ?? "morning") === t && "active")} disabled={busy} onClick={() => setTime(t)}>
                {t}
              </button>
            ))}
          </div>
        )}
        {gm && <GmDayControls cal={cal} busy={busy} act={act} moveDay={moveDay} />}
        {gm && party && (
          <div class="cal-party-day">
            <NewPartyDay />
          </div>
        )}
      </section>

      {soon.length > 0 && (
        <section class="cal-soon">
          <div class="small muted">Coming up</div>
          <ul class="cal-soon-list">
            {soon.map(({ epoch, event }) => (
              <li key={event.id}>
                <button class="link-btn" onClick={() => goTo(epoch)}>
                  {event.name}
                </button>
                <span class="small muted">
                  {" "}
                  {dayWord(epoch)}
                  {event.gmOnly && <EyeOff size={11} aria-label="The GM's eyes only" />}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section class="cal-find">
        <label class="cal-log-row">
          <Search size={14} />
          <input value={find} placeholder="Find an event" onInput={(e) => setFind(e.currentTarget.value)} />
        </label>
        {find.trim() && (
          <ul class="cal-soon-list">
            {found.length === 0 && <li class="small muted">Nothing by that name.</li>}
            {found.map(({ event, epoch }) => (
              <li key={event.id}>
                {epoch === null ? (
                  <span>{event.name}</span>
                ) : (
                  <button class="link-btn" onClick={() => goTo(epoch)}>
                    {event.name}
                  </button>
                )}
                <span class="small muted"> {epoch === null ? "never falls" : `${dateText(cal, epoch)} (${dayWord(epoch)})`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(
        <section class="cal-log">
          <label class="field">
            <span class="small">{gm ? "The party's log for today" : "The party's log for today (your name goes with it)"}</span>
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
          <button class="link-btn cal-month-name" title="Back to today" onClick={backToToday}>
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
                    {[cat?.name, e.when.kind === "rule" ? e.when.summary : null, e.days > 1 ? `${e.days} days` : null, e.by ? `by ${e.by}` : null].filter(Boolean).join(" · ")}
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

function GmDayControls(props: { cal: Calendar; busy: boolean; act: (what: () => Promise<unknown>, then?: () => void) => void; moveDay: (epoch: number) => void }) {
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
    props.moveDay(epochOf(cal, y, month, Math.min(dd, cal.months[month]?.length ?? dd)));
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
      <label class="check small">
        <input type="checkbox" checked={cal.showOnMap !== false} onChange={(e) => act(() => patchCalendar(room, { showOnMap: e.currentTarget.checked }))} />
        <span>Show the date and weather on every map (table displays too)</span>
      </label>
      <label class="check small">
        <input type="checkbox" checked={cal.weatherOnMap !== false} onChange={(e) => act(() => patchCalendar(room, { weatherOnMap: e.currentTarget.checked }))} />
        <span>Rain and snow fall on the map on a wet day</span>
      </label>
      <label class="check small">
        <input type="checkbox" checked={cal.moonlight !== false} onChange={(e) => act(() => patchCalendar(room, { moonlight: e.currentTarget.checked }))} />
        <span>The moons light night scenes (lighting on, night), by their phases</span>
      </label>
      <label class="check small">
        <input type="checkbox" checked={cal.seasonsFollow === true} onChange={(e) => act(() => patchCalendar(room, { seasonsFollow: e.currentTarget.checked }))} />
        <span>Scenes with a season follow the calendar's (a scene's season can be pinned)</span>
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
    <div class="panel-body calendar">
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
        <a class="btn btn-sm" href="/api/calendar/export?format=fc" download title="In Fantasy Calendar's own shape, with the events and log made here, to import there">
          A copy for Fantasy Calendar
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
