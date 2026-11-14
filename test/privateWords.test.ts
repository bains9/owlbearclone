// The private-words check (scripts/private-words.mjs): none of this table's private words is
// in the files or their names. The words are the "private_words" of local.jsonc, a file that's
// never committed, so the list isn't in the code either: on a checkout without one, the check
// of the real files is skipped. How a word matches is tested here on made-up words.
import { describe, expect, it } from "vitest";

interface Found {
  file: string;
  line: number;
  entry: string;
}
interface Check {
  wordsOf(line: string): { raw: string; low: string }[];
  pattern(entry: string): { entry: string; exact: boolean; parts: string[]; letters: number };
  findInLine(line: string, patterns: ReturnType<Check["pattern"]>[]): { entry: string; at: number }[];
  findInText(text: string, patterns: ReturnType<Check["pattern"]>[]): { entry: string; line: number }[];
  filesToCheck(root?: string): string[];
  findPrivateWords(root?: string, entries?: string[], files?: string[]): Found[];
}
interface Local {
  ROOT: string;
  readLocal(root?: string): { path: string; privateWords: string[] } | null;
  parseJsonc(text: string): unknown;
}

// Scripts are plain .mjs: imported by a path tsc doesn't follow.
const check = (await import(/* @vite-ignore */ "../scripts/" + "private-words.mjs")) as Check;
const local = (await import(/* @vite-ignore */ "../scripts/" + "local.mjs")) as Local;

const found = (line: string, ...entries: string[]) => check.findInLine(line, entries.map(check.pattern)).map((f) => f.entry);

describe("how a private word matches", () => {
  it("reads text as words, with a new word at each capital or digit inside a name", () => {
    const words = (s: string) => check.wordsOf(s).map((w) => w.raw);
    expect(words("haveNameExport DD_NAME name2 XMLParser it's")).toEqual(["have", "Name", "Export", "DD", "NAME", "name", "2", "XML", "Parser", "it", "s"]);
    expect(words("https://table.example.com/r/abc")).toEqual(["https", "table", "example", "com", "r", "abc"]);
  });

  it("finds a whole word whatever its case, in prose and inside names", () => {
    for (const line of ["Zeno asked for it", "zeno's map", "// ZENO: do it", "const haveZenoExport = 1", "DD_ZENO=/maps", "zeno@example.com", "a/zeno/b.png"]) {
      expect(found(line, "Zeno"), line).toEqual(["Zeno"]);
    }
  });

  it("doesn't find it inside a longer word", () => {
    for (const line of ["zenobia", "Cazenove", "unzenoed", "ZENOBIA", "kazeno"]) expect(found(line, "Zeno"), line).toEqual([]);
    // The classic: a short name inside common words.
    for (const line of ["a frozen lake", "a dozen", "the citizens", "Zenith", "DENIZENS"]) expect(found(line, "Zen"), line).toEqual([]);
    expect(found("Zen asked", "Zen")).toEqual(["Zen"]);
  });

  it('matches "=Word" only as written', () => {
    expect(found("Zed said so", "=Zed")).toEqual(["=Zed"]);
    expect(found("(Zed: \"do all\")", "=Zed")).toEqual(["=Zed"]);
    for (const line of ["zed", "ZED", "a zed-shaped room", "const zed = 1"]) expect(found(line, "=Zed"), line).toEqual([]);
  });

  it("matches several words in a row, close together, and an address by its parts", () => {
    expect(found("for the Blue Lantern gang", "Blue Lantern")).toEqual(["Blue Lantern"]);
    expect(found("blue_lantern.md", "Blue Lantern")).toEqual(["Blue Lantern"]);
    expect(found("blueLantern", "Blue Lantern")).toEqual(["Blue Lantern"]);
    expect(found("a blue door and, further on, a lantern", "Blue Lantern")).toEqual([]);
    expect(found("lantern blue", "Blue Lantern")).toEqual([]);
    expect(found("wss://table.example.com/api", "table.example.com")).toEqual(["table.example.com"]);
    expect(found("mail gm@example.com", "gm@example.com")).toEqual(["gm@example.com"]);
    expect(found("C:\\Users\\zeno\\maps", "C:/Users/zeno")).toEqual(["C:/Users/zeno"]);
    expect(found("id 1AbcDefGhi23Jkl", "1AbcDefGhi23Jkl")).toEqual(["1AbcDefGhi23Jkl"]);
  });

  it("skips checksums, where any short word turns up by chance", () => {
    expect(found('"integrity": "sha512-aQZedZk+Zed/zeno=Zed0aaaaaaaaaaaaaaaaaaaaaaaaaa=="', "=Zed", "Zeno")).toEqual([]);
    expect(found('"resolved": "https://zeno.example.com/x.tgz"', "Zeno")).toEqual(["Zeno"]);
  });

  it("says which line", () => {
    const patterns = ["Zeno", "Blue Lantern"].map(check.pattern);
    expect(check.findInText("one\r\ntwo zeno\n\nfour Blue  Lantern, and Zeno", patterns)).toEqual([
      { entry: "Zeno", line: 2 },
      { entry: "Zeno", line: 4 },
      { entry: "Blue Lantern", line: 4 },
    ]);
  });

  it("an empty word, or a list of none, finds nothing", () => {
    expect(found("anything at all", "", "  ", "=")).toEqual([]);
    expect(check.findPrivateWords(local.ROOT, [], ["README.md"])).toEqual([]);
  });
});

