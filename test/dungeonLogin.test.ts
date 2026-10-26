import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";

// Dungeon signs in with Table's GM sign-in (src/worker/dungeon.ts). The worker files are
// loaded the way the room tests load theirs, so this file's types don't need the Workers ones.
type Who = { kind: "password" } | { kind: "google"; email: string };
interface FakeEnv {
  GM_PASSWORD: string;
  GM_EMAILS: string;
  DUNGEON_URL: string;
  DIRECTORY: { getByName(name: string): { sessionSecret(): Promise<string>; spendHop(nonce: string, exp: number): Promise<boolean> } };
}
interface Auth {
  sessionValue(env: FakeEnv, who: Who, seconds: number, site?: string): Promise<string>;
  sessionWho(value: string | null, env: FakeEnv, site?: string): Promise<Who | null>;
  sessionCookie(env: FakeEnv, secure: boolean): Promise<string>;
  isGm(request: Request, env: FakeEnv): Promise<boolean>;
}
interface Dungeon {
  dungeonPath(raw: string | null): string;
  hopCode(env: FakeEnv, who: Who): Promise<string>;
  redeemHop(env: FakeEnv, code: string): Promise<string | null>;
  dungeonSessionOk(env: FakeEnv, session: string): Promise<boolean>;
  dungeonHop(request: Request, env: FakeEnv, url: URL): Promise<Response>;
  DUNGEON_SESSION_SECONDS: number;
}

