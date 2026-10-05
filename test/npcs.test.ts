// The GM's NPCs list: the races and classes from the group's own campaign handbook (generated
// from the same table as the icons, and checked against it), the icons and their token art,
// finding a pair's uploaded picture again, numbering, dragging, placing one (sized, named,
// coloured by class, hidden when asked), what happens when the icons can't load, and what the
// guide says about them.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { RoomClient } from "../src/client/room/client";
import { DND_SQUARES } from "../src/client/room/tokenSizes";
import { saveAddHidden } from "../src/client/monsters/place";
import {
  ART_PX,
  CLASS_GROUPS,
  NPC_CLASSES,
  NPC_RACES,
  RACE_GROUPS,
  classesByGroup,
  findClass,
  findNpcAsset,
  findRace,
  npcAssetName,
  npcDescription,
  npcLabel,
  npcName,
  npcSquares,
  racesByGroup,
} from "../src/client/npcs/npcs";
import { ART, drawNpcArt, iconPlacement, previewPx } from "../src/client/npcs/art";
import { NPC_ICONS } from "../src/client/npcs/icons";
import { NPCS_LOAD_FAILED, loadNpcs, npcDragData, placeNpc, readNpcDrag } from "../src/client/npcs/place";
import * as table from "../src/client/npcs/table";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER, sanitizeItem } from "../src/shared/sanitize";
import type { Asset, Player, Scene, TokenItem } from "../src/shared/types";

