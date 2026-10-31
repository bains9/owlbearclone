// The bars round the map keep out of each other's way (src/client/layoutCheck.ts), checked in a real
// browser at phone, tablet and laptop sizes, in a few states each, before a deploy:
//
//   npm run smoke:layout            (starts a dev server on :5299, needs Chrome installed)
//
// It uses the Chrome already on this computer through playwright-core (no browser download), signs
// in as the GM with the password in .dev.vars (making a throwaway one if there's none), makes a
// room, looks at it, and deletes the room again. Exits 1 with what overlapped.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright-core";

const PORT = 5299;
const BASE = `http://localhost:${PORT}`;
const SIZES = [
  ["phone", 375, 812],
  ["tablet", 768, 1024],
  ["laptop", 1280, 720],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let password;
let madeVars = false;
if (existsSync(".dev.vars")) password = /^GM_PASSWORD=(.*)$/m.exec(readFileSync(".dev.vars", "utf8"))?.[1]?.trim();
if (!password) {
  password = randomBytes(12).toString("base64url");
  writeFileSync(".dev.vars", `GM_PASSWORD=${password}\n`);
  madeVars = true;
}

const server = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["vite", "dev", "--port", String(PORT), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
let serverOut = "";
server.stdout.on("data", (d) => (serverOut += d));
server.stderr.on("data", (d) => (serverOut += d));

const cleanup = () => {
  server.kill();
  if (madeVars) unlinkSync(".dev.vars");
};

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE}/api/build`);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    await sleep(500);
  }
  throw new Error(`The dev server didn't come up on :${PORT}.\n${serverOut.slice(-800)}`);
}

let failures = 0;
try {
  await waitForServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let roomId;
  let context;
  try {
    // Signed in through the start page itself, so the browser holds the session cookie as a GM's would.
    context = await browser.newContext();
    const start = await context.newPage();
    await start.goto(BASE);
    await start.fill('input[aria-label="GM password"]', password);
    await start.click('form:has(input[aria-label="GM password"]) button[type="submit"], form:has(input[aria-label="GM password"]) button');
    await start.waitForFunction(() => /Signed in as the GM|Your rooms/.test(document.body.innerText), null, { timeout: 20000 });
    const made = await start.evaluate(async () => {
      const res = await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Layout smoke (delete me)" }) });
      return res.json();
    });
    roomId = made.id ?? made.room?.id;
    if (!roomId) throw new Error("No room was made.");
    await start.close();
    for (const [label, width, height] of SIZES) {
      const page = await context.newPage();
      await page.setViewportSize({ width, height });
      await page.goto(`${BASE}/r/${roomId}`);
      // A fresh browser is asked its name first, the GM too.
      const join = page.locator('input[placeholder="What should everyone call you?"]');
      if (await join.count()) {
        await join.fill("Smoke");
        await join.press("Enter");
      }
      try {
        await page.waitForFunction(() => !!window.__room?.state.me, null, { timeout: 30000 });
      } catch {
        const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 160));
        throw new Error(`The room didn't open as the GM at ${label}: "${text}"`);
      }
      const problems = await page.evaluate(async () => {
        const room = window.__room;
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const out = {};
        const run = async (state, set) => {
          await set();
          await wait(700);
          const found = window.__layoutCheck();
          if (found.length) out[state] = found.map((p) => `${p.kind}: ${p.a}${p.b ? " × " + p.b : ""} (${p.by}px)`);
        };
        const base = { tool: "select", selection: [], lightPick: null, buildSel: null, panel: null };
        await run("plain", () => room.store.set({ ...base }));
        await run("messages", () => room.toast("A message to measure, long enough to wrap onto a second line on a phone."));
        for (const tool of ["draw", "build", "fog", "spell", "measure"]) await run(`${tool} tool`, () => room.store.set({ ...base, tool }));
        await run("chat panel", () => room.store.set({ ...base, panel: "chat" }));
        await run("calendar panel", () => room.store.set({ ...base, panel: "calendar" }));
        await run("more menu", async () => {
          room.store.set({ ...base });
          await wait(200);
          document.querySelector(".more-wrap button")?.click();
        });
        document.querySelector(".more-wrap button")?.click();
        return out;
      });
      const states = Object.keys(problems);
      if (states.length) {
        failures += states.length;
        console.log(`  FAIL  ${label} (${width}×${height})`);
        for (const s of states) for (const p of problems[s]) console.log(`          ${s}: ${p}`);
      } else console.log(`  ok    ${label} (${width}×${height})`);
      await page.close();
    }
  } finally {
    if (roomId && context) {
      const page = await context.newPage();
      await page.goto(BASE);
      await page.evaluate((id) => fetch(`/api/rooms/${id}`, { method: "DELETE" }), roomId);
      await page.close();
    }
    await browser.close();
  }
} catch (err) {
  failures++;
  console.log(`  FAIL  ${err instanceof Error ? err.message : String(err)}`);
} finally {
  cleanup();
}
console.log(failures ? `${failures} layout problem(s)` : "The layout is clean at every size.");
process.exit(failures ? 1 : 0);