const auth = (await import(/* @vite-ignore */ "../src/worker/" + "auth")) as Auth;
const dungeon = (await import(/* @vite-ignore */ "../src/worker/" + "dungeon")) as Dungeon;

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const SECRET = b64url(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const PASSWORD = "test-gm-password";
const GM = "gm@example.com";
let spent: Set<string>;
let env: FakeEnv;

beforeEach(() => {
  spent = new Set();
  env = {
    GM_PASSWORD: PASSWORD,
    GM_EMAILS: GM,
    DUNGEON_URL: "https://dungeon.example.test",
    DIRECTORY: {
      getByName: () => ({
        sessionSecret: async () => SECRET,
        spendHop: async (nonce) => (spent.has(nonce) ? false : (spent.add(nonce), true)),
      }),
    },
  };
});
afterEach(() => {
  vi.useRealTimers();
});

const PASSWORD_GM: Who = { kind: "password" };
const GOOGLE_GM: Who = { kind: "google", email: GM };
const tableCookie = async (who: Who) => `tt_gm=${await auth.sessionValue(env, who, 3600)}`;
const hop = (cookie: string | null, query = "") =>
  dungeon.dungeonHop(
    new Request(`https://table.example.test/api/dungeon/hop${query}`, cookie ? { headers: { Cookie: cookie } } : {}),
    env,
    new URL(`https://table.example.test/api/dungeon/hop${query}`),
  );
const codeFrom = (res: Response) => new URL(res.headers.get("Location")!).searchParams.get("code")!;

describe("Table's own sessions", () => {
  it("keep their format and still sign the GM in", async () => {
    const cookie = await auth.sessionCookie(env, true);
    expect(cookie).toMatch(/^tt_gm=v1\.\d+\.[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
    const value = cookie.split(";")[0];
    expect(await auth.isGm(new Request("https://table.example.test/", { headers: { Cookie: value } }), env)).toBe(true);
    expect(await auth.isGm(new Request("https://table.example.test/", { headers: { Cookie: await tableCookie(GOOGLE_GM) } }), env)).toBe(true);
    expect(await auth.isGm(new Request("https://table.example.test/"), env)).toBe(false);
  });
});

describe("the hop to Dungeon", () => {
  it("sends the signed-in GM back to Dungeon with a one-time code, and the page asked for", async () => {
    const res = await hop(await tableCookie(PASSWORD_GM), "?to=%2Fguide");
    expect(res.status).toBe(303);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const back = new URL(res.headers.get("Location")!);
    expect(back.origin + back.pathname).toBe("https://dungeon.example.test/auth/table");
    expect(back.searchParams.get("to")).toBe("/guide");
    expect(back.searchParams.get("code")).toMatch(/^h1\.\d+\.[A-Za-z0-9]{16}\.p\.[A-Za-z0-9_-]+$/);
  });

  it("sends anyone else to the home page to sign in, remembering where they were going", async () => {
    expect((await hop(null)).headers.get("Location")).toBe("/?then=dungeon");
    expect((await hop(null, "?to=%2Fguide")).headers.get("Location")).toBe("/?then=dungeon&to=%2Fguide");
    expect((await hop("tt_gm=v1.99999999999999.forged")).headers.get("Location")).toBe("/?then=dungeon");
    // A Dungeon session is no good here.
    const dungeonSession = await auth.sessionValue(env, PASSWORD_GM, 3600, "dungeon|");
    expect((await hop(`tt_gm=${dungeonSession}`)).headers.get("Location")).toBe("/?then=dungeon");
  });

  it("only ever goes back to a path on Dungeon", () => {
    for (const bad of [null, "", "//evil.example", "/\\evil.example", "https://evil.example/", "guide", "/a b", "/" + "x".repeat(600)]) {
      expect(dungeon.dungeonPath(bad)).toBe("/");
    }
    for (const good of ["/", "/guide", "/guide.html?x=1", "/assets/index-abc.js"]) expect(dungeon.dungeonPath(good)).toBe(good);
  });
});

describe("Dungeon's sessions", () => {
  it("are made from a code once, and then check out", async () => {
    const code = codeFrom(await hop(await tableCookie(PASSWORD_GM)));
    const session = await dungeon.redeemHop(env, code);
    expect(session).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]+$/);
    expect(await dungeon.dungeonSessionOk(env, session!)).toBe(true);
    // The same code again: spent.
    expect(await dungeon.redeemHop(env, code)).toBeNull();
  });

  it("work for a Google GM, and end when the account comes off the GM list", async () => {
    const code = codeFrom(await hop(await tableCookie(GOOGLE_GM)));
    const session = (await dungeon.redeemHop(env, code))!;
    expect(session.startsWith("g1.")).toBe(true);
    expect(await dungeon.dungeonSessionOk(env, session)).toBe(true);
    env.GM_EMAILS = "someone-else@example.com";
    expect(await dungeon.dungeonSessionOk(env, session)).toBe(false);
  });

  it("end when the GM password changes, and so do codes not yet used", async () => {
    const session = (await dungeon.redeemHop(env, await dungeon.hopCode(env, PASSWORD_GM)))!;
    const code = await dungeon.hopCode(env, PASSWORD_GM);
    env.GM_PASSWORD = "a-new-test-password";
    expect(await dungeon.dungeonSessionOk(env, session)).toBe(false);
    expect(await dungeon.redeemHop(env, code)).toBeNull();
  });

  it("aren't Table sessions, and Table sessions aren't theirs", async () => {
    const session = (await dungeon.redeemHop(env, await dungeon.hopCode(env, PASSWORD_GM)))!;
    expect(await auth.sessionWho(session, env)).toBeNull();
    const table = await auth.sessionValue(env, PASSWORD_GM, 3600);
    expect(await dungeon.dungeonSessionOk(env, table)).toBe(false);
  });

  it("last 12 hours", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
    const session = (await dungeon.redeemHop(env, await dungeon.hopCode(env, PASSWORD_GM)))!;
    expect(dungeon.DUNGEON_SESSION_SECONDS).toBe(12 * 3600);
    vi.setSystemTime(new Date("2026-10-26T23:59:00Z"));
    expect(await dungeon.dungeonSessionOk(env, session)).toBe(true);
    vi.setSystemTime(new Date("2026-10-27T00:01:00Z"));
    expect(await dungeon.dungeonSessionOk(env, session)).toBe(false);
  });

  it("aren't made from an old, altered or made-up code", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
    const code = await dungeon.hopCode(env, PASSWORD_GM);
    vi.setSystemTime(new Date("2026-10-26T12:01:01Z"));
    expect(await dungeon.redeemHop(env, code)).toBeNull();
    vi.setSystemTime(new Date("2026-10-26T12:00:30Z"));

    const [h, exp, nonce, who, sig] = code.split(".");
    const email = b64url(GM);
    for (const altered of [
      [h, String(Number(exp) + 3600_000), nonce, who, sig],
      [h, exp, nonce, email, sig],
      [h, exp, "A".repeat(16), who, sig],
      [h, exp, nonce, who, sig.slice(0, -2) + (sig.endsWith("AA") ? "BB" : "AA")],
      ["h2", exp, nonce, who, sig],
    ]) {
      expect(await dungeon.redeemHop(env, altered.join("."))).toBeNull();
    }
    for (const junk of ["", "h1", "x".repeat(500), `${code}.extra`]) expect(await dungeon.redeemHop(env, junk)).toBeNull();
    // Nothing above spent the real one.
    expect(await dungeon.redeemHop(env, code)).not.toBeNull();
  });
});