// The browser draws an NPC's picture (art.ts, tested below with a stand-in canvas); here
// placing gets a stand-in file instead, for a stand-in upload.
vi.mock("../src/client/npcs/art", async (original) => ({
  ...(await original<typeof import("../src/client/npcs/art")>()),
  npcArtFile: async (race: { name: string }, cls: { name: string }) => ({ name: `NPC: ${race.name} ${cls.name}.webp` }) as File,
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

async function readSource(path: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

const octran = findRace("octran")!;
const crusader = findClass("crusader")!;

describe("the races and classes", () => {
  it("are the handbook's 17 races and 14 classes, as generated from the table (run node scripts/npc-icons.mjs after changing it)", async () => {
    const rows = (await readSource("../scripts/npc-icons/list.tsv"))
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => l.split("\t"));
    expect(rows[0]).toEqual(["kind", "id", "name", "icon", "colour", "size", "group"]);
    expect(NPC_RACES).toHaveLength(17);
    expect(NPC_CLASSES).toHaveLength(14);
    expect(NPC_RACES.map((r) => ["race", r.id, r.name, r.icon, r.tint, r.size, r.group])).toEqual(rows.slice(1, 18));
    expect(NPC_CLASSES.map((c) => ["class", c.id, c.name, c.icon, c.color, "", c.group])).toEqual(rows.slice(18));
    // The one table, not a copy kept by hand.
    expect(NPC_RACES).toBe(table.NPC_RACES);
    expect(NPC_CLASSES).toBe(table.NPC_CLASSES);
  });

  it("has exactly the handbook's names", () => {
    expect(NPC_RACES.map((r) => r.name)).toEqual([
      "Nyloran",
      "Sylvan",
      "Duga",
      "Half-elf",
      "Dwerv",
      "Gnome",
      "Oesir",
      "Firgald",
      "Wyddin",
      "Danae",
      "Octran",
      "Goblin",
      "Hobgoblin",
      "Lizardfolk",
      "Kobold",
      "Sea Elf",
      "Urk",
    ]);
    expect(NPC_CLASSES.map((c) => c.name)).toEqual([
      "Fighter",
      "Crusader",
      "Samurai",
      "Ranger",
      "Cleric",
      "War Cleric",
      "Nature Cleric",
      "Rogue",
      "Monk",
      "Mage",
      "Shaman",
      "Necromancer",
      "Death Knight",
      "Bog Witch",
    ]);
  });

  it("has unique ids and names, known groups in the groups' order, and valid colours", () => {
    expect(new Set([...NPC_RACES, ...NPC_CLASSES].map((x) => x.id)).size).toBe(31);
    expect(new Set([...NPC_RACES, ...NPC_CLASSES].map((x) => x.name.toLowerCase())).size).toBe(31);
    for (const x of [...NPC_RACES, ...NPC_CLASSES]) expect(x.id, x.name).toMatch(/^[a-z0-9-]+$/);
    for (const r of NPC_RACES) expect(r.tint, r.id).toMatch(/^#[0-9a-f]{6}$/);
    for (const c of NPC_CLASSES) expect(c.color, c.id).toMatch(/^#[0-9a-f]{6}$/);
    // Grouped as the list shows them: each group's members together, groups in order.
    const groupsOf = (xs: readonly { group: string }[]) => xs.map((x) => x.group).filter((g, i, all) => all.indexOf(g) === i);
    expect(groupsOf(NPC_RACES)).toEqual(RACE_GROUPS);
    expect(groupsOf(NPC_CLASSES)).toEqual(CLASS_GROUPS);
    expect(RACE_GROUPS).toEqual(["Elves", "Dwerves and gnomes", "Humans", "NPC races"]);
    expect(CLASS_GROUPS).toEqual(["Classes", "NPC classes"]);
    expect(NPC_RACES.filter((r) => r.group === "Elves").map((r) => r.id)).toEqual(["nyloran", "sylvan", "duga", "half-elf"]);
    expect(NPC_CLASSES.filter((c) => c.group === "NPC classes").map((c) => c.id)).toEqual(["necromancer", "death-knight", "bog-witch"]);
  });

  it("sizes gnomes, goblins and kobolds Small and the rest Medium: one square each", () => {
    expect(NPC_RACES.filter((r) => r.size === "small").map((r) => r.id)).toEqual(["gnome", "goblin", "kobold"]);
    for (const r of NPC_RACES) {
      expect(["small", "medium"], r.id).toContain(r.size);
      expect(npcSquares(r), r.id).toBe(1);
      expect(DND_SQUARES[r.size]).toBe(1);
    }
  });

  it("finds a race or class by id", () => {
    expect(findRace("sea-elf")?.name).toBe("Sea Elf");
    expect(findClass("war-cleric")?.name).toBe("War Cleric");
    expect(findRace("elf")).toBeUndefined();
    expect(findClass("nyloran")).toBeUndefined();
  });

  it("names an NPC by its race and class", () => {
    expect(npcName(octran, crusader)).toBe("Octran Crusader");
    expect(npcAssetName(octran, crusader)).toBe("NPC: Octran Crusader");
    for (const r of NPC_RACES) {
      for (const c of NPC_CLASSES) {
        // Its uploaded picture's name fits an asset name.
        expect(npcAssetName(r, c).length).toBeLessThanOrEqual(60);
      }
    }
  });
});

describe("the list's pickers", () => {
  it("offer every race and class once, under its group, the groups in order", () => {
    const races = racesByGroup();
    expect(races.map((g) => g.group)).toEqual(RACE_GROUPS);
    expect(races.flatMap((g) => g.races)).toEqual(NPC_RACES);
    for (const g of races) for (const r of g.races) expect(r.group, r.id).toBe(g.group);
    expect(races.map((g) => g.races.map((r) => r.name))).toEqual([
      ["Nyloran", "Sylvan", "Duga", "Half-elf"],
      ["Dwerv", "Gnome"],
      ["Oesir", "Firgald", "Wyddin", "Danae", "Octran"],
      ["Goblin", "Hobgoblin", "Lizardfolk", "Kobold", "Sea Elf", "Urk"],
    ]);
    const classes = classesByGroup();
    expect(classes.map((g) => g.group)).toEqual(CLASS_GROUPS);
    expect(classes.flatMap((g) => g.classes)).toEqual(NPC_CLASSES);
    for (const g of classes) for (const c of g.classes) expect(c.group, c.id).toBe(g.group);
    expect(classes[1].classes.map((c) => c.name)).toEqual(["Necromancer", "Death Knight", "Bog Witch"]);
  });

  it("describe a pair as the guide says, with its D&D size and squares", () => {
    expect(npcDescription(octran, crusader)).toBe("Octran Crusader: Medium, 1×1 squares");
    expect(npcDescription(findRace("goblin")!, findClass("shaman")!)).toBe("Goblin Shaman: Small, 1×1 squares");
    expect(npcDescription(findRace("gnome")!, findClass("bog-witch")!)).toBe("Gnome Bog Witch: Small, 1×1 squares");
  });
});

describe("the icons (generated data)", () => {
  it("has every head and emblem the races and classes use, and no other", () => {
    const used = new Set([...NPC_RACES.map((r) => r.icon), ...NPC_CLASSES.map((c) => c.icon)]);
    expect(Object.keys(NPC_ICONS).sort()).toEqual([...used].sort());
    expect(Object.keys(NPC_ICONS)).toHaveLength(27);
    for (const [id, icon] of Object.entries(NPC_ICONS)) expect(icon.source, id).toBe(id.replace("_", "/"));
  });

  it("is up to date with the SVGs (run node scripts/npc-icons.mjs after changing them)", async () => {
    for (const [id, icon] of Object.entries(NPC_ICONS)) {
      const svg = await readSource(`../scripts/npc-icons/svg/${id}.svg`);
      expect(/\sd="([^"]+)"/.exec(svg)?.[1], id).toBe(icon.path);
    }
  });

  it("has a path for each, on the 512 box, and where its drawing sits", () => {
    for (const [id, icon] of Object.entries(NPC_ICONS)) {
      expect(icon.path.length, id).toBeGreaterThan(100);
      expect(icon.path, id).toMatch(/^[Mm][-0-9.,\s MmLlHhVvCcSsQqTtAaZz]+$/);
      const [cx, cy, r] = icon.fit;
      // Game-icons are drawn around the middle of their box.
      expect(Math.abs(cx - 256) < 32 && Math.abs(cy - 256) < 32, id).toBe(true);
      // At least a fair part of the box, and no farther than its corners.
      expect(r > 150 && r <= 363, id).toBe(true);
    }
  });

  it("loads them on demand", async () => {
    expect(await loadNpcs()).toBe(NPC_ICONS);
  });
});

describe("when the icons can't be loaded", () => {
  /**
   * A fresh place.ts (it keeps the icons once loaded), with icons.ts failing to load the first
   * `failures` times, as it does on a dropped connection or after a deploy replaced the file.
   */
  async function freshPlace(failures: number) {
    vi.resetModules();
    vi.doMock("../src/client/npcs/icons", async (original) => {
      if (failures-- > 0) throw new Error("Failed to fetch dynamically imported module");
      return original();
    });
    return import("../src/client/npcs/place");
  }
  afterEach(() => {
    vi.doUnmock("../src/client/npcs/icons");
    vi.resetModules();
  });

  it("fails that time and loads them the next, so Try again can work", async () => {
    const { loadNpcs } = await freshPlace(1);
    await expect(loadNpcs()).rejects.toThrow();
    expect(Object.keys(await loadNpcs())).toEqual(Object.keys(NPC_ICONS));
  });

  it("says so in plain words when an NPC is dropped meanwhile, places nothing, and works once they load", async () => {
    const { placeNpc } = await freshPlace(1);
    const room = client();
    const uploads = fakeUpload(room);
    expect(await placeNpc(room, "dwerv", "fighter", { x: 100, y: 100 }, false)).toBeNull();
    expect(room.state.toasts.map((t) => [t.kind, t.text])).toEqual([["error", NPCS_LOAD_FAILED]]);
    expect(NPCS_LOAD_FAILED).toBe("Couldn't load the NPCs. Check the connection, then try again.");
    expect(uploads).toEqual([]);
    expect(Object.keys(room.state.items)).toEqual([]);
    const t = await placeNpc(room, "dwerv", "fighter", { x: 100, y: 100 }, false);
    expect(t?.label).toBe("Dwerv Fighter");
    expect(uploads).toEqual(["NPC: Dwerv Fighter.webp"]);
  });
});

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (h: string) => {
  const [r, g, b] = hex(h).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("the token art", () => {
  it("has the approved proportions (on a 200 box: disc r 94, ring r 88 width 10, badge r 30 at 156,152)", () => {
    const r = 100;
    expect(ART.ringOuter * r).toBeCloseTo(93, 6);
    expect(ART.ringInner * r).toBeCloseTo(83, 6);
    expect(ART.rim * r).toBeCloseTo(96.5, 6);
    expect([ART.badgeX * r, ART.badgeY * r]).toEqual([156, 152]);
    expect(ART.badgeRim * r).toBeCloseTo(31.5, 6);
    expect(ART.badge * r).toBeCloseTo(28.5, 6);
    // The head's box scaled 0.21 at 46,40, and the emblem's 0.074 at 137,133.
    expect(ART.headBox * r).toBeCloseTo(512 * 0.21, 0);
    expect(ART.headY * r).toBeCloseTo(40 + 256 * 0.21, 0);
    expect(ART.emblemBox * r).toBeCloseTo(512 * 0.074, 0);
    expect([137 + 256 * 0.074, 133 + 256 * 0.074].map(Math.round)).toEqual([156, 152]);
  });

  it("puts each head's middle above the middle, inside the disc, and each emblem's in its badge", () => {
    const r = ART_PX / 2;
    for (const race of NPC_RACES) {
      const fit = NPC_ICONS[race.icon].fit;
      const at = iconPlacement(fit, ART.headBox * r, r, ART.headY * r);
      expect(at.x + fit[0] * at.scale).toBeCloseTo(r, 6);
      expect(at.y + fit[1] * at.scale).toBeCloseTo(ART.headY * r, 6);
      // Its farthest point stays inside the disc, short of the ring.
      expect(Math.hypot(0, (1 - ART.headY) * r) + fit[2] * at.scale, race.id).toBeLessThan(ART.ringInner * r);
    }
    for (const cls of NPC_CLASSES) {
      const fit = NPC_ICONS[cls.icon].fit;
      const at = iconPlacement(fit, ART.emblemBox * r, ART.badgeX * r, ART.badgeY * r);
      expect(at.x + fit[0] * at.scale).toBeCloseTo(ART.badgeX * r, 6);
      expect(at.y + fit[1] * at.scale).toBeCloseTo(ART.badgeY * r, 6);
      expect(fit[2] * at.scale, cls.id).toBeLessThan(ART.badge * r);
      expect(fit[2] * at.scale, cls.id).toBeGreaterThan(0.6 * ART.badge * r);
    }
    // The badge crosses the ring (its middle inside it, its edge past it), and stays inside the (square) picture, as does the rim.
    const badgeAt = Math.hypot(ART.badgeX - 1, ART.badgeY - 1);
    expect(badgeAt).toBeLessThan(ART.ringInner);
    expect(badgeAt + ART.badge).toBeGreaterThan(ART.ringOuter);
    expect(ART.badgeX + ART.badgeRim).toBeLessThanOrEqual(2);
    expect(ART.badgeY + ART.badgeRim).toBeLessThanOrEqual(2);
    expect(ART.rim).toBeLessThanOrEqual(1);
  });

  it("keeps each head and emblem within 3 px (on the 200 box) of the approved preview, which centred the box instead of the drawing", () => {
    const off = (fit: readonly number[], box: number) => Math.hypot(fit[0] - 256, fit[1] - 256) * (box / 512);
    for (const race of NPC_RACES) expect(off(NPC_ICONS[race.icon].fit, ART.headBox * 100), race.id).toBeLessThan(3);
    for (const cls of NPC_CLASSES) expect(off(NPC_ICONS[cls.icon].fit, ART.emblemBox * 100), cls.id).toBeLessThan(1.6);
  });

  it("gives the list's preview as many pixels as the screen has for it, so it isn't stretched on a dense screen", () => {
    expect(previewPx(96, 1)).toBe(96);
    expect(previewPx(96, 2)).toBe(192);
    expect(previewPx(96, 3)).toBe(288);
    expect(previewPx(96, 2.625)).toBe(252);
    // A browser that doesn't say.
    expect(previewPx(96, 0)).toBe(96);
    expect(previewPx(96, NaN)).toBe(96);
  });

  it("makes every ring, head and emblem stand out from what it's on (the handbook's colours, so the darkest only just)", () => {
    for (const c of NPC_CLASSES) {
      expect(contrast(c.color, ART.discColor), c.id).toBeGreaterThan(2);
      expect(contrast(ART.emblemColor, c.color), c.id).toBeGreaterThan(2);
    }
    for (const r of NPC_RACES) expect(contrast(r.tint, ART.discColor), r.id).toBeGreaterThan(5);
  });

  /** A stand-in canvas: keeps what's filled, in order, and whether each icon was clipped. */
  function fakeContext() {
    const fills: unknown[] = [];
    const paths: string[] = [];
    const clipped: boolean[] = [];
    let clip = false;
    vi.stubGlobal(
      "Path2D",
      class {
        constructor(d: string) {
          paths.push(d);
        }
      },
    );
    const ctx = {
      fillStyle: "" as unknown,
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      closePath: vi.fn(),
      fill(p?: unknown) {
        fills.push(ctx.fillStyle);
        if (p) clipped.push(clip);
      },
      save: vi.fn(),
      restore() {
        clip = false;
      },
      clip() {
        clip = true;
      },
      translate: vi.fn(),
      scale: vi.fn(),
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, raw: ctx, fills, paths, clipped };
  }

  it("draws the rim, the class's ring, the disc, the tinted head clipped to the disc, then the badge and its dark emblem", () => {
    const { ctx, raw, fills, paths, clipped } = fakeContext();
    drawNpcArt(ctx, octran, crusader, NPC_ICONS, 768);
    expect(fills).toEqual([ART.rimColor, crusader.color, ART.discColor, octran.tint, ART.rimColor, crusader.color, ART.emblemColor]);
    expect(paths).toEqual([NPC_ICONS[octran.icon].path, NPC_ICONS[crusader.icon].path]);
    expect(clipped).toEqual([true, true]);
    // Round, filling the picture, with the badge at the bottom right.
    expect(raw.arc.mock.calls.map((c) => c.slice(0, 3))).toEqual([
      [384, 384, ART.rim * 384],
      [384, 384, ART.ringOuter * 384],
      [384, 384, ART.ringInner * 384],
      [ART.badgeX * 384, ART.badgeY * 384, ART.badgeRim * 384],
      [ART.badgeX * 384, ART.badgeY * 384, ART.badge * 384],
    ]);
    expect(raw.clearRect).toHaveBeenCalledWith(0, 0, 768, 768);
  });

  it("draws the same, small, for a preview, and ART_PX across by default", () => {
    const { ctx, raw, fills } = fakeContext();
    drawNpcArt(ctx, findRace("goblin")!, findClass("shaman")!, NPC_ICONS, 64);
    expect(fills).toHaveLength(7);
    expect(raw.arc.mock.calls[0].slice(0, 3)).toEqual([32, 32, ART.rim * 32]);
    expect(raw.clearRect).toHaveBeenCalledWith(0, 0, 64, 64);
    const whole = fakeContext();
    drawNpcArt(whole.ctx, octran, crusader, NPC_ICONS);
    expect(whole.raw.clearRect).toHaveBeenCalledWith(0, 0, ART_PX, ART_PX);
  });

  it("says which token it couldn't draw when an icon is missing", () => {
    const { ctx } = fakeContext();
    expect(() => drawNpcArt(ctx, octran, crusader, {}, 64)).toThrow("NPC: Octran Crusader: no icon");
  });
});

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: "a1",
  name: "NPC: Octran Crusader",
  kind: "token",
  width: ART_PX,
  height: ART_PX,
  mime: "image/webp",
  bytes: 40000,
  owner: GM_OWNER,
  createdAt: 10,
  ...over,
});

describe("finding an NPC's picture again", () => {
  it("finds its token picture by name and size", () => {
    const assets = { a1: asset(), a2: asset({ id: "a2", name: "NPC: Goblin Shaman" }) };
    expect(findNpcAsset(assets, octran, crusader)?.id).toBe("a1");
    expect(findNpcAsset(assets, findRace("goblin")!, findClass("shaman")!)?.id).toBe("a2");
    expect(findNpcAsset(assets, findRace("goblin")!, crusader)).toBeUndefined();
  });

  it("doesn't take another picture, a renamed one, a monster's or a map for it", () => {
    const assets = {
      upload: asset({ id: "upload", width: 512, height: 512 }),
      renamed: asset({ id: "renamed", name: "Octran Crusader boss" }),
      map: asset({ id: "map", kind: "map" }),
      plain: asset({ id: "plain", name: "Octran Crusader" }),
      monster: asset({ id: "monster", name: "Monster: Octran Crusader" }),
    };
    expect(findNpcAsset(assets, octran, crusader)).toBeUndefined();
  });

  it("takes the oldest when there are two (two tabs made one at once)", () => {
    const assets = { b: asset({ id: "b", createdAt: 20 }), a: asset({ id: "a", createdAt: 10 }) };
    expect(findNpcAsset(assets, octran, crusader)?.id).toBe("a");
  });
});

describe("numbering NPCs", () => {
  it("uses the name alone when the scene has none of it", () => {
    expect(npcLabel("Octran Crusader", [])).toBe("Octran Crusader");
    expect(npcLabel("Octran Crusader", ["Octran Mage", "Octran Crusader King", "Crusader"])).toBe("Octran Crusader");
  });

  it("numbers it like a duplicate when there is one", () => {
    expect(npcLabel("Octran Crusader", ["Octran Crusader"])).toBe("Octran Crusader 2");
    expect(npcLabel("Octran Crusader", ["Octran Crusader", "Octran Crusader 2"])).toBe("Octran Crusader 3");
    expect(npcLabel("Octran Crusader", ["Octran Crusader", "Octran Crusader 7", "Octran Crusader 3"])).toBe("Octran Crusader 8");
    // The first one was renamed or deleted: still one more than the highest.
    expect(npcLabel("Octran Crusader", ["Octran Crusader 2"])).toBe("Octran Crusader 3");
  });

  it("isn't thrown by names with symbols in them", () => {
    expect(npcLabel("Half-elf Monk (x)", ["Half-elf Monk (x)"])).toBe("Half-elf Monk (x) 2");
    expect(npcLabel("Half-elf Monk (x)", ["Half-elf Monk x"])).toBe("Half-elf Monk (x)");
  });
});

function client(me: Player = { connId: "c1", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm" }) {
  const room = new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });
  const scene: Scene = {
    id: "scene1",
    name: "Crypt",
    order: 0,
    mapAssetId: null,
    width: 1400,
    height: 1000,
    background: "#000000",
    grid: { ...DEFAULT_GRID },
    fogCover: true,
    createdAt: 0,
  };
  room.store.set({
    me,
    room: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS, playersCanAddTokens: true } },
    scenes: { scene1: scene },
    viewSceneId: "scene1",
    activeSceneId: "scene1",
    items: {},
    assets: { a1: asset(), a2: asset({ id: "a2", name: "NPC: Goblin Shaman" }) },
  });
  return room;
}

