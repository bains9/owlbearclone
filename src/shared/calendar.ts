// The campaign's calendar (31 October 2026, from the DM's ask): the date the game is at, shown to
// everyone and moved on by the GM; the moons and their phases; the seasons; the weather, made up
// day by day for the region the party is in; and what happens when: one-off events, cycles that
// come round (a festival on the last Tenday of a month, the night all three moons are full), and
// the party's log of what it did. Some events are the GM's eyes only.
//
// It can be brought in from Fantasy Calendar (fantasy-calendar.com): its months, weekdays, moons,
// seasons, climate and events, with the days worked out the same way it does (the moons' phases,
// the day of a season, which days a repeating event falls on), checked against it.

export interface CalMonth {
  name: string;
  /** Days in it. */
  length: number;
}

export interface CalMoon {
  name: string;
  /** Days from new moon to new moon. */
  cycle: number;
  /** The day of the first new moon (epoch), as Fantasy Calendar has it ("shift"). */
  shift: number;
  /** How many phases it's drawn in (4: new, first quarter, full, last quarter; 8; 24; 40...). */
  granularity: number;
  color: string;
}

export interface CalSeason {
  name: string;
  /** Days it takes to change into the next season (Fantasy Calendar's "transition"). */
  transition: number;
  /** Days it holds steady first. */
  duration: number;
}

/** A region's weather, season by season: temperatures in °C, and how often it rains (0 to 1). */
export interface Climate {
  name: string;
  seasons: { low: number; high: number; rain: number; heavy: number }[];
}

/** When an event falls: one date, or Fantasy Calendar's rules (conditions), which come round. */
export type EventWhen = { kind: "date"; year: number; month: number; day: number } | { kind: "rule"; conditions: unknown[]; summary: string };

export interface CalEvent {
  id: string;
  name: string;
  text: string;
  /** A category's id, or "". */
  category: string;
  /** The GM's eyes only. */
  gmOnly: boolean;
  when: EventWhen;
  /** How many days it lasts (1 for the day alone). */
  days: number;
  /** Fantasy Calendar's id for it, when it came from there (a sync replaces these, and keeps the rest). */
  fc?: number;
}

export interface CalCategory {
  id: string;
  name: string;
  color: string;
  gmOnly: boolean;
}

export interface Calendar {
  name: string;
  weekdays: string[];
  /** The weekday (1-based) of day 0 (epoch 0). */
  firstDay: number;
  months: CalMonth[];
  /** Whether there's a year 0 (else the first year is 1). */
  yearZero: boolean;
  moons: CalMoon[];
  seasons: CalSeason[];
  /** Days the seasons' cycle is shifted by (Fantasy Calendar's season_offset). */
  seasonOffset: number;
  climates: Climate[];
  /** The region the party is in: a climate's name. */
  climate: string;
  weatherSeed: number;
  /** Days whose weather the GM rolled again (how many times), by epoch. */
  rerolls: Record<string, number>;
  /** The GM's own words for a day's weather, by epoch (in place of what's rolled). */
  weatherNotes: Record<string, string>;
  /** The day the game is at (epoch: days from day 1 of year 1, or of year 0 with one). */
  today: number;
  events: CalEvent[];
  categories: CalCategory[];
  /** The category the party's log goes in. */
  logCategory: string;
  /** Where it was brought in from, for a sync. */
  source?: { fc: string; at: number };
}

export const CALENDAR_LIMITS = {
  name: 80,
  weekdays: 20,
  months: 40,
  monthLength: 400,
  moons: 12,
  seasons: 12,
  climates: 40,
  events: 4000,
  eventName: 200,
  eventText: 8000,
  conditions: 4000,
  days: 400,
  categories: 60,
  notes: 2000,
  note: 500,
} as const;

/** A fresh calendar: a plain year of twelve 30-day months, a ten-day week, one moon, four seasons. */
export function newCalendar(): Calendar {
  return {
    name: "The calendar",
    weekdays: ["Oneday", "Twoday", "Threeday", "Fourday", "Fiveday", "Sixday", "Sevenday", "Eightday", "Nineday", "Tenday"],
    firstDay: 1,
    months: ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh", "Twelfth"].map((name) => ({ name, length: 30 })),
    yearZero: false,
    moons: [{ name: "The moon", cycle: 30, shift: 0, granularity: 8, color: "#e8e6df" }],
    seasons: [
      { name: "Winter", transition: 90, duration: 0 },
      { name: "Spring", transition: 90, duration: 0 },
      { name: "Summer", transition: 90, duration: 0 },
      { name: "Autumn", transition: 90, duration: 0 },
    ],
    seasonOffset: 0,
    climates: CLIMATES.map((c) => ({ ...c, seasons: c.seasons.map((s) => ({ ...s })) })),
    climate: CLIMATES[0].name,
    weatherSeed: 1,
    rerolls: {},
    weatherNotes: {},
    today: 0,
    events: [],
    categories: [{ id: "log", name: "Party log", color: "#f0a63a", gmOnly: false }],
    logCategory: "log",
  };
}

