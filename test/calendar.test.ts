// The campaign's calendar (shared/calendar.ts), checked against Fantasy Calendar: the fixture is
// a year of one of its calendars as it worked the days out (epoch:weekday:moon phases:season
// index:season day), so the moons, weekdays and seasons here must come out the same, and the
// repeating events must fall on the same days.
import { describe, expect, it } from "vitest";
import {
  CALENDAR_LIMITS,
  dateOf,
  dateText,
  epochOf,
  eventStarts,
  eventsOn,
  forPlayers,
  fromFantasyCalendar,
  htmlToText,
  moonPhase,
  moonPhaseName,
  newCalendar,
  repeatRule,
  ruleSummary,
  sanitizeCalendar,
  seasonOf,
  weatherOf,
  type Calendar,
} from "../src/shared/calendar";

const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
const oracle = fs
  .readFileSync(new URL("./fixtures/calendar-oracle.txt", import.meta.url), "utf8")
  .trim()
  .split(/\s+/)
  .map((row) => {
    const [epoch, weekday, moons, season, seasonDay] = row.split(":");
    return { epoch: Number(epoch), weekday: Number(weekday), moons: moons.split(".").map(Number), season: Number(season), seasonDay: Number(seasonDay) };
  });

/** The calendar the fixture came from: a ten-day week, twelve 30-day months, three moons, four 90-day seasons shifted a day. */
function fixture(): Calendar {
  const c = newCalendar();
  c.months = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10", "M11", "M12"].map((name) => ({ name, length: 30 }));
  c.moons = [
    { name: "Small", cycle: 7, shift: 3, granularity: 4, color: "#8e83f9" },
    { name: "Big", cycle: 47, shift: 5, granularity: 40, color: "#fa5656" },
    { name: "Pale", cycle: 30, shift: 14, granularity: 24, color: "#ffffff" },
  ];
  c.seasonOffset = -1;
  c.today = 418;
  return c;
}

describe("dates", () => {
  it("count days from the first day of year 1, month by month, and know the weekday", () => {
    const c = fixture();
    expect(epochOf(c, 2, 1, 29)).toBe(418);
    expect(dateOf(c, 418)).toEqual({ year: 2, month: 1, day: 29, yearDay: 59, weekday: 9 });
    expect(dateText(c, 418)).toBe("Nineday 29 M2, Year 2");
    expect(dateOf(c, 0)).toEqual({ year: 1, month: 0, day: 1, yearDay: 1, weekday: 1 });
    expect(dateOf(c, 359).day).toBe(30);
    for (const row of oracle) expect(dateOf(c, row.epoch).weekday, `epoch ${row.epoch}`).toBe(row.weekday);
    // With a year 0, the count starts there.
    expect(dateOf({ ...c, yearZero: true }, 0).year).toBe(0);
  });
});

describe("moons", () => {
  it("are in the phase Fantasy Calendar puts them in, every day of the year", () => {
    const c = fixture();
    for (const row of oracle) {
      for (let i = 0; i < 3; i++) expect(moonPhase(c.moons[i], row.epoch), `epoch ${row.epoch} moon ${i}`).toBe(row.moons[i]);
    }
    expect([moonPhaseName(0, 4), moonPhaseName(2, 4), moonPhaseName(1, 4), moonPhaseName(3, 4), moonPhaseName(5, 40), moonPhaseName(15, 40), moonPhaseName(25, 40), moonPhaseName(35, 40)]).toEqual([
      "new",
      "full",
      "first quarter",
      "last quarter",
      "waxing crescent",
      "waxing gibbous",
      "waning gibbous",
      "waning crescent",
    ]);
  });
});

describe("seasons", () => {
  it("fall on the days Fantasy Calendar's do, through the turn of the year", () => {
    const c = fixture();
    for (const row of oracle) {
      const s = seasonOf(c, row.epoch);
      expect([s.index, s.day], `epoch ${row.epoch}`).toEqual([row.season, row.seasonDay]);
    }
    expect(Math.floor(seasonOf(c, 418).perc * 100)).toBe(34);
  });
});

describe("weather", () => {
  it("is the same every time for a day, within the region's range, and rolls again when asked", () => {
    const c = fixture();
    const w = weatherOf(c, 418);
    expect(weatherOf(c, 418)).toEqual(w);
    expect(w.text).toMatch(/°C\.$/);
    expect(w.low).toBeLessThan(w.high);
    const temps = oracle.map((r) => weatherOf(c, r.epoch));
    // Winter is colder than summer in a temperate region.
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(temps.slice(0, 90).map((x) => x.high))).toBeLessThan(mean(temps.slice(180, 270).map((x) => x.high)));
    expect(temps.some((x) => x.precipitation !== "none")).toBe(true);
    expect(temps.some((x) => x.precipitation === "none")).toBe(true);
    const again = { ...c, rerolls: { "418": 1 } };
    expect(oracle.filter((r) => weatherOf(c, r.epoch).text !== weatherOf({ ...c, weatherSeed: 2 }, r.epoch).text).length).toBeGreaterThan(300);
    expect(weatherOf(again, 417)).toEqual(weatherOf(c, 417));
    // Another region, another weather.
    expect(weatherOf({ ...c, climate: "Hot desert" }, 418).high).toBeGreaterThan(w.high);
  });
});