/** A stand-in upload: keeps the names it's sent and adds each as an NPC's token picture. */
function fakeUpload(room: RoomClient): string[] {
  const names: string[] = [];
  room.upload = async (files: File[]) => {
    names.push(files[0].name);
    await new Promise((r) => setTimeout(r, 5));
    const a = asset({ id: `up${names.length}`, name: files[0].name.replace(/\.webp$/, ""), createdAt: 100 + names.length });
    room.store.set((s) => ({ assets: { ...s.assets, [a.id]: a } }));
    return [a];
  };
  return names;
}

describe("placing an NPC", () => {
  it("puts its picture on the map, one square, named by race and class, coloured by class, selected", async () => {
    const room = client();
    const t = (await placeNpc(room, "octran", "crusader", undefined, false))!;
    expect(t).toMatchObject({ assetId: "a1", label: "Octran Crusader", size: 1, color: crusader.color, hidden: false });
    expect(room.state.items[t.id]).toEqual(t);
    expect(room.state.selection).toEqual([t.id]);
    // What it sends passes the server's checks unchanged.
    expect(sanitizeItem(t, GM_OWNER)).toEqual(t);
    const g = (await placeNpc(room, "goblin", "shaman", { x: 300, y: 300 }, false))!;
    // One square (Small is one too): its middle is in the middle of the square it was dropped on.
    expect(g).toMatchObject({ assetId: "a2", label: "Goblin Shaman", size: 1, color: findClass("shaman")!.color });
    expect([g.x, g.y]).toEqual([315, 315]);
  });

  it("numbers the next one of the same race and class, and not one on another scene", async () => {
    const room = client();
    const other: TokenItem = {
      id: "other",
      sceneId: "scene2",
      kind: "token",
      z: 0,
      owner: GM_OWNER,
      x: 35,
      y: 35,
      size: 1,
      rotation: 0,
      assetId: "a1",
      color: crusader.color,
      label: "Octran Crusader 9",
      hidden: false,
      locked: false,
      rings: [],
    };
    room.store.set({ items: { other } });
    const a = (await placeNpc(room, "octran", "crusader", undefined, false))!;
    const b = (await placeNpc(room, "octran", "crusader", undefined, false))!;
    const c = (await placeNpc(room, "octran", "crusader", undefined, false))!;
    expect([a.label, b.label, c.label]).toEqual(["Octran Crusader", "Octran Crusader 2", "Octran Crusader 3"]);
    // Each on a square of its own.
    expect(new Set([a, b, c].map((t) => `${t.x},${t.y}`)).size).toBe(3);
  });

  it("adds it hidden from players when asked", async () => {
    const room = client();
    const t = (await placeNpc(room, "octran", "crusader", undefined, true))!;
    expect(t.hidden).toBe(true);
    expect(sanitizeItem(t, GM_OWNER)).toEqual(t);
  });

  it("follows the Monsters list's Add hidden when not told", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    saveAddHidden(true);
    expect(store.get("tabletop-monsters-hidden")).toBe("1");
    expect((await placeNpc(client(), "octran", "crusader"))!.hidden).toBe(true);
    saveAddHidden(false);
    expect((await placeNpc(client(), "octran", "crusader"))!.hidden).toBe(false);
  });

  it("is one undo step", async () => {
    const room = client();
    const t = (await placeNpc(room, "octran", "crusader", undefined, false))!;
    room.undo();
    expect(room.state.items[t.id]).toBeUndefined();
  });

  it("uploads a pair's picture once, the first time, however quickly it's clicked", async () => {
    const room = client();
    const uploads = fakeUpload(room);
    const [a, b] = await Promise.all([
      placeNpc(room, "urk", "death-knight", undefined, false),
      placeNpc(room, "urk", "death-knight", undefined, false),
    ]);
    const c = await placeNpc(room, "urk", "death-knight", undefined, false);
    expect(uploads).toEqual(["NPC: Urk Death Knight.webp"]);
    expect([a!.label, b!.label, c!.label]).toEqual(["Urk Death Knight", "Urk Death Knight 2", "Urk Death Knight 3"]);
    expect(new Set([a!.assetId, b!.assetId, c!.assetId]).size).toBe(1);
    // Another class of the same race is another picture.
    await placeNpc(room, "urk", "fighter", undefined, false);
    expect(uploads).toEqual(["NPC: Urk Death Knight.webp", "NPC: Urk Fighter.webp"]);
  });

  it("places nothing if the GM moves to another scene while its picture uploads, then places it at once", async () => {
    const room = client();
    const uploads = fakeUpload(room);
    room.store.set((s) => ({ scenes: { ...s.scenes, scene2: { ...s.scenes.scene1, id: "scene2", name: "Tomb" } } }));
    const dropped = placeNpc(room, "dwerv", "fighter", { x: 100, y: 100 }, false);
    room.store.set({ viewSceneId: "scene2" });
    expect(await dropped).toBeNull();
    expect(Object.keys(room.state.items)).toEqual([]);
    expect(room.state.toasts.map((t) => t.text)).toContain("Dwerv Fighter is ready. You moved to another scene, so place it again here.");
    const t = (await placeNpc(room, "dwerv", "fighter", { x: 100, y: 100 }, false))!;
    expect(t.sceneId).toBe("scene2");
    expect(uploads).toHaveLength(1);
  });

  it("says why when the picture can't be made, and places nothing", async () => {
    const room = client();
    room.upload = async () => {
      throw new Error("The room is full.");
    };
    expect(await placeNpc(room, "dwerv", "fighter", undefined, false)).toBeNull();
    expect(room.state.toasts.map((t) => t.text)).toContain("Dwerv Fighter: The room is full.");
    expect(Object.keys(room.state.items)).toEqual([]);
  });

  it("is the GM's alone, and needs a race and a class that exist", async () => {
    const player = client({ connId: "c2", userId: "alice", name: "Alice", color: "#00ff00", role: "player" });
    expect(await placeNpc(player, "octran", "crusader")).toBeNull();
    expect(await placeNpc(client(), "nothing", "crusader")).toBeNull();
    expect(await placeNpc(client(), "octran", "nothing")).toBeNull();
    expect(await placeNpc(client(), "crusader", "octran")).toBeNull();
  });
});