/** Regions to choose from (°C; rain is the chance of a wet day, heavy how much of it comes down hard). Four seasons, winter first. */
export const CLIMATES: Climate[] = [
  { name: "Temperate", seasons: [{ low: -6, high: 3, rain: 0.4, heavy: 0.3 }, { low: 4, high: 15, rain: 0.4, heavy: 0.3 }, { low: 13, high: 26, rain: 0.3, heavy: 0.4 }, { low: 4, high: 15, rain: 0.45, heavy: 0.3 }] },
  { name: "Warm and rainy", seasons: [{ low: -12, high: 10, rain: 0.4, heavy: 0.5 }, { low: -1, high: 20, rain: 0.4, heavy: 0.55 }, { low: 10, high: 29, rain: 0.4, heavy: 0.6 }, { low: -1, high: 20, rain: 0.4, heavy: 0.55 }] },
  { name: "Cold desert", seasons: [{ low: -14, high: -4, rain: 0.2, heavy: 0.1 }, { low: -1, high: 11, rain: 0.25, heavy: 0.12 }, { low: 11, high: 25, rain: 0.3, heavy: 0.15 }, { low: -1, high: 11, rain: 0.25, heavy: 0.12 }] },
  { name: "Hot desert", seasons: [{ low: 5, high: 20, rain: 0.05, heavy: 0.3 }, { low: 15, high: 32, rain: 0.05, heavy: 0.3 }, { low: 25, high: 42, rain: 0.03, heavy: 0.5 }, { low: 15, high: 32, rain: 0.05, heavy: 0.3 }] },
  { name: "Mountains", seasons: [{ low: -18, high: -6, rain: 0.5, heavy: 0.4 }, { low: -6, high: 6, rain: 0.5, heavy: 0.4 }, { low: 4, high: 16, rain: 0.4, heavy: 0.4 }, { low: -6, high: 6, rain: 0.5, heavy: 0.4 }] },
  { name: "Tundra", seasons: [{ low: -30, high: -18, rain: 0.3, heavy: 0.2 }, { low: -15, high: -2, rain: 0.3, heavy: 0.2 }, { low: 2, high: 12, rain: 0.35, heavy: 0.2 }, { low: -15, high: -2, rain: 0.35, heavy: 0.2 }] },
  { name: "Coast", seasons: [{ low: 0, high: 7, rain: 0.55, heavy: 0.3 }, { low: 6, high: 14, rain: 0.5, heavy: 0.3 }, { low: 13, high: 22, rain: 0.35, heavy: 0.3 }, { low: 7, high: 15, rain: 0.55, heavy: 0.35 }] },
  { name: "Rainforest", seasons: [{ low: 20, high: 30, rain: 0.7, heavy: 0.6 }, { low: 21, high: 31, rain: 0.75, heavy: 0.6 }, { low: 22, high: 32, rain: 0.8, heavy: 0.7 }, { low: 21, high: 31, rain: 0.75, heavy: 0.6 }] },
  { name: "Savanna", seasons: [{ low: 15, high: 30, rain: 0.05, heavy: 0.3 }, { low: 20, high: 34, rain: 0.2, heavy: 0.5 }, { low: 18, high: 28, rain: 0.6, heavy: 0.6 }, { low: 17, high: 31, rain: 0.3, heavy: 0.5 }] },
  { name: "Marsh", seasons: [{ low: -3, high: 5, rain: 0.55, heavy: 0.3 }, { low: 6, high: 17, rain: 0.5, heavy: 0.4 }, { low: 15, high: 27, rain: 0.45, heavy: 0.5 }, { low: 6, high: 17, rain: 0.55, heavy: 0.4 }] },
];

// ------------------------------------------------------------------------------------- dates

export interface CalDate {
  year: number;
  /** 0-based. */
  month: number;
  /** 1-based. */
  day: number;
  /** 1-based, within the year. */
  yearDay: number;
  /** 1-based, into `weekdays`. */
  weekday: number;
}

export function yearLength(c: Pick<Calendar, "months">): number {
  return c.months.reduce((n, m) => n + m.length, 0);
}

/** The year's first day as an epoch. */
function yearStart(c: Pick<Calendar, "months" | "yearZero">, year: number): number {
  return (c.yearZero ? year : year - 1) * yearLength(c);
}