describe("the files", () => {
  it("are checked by name and by what's in them, new files too", () => {
    const files = check.filesToCheck(local.ROOT);
    for (const f of ["README.md", "wrangler.jsonc", "src/worker/index.ts", "scripts/private-words.mjs", "test/privateWords.test.ts"]) expect(files, f).toContain(f);
    // What git ignores is never among them: the private settings themselves, least of all.
    for (const f of files) expect(f.startsWith("node_modules/") || f.startsWith("dist/") || f === "local.jsonc" || f === ".dev.vars", f).toBe(false);
    // A word that is in a file, and one that names a file.
    const hits = check.findPrivateWords(local.ROOT, ["Durable Object", "wrangler"], ["README.md", "wrangler.jsonc"]);
    expect(hits.some((h) => h.file === "README.md" && h.line > 0 && h.entry === "Durable Object")).toBe(true);
    expect(hits.some((h) => h.file === "wrangler.jsonc" && h.line === 0 && h.entry === "wrangler")).toBe(true);
  });

  const mine = local.readLocal(local.ROOT);
  const words = mine?.privateWords ?? [];

  // The real check, wherever there's a list: every file, for every word on it.
  it.skipIf(!words.length)("hold none of this table's private words", () => {
    const hits = check.findPrivateWords(local.ROOT, words);
    expect(hits.map((h) => `${h.file}${h.line ? `:${h.line}` : " (its name)"}: ${h.entry}`)).toEqual([]);
  });
});

describe("the private settings file", () => {
  it("is read as JSON with comments and trailing commas, slashes in text left alone", () => {
    const text = `{
      // where it's served
      "wrangler": { "routes": [{ "pattern": "table.example.com", "custom_domain": true, }], /* and */ "vars": { "DUNGEON_URL": "https://dungeon.example.com", }, },
      "private_words": ["Zeno", "a // b", "c /* d */ e",],
    }`;
    expect(local.parseJsonc(text)).toEqual({
      wrangler: { routes: [{ pattern: "table.example.com", custom_domain: true }], vars: { DUNGEON_URL: "https://dungeon.example.com" } },
      private_words: ["Zeno", "a // b", "c /* d */ e"],
    });
    expect(local.parseJsonc('{"a": "say \\"hi\\", then // go", "b": [1, 2, ], }')).toEqual({ a: 'say "hi", then // go', b: [1, 2] });
    expect(() => local.parseJsonc("{ not json }")).toThrow();
  });
});