describe("dragging an NPC onto the map", () => {
  it("carries the race, the class and the Add hidden the list showed", () => {
    expect(readNpcDrag(npcDragData("octran", "crusader", true))).toEqual({ raceId: "octran", classId: "crusader", hidden: true });
    expect(readNpcDrag(npcDragData("goblin", "shaman", false))).toEqual({ raceId: "goblin", classId: "shaman", hidden: false });
  });

  it("ignores anything else, a creature's drag included", () => {
    for (const junk of [undefined, "", "octran", "null", "{}", '{"raceId":""}', '{"raceId":"octran"}', '{"raceId":3,"classId":"mage"}', "[1]"]) {
      expect(readNpcDrag(junk), String(junk)).toBeNull();
    }
    expect(readNpcDrag('{"id":"goblin","hidden":true}')).toBeNull();
    expect(readNpcDrag('{"raceId":"urk","classId":"mage","hidden":"yes"}')).toEqual({ raceId: "urk", classId: "mage", hidden: false });
  });

  it("places it hidden or not as the drag says, whatever this device has stored since", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "0", setItem: () => undefined });
    const room = client();
    const drag = readNpcDrag(npcDragData("octran", "crusader", true))!;
    const t = (await placeNpc(room, drag.raceId, drag.classId, { x: 300, y: 300 }, drag.hidden))!;
    expect(t.hidden).toBe(true);
  });
});

