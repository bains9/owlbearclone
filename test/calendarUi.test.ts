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
    expect(read("src/client/room/client.ts")).toContain('export type PanelId = "chat" | "scenes" | "library" | "initiative" | "calendar" | "settings";');
  });

  it("is read on joining and when the GM changes it, and the GM's changes are told to the room", () => {
    const client = read("src/client/room/client.ts");
    expect(client).toContain("void this.refreshCalendar();");
    expect(client).toContain('case "calendar":\n        if (msg.version !== this.state.calendarVersion) void this.refreshCalendar();');
    expect(client).toContain('if (this.isGm) this.submit({ t: "calendar.changed", version });');
    const room = read("src/worker/room.ts");
    expect(room).toContain('case "calendar.changed": {\n        if (!gm) return this.deny(ws);');
    expect(room).toContain('this.broadcast({ t: "calendar", version:');
  });

  it("lets the GM move the day, set the region and weather, log, and add events; players only look", () => {
    const panel = read("src/client/ui/CalendarPanel.tsx");
    for (const words of [
      'patchCalendar(room, { today: today + 1 })',
      'patchCalendar(room, { climate: e.currentTarget.value })',
      'patchCalendar(room, { reroll: today, note: { epoch: today, text: null } })',
      'patchCalendar(room, { newWeather: true })',
      "The party's log for today",
      "The GM's eyes only",
      '<option value="yearly">Every year on this day</option>',
      "Bring it in",
    ])
      expect(panel).toContain(words);
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
    expect(routes).toContain("if (text.length > MAX_BYTES) return");
    // An event from Fantasy Calendar keeps its link to it through a change here.
    expect(routes).toContain("if (old?.fc !== undefined) e.fc = old.fc;");
    expect(read("src/worker/directory.ts")).toContain("setCalendar(json: string): number {");
  });
});

describe("in the guide", () => {
  it("leads What's new, and has its own part", () => {
    expect(GUIDE[0].parts[0].title).toBe("The campaign's calendar: the date, the moons, the weather, and what happens when (31 October 2026)");
    const all = JSON.stringify(GUIDE);
    for (const words of ["**Bring it in**", "**Sync**", "**The GM's eyes only**", "**New weather for the whole calendar**", "Leap days and months that come only some years"]) expect(all).toContain(words);
  });
});
