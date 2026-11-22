// The bars round the map keep out of each other's way (src/client/layoutCheck.ts), checked in a real
// browser at phone, tablet and laptop sizes, in a few states each, before a deploy:
//
//   npm run smoke:layout            (starts a dev server on :5299, needs Chrome installed)
//
// It uses the Chrome already on this computer through playwright-core (no browser download), signs
// in as the GM with the password in .dev.vars (making a throwaway one if there's none), makes a
// room, looks at it, and deletes the room again. Exits 1 with what overlapped.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 5299;
// How long the dev server may take to start, by the clock. It takes about 5 seconds on a quiet
// computer, three to five times that while other work runs (mostly loading the Cloudflare
// plugin and starting workerd), and once took 42 seconds on a deploy, after four deploys in a
// row had given up at 60.
const START_LIMIT_S = 180;
// By number, not "localhost": a stale proxy for that name can answer when nothing listens.
const BASE = `http://127.0.0.1:${PORT}`;
const SIZES = [
  ["phone", 375, 812],
  ["tablet", 768, 1024],
  ["laptop", 1280, 720],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

let password;
let madeVars = false;
if (existsSync(".dev.vars")) password = /^GM_PASSWORD=(.*)$/m.exec(readFileSync(".dev.vars", "utf8"))?.[1]?.trim();
if (!password) {
  password = randomBytes(12).toString("base64url");
  writeFileSync(".dev.vars", `GM_PASSWORD=${password}\n`);
  madeVars = true;
}

await nothingOnPort();
// Vite's own command, run by this same node rather than through npx and a shell: those two
// alone took 7 seconds on a busy computer.
const viteBin = join(dirname(createRequire(import.meta.url).resolve("vite/package.json")), "bin", "vite.js");
const startedAt = Date.now();
const server = spawn(process.execPath, [viteBin, "dev", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"] });
let serverOut = "";
let serverEnded = null;
server.stdout.on("data", (d) => (serverOut += d));
server.stderr.on("data", (d) => (serverOut += d));
server.on("exit", (code, signal) => (serverEnded = signal ? `was stopped (${signal})` : `stopped with exit code ${code}`));
server.on("error", (err) => (serverEnded = `couldn't be started (${err.message})`));

const cleanup = () => {
  // On Windows workerd outlives the vite that started it: the whole tree, or the next run talks to this one.
  if (process.platform === "win32" && server.pid) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill();
  if (madeVars) unlinkSync(".dev.vars");
};

async function nothingOnPort() {
  try {
    await fetch(`${BASE}/api/build`);
  } catch {
    return;
  }
  throw new Error(`Something is already on :${PORT} (a dev server from an earlier run?): stop it first.`);
}

function portIsOpen() {
  return new Promise((resolve) => {
    const socket = connect(PORT, "127.0.0.1");
    socket.setTimeout(2000);
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("timeout", () => (socket.destroy(), resolve(false)));
    socket.once("error", () => resolve(false));
  });
}

async function waitForServer() {
  const deadline = startedAt + START_LIMIT_S * 1000;
  let openedAt = null;
  let lastAnswer = null;
  while (Date.now() < deadline && !serverEnded) {
    if (openedAt === null && (await portIsOpen())) openedAt = Date.now();
    if (openedAt !== null) {
      try {
        // A fetch can hang once the port is open, so each one has its own limit.
        const res = await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(15000) });
        if (res.ok) {
          console.log(`  The dev server was up in ${seconds(Date.now() - startedAt)} (port open at ${seconds(openedAt - startedAt)}).`);
          return;
        }
        lastAnswer = `HTTP ${res.status}`;
      } catch (err) {
        lastAnswer = err?.name === "TimeoutError" ? "no answer in 15 s" : (err?.cause?.code ?? err?.message ?? String(err));
      }
    }
    await sleep(500);
  }
  const took = seconds(Date.now() - startedAt);
  const what = serverEnded ? `The dev server ${serverEnded} after ${took}, before it was up on :${PORT}.` : `The dev server didn't come up on :${PORT} in ${START_LIMIT_S} s.`;
  const port = openedAt === null ? `The port never opened.` : `The port opened at ${seconds(openedAt - startedAt)}, but /api/build never answered OK (last: ${lastAnswer ?? "not asked"}).`;
  const out = serverOut.trim() ? serverOut.replace(/\x1b\[[0-9;]*m/g, "").trimEnd() : "(nothing)";
  throw new Error(`${what}\n        ${port}\n        Everything the server printed:\n${out}`);
}

let failures = 0;
try {
  await waitForServer();
  if (serverOut.includes("already in use")) throw new Error(`Something is already on :${PORT} (a dev server from an earlier run?): stop it first.`);
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
    try {
      await start.waitForFunction(() => /Signed in as the GM|Your rooms/.test(document.body.innerText), null, { timeout: 60000 });
    } catch {
      const text = await start.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 200));
      throw new Error(`Signing in as the GM didn't take: "${text}"`);
    }
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