describe("the guide", () => {
  const parts = GUIDE.flatMap((s) => s.parts);
  const text = (title: string) => {
    const p = parts.find((x) => x.title === title);
    if (!p) throw new Error(`no guide part "${title}"`);
    return [...p.steps, ...p.notes].join("\n");
  };

  it("has the NPCs second in What's new, after the exact seasons, dated 4 October, and points to the how-to", () => {
    const news = GUIDE.find((s) => s.id === "whats-new")!;
    expect(news.parts[0].title).toBe("Exact seasons from Dungeondraft files (4 October 2026, latest)");
    expect(news.parts[1].title).toBe("NPC tokens by race and class (4 October 2026, later)");
    expect(news.intro).toContain("The latest update came out on 4 October 2026.");
    const entry = text(news.parts[1].title);
    expect(entry).toContain("**NPCs** tab");
    expect(entry).toContain("campaign handbook");
    expect(entry).toContain("See **NPC tokens by race and class**.");
  });

  it("explains them right after the monsters, in the same section, and mentions the tab where the Tokens tab is explained", () => {
    const section = GUIDE.find((s) => s.id === "monsters")!;
    const titles = section.parts.map((p) => p.title);
    expect(titles.indexOf("NPC tokens by race and class")).toBe(titles.indexOf("Place a monster") + 1);
    const tokens = GUIDE.find((s) => s.id === "tokens")!;
    expect(tokens.parts.some((p) => p.notes.some((n) => n.includes("**NPCs** tab")))).toBe(true);
  });

  it("names every race and class, each race's size, the shared Add hidden and the picture's name", () => {
    const how = text("NPC tokens by race and class");
    for (const x of [...NPC_RACES, ...NPC_CLASSES]) expect(how).toContain(x.name);
    for (const g of [...RACE_GROUPS, ...CLASS_GROUPS]) expect(how).toContain(g);
    expect(how).toContain("campaign handbook");
    // The Small races, by name, and the one-square rule.
    expect(how).toContain("Gnome, Goblin and Kobold are Small, every other race Medium");
    expect(how).toContain(npcDescription(octran, crusader));
    expect(how).toContain("**Add hidden** is the same setting as on the **Monsters** tab");
    expect(how).toContain(`"${npcAssetName(octran, crusader).slice(0, 5)}"`);
    expect(how).toContain("**Size in squares**");
  });

  it("says where a placed NPC lands, that it's selected, that the panel closes on a phone and that it's one undo step, as the monsters' does", () => {
    const how = text("NPC tokens by race and class");
    const monsters = text("Place a monster");
    for (const what of [
      "lands on the nearest free square to the middle of your view",
      "lands where you let go",
      "with **Move & select** switched on",
      "(on a phone the panel closes to show it)",
      "one step for **Undo** (Ctrl+Z)",
    ]) {
      expect(how).toContain(what);
      expect(monsters).toContain(what);
    }
    // The picture places too, like a monster's.
    expect(how).toContain("Click **Place** (or the picture)");
  });

  it("says where the class colour shows (the initiative entry), not on the name or the selection ring, which the board draws the same for every token", () => {
    const how = text("NPC tokens by race and class");
    expect(how).toContain("The token's own colour (the one its initiative entry gets) is the class's too.");
    expect(how).not.toContain("ring when selected");
    expect(how).not.toContain("its name and its ring");
  });

  it("credits the icons, with links, and says the names are the group's own", () => {
    const credit = text("Where the pictures come from");
    for (const who of ["Delapouite", "Lorc", "Cathelineau", "Caro Asercion"]) expect(credit).toContain(who);
    expect(credit).toContain("NPC icons by Delapouite, Lorc, Cathelineau and Caro Asercion");
    // CC BY asks for changes to be said.
    expect(credit).toContain("(recoloured and set on token discs)");
    expect(credit).toContain("(https://game-icons.net)");
    expect(credit).toContain("CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)");
    expect(credit).toContain("campaign handbook");
    expect(credit).toContain("bottom of the **NPCs** tab");
  });
});
