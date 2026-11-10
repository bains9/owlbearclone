// The calendar on the page and at the Worker (31 October 2026): the panel for everyone, the date
// in the top bar, the GM's changes going through the Worker and told to the room, and the import
// from Fantasy Calendar by its link. The maths is in calendar.test.ts.
import { describe, expect, it } from "vitest";
import { GUIDE } from "../src/client/guide";

const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("the calendar on the page", () => {
  it("is a panel for everyone, with the date in the top bar", () => {
    const page = read("src/client/ui/RoomPage.tsx");
    expect(page).toContain('{ id: "calendar", label: "Calendar", icon: CalendarDays },');
    expect(page).toContain('else if (props.panel === "calendar") body = <CalendarPanel />;');
    expect(page).toContain("<DateChip />");
    // ...and on every map, the table display's too, unless the GM keeps it to the panel.
    expect(page).toContain("<DateOverlay />");
    expect(read("src/client/ui/TableDisplay.tsx")).toContain("{hasHello && <DateOverlay />}");
    expect(read("src/client/ui/CalendarPanel.tsx")).toContain("if (!cal || cal.showOnMap === false) return null;");
    expect(read("src/client/room/client.ts")).toContain('export type PanelId = "chat" | "scenes" | "library" | "initiative" | "calendar" | "sound" | "settings" | "notes" | "handouts";');
  });

  it("is read on joining and when the GM changes it, and the GM's changes are told to the room", () => {
    const client = read("src/client/room/client.ts");
    expect(client).toContain("void this.refreshCalendar();");
    expect(client).toContain('case "calendar":\n        if (msg.version !== this.state.calendarVersion) void this.refreshCalendar();');
    expect(client).toContain('if (!this.display) this.submit({ t: "calendar.changed", version });');
    const room = read("src/worker/room.ts");
    expect(room).toContain('case "calendar.changed": {\n        // Anyone\'s (a player\'s log line changes it too), never a display\'s.\n        if (conn.display) return;');
    expect(room).toContain('this.broadcast({ t: "calendar", version:');
  });

  it("lets the GM move the day, set the region and weather, log, and add events; players only look", () => {
    const panel = read("src/client/ui/CalendarPanel.tsx");
    for (const words of [
      // An arrow asks, a day further each click; a day picked in the month can be asked about too.
      "onClick={() => stepAsk(1)}",
      "const next = (askDay ?? today) + n;",
      "onClick={() => setAskDay(shown)}",
      "Make it the game's date",
      "onClick={() => moveDay(askDay)}",
      "patchCalendar(room, { today: epoch, move: true })",
      "onDblClick={() => openDay(list)}",
      "onDblClick={gm ? (ev) => editOnDoubleClick(ev, e) : undefined}",
      // Like every side panel, it scrolls when it's taller than the window.
      '<div class="panel-body calendar">',
      'title="Back to today" onClick={backToToday}',
      "room.sendChat(dayLine(calendar))",
      "act(() => logLine(room, text), () => setLog(\"\"))",
      "<NewPartyDay />",
      "Coming up",
      'placeholder="Find an event"',
      'patchCalendar(room, { climate: e.currentTarget.value })',
      'patchCalendar(room, { reroll: today, note: { epoch: today, text: null } })',
      'patchCalendar(room, { newWeather: true })',
      "The party's log for today",
      "The GM's eyes only",
      '<option value="yearly">Every year on this day</option>',
      "Bring it in",
    ])
      expect(panel).toContain(words);
    // Double-clicks are for looking and editing. Only an arrow, once answered, and Go to this day move the game.
    expect(panel).not.toMatch(/onDblClick=.*moveDay/);
    expect(panel.slice(panel.indexOf("const toDayList"), panel.indexOf("const add = "))).not.toContain("moveDay");
    expect(panel).not.toMatch(/onClick=\{\(\) => moveDay\(today/);
    // Changing a long event from a later day leaves its date alone.
    expect(panel).toContain("...(dr.on ?? { year: at.year, month: at.month, day: at.day })");
    expect(panel).toContain('return gm ? <CalendarSetup busy={busy} act={act} /> : <p class="small muted">The GM hasn\'t set up the calendar yet.</p>;');
  });
});

describe("the calendar at the Worker", () => {
  it("is read by anyone at a table (players without the GM's eyes-only events), changed by the GM alone", () => {
    const index = read("src/worker/index.ts");
    expect(index).toContain('if (sub === "/calendar" && method === "GET") return roomCalendar(request, env, roomId);');
    const routes = read("src/worker/calendarRoutes.ts");
    expect(routes).toContain("return json({ calendar: calendar ? (gm ? calendar : forPlayers(calendar)) : null, version });");
    expect(routes).toContain('if (!(await isGm(request, env))) return fail(401, "Sign in as the GM first.");');
    expect(routes).toContain("const FC_HASH = /^[a-f0-9]{32}$/;");
    // The game's date moves only when asked for, which a page left open from before can't say.
    expect(routes).toContain("if (had && b.move !== true) return fail(409,");
    expect(routes).toContain("if (text.length > MAX_BYTES) return");
    // An event from Fantasy Calendar keeps its link to it through a change here.
    expect(routes).toContain("if (old?.fc !== undefined) e.fc = old.fc;");
    expect(read("src/worker/directory.ts")).toContain("setCalendar(json: string): number {");
    // Time of day, a scene following it, a scene's own region, the day card on a display, a copy for Fantasy Calendar.
    expect(read("src/client/ui/LightingSettings.tsx")).toContain("Day and night follow the calendar's time of day");
    expect(read("src/client/room/client.ts")).toContain("if (this.isGm) this.followDayNight(calendar);");
    expect(read("src/client/ui/ScenesPanel.tsx")).toContain("<SceneRegion scene={s} />");
    expect(read("src/client/ui/ScenesPanel.tsx")).toContain('<option value="on">Always: rain and snow fall here</option>');
    expect(read("src/client/ui/CalendarPanel.tsx")).toContain("{gm && <WeatherHereControl />}");
    // The weather's sound starts in the tap itself (Safari), and says why it's quiet.
    expect(read("src/client/ui/CalendarPanel.tsx")).toContain("if (!on) unlockWeatherSound();");
    expect(read("src/client/weatherSound.ts")).toContain("resumeOnNextGesture();");
    expect(read("src/shared/sanitize.ts")).toContain('const weather = r.weather === null ? undefined : r.weather === "on" || r.weather === "off" ? r.weather : existing?.weather;');
    expect(read("src/client/ui/CalendarPanel.tsx")).toContain("if (!cal || cal.weatherOnMap === false || indoors) return null;");
    expect(read("src/client/ui/TableDisplay.tsx")).toContain("{hasHello && <DayCard />}");
    expect(read("src/worker/calendarRoutes.ts")).toContain('new URL(request.url).searchParams.get("format") === "fc"');
    // A scene's season can be pinned against the calendar's, in its Season pop-up.
    expect(read("src/client/ui/SeasonPicker.tsx")).toContain("<span>Keep this season when the calendar's changes</span>");
    expect(read("src/shared/sanitize.ts")).toContain("...(r.pinned === true ? { pinned: true } : {})");
  });
});

describe("in the guide", () => {
  it("leads What's new, and has its own part", () => {
    expect(GUIDE[0].parts[12].title).toBe("The campaign's calendar: the date, the moons, the weather, and what happens when (31 October 2026)");
    const all = JSON.stringify(GUIDE);
    for (const words of ["**Bring it in**", "**Sync**", "**The GM's eyes only**", "**New weather for the whole calendar**", "Leap days and months that come only some years"]) expect(all).toContain(words);
  });
});