export function epochOf(c: Pick<Calendar, "months" | "yearZero">, year: number, month: number, day: number): number {
  let n = yearStart(c, year);
  for (let i = 0; i < month && i < c.months.length; i++) n += c.months[i].length;
  return n + day - 1;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

export function dateOf(c: Pick<Calendar, "months" | "yearZero" | "weekdays" | "firstDay">, epoch: number): CalDate {
  const len = Math.max(1, yearLength(c));
  const years = Math.floor(epoch / len);
  const year = c.yearZero ? years : years + 1;
  let rest = epoch - years * len;
  let month = 0;
  while (month < c.months.length - 1 && rest >= c.months[month].length) {
    rest -= c.months[month].length;
    month++;
  }
  const W = Math.max(1, c.weekdays.length);
  return { year, month, day: rest + 1, yearDay: epoch - years * len + 1, weekday: mod(epoch + c.firstDay - 1, W) + 1 };
}

/** "Nineday 29 Vanyir, Year 2". */
export function dateText(c: Calendar, epoch: number): string {
  const d = dateOf(c, epoch);
  return `${c.weekdays[d.weekday - 1] ?? ""} ${d.day} ${c.months[d.month]?.name ?? ""}, Year ${d.year}`.trim();
}

// ------------------------------------------------------------------------------------- moons

/** A moon's phase on a day: 0 to granularity − 1 (0 new, half way full), as Fantasy Calendar works it out. */
export function moonPhase(m: CalMoon, epoch: number): number {
  const g = Math.max(2, Math.round(m.granularity));
  const pos = (epoch - m.shift) / Math.max(1, m.cycle);
  const frac = pos - Math.floor(pos);
  return Math.round(frac * g) % g;
}

/** The phase in words: new, waxing crescent, first quarter, waxing gibbous, full, waning... */
export function moonPhaseName(phase: number, granularity: number): string {
  const f = phase / Math.max(2, granularity);
  if (f === 0) return "new";
  if (f === 0.5) return "full";
  if (f === 0.25) return "first quarter";
  if (f === 0.75) return "last quarter";
  if (f < 0.25) return "waxing crescent";
  if (f < 0.5) return "waxing gibbous";
  if (f < 0.75) return "waning gibbous";
  return "waning crescent";
}

// ------------------------------------------------------------------------------------- seasons

export interface SeasonDay {
  /** Into `seasons`. */
  index: number;
  /** 1-based, as Fantasy Calendar counts it. */
  day: number;
  /** How far into the change to the next season: 1 at its start, 0 at its end. */
  perc: number;
}

function seasonsLength(c: Pick<Calendar, "seasons">): number {
  return c.seasons.reduce((n, s) => n + s.transition + s.duration, 0);
}

/** The season a day is in, worked out as Fantasy Calendar's periodic seasons are. */
export function seasonOf(c: Pick<Calendar, "seasons" | "seasonOffset">, epoch: number): SeasonDay {
  const L = Math.max(1, seasonsLength(c));
  const x = (epoch - c.seasonOffset) / L;
  let day = Math.round((x - Math.floor(x)) * L);
  if (day >= L) day -= L;
  let start = 0;
  for (let i = 0; i < c.seasons.length; i++) {
    const s = c.seasons[i];
    const len = s.transition + s.duration;
    if (day < start + len || i === c.seasons.length - 1) {
      const d0 = day - start;
      const perc = d0 >= s.duration && s.transition > 0 ? 1 - (d0 - s.duration) / s.transition : 1;
      return { index: i, day: d0 + 1, perc: Math.max(0, Math.min(1, perc)) };
    }
    start += len;
  }
  return { index: 0, day: 1, perc: 1 };
}

// ------------------------------------------------------------------------------------- weather

export interface Weather {
  /** °C. */
  low: number;
  high: number;
  precipitation: "none" | "light" | "heavy";
  kind: "rain" | "snow" | "sleet";
  clouds: "clear" | "a few clouds" | "cloudy" | "overcast";
  wind: "calm" | "light wind" | "breezy" | "windy" | "gale";
  from: string;
  /** In a sentence or two. */
  text: string;
}

/** 0 to 1, the same for the same inputs. */
function hash(...parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) {
    const v = Math.floor(p * 1000003) | 0;
    h ^= v;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth noise over days, −1 to 1: a slow swell, a medium one and a quick one, as weather drifts. */
function drift(seed: number, epoch: number, salt: number): number {
  let out = 0;
  for (const [period, amp] of [
    [40, 1],
    [8, 0.5],
    [2, 0.3],
  ]) {
    const t = epoch / period;
    const i = Math.floor(t);
    const f = t - i;
    const s = f * f * (3 - 2 * f);
    const a = hash(seed, salt, i) * 2 - 1;
    const b = hash(seed, salt, i + 1) * 2 - 1;
    out += (a + (b - a) * s) * amp;
  }
  return out / 1.8;
}

const WINDS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** The weather on a day, rolled from the calendar's seed (the same every time it's asked), in the party's region. */
export function weatherOf(c: Calendar, epoch: number): Weather {
  const climate = c.climates.find((x) => x.name === c.climate) ?? c.climates[0] ?? CLIMATES[0];
  const s = seasonOf(c, epoch);
  const n = Math.max(1, climate.seasons.length);
  const now = climate.seasons[s.index % n];
  const next = climate.seasons[(s.index + 1) % n];
  const lerp = (a: number, b: number) => b + (a - b) * s.perc;
  const roll = (c.rerolls[String(epoch)] ?? 0) * 1000;
  const seed = c.weatherSeed + roll;
  const swing = drift(seed, epoch, 1);
  const spread = Math.max(2, (lerp(now.high, next.high) - lerp(now.low, next.low)) * 0.6);
  const low = Math.round(lerp(now.low, next.low) + swing * spread);
  const high = Math.round(Math.max(low + 2, lerp(now.high, next.high) + swing * spread + hash(seed, 2, epoch) * 2));
  const wet = hash(seed, 3, epoch) < lerp(now.rain, next.rain) + drift(seed, epoch, 4) * 0.15;
  const heavy = wet && hash(seed, 5, epoch) < lerp(now.heavy, next.heavy);
  const precipitation: Weather["precipitation"] = !wet ? "none" : heavy ? "heavy" : "light";
  const kind: Weather["kind"] = high <= 0 ? "snow" : high <= 3 ? "sleet" : "rain";
  const cloudy = (drift(seed, epoch, 6) + 1) / 2 + (wet ? 0.4 : 0);
  const clouds: Weather["clouds"] = cloudy < 0.3 ? "clear" : cloudy < 0.55 ? "a few clouds" : cloudy < 0.8 ? "cloudy" : "overcast";
  const windy = (drift(seed, epoch, 7) + 1) / 2 + (heavy ? 0.2 : 0);
  const wind: Weather["wind"] = windy < 0.25 ? "calm" : windy < 0.5 ? "light wind" : windy < 0.75 ? "breezy" : windy < 0.92 ? "windy" : "gale";
  const from = WINDS[Math.floor(hash(seed, 8, Math.floor(epoch / 3)) * 8)];
  const feel = high <= -10 ? "Bitterly cold" : high <= 2 ? "Freezing" : high <= 10 ? "Cold" : high <= 18 ? "Cool" : high <= 26 ? "Warm" : high <= 33 ? "Hot" : "Scorching";
  const falling = precipitation === "none" ? "" : `${precipitation === "heavy" ? "heavy " : "light "}${kind}`;
  const sky = clouds === "clear" ? "clear skies" : clouds;
  const blowing = wind === "calm" ? "calm" : `${wind} from the ${from}`;
  const text = `${feel}, ${[falling, sky].filter(Boolean).join(", ")}, ${blowing}. ${low} to ${high} °C.`;
  return { low, high, precipitation, kind, clouds, wind, from, text };
}

// ------------------------------------------------------------------------------------- events

/** What's true of a day, by the names Fantasy Calendar's event rules use. */
interface DayFacts {
  epoch: number;
  year: number;
  era_year: number;
  timespan_index: number;
  timespan_number: number;
  timespan_count: number;
  num_timespans: number;
  timespan_name: string;
  day: number;
  inverse_day: number;
  year_day: number;
  week_day: number;
  week_day_name: string;
  week_day_num: number;
  inverse_week_day_num: number;
  month_week_num: number;
  inverse_month_week_num: number;
  year_week_num: number;
  inverse_year_week_num: number;
  total_week_num: number;
  intercalary: boolean;
  moon_phase: number[];
  season_index: number;
  season_day: number;
  season_perc: number;
}

export function dayFacts(c: Calendar, epoch: number): DayFacts {
  const d = dateOf(c, epoch);
  const W = Math.max(1, c.weekdays.length);
  const monthLen = c.months[d.month]?.length ?? 30;
  const yl = Math.max(1, yearLength(c));
  const s = seasonOf(c, epoch);
  return {
    epoch,
    year: d.year,
    era_year: d.year,
    timespan_index: d.month,
    timespan_number: d.month,
    timespan_count: d.month + 1,
    num_timespans: (c.yearZero ? d.year : d.year - 1) * c.months.length + d.month + 1,
    timespan_name: c.months[d.month]?.name ?? "",
    day: d.day,
    inverse_day: monthLen - d.day + 1,
    year_day: d.yearDay,
    week_day: d.weekday,
    week_day_name: c.weekdays[d.weekday - 1] ?? "",
    week_day_num: Math.floor((d.day - 1) / W) + 1,
    inverse_week_day_num: Math.floor((monthLen - d.day) / W) + 1,
    month_week_num: Math.floor((d.day - 1) / W) + 1,
    inverse_month_week_num: Math.floor((monthLen - d.day) / W) + 1,
    year_week_num: Math.floor((d.yearDay - 1) / W) + 1,
    inverse_year_week_num: Math.floor((yl - d.yearDay) / W) + 1,
    total_week_num: Math.floor(epoch / W) + 1,
    intercalary: false,
    moon_phase: c.moons.map((m) => moonPhase(m, epoch)),
    season_index: s.index,
    season_day: s.day,
    season_perc: Math.max(1, Math.min(100, Math.floor(s.perc * 100))),
  };
}

type Op = "==" | "!=" | ">=" | "<=" | ">" | "<" | "%";
/** A rule's parts: what of the day, how it's compared, and which of the rule's values (the second for an interval's offset). */
type Rule = [keyof DayFacts | "season_index" | "season_day" | "season_perc" | "random", Op, number, number?];

const CMP: Op[] = ["==", "!=", ">=", "<=", ">", "<"];
const cmp = (sel: Rule[0], i: number): Rule => [sel, CMP[i], 0];
const six = (sel: Rule[0]): Rule[] => CMP.map((_, i) => cmp(sel, i));

/** Fantasy Calendar's rules, by category and type number (the order it lists them in). */
const RULES: Record<string, (Rule | Rule[])[]> = {
  Date: six("epoch"),
  Year: [...six("year"), ["year", "%", 0, 1]],
  Month: [...six("timespan_index"), [cmp("timespan_index", 0), ["timespan_count", "%", 1, 2]], ...six("timespan_number"), ["num_timespans", "%", 0, 1], cmp("timespan_name", 0), cmp("timespan_name", 1)],
  Day: [...six("day"), ["day", "%", 0, 1], ...six("year_day"), ["year_day", "%", 0, 1], ...six("inverse_day"), cmp("intercalary", 0), cmp("intercalary", 1)],
  Epoch: [...six("epoch"), ["epoch", "%", 0, 1]],
  Weekday: [cmp("week_day_name", 0), cmp("week_day_name", 1), ...six("week_day"), ...six("week_day_num"), ...six("inverse_week_day_num")],
  Week: [...six("month_week_num"), ["month_week_num", "%", 0, 1], ...six("year_week_num"), ["year_week_num", "%", 0, 1], ...six("inverse_month_week_num"), ...six("inverse_year_week_num"), ...six("total_week_num")],
  Moons: CMP.map((_, i): Rule => ["moon_phase", CMP[i], 1]),
  Season: [cmp("season_index", 0), cmp("season_index", 1), ...six("season_perc"), ...six("season_day"), ["season_day", "%", 0, 1]],
  Random: [
    ["random", ">", 0, 1],
    ["random", "<", 0, 1],
  ],
};

function compare(op: Op, a: unknown, b: unknown, c?: unknown): boolean {
  switch (op) {
    case "==":
      return a == b; // eslint-disable-line eqeqeq
    case "!=":
      return a != b; // eslint-disable-line eqeqeq
    case ">=":
      return (a as number) >= (b as number);
    case "<=":
      return (a as number) <= (b as number);
    case ">":
      return (a as number) > (b as number);
    case "<":
      return (a as number) < (b as number);
    case "%": {
      const n = Number(b) || 1;
      const off = (Number(c) || 0) % n;
      return (Number(a) - off) % n === 0;
    }
  }
}

const num = (v: unknown): unknown => (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : v);

/** One condition of a rule, as Fantasy Calendar keeps it: [category, type, values]. */
function condition(c: Calendar, f: DayFacts, cond: unknown): boolean {
  if (!Array.isArray(cond) || typeof cond[0] !== "string") return false;
  const [category, type, values] = cond as [string, string, unknown[]];
  const list = RULES[category];
  const entry = list?.[Number(type)];
  if (!entry || !Array.isArray(values)) return false;
  if (category === "Date") {
    const [y, m, d] = values.map(Number);
    return compare(CMP[Number(type)], f.epoch, epochOf(c, y, m, d));
  }
  const rules = Array.isArray(entry[0]) ? (entry as Rule[]) : [entry as Rule];
  return rules.every((r) => {
    const [sel, op, i, j] = r;
    if (category === "Moons") {
      const moon = Number(values[0]);
      return compare(op, f.moon_phase[moon], Number(values[1]) | 0, j === undefined ? undefined : Number(values[j]) | 0);
    }
    if (category === "Random") {
      const seed = Number(values[1]) || 0;
      const x = 43758.5453 * Math.sin(seed + 78.233 * f.epoch);
      return compare(op, (x - Math.floor(x)) * 100, Number(values[0]) | 0);
    }
    let want = num(values[i]);
    if (category === "Weekday" && (type === "0" || type === "1") && typeof want === "number") want = c.weekdays[want] ?? want;
    if (category === "Day" && sel === "intercalary") return compare(op, false, Number(want) === 1);
    return compare(op, f[sel as keyof DayFacts], want, j === undefined ? undefined : num(values[j]));
  });
}

/** A rule's conditions, joined by &&, ||, NAND and ^ (Fantasy Calendar groups: right to left, as it does). */
function conditions(c: Calendar, f: DayFacts, list: unknown[]): boolean {
  let result = false;
  for (let i = list.length - 1; i >= 0; i -= 2) {
    const item = list[i] as unknown[];
    let got: boolean;
    if (Array.isArray(item) && Array.isArray(item[1])) {
      const head = item[0];
      const count = head !== "" && head !== "!" && !Number.isNaN(Number(head)) ? Number(head) : null;
      if (count !== null) got = (item[1] as unknown[]).filter((x) => (Array.isArray(x) && Array.isArray((x as unknown[])[1]) ? conditions(c, f, (x as unknown[])[1] as unknown[]) : condition(c, f, x))).length >= count;
      else got = conditions(c, f, item[1] as unknown[]);
      if (head === "!") got = !got;
    } else got = condition(c, f, item);
    const joiner = (list[i + 1] as unknown[] | undefined)?.[0];
    if (joiner === "&&") result = result && got;
    else if (joiner === "NAND") result = !(result && got);
    else if (joiner === "||") result = result || got;
    else if (joiner === "^") result = result !== got;
    else result = got;
  }
  return result;
}

/** Whether an event starts on a day. */
export function eventStarts(c: Calendar, e: CalEvent, epoch: number, facts?: DayFacts): boolean {
  if (e.when.kind === "date") return epochOf(c, e.when.year, e.when.month, e.when.day) === epoch;
  if (!e.when.conditions.length) return false;
  return conditions(c, facts ?? dayFacts(c, epoch), e.when.conditions);
}

/** The events on a day (one that lasts days is on each of them), in the calendar's order. */
export function eventsOn(c: Calendar, epoch: number, gm: boolean): CalEvent[] {
  const facts = new Map<number, DayFacts>();
  const at = (ep: number) => {
    let f = facts.get(ep);
    if (!f) facts.set(ep, (f = dayFacts(c, ep)));
    return f;
  };
  return c.events.filter((e) => {
    if (e.gmOnly && !gm) return false;
    const days = Math.max(1, Math.min(CALENDAR_LIMITS.days, Math.round(e.days)));
    for (let k = 0; k < days; k++) if (eventStarts(c, e, epoch - k, at(epoch - k))) return true;
    return false;
  });
}

/** A rule in plain words, for the list ("every year on 15 Agronos", "when Big Dog and Feyor are new"). */
export function ruleSummary(c: Pick<Calendar, "weekdays" | "months" | "moons" | "seasons">, conds: unknown[]): string {
  const parts: string[] = [];
  for (let i = 0; i < conds.length; i += 2) {
    const cond = conds[i] as unknown[];
    if (!Array.isArray(cond)) continue;
    if (Array.isArray(cond[1])) {
      parts.push(`(${ruleSummary(c, cond[1] as unknown[])})`);
      continue;
    }
    const [category, type, values] = cond as [string, string, unknown[]];
    const v = (k: number) => String(values?.[k] ?? "");
    const t = Number(type);
    if (category === "Month" && t === 0) parts.push(`in ${c.months[Number(v(0))]?.name ?? "month " + v(0)}`);
    else if (category === "Day" && t === 0) parts.push(`on day ${v(0)}`);
    else if (category === "Day" && t === 21) continue;
    else if (category === "Year" && t === 6) parts.push(Number(v(0)) > 1 ? `every ${v(0)} years` : "every year");
    else if (category === "Weekday" && t === 0) parts.push(`on a ${c.weekdays[Number(v(0))] ?? v(0)}`);
    else if (category === "Weekday" && t === 8) parts.push(`the ${ordinal(Number(v(0)))} one of the month`);
    else if (category === "Weekday" && t === 14) parts.push(Number(v(0)) === 1 ? "the last one of the month" : `the ${ordinal(Number(v(0)))} from the end of the month`);
    else if (category === "Moons" && t === 0) {
      const m = c.moons[Number(v(0))];
      parts.push(`${m?.name ?? "a moon"} ${moonPhaseName(Number(v(1)), m?.granularity ?? 8)}`);
    } else if (category === "Season" && t === 0) parts.push(`in ${c.seasons[Number(v(0))]?.name ?? "season " + v(0)}`);
    else if (category === "Season" && t === 8) parts.push(Number(v(0)) === 1 ? "on its first day" : `on its day ${v(0)}`);
    else if (category === "Date" && t === 0) parts.push(`on ${v(2)} ${c.months[Number(v(1))]?.name ?? ""} of year ${v(0)}`);
    else parts.push(`${category.toLowerCase()} rule`);
  }
  return parts.join(", ") || "a rule";
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/** Rules made here, without Fantasy Calendar's editor: once a year, once a month, or every so many days from a date. */
export function repeatRule(kind: "yearly" | "monthly" | "everyDays", d: { month: number; day: number }, every = 1, fromEpoch = 0): unknown[] {
  if (kind === "yearly") return [["Month", "0", [String(d.month)]], ["&&"], ["Day", "0", [String(d.day)]]];
  if (kind === "monthly") return [["Day", "0", [String(d.day)]]];
  return [["Epoch", "6", [String(Math.max(1, every)), String(fromEpoch)]]];
}

// ---------------------------------------------------------------------------- Fantasy Calendar

/** HTML from Fantasy Calendar's event editor as plain lines. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6])>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const FC_COLORS: Record<string, string> = {
  "Dark-Solid": "#8a8f98",
  "Light-Solid": "#d8dbe0",
  Red: "#e5484d",
  Pink: "#e93d82",
  Purple: "#8e4ec6",
  "Deep-Purple": "#6e56cf",
  Indigo: "#3e63dd",
  Blue: "#0090ff",
  "Light-Blue": "#53b1fd",
  Cyan: "#00a2c7",
  Teal: "#12a594",
  Green: "#30a46c",
  "Light-Green": "#6fcf5a",
  Lime: "#bdee63",
  Yellow: "#f5d90a",
  Amber: "#ffb224",
  Orange: "#f76b15",
  "Deep-Orange": "#e54d2e",
  Brown: "#ad7f58",
  Grey: "#8b8d98",
  "Blue-Grey": "#7e94a6",
};

/** Fantasy Calendar's data, as its API gives it (api/v1/calendar/{hash}) or its export file. */
interface FcData {
  name?: unknown;
  static_data?: {
    year_data?: { first_day?: unknown; global_week?: unknown; timespans?: unknown; leap_days?: unknown };
    moons?: unknown;
    seasons?: { global_settings?: { season_offset?: unknown; seed?: unknown }; data?: unknown; locations?: unknown };
    settings?: { year_zero_exists?: unknown };
  };
  dynamic_data?: { epoch?: unknown; location?: unknown };
  events?: unknown;
  event_categories?: unknown;
  categories?: unknown;
}

const str = (v: unknown, max: number, fallback = ""): string => (typeof v === "string" ? v.trim().slice(0, max) : fallback);
const n = (v: unknown, fallback = 0): number => {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : fallback;
};

/**
 * A calendar from Fantasy Calendar's data: what it says in words when something couldn't come
 * over (leap days, say). `keep` is the calendar here already: its own events (those not from
 * Fantasy Calendar), its day, region and weather stay.
 */
export function fromFantasyCalendar(raw: unknown, keep?: Calendar | null, source?: string): { calendar: Calendar; notes: string[] } {
  const d = (raw ?? {}) as FcData;
  const s = d.static_data ?? {};
  const notes: string[] = [];
  const base = keep ?? newCalendar();
  const out: Calendar = { ...base, name: str(d.name, CALENDAR_LIMITS.name) || base.name };
  const yd = s.year_data ?? {};
  if (Array.isArray(yd.global_week) && yd.global_week.length) out.weekdays = yd.global_week.map((w) => str(w, 30, "Day")).slice(0, CALENDAR_LIMITS.weekdays);
  out.firstDay = Math.max(1, Math.round(n(yd.first_day, 1)));
  if (Array.isArray(yd.timespans) && yd.timespans.length) {
    const months = yd.timespans as { name?: unknown; length?: unknown; type?: unknown; interval?: unknown }[];
    if (months.some((m) => n(m.interval, 1) !== 1 || (m.type !== undefined && m.type !== "month"))) notes.push("Months that come only some years (intercalary ones) aren't kept: every month is in every year here.");
    out.months = months.map((m) => ({ name: str(m.name, 40, "Month"), length: Math.max(1, Math.min(CALENDAR_LIMITS.monthLength, Math.round(n(m.length, 30)))) })).slice(0, CALENDAR_LIMITS.months);
  }
  if (Array.isArray(yd.leap_days) && yd.leap_days.length) notes.push("Leap days aren't kept: every year is the same length here, so dates after a leap day may be a day off.");
  out.yearZero = s.settings?.year_zero_exists === true;
  if (Array.isArray(s.moons)) {
    out.moons = (s.moons as Record<string, unknown>[])
      .filter((m) => m.hidden !== true)
      .map((m) => ({
        name: str(m.name, 40, "Moon"),
        cycle: Math.max(1, n(m.cycle, 30)),
        shift: n(m.shift, 0),
        granularity: Math.max(2, Math.min(64, Math.round(n(m.granularity, 8)))),
        color: /^#[0-9a-f]{6}$/i.test(String(m.color)) ? String(m.color) : "#e8e6df",
      }))
      .slice(0, CALENDAR_LIMITS.moons);
    if ((s.moons as Record<string, unknown>[]).some((m) => m.custom_phase === true)) notes.push("A moon with custom phases is shown by its cycle instead.");
  }
  const seasons = s.seasons?.data;
  if (Array.isArray(seasons) && seasons.length) {
    out.seasons = (seasons as Record<string, unknown>[])
      .map((x) => ({ name: str(x.name, 40, "Season"), transition: Math.max(0, Math.round(n(x.transition_length, 90))), duration: Math.max(0, Math.round(n(x.duration, 0))) }))
      .slice(0, CALENDAR_LIMITS.seasons);
    if (!seasonsLength(out)) out.seasons = out.seasons.map((x) => ({ ...x, transition: 90 }));
  }
  out.seasonOffset = Math.round(n(s.seasons?.global_settings?.season_offset, 0));
  // The calendar's own regions (°C or °F: Fantasy Calendar keeps them in °F when the calendar is imperial).
  const locations = s.seasons?.locations;
  if (Array.isArray(locations)) {
    const imperial = (s.seasons?.global_settings as { temp_sys?: unknown } | undefined)?.temp_sys === "imperial";
    const toC = (t: number) => (imperial ? Math.round((((t - 32) * 5) / 9) * 10) / 10 : t);
    for (const loc of locations as { name?: unknown; seasons?: { weather?: Record<string, unknown> }[] }[]) {
      if (!Array.isArray(loc.seasons)) continue;
      const climate: Climate = {
        name: str(loc.name, 40, "Region"),
        seasons: loc.seasons.map((x) => ({
          low: toC(n(x.weather?.temp_low, 0)),
          high: toC(n(x.weather?.temp_high, 10)),
          rain: Math.max(0, Math.min(1, n(x.weather?.precipitation, 0.3))),
          heavy: Math.max(0, Math.min(1, n(x.weather?.precipitation_intensity, 0.3))),
        })),
      };
      if (!climate.seasons.length) continue;
      // The calendar's own regions first, then the ones to choose from here.
      out.climates = [climate, ...out.climates.filter((x) => x.name !== climate.name)].slice(0, CALENDAR_LIMITS.climates);
    }
  }
  for (const preset of CLIMATES) if (!out.climates.some((x) => x.name === preset.name)) out.climates.push(preset);
  if (!keep) {
    const where = str(d.dynamic_data?.location, 40);
    out.climate = out.climates.find((x) => x.name.toLowerCase() === where.toLowerCase())?.name ?? out.climates[0].name;
    out.weatherSeed = Math.round(n(s.seasons?.global_settings?.seed, 1)) || 1;
    out.today = Math.round(n(d.dynamic_data?.epoch, 0));
  }
  // Categories, then events: hidden ones are the GM's eyes only.
  const fcCats = (Array.isArray(d.event_categories) ? d.event_categories : Array.isArray(d.categories) ? d.categories : []) as Record<string, unknown>[];
  const catById = new Map<string, CalCategory>();
  const categories: CalCategory[] = keep?.categories.filter((x) => !x.id.startsWith("fc")) ?? [];
  for (const cat of fcCats) {
    const settings = (cat.event_settings ?? {}) as Record<string, unknown>;
    const c: CalCategory = {
      id: `fc${n(cat.id, categories.length)}`,
      name: str(cat.name, 60, "Events").replace(/\s+/g, " "),
      color: FC_COLORS[String(settings.color)] ?? "#8a8f98",
      gmOnly: settings.hide === true,
    };
    catById.set(String(cat.id), c);
    categories.push(c);
  }
  out.categories = categories.slice(0, CALENDAR_LIMITS.categories);
  const log = out.categories.find((x) => /party/i.test(x.name) && /log|action|event/i.test(x.name)) ?? out.categories.find((x) => x.id === keep?.logCategory);
  if (log) out.logCategory = log.id;
  else {
    out.categories.push({ id: "log", name: "Party log", color: "#f0a63a", gmOnly: false });
    out.logCategory = "log";
  }
  const events: CalEvent[] = keep?.events.filter((e) => e.fc === undefined) ?? [];
  let unknown = 0;
  for (const raw of (Array.isArray(d.events) ? d.events : []) as Record<string, unknown>[]) {
    const data = (raw.data ?? {}) as Record<string, unknown>;
    const settings = (raw.settings ?? {}) as Record<string, unknown>;
    const conds = Array.isArray(data.conditions) ? data.conditions : [];
    const date = Array.isArray(data.date) && data.date.length === 3 ? data.date.map(Number) : null;
    const dated = conds.length === 1 && Array.isArray(conds[0]) && conds[0][0] === "Date" && conds[0][1] === "0";
    const when: EventWhen =
      dated && date
        ? { kind: "date", year: date[0], month: date[1], day: date[2] }
        : conds.length
          ? { kind: "rule", conditions: JSON.parse(JSON.stringify(conds).slice(0, CALENDAR_LIMITS.conditions * 4)) as unknown[], summary: ruleSummary(out, conds) }
          : { kind: "rule", conditions: [], summary: "no rule" };
    if (when.kind === "rule" && !when.conditions.length) unknown++;
    const category = catById.get(String(raw.event_category_id));
    events.push({
      id: `fc${n(raw.id, events.length)}`,
      name: str(raw.name, CALENDAR_LIMITS.eventName, "Event"),
      text: htmlToText(str(raw.description, CALENDAR_LIMITS.eventText * 4)).slice(0, CALENDAR_LIMITS.eventText),
      category: category?.id ?? "",
      gmOnly: settings.hide === true || settings.hide_full === true || category?.gmOnly === true,
      when,
      days: data.has_duration === true ? Math.max(1, Math.min(CALENDAR_LIMITS.days, Math.round(n(data.duration, 1)))) : 1,
      fc: Math.round(n(raw.id, -1)),
    });
  }
  out.events = events.slice(0, CALENDAR_LIMITS.events);
  if (unknown) notes.push(`${unknown} event${unknown === 1 ? " has" : "s have"} no date or rule, so ${unknown === 1 ? "it" : "they"} won't show on any day.`);
  if (source) out.source = { fc: source, at: Date.now() };
  return { calendar: out, notes };
}

// ------------------------------------------------------------------------------------- checking

/** A calendar as sent, checked and trimmed to its limits; null when it isn't one. */
export function sanitizeCalendar(raw: unknown): Calendar | null {
  const r = raw as Partial<Calendar> | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.months) || !Array.isArray(r.weekdays)) return null;
  const L = CALENDAR_LIMITS;
  const fresh = newCalendar();
  const months = r.months.map((m) => ({ name: str((m as CalMonth)?.name, 40, "Month"), length: Math.max(1, Math.min(L.monthLength, Math.round(n((m as CalMonth)?.length, 30)))) })).slice(0, L.months);
  const weekdays = r.weekdays.map((w) => str(w, 30, "Day")).slice(0, L.weekdays);
  if (!months.length || !weekdays.length) return null;
  const color = (v: unknown, fallback: string) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : fallback);
  const seasons = (Array.isArray(r.seasons) ? r.seasons : fresh.seasons)
    .map((s) => ({ name: str((s as CalSeason)?.name, 40, "Season"), transition: Math.max(0, Math.min(10000, Math.round(n((s as CalSeason)?.transition, 90)))), duration: Math.max(0, Math.min(10000, Math.round(n((s as CalSeason)?.duration, 0)))) }))
    .slice(0, L.seasons);
  const climates = (Array.isArray(r.climates) ? r.climates : [])
    .filter((c): c is Climate => !!c && Array.isArray((c as Climate).seasons) && (c as Climate).seasons.length > 0)
    .map((c) => ({ name: str(c.name, 40, "Region"), seasons: c.seasons.slice(0, L.seasons).map((s) => ({ low: Math.max(-100, Math.min(100, n(s?.low, 0))), high: Math.max(-100, Math.min(100, n(s?.high, 10))), rain: Math.max(0, Math.min(1, n(s?.rain, 0.3))), heavy: Math.max(0, Math.min(1, n(s?.heavy, 0.3))) })) }))
    .slice(0, L.climates);
  const categories = (Array.isArray(r.categories) ? r.categories : [])
    .filter((c): c is CalCategory => !!c && typeof (c as CalCategory).id === "string")
    .map((c) => ({ id: str(c.id, 40), name: str(c.name, 60, "Events"), color: color(c.color, "#8a8f98"), gmOnly: c.gmOnly === true }))
    .slice(0, L.categories);
  const events = (Array.isArray(r.events) ? r.events : [])
    .map((e): CalEvent | null => {
      const x = e as Partial<CalEvent> | null;
      if (!x || typeof x.id !== "string" || !x.when || typeof x.when !== "object") return null;
      let when: EventWhen;
      if (x.when.kind === "date") when = { kind: "date", year: Math.round(n(x.when.year, 1)), month: Math.max(0, Math.min(months.length - 1, Math.round(n(x.when.month, 0)))), day: Math.max(1, Math.min(L.monthLength, Math.round(n(x.when.day, 1)))) };
      else if (x.when.kind === "rule" && Array.isArray(x.when.conditions)) {
        if (JSON.stringify(x.when.conditions).length > L.conditions || !plainRule(x.when.conditions, 0)) return null;
        when = { kind: "rule", conditions: x.when.conditions, summary: str(x.when.summary, 200) };
      } else return null;
      const out: CalEvent = {
        id: str(x.id, 40),
        name: str(x.name, L.eventName, "Event"),
        text: str(x.text, L.eventText),
        category: str(x.category, 40),
        gmOnly: x.gmOnly === true,
        when,
        days: Math.max(1, Math.min(L.days, Math.round(n(x.days, 1)))),
      };
      if (typeof x.fc === "number" && Number.isInteger(x.fc)) out.fc = x.fc;
      return out;
    })
    .filter((e): e is CalEvent => e !== null)
    .slice(0, L.events);
  const record = (v: unknown, each: (x: unknown) => unknown | undefined) => {
    const out: Record<string, never> = {};
    if (!v || typeof v !== "object") return out;
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, L.notes)) {
      if (!/^-?\d{1,9}$/.test(k)) continue;
      const y = each(x);
      if (y !== undefined) (out as Record<string, unknown>)[k] = y;
    }
    return out;
  };
  const cal: Calendar = {
    name: str(r.name, L.name, fresh.name),
    weekdays,
    firstDay: Math.max(1, Math.min(weekdays.length, Math.round(n(r.firstDay, 1)))),
    months,
    yearZero: r.yearZero === true,
    moons: (Array.isArray(r.moons) ? r.moons : [])
      .map((m) => ({ name: str((m as CalMoon)?.name, 40, "Moon"), cycle: Math.max(1, Math.min(100000, n((m as CalMoon)?.cycle, 30))), shift: Math.max(-1e7, Math.min(1e7, n((m as CalMoon)?.shift, 0))), granularity: Math.max(2, Math.min(64, Math.round(n((m as CalMoon)?.granularity, 8)))), color: color((m as CalMoon)?.color, "#e8e6df") }))
      .slice(0, L.moons),
    seasons: seasons.length ? seasons : fresh.seasons,
    seasonOffset: Math.max(-1e7, Math.min(1e7, Math.round(n(r.seasonOffset, 0)))),
    climates: climates.length ? climates : [CLIMATES[0]],
    climate: str(r.climate, 40),
    weatherSeed: Math.round(n(r.weatherSeed, 1)) || 1,
    rerolls: record(r.rerolls, (x) => (typeof x === "number" && x > 0 && x < 1000 ? Math.round(x) : undefined)),
    weatherNotes: record(r.weatherNotes, (x) => (typeof x === "string" && x.trim() ? x.trim().slice(0, L.note) : undefined)),
    today: Math.max(-1e8, Math.min(1e8, Math.round(n(r.today, 0)))),
    events,
    categories,
    logCategory: str(r.logCategory, 40),
  };
  if (!cal.climates.some((c) => c.name === cal.climate)) cal.climate = cal.climates[0].name;
  if (!cal.seasons.length) cal.seasons = fresh.seasons;
  if (!seasonsLength(cal)) cal.seasons = cal.seasons.map((s) => ({ ...s, transition: 90 }));
  if (r.source && typeof r.source === "object" && /^[a-f0-9]{32}$/.test(String((r.source as { fc?: unknown }).fc))) cal.source = { fc: String((r.source as { fc: string }).fc), at: Math.round(n((r.source as { at?: unknown }).at, 0)) };
  return cal;
}

/** A rule as Fantasy Calendar keeps them: lists of words, numbers and lists, nothing else, and not too deep. */
function plainRule(v: unknown, depth: number): boolean {
  if (depth > 6) return false;
  if (Array.isArray(v)) return v.length <= 64 && v.every((x) => plainRule(x, depth + 1));
  return typeof v === "string" ? v.length <= 80 : typeof v === "number" && Number.isFinite(v);
}

/** The calendar as players get it: without the GM's eyes-only events and categories. */
export function forPlayers(c: Calendar): Calendar {
  return { ...c, events: c.events.filter((e) => !e.gmOnly), categories: c.categories.filter((x) => !x.gmOnly), weatherNotes: c.weatherNotes };
}