describe("events", () => {
  it("fall on the day of a date, and on each day of one that lasts", () => {
    const c = fixture();
    c.events = [
      { id: "a", name: "Market", text: "", category: "", gmOnly: false, when: { kind: "date", year: 2, month: 1, day: 29 }, days: 1 },
      { id: "b", name: "Siege", text: "", category: "", gmOnly: false, when: { kind: "date", year: 2, month: 1, day: 27 }, days: 3 },
      { id: "c", name: "Secret", text: "", category: "", gmOnly: true, when: { kind: "date", year: 2, month: 1, day: 29 }, days: 1 },
    ];
    expect(eventsOn(c, 418, true).map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(eventsOn(c, 418, false).map((e) => e.id)).toEqual(["a", "b"]);
    expect(eventsOn(c, 419, true).map((e) => e.id)).toEqual([]);
    expect(eventsOn(c, 416, true).map((e) => e.id)).toEqual(["b"]);
  });

  it("come round by Fantasy Calendar's rules, on the days it would put them", () => {
    const c = fixture();
    const rule = (conditions: unknown[]) => ({ id: "r", name: "R", text: "", category: "", gmOnly: false, when: { kind: "rule" as const, conditions, summary: "" }, days: 1 });
    const days = (conditions: unknown[]) => oracle.filter((r) => eventStarts(c, rule(conditions), r.epoch)).map((r) => r.epoch);
    // The first day of each season.
    expect(days([["Season", "0", ["1"]], ["&&"], ["Season", "8", ["1"]]])).toEqual([449]);
    expect(days([["Season", "0", ["0"]], ["&&"], ["Season", "8", ["1"]]])).toEqual([719]);
    // All three moons full at once, and the Big and Pale moons both new (on any ordinary day).
    const full = oracle.filter((r) => r.moons[0] === 2 && r.moons[1] === 20 && r.moons[2] === 12).map((r) => r.epoch);
    expect(days([["Moons", "0", ["0", "2"]], ["&&"], ["Moons", "0", ["1", "20"]], ["&&"], ["Moons", "0", ["2", "12"]]])).toEqual(full);
    // Both the Big and Pale moons new (never in this year), and the Big moon new on an ordinary day.
    expect(days([["Day", "21", ["1"]], ["&&"], ["Moons", "0", ["1", "0"]], ["&&"], ["Moons", "0", ["2", "0"]]])).toEqual([]);
    const dark = oracle.filter((r) => r.moons[1] === 0).map((r) => r.epoch);
    expect(dark.length).toBeGreaterThan(0);
    expect(days([["Day", "21", ["1"]], ["&&"], ["Moons", "0", ["1", "0"]]])).toEqual(dark);
    // The last Tenday of month 10, and the first Oneday of month 5; the 15th of month 10 every year.
    expect(days([["Month", "0", ["9"]], ["&&"], ["Weekday", "0", ["Tenday"]], ["&&"], ["Weekday", "14", ["1"]]])).toEqual([659]);
    expect(days([["Month", "0", ["4"]], ["&&"], ["Weekday", "0", ["Oneday"]], ["&&"], ["Weekday", "8", ["1"]]])).toEqual([480]);
    expect(days([["Day", "0", ["15"]], ["&&"], ["Month", "0", ["9"]], ["&&"], ["Year", "6", ["1", "0"]]])).toEqual([644]);
    // A date rule twice over (as Fantasy Calendar's editor leaves some), and every 7th day from a day.
    expect(days([["Date", "0", [2, 1, 29]], ["&&"], ["Date", "0", [2, 1, 29]]])).toEqual([418]);
    expect(days(repeatRule("everyDays", { month: 1, day: 29 }, 7, 418)).slice(0, 3)).toEqual([362, 369, 376]);
    expect(days(repeatRule("yearly", { month: 1, day: 29 }))).toEqual([418]);
    expect(days(repeatRule("monthly", { month: 1, day: 29 })).length).toBe(12);
    // Or: either moon new.
    expect(days([["Moons", "0", ["1", "0"]], ["||"], ["Moons", "0", ["2", "0"]]]).length).toBeGreaterThan(dark.length);
    // Not a rule it knows: never.
    expect(days([["Era", "0", ["1"]]])).toEqual([]);
    expect(days([])).toEqual([]);
  });

  it("say a rule in words", () => {
    const c = fixture();
    expect(ruleSummary(c, [["Month", "0", ["9"]], ["&&"], ["Weekday", "0", ["Tenday"]], ["&&"], ["Weekday", "14", ["1"]]])).toBe("in M10, on a Tenday, the last one of the month");
    expect(ruleSummary(c, [["Moons", "0", ["1", "0"]], ["&&"], ["Moons", "0", ["2", "0"]]])).toBe("Big new, Pale new");
    expect(ruleSummary(c, [["Day", "0", ["15"]], ["&&"], ["Month", "0", ["9"]], ["&&"], ["Year", "6", ["1", "0"]]])).toBe("on day 15, in M10, every year");
    expect(ruleSummary(c, [["Season", "0", ["2"]], ["&&"], ["Season", "8", ["1"]]])).toBe("in Summer, on its first day");
  });
});

describe("from Fantasy Calendar", () => {
  const fc = () => ({
    name: "A world",
    static_data: {
      year_data: { first_day: 1, overflow: true, global_week: ["Oneday", "Twoday"], timespans: [{ name: "Alpha", type: "month", length: 20, interval: 1, offset: 0 }, { name: "Beta", type: "month", length: 10, interval: 1, offset: 0 }], leap_days: [] },
      moons: [{ name: "Luna", cycle: "30", shift: 14, granularity: 24, color: "#ffffff", hidden: false }, { name: "Ghost", cycle: 9, shift: 0, granularity: 8, color: "#000000", hidden: true }],
      seasons: {
        global_settings: { season_offset: -1, seed: 42, temp_sys: "metric" },
        data: [{ name: "Cold", transition_length: 15, duration: 0 }, { name: "Hot", transition_length: 15, duration: 0 }],
        locations: [{ name: "Warm and Rainy", seasons: [{ weather: { temp_low: -12.2, temp_high: 10, precipitation: 0.4, precipitation_intensity: 0.5 } }, { weather: { temp_low: 10, temp_high: 29.4, precipitation: 0.4, precipitation_intensity: 0.6 } }] }],
      },
      settings: { year_zero_exists: false },
    },
    dynamic_data: { year: 2, timespan: 0, day: 3, epoch: 32, location: "Cold Desert" },
    event_categories: [
      { id: 1, name: "Party  Action or Event", event_settings: { color: "Orange", hide: false } },
      { id: 2, name: "Sandbox", event_settings: { color: "Cyan", hide: true } },
    ],
    events: [
      { id: 10, name: "Met the bridge", description: "<p>Crossed at <strong>dawn</strong>.</p><ul><li>one</li><li>two</li></ul>", event_category_id: 1, data: { conditions: [["Date", "0", [2, 0, 3]]], date: [2, 0, 3], has_duration: false, duration: 1 }, settings: { color: "Orange", hide: false } },
      { id: 11, name: "Plot", description: "", event_category_id: 2, data: { conditions: [["Date", "0", [2, 0, 4]]], date: [2, 0, 4], has_duration: true, duration: 3 }, settings: { color: "Cyan", hide: true } },
      { id: 12, name: "Cold's first day", description: "", event_category_id: null, data: { conditions: [["Season", "0", ["0"]], ["&&"], ["Season", "8", ["1"]]], date: [1, 0, 1] }, settings: { hide: false } },
      { id: 13, name: "Lost", description: "", event_category_id: null, data: { conditions: [] }, settings: {} },
    ],
  });

  it("brings over the months, weekdays, moons, seasons, regions, date, categories and events", () => {
    const { calendar: c, notes } = fromFantasyCalendar(fc(), null, "c59352efd833e0789e966cf8c13805b4");
    expect(c.name).toBe("A world");
    expect(c.months).toEqual([{ name: "Alpha", length: 20 }, { name: "Beta", length: 10 }]);
    expect(c.weekdays).toEqual(["Oneday", "Twoday"]);
    expect(c.moons).toEqual([{ name: "Luna", cycle: 30, shift: 14, granularity: 24, color: "#ffffff" }]);
    expect(c.seasons).toEqual([{ name: "Cold", transition: 15, duration: 0 }, { name: "Hot", transition: 15, duration: 0 }]);
    expect(c.seasonOffset).toBe(-1);
    expect(c.climates[0]).toEqual({ name: "Warm and Rainy", seasons: [{ low: -12.2, high: 10, rain: 0.4, heavy: 0.5 }, { low: 10, high: 29.4, rain: 0.4, heavy: 0.6 }] });
    expect(c.climates.some((x) => x.name === "Cold desert")).toBe(true);
    expect(c.climate).toBe("Cold desert");
    expect(c.today).toBe(32);
    expect(c.weatherSeed).toBe(42);
    expect(c.categories).toEqual([
      { id: "fc1", name: "Party Action or Event", color: "#f76b15", gmOnly: false },
      { id: "fc2", name: "Sandbox", color: "#00a2c7", gmOnly: true },
    ]);
    expect(c.logCategory).toBe("fc1");
    expect(c.events.map((e) => [e.id, e.when.kind, e.gmOnly, e.days, e.category])).toEqual([
      ["fc10", "date", false, 1, "fc1"],
      ["fc11", "date", true, 3, "fc2"],
      ["fc12", "rule", false, 1, ""],
      ["fc13", "rule", false, 1, ""],
    ]);
    expect(c.events[0].text).toBe("Crossed at dawn.\n\n• one\n• two");
    expect(c.events[2].when).toMatchObject({ summary: "in Cold, on its first day" });
    expect(c.source?.fc).toBe("c59352efd833e0789e966cf8c13805b4");
    expect(notes).toEqual(["1 event has no date or rule, so it won't show on any day."]);
    // Luna's phase on the current day, as the moon maths has it.
    expect(moonPhase(c.moons[0], 32)).toBe(moonPhase({ name: "", cycle: 30, shift: 14, granularity: 24, color: "" }, 32));
  });

  it("on a sync keeps what was made here: the day, the region, and the calendar's own events", () => {
    const first = fromFantasyCalendar(fc(), null).calendar;
    const mine: Calendar = { ...first, today: 40, climate: "Hot desert", events: [...first.events, { id: "own1", name: "Ours", text: "", category: first.logCategory, gmOnly: false, when: { kind: "date", year: 2, month: 0, day: 9 }, days: 1 }] };
    const data = fc();
    data.events[0].name = "Met the bridge, renamed";
    const again = fromFantasyCalendar(data, mine).calendar;
    expect([again.today, again.climate]).toEqual([40, "Hot desert"]);
    expect(again.events.map((e) => e.name)).toEqual(["Ours", "Met the bridge, renamed", "Plot", "Cold's first day", "Lost"]);
  });

  it("says what can't come over: leap days, months that skip years", () => {
    const data = fc();
    data.static_data.year_data.leap_days = [{ name: "Leap" }] as never;
    data.static_data.year_data.timespans.push({ name: "Odd", type: "intercalary", length: 1, interval: 4, offset: 0 });
    const { notes } = fromFantasyCalendar(data, null);
    expect(notes.some((x) => /Leap days/.test(x))).toBe(true);
    expect(notes.some((x) => /intercalary/.test(x))).toBe(true);
  });

  it("turns the editor's HTML into plain lines", () => {
    expect(htmlToText("<p>One <em>two</em></p><p>Three<br>four</p><div>&amp; &lt;5&gt;</div>")).toBe("One two\n\nThree\nfour\n\n& <5>");
  });
});

describe("checking a calendar sent in", () => {
  it("keeps what's right, trims to the limits, and refuses what isn't one", () => {
    expect(sanitizeCalendar(null)).toBeNull();
    expect(sanitizeCalendar({ months: [] })).toBeNull();
    expect(sanitizeCalendar({ months: [{ name: "A", length: 5 }], weekdays: ["x"] })).toMatchObject({ name: "The calendar", firstDay: 1, climate: "Temperate", today: 0 });
    const c = fixture();
    c.events = [{ id: "e", name: "x".repeat(500), text: "", category: "", gmOnly: false, when: { kind: "rule", conditions: [["Moons", "0", ["1", "0"]]], summary: "" }, days: 9000 }];
    c.weatherNotes = { "418": "Fog.", bad: "no", "419": "" };
    c.rerolls = { "418": 2 };
    const out = sanitizeCalendar(JSON.parse(JSON.stringify(c)))!;
    expect(out.events[0].name).toHaveLength(CALENDAR_LIMITS.eventName);
    expect(out.events[0].days).toBe(CALENDAR_LIMITS.days);
    expect(out.weatherNotes).toEqual({ "418": "Fog." });
    expect(out.rerolls).toEqual({ "418": 2 });
    expect(out.moons).toEqual(c.moons);
    // A rule that isn't lists of words and numbers is thrown out.
    const bad = { ...c, events: [{ ...c.events[0], when: { kind: "rule", conditions: [["Moons", "0", { evil: true }]] } }] };
    expect(sanitizeCalendar(JSON.parse(JSON.stringify(bad)))!.events).toEqual([]);
  });

  it("gives players a calendar without the GM's eyes-only events", () => {
    const c = fixture();
    c.events = [{ id: "s", name: "S", text: "", category: "", gmOnly: true, when: { kind: "date", year: 1, month: 0, day: 1 }, days: 1 }];
    c.categories = [{ id: "h", name: "Hidden", color: "#000000", gmOnly: true }];
    expect(forPlayers(c).events).toEqual([]);
    expect(forPlayers(c).categories).toEqual([]);
  });
});