describe("the guide", () => {
  const news = GUIDE.find((s) => s.id === "whats-new")!;
  const all = GUIDE.flatMap((s) => s.parts);
  const text = (p: { steps: string[]; notes: string[] }) => [...p.steps, ...p.notes].join("\n");

  it("has Dungeon's sign-in second in What's new, under the Build tool's library, pointing to the how-to", () => {
    expect(news.parts[1].title).toBe("Dungeon signs in with Tabletop (26 October 2026)");
    expect(news.parts[2].title).toBe("Extend a map past its edges (26 October 2026)");
    const entry = text(news.parts[1]);
    for (const what of ["**Dungeon**", "**Table**", "castle button", "See **Open Dungeon, the map maker**"]) expect(entry).toContain(what);
    expect(all.some((p) => p.title === "Open Dungeon, the map maker")).toBe(true);
    expect(all.some((p) => p.title === "Dungeon uses this sign-in")).toBe(true);
  });

  it("quotes the sign-in box and names the buttons as the pages show them", async () => {
    const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
    const home = await readFile(new URL("../src/client/ui/Home.tsx", import.meta.url), "utf8");
    const room = await readFile(new URL("../src/client/ui/RoomPage.tsx", import.meta.url), "utf8");
    const signIn = text(all.find((p) => p.title === "Dungeon uses this sign-in")!);
    expect(home).toContain("Sign in as the GM to open Dungeon, the map maker.");
    expect(signIn).toContain('"Sign in as the GM to open Dungeon, the map maker."');
    expect(home).toMatch(/<Castle size=\{16\} \/> Dungeon\s*<\/a>/);
    expect(room).toContain('aria-label="Dungeon"');
    expect(signIn).toContain("12 hours");
  });
});

describe("signing in on the way to Dungeon", () => {
  const store = new Map<string, string>();
  let replaced: string[];
  const replaceState = vi.fn();
  const load = async (search: string) => {
    vi.resetModules();
    replaced = [];
    vi.stubGlobal("location", { search, pathname: "/", hash: "", replace: (u: string) => replaced.push(u) });
    vi.stubGlobal("history", { replaceState });
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    return import("../src/client/dungeonLink");
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    store.clear();
    replaceState.mockClear();
  });

  it("remembers where Dungeon was going, through Google and back, then carries on there", async () => {
    let link = await load("?then=dungeon&to=%2Fguide");
    expect(link.dungeonNext()).toBe("/guide");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/");
    // Back from Google: the address is plain again.
    link = await load("");
    expect(link.dungeonNext()).toBe("/guide");
    link.continueToDungeon("/guide");
    expect(replaced).toEqual(["/api/dungeon/hop?to=%2Fguide"]);
    link = await load("");
    expect(link.dungeonNext()).toBeNull();
  });

  it("forgets it after ten minutes, and goes nowhere without being asked", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
    let link = await load("?then=dungeon");
    expect(link.dungeonNext()).toBe("/");
    vi.setSystemTime(new Date("2026-10-26T12:10:01Z"));
    link = await load("");
    expect(link.dungeonNext()).toBeNull();
    store.clear();
    replaceState.mockClear();
    link = await load("?signin=denied");
    expect(link.dungeonNext()).toBeNull();
    expect(replaceState).not.toHaveBeenCalledWith(null, "", "/");
    link.continueToDungeon("/");
    expect(replaced).toEqual(["/api/dungeon/hop"]);
  });
});

describe("the Dungeon button", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const otherSite = () => {
    const tab = { closed: false, focus: vi.fn() };
    Object.defineProperty(tab, "location", {
      get() {
        throw new Error("cross-origin");
      },
    });
    return tab;
  };
  const browser = (opts: { name?: string; opener?: object | null; found?: object | null; focused?: boolean }) => {
    const open = vi.fn((url: string, name: string) => (url === "" ? (opts.found ?? null) : { url, name }));
    vi.stubGlobal("window", { name: opts.name ?? "", opener: opts.opener ?? null, open, setTimeout });
    vi.stubGlobal("document", { hasFocus: () => opts.focused ?? false });
    return open;
  };

  it("opens Dungeon in its own tab, or brings that tab forward without reloading it", async () => {
    const { DUNGEON_URL, openDungeon } = await import("../src/client/dungeonLink");
    const blank = { closed: false, focus: vi.fn(), location: { href: "about:blank", replace: vi.fn() } };
    let open = browser({ found: blank });
    expect(openDungeon()).toBe(true);
    expect(open).toHaveBeenCalledWith("", "dungeon");
    expect(blank.location.replace).toHaveBeenCalledWith(DUNGEON_URL);

    vi.useFakeTimers();
    const dungeonTab = otherSite();
    open = browser({ found: dungeonTab });
    openDungeon();
    vi.advanceTimersByTime(400);
    expect(dungeonTab.focus).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledTimes(1);

    // This tab was opened by Dungeon: Dungeon is its opener.
    const opener = otherSite();
    open = browser({ name: "tabletop", opener });
    openDungeon();
    vi.advanceTimersByTime(400);
    expect(opener.focus).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();

    // The browser wouldn't switch tabs: Dungeon loads again in its tab.
    open = browser({ found: otherSite(), focused: true });
    openDungeon();
    vi.advanceTimersByTime(400);
    expect(open).toHaveBeenLastCalledWith(DUNGEON_URL, "dungeon");

    browser({ found: null });
    expect(openDungeon()).toBe(false);
  });
});
