// The GM's Monsters list: D&D sizes on the token bar, the creatures' data (generated from the
// game-icons.net SVGs), their type colours and token art, finding a creature's uploaded picture
// again, numbering, searching, and placing one (sized, named, hidden when asked).
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomClient } from "../src/client/room/client";
import { DND_SIZE_NAMES, DND_SQUARES, TOKEN_SIZES, dndSizeName, sizeOptionLabel } from "../src/client/room/tokenSizes";
import type { DndSize } from "../src/client/room/tokenSizes";
import {
  ART_PX,
  CREATURE_TYPES,
  SIZE_LETTERS,
  TYPE_COLORS,
  TYPE_NAMES,
  filterMonsters,
  findMonsterAsset,
  monsterAssetName,
  monsterLabel,
  monsterSquares,
} from "../src/client/monsters/monsters";
import { ART, drawMonsterArt, iconPlacement } from "../src/client/monsters/art";
import { MONSTER_ICONS } from "../src/client/monsters/icons";
import {
  loadAddHidden,
  loadMonsters,
  monsterDragData,
  placeMonster,
  readMonsterDrag,
  saveAddHidden,
} from "../src/client/monsters/place";
import { GUIDE } from "../src/client/guide";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER, sanitizeItem } from "../src/shared/sanitize";
import type { Asset, Player, Scene, TokenItem } from "../src/shared/types";

// The browser draws a creature's picture (art.ts, tested below with a stand-in canvas); here
// placing gets a stand-in file instead, for a stand-in upload.
vi.mock("../src/client/monsters/art", async (original) => ({
  ...(await original<typeof import("../src/client/monsters/art")>()),
  monsterArtFile: async (m: { name: string }) => ({ name: `Monster: ${m.name}.webp` }) as File,
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("token sizes and D&D sizes", () => {
  it("gives each D&D size its squares", () => {
    expect(DND_SQUARES).toEqual({ tiny: 0.5, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 });
    // Every D&D size is one the token bar offers.
    for (const s of Object.values(DND_SQUARES)) expect(TOKEN_SIZES).toContain(s);
  });

  it("names the D&D sizes each size in the list stands for", () => {
    expect(TOKEN_SIZES.map((s) => dndSizeName(s))).toEqual(["Tiny", "Small/Medium", "Large", "Huge", "Gargantuan", ""]);
    expect(dndSizeName(1.5)).toBe("");
  });

  it("labels the token bar's sizes with them", () => {
    expect(TOKEN_SIZES.map((s) => sizeOptionLabel(s))).toEqual([
      "½×½ (Tiny)",
      "1×1 (Small/Medium)",
      "2×2 (Large)",
      "3×3 (Huge)",
      "4×4 (Gargantuan)",
      "6×6",
    ]);
    // A size set some other way (the wheel, an import), and a compass's list, without names.
    expect(sizeOptionLabel(1.25)).toBe("1.25×1.25");
    expect(sizeOptionLabel(2, false)).toBe("2×2");
  });
});

async function readSource(path: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("the creatures (generated data)", () => {
  it("has all 55, in the list's order, with its names, sizes, types and sources", async () => {
    const rows = (await readSource("../scripts/monster-icons/list.tsv"))
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => l.split("\t"));
    expect(rows).toHaveLength(55);
    expect(MONSTER_ICONS).toHaveLength(55);
    expect(MONSTER_ICONS.map((m) => [m.id, m.name, m.source, m.size, m.type])).toEqual(rows);
  });

  it("is up to date with the SVGs (run node scripts/monster-icons.mjs after changing them)", async () => {
    for (const m of MONSTER_ICONS) {
      const svg = await readSource(`../scripts/monster-icons/svg/${m.id}.svg`);
      expect(/\sd="([^"]+)"/.exec(svg)?.[1], m.id).toBe(m.path);
    }
  });

  it("has unique ids and names, and known sizes and types", () => {
    expect(new Set(MONSTER_ICONS.map((m) => m.id)).size).toBe(55);
    expect(new Set(MONSTER_ICONS.map((m) => m.name.toLowerCase())).size).toBe(55);
    for (const m of MONSTER_ICONS) {
      expect(Object.keys(DND_SQUARES)).toContain(m.size);
      expect(CREATURE_TYPES).toContain(m.type);
      expect(m.name.length).toBeGreaterThan(0);
      // Its uploaded picture's name fits an asset name.
      expect(monsterAssetName(m).length).toBeLessThanOrEqual(60);
    }
  });

  it("has a path for each, on the 512 box, and where its drawing sits", () => {
    for (const m of MONSTER_ICONS) {
      expect(m.path.length, m.id).toBeGreaterThan(100);
      expect(m.path, m.id).toMatch(/^[Mm][-0-9.,\s MmLlHhVvCcSsQqTtAaZz]+$/);
      const [cx, cy, r] = m.fit;
      expect(cx > 0 && cx < 512 && cy > 0 && cy < 512, m.id).toBe(true);
      // At least a fair part of the box, and no farther than its corners.
      expect(r > 150 && r <= 363, m.id).toBe(true);
    }
  });

  it("uses every type, and has creatures of every size", () => {
    expect(new Set(MONSTER_ICONS.map((m) => m.type))).toEqual(new Set(CREATURE_TYPES));
    expect(new Set(MONSTER_ICONS.map((m) => m.size))).toEqual(new Set(Object.keys(DND_SQUARES)));
  });

  it("loads them on demand", async () => {
    expect(await loadMonsters()).toBe(MONSTER_ICONS);
  });

  it("sizes each by its D&D size", () => {
    const by = (id: string) => monsterSquares(MONSTER_ICONS.find((m) => m.id === id)!);
    expect([by("imp"), by("goblin"), by("orc"), by("ogre"), by("giant"), by("kraken")]).toEqual([0.5, 1, 1, 2, 3, 4]);
    expect(Object.keys(SIZE_LETTERS).map((s) => `${SIZE_LETTERS[s as DndSize]}${DND_SIZE_NAMES[s as DndSize].slice(1)}`)).toEqual(
      Object.values(DND_SIZE_NAMES),
    );
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
/** CIE L*a*b*, to measure how different two colours look. */
const lab = (h: string) => {
  const [r, g, b] = hex(h).map(lin);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
};

describe("type colours", () => {
  it("has a colour and a name for every type", () => {
    expect(Object.keys(TYPE_COLORS).sort()).toEqual([...CREATURE_TYPES].sort());
    expect(Object.keys(TYPE_NAMES).sort()).toEqual([...CREATURE_TYPES].sort());
    for (const c of Object.values(TYPE_COLORS)) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("gives each type a colour clearly different from every other", () => {
    for (const a of CREATURE_TYPES) {
      for (const b of CREATURE_TYPES) {
        if (a >= b) continue;
        const [p, q] = [lab(TYPE_COLORS[a]), lab(TYPE_COLORS[b])];
        expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), `${a} and ${b}`).toBeGreaterThan(30);
      }
    }
  });

  it("keeps them apart for red-green colour-blind eyes too", () => {
    // Machado, Oliveira and Fernandes (2009), full strength, on linear RGB.
    const views: Record<string, number[][]> = {
      deuteranopia: [
        [0.367322, 0.860646, -0.227968],
        [0.280085, 0.672501, 0.047413],
        [-0.01182, 0.04294, 0.968881],
      ],
      protanopia: [
        [0.152286, 1.052583, -0.204868],
        [0.114503, 0.786281, 0.099216],
        [-0.003882, -0.048116, 1.051998],
      ],
    };
    const seen = (h: string, m: number[][]) => {
      const l = hex(h).map(lin);
      const out = m.map((row) => Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2])));
      const srgb = out.map((c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
      return `#${srgb.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;
    };
    for (const [view, m] of Object.entries(views)) {
      for (const a of CREATURE_TYPES) {
        for (const b of CREATURE_TYPES) {
          if (a >= b) continue;
          const [p, q] = [lab(seen(TYPE_COLORS[a], m)), lab(seen(TYPE_COLORS[b], m))];
          expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), `${a} and ${b} (${view})`).toBeGreaterThan(15);
        }
      }
    }
  });

  it("makes every ring and the icon stand out from the dark disc", () => {
    for (const t of CREATURE_TYPES) {
      expect(contrast(TYPE_COLORS[t], ART.discOuter), t).toBeGreaterThan(4.5);
      expect(contrast(TYPE_COLORS[t], ART.discInner), t).toBeGreaterThan(3.5);
    }
    expect(contrast(ART.iconColor, ART.discInner)).toBeGreaterThan(10);
  });
});

describe("the token art", () => {
  it("puts each icon's middle in the middle, inside the disc", () => {
    for (const m of MONSTER_ICONS) {
      const at = iconPlacement(m.fit, ART_PX);
      const r = ART_PX / 2;
      expect(at.x + m.fit[0] * at.scale).toBeCloseTo(r, 6);
      expect(at.y + m.fit[1] * at.scale).toBeCloseTo(r, 6);
      // Its farthest point stays inside the disc, short of the ring.
      expect(m.fit[2] * at.scale).toBeLessThan(ART.ringInner * r);
      expect(m.fit[2] * at.scale).toBeGreaterThan(0.85 * ART.ringInner * r);
    }
  });

  it("draws the rim, the type's ring, the disc, then the icon clipped to the disc", () => {
    const fills: unknown[] = [];
    const paths: string[] = [];
    let clipped = false;
    let iconClipped = false;
    vi.stubGlobal(
      "Path2D",
      class {
        constructor(d: string) {
          paths.push(d);
        }
      },
    );
    const gradient = { addColorStop: vi.fn() };
    const ctx = {
      fillStyle: "" as unknown,
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      closePath: vi.fn(),
      fill(p?: unknown) {
        fills.push(ctx.fillStyle);
        if (p) iconClipped = clipped;
      },
      createRadialGradient: vi.fn(() => gradient),
      save: vi.fn(),
      restore: vi.fn(),
      clip() {
        clipped = true;
      },
      translate: vi.fn(),
      scale: vi.fn(),
    };
    const ogre = MONSTER_ICONS.find((m) => m.id === "ogre")!;
    drawMonsterArt(ctx as unknown as CanvasRenderingContext2D, ogre, 768);
    expect(fills).toEqual([ART.rimColor, TYPE_COLORS.giant, gradient, ART.iconColor]);
    expect(paths).toEqual([ogre.path]);
    expect(iconClipped).toBe(true);
    // Round, and filling the picture.
    expect(ctx.arc.mock.calls.map((c) => c[2])).toEqual([ART.rim * 384, ART.ringOuter * 384, ART.ringInner * 384]);
  });
});

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: "a1",
  name: "Monster: Goblin",
  kind: "token",
  width: ART_PX,
  height: ART_PX,
  mime: "image/webp",
  bytes: 40000,
  owner: GM_OWNER,
  createdAt: 10,
  ...over,
});

describe("finding a creature's picture again", () => {
  it("finds its token picture by name and size", () => {
    const assets = { a1: asset(), a2: asset({ id: "a2", name: "Monster: Orc" }) };
    expect(findMonsterAsset(assets, { name: "Goblin" })?.id).toBe("a1");
    expect(findMonsterAsset(assets, { name: "Orc" })?.id).toBe("a2");
    expect(findMonsterAsset(assets, { name: "Ogre" })).toBeUndefined();
  });

  it("doesn't take another picture, a renamed one or a map for it", () => {
    const assets = {
      upload: asset({ id: "upload", width: 512, height: 512 }),
      renamed: asset({ id: "renamed", name: "Goblin boss" }),
      map: asset({ id: "map", kind: "map" }),
      plain: asset({ id: "plain", name: "Goblin" }),
    };
    expect(findMonsterAsset(assets, { name: "Goblin" })).toBeUndefined();
  });

  it("takes the oldest when there are two (two tabs made one at once)", () => {
    const assets = { b: asset({ id: "b", createdAt: 20 }), a: asset({ id: "a", createdAt: 10 }) };
    expect(findMonsterAsset(assets, { name: "Goblin" })?.id).toBe("a");
  });
});

describe("numbering creatures", () => {
  it("uses the name alone when the scene has none of it", () => {
    expect(monsterLabel("Goblin", [])).toBe("Goblin");
    expect(monsterLabel("Goblin", ["Orc", "Goblin King", "Hobgoblin"])).toBe("Goblin");
    expect(monsterLabel("Giant", ["Giant spider", "Giant rat 2"])).toBe("Giant");
  });

  it("numbers it like a duplicate when there is one", () => {
    expect(monsterLabel("Goblin", ["Goblin"])).toBe("Goblin 2");
    expect(monsterLabel("Goblin", ["Goblin", "Goblin 2"])).toBe("Goblin 3");
    expect(monsterLabel("Goblin", ["Goblin", "Goblin 7", "Goblin 3"])).toBe("Goblin 8");
    // The first one was renamed or deleted: still one more than the highest.
    expect(monsterLabel("Goblin", ["Goblin 2"])).toBe("Goblin 3");
  });

  it("isn't thrown by names with symbols in them", () => {
    expect(monsterLabel("Imp (x)", ["Imp (x)"])).toBe("Imp (x) 2");
    expect(monsterLabel("Imp (x)", ["Imp x"])).toBe("Imp (x)");
  });
});

describe("searching the list", () => {
  it("matches every word of the search in the name or type, in any case", () => {
    const names = (q: string, t: Parameters<typeof filterMonsters>[2] = "") => filterMonsters(MONSTER_ICONS, q, t).map((m) => m.name);
    expect(names("")).toHaveLength(55);
    expect(names("DRAGON")).toEqual(["Wyvern", "Young dragon", "Adult dragon", "Ancient dragon"]);
    expect(names("giant sp")).toEqual(["Giant spider"]);
    expect(names("zzz")).toEqual([]);
    expect(names("", "undead")).toEqual(["Skeleton", "Zombie", "Ghost", "Wraith", "Mummy", "Vampire", "Lich"]);
    expect(names("m", "undead")).toEqual(["Mummy"]);
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
    assets: { a1: asset(), a2: asset({ id: "a2", name: "Monster: Adult dragon" }) },
  });
  return room;
}

/** A stand-in upload: keeps the names it's sent and adds each as a creature's token picture. */
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

function token(id: string, sceneId: string, label: string): TokenItem {
  return {
    id,
    sceneId,
    kind: "token",
    z: 0,
    owner: GM_OWNER,
    x: 35,
    y: 35,
    size: 1,
    rotation: 0,
    assetId: null,
    color: "#ff0000",
    label,
    hidden: false,
    locked: false,
    rings: [],
  };
}

describe("placing a creature", () => {
  it("puts its picture on the map, sized by its D&D size, named and coloured by type, selected", async () => {
    const room = client();
    const t = (await placeMonster(room, "goblin", undefined, false))!;
    expect(t).toMatchObject({ assetId: "a1", label: "Goblin", size: 1, color: TYPE_COLORS.humanoid, hidden: false });
    expect(room.state.items[t.id]).toEqual(t);
    expect(room.state.selection).toEqual([t.id]);
    // What it sends passes the server's checks unchanged.
    expect(sanitizeItem(t, GM_OWNER)).toEqual(t);
    const d = (await placeMonster(room, "adult-dragon", { x: 300, y: 300 }, false))!;
    // Three squares (odd): its middle is in the middle of a square.
    expect(d).toMatchObject({ assetId: "a2", label: "Adult dragon", size: 3 });
    expect([d.x, d.y]).toEqual([315, 315]);
  });

  it("numbers the next one of the same creature, and not one on another scene", async () => {
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
      color: TYPE_COLORS.humanoid,
      label: "Goblin 9",
      hidden: false,
      locked: false,
      rings: [],
    };
    room.store.set({ items: { other } });
    const a = (await placeMonster(room, "goblin", undefined, false))!;
    const b = (await placeMonster(room, "goblin", undefined, false))!;
    const c = (await placeMonster(room, "goblin", undefined, false))!;
    expect([a.label, b.label, c.label]).toEqual(["Goblin", "Goblin 2", "Goblin 3"]);
    // Each on a square of its own.
    expect(new Set([a, b, c].map((t) => `${t.x},${t.y}`)).size).toBe(3);
  });

  it("adds it hidden from players when asked", async () => {
    const room = client();
    const t = (await placeMonster(room, "goblin", undefined, true))!;
    expect(t.hidden).toBe(true);
    expect(sanitizeItem(t, GM_OWNER)).toEqual(t);
  });

  it("is one undo step", async () => {
    const room = client();
    const t = (await placeMonster(room, "goblin", undefined, false))!;
    room.undo();
    expect(room.state.items[t.id]).toBeUndefined();
  });

  it("uploads a creature's picture once, the first time, however quickly it's clicked", async () => {
    const room = client();
    const uploads = fakeUpload(room);
    const [a, b] = await Promise.all([placeMonster(room, "orc", undefined, false), placeMonster(room, "orc", undefined, false)]);
    const c = await placeMonster(room, "orc", undefined, false);
    expect(uploads).toEqual(["Monster: Orc.webp"]);
    expect([a!.label, b!.label, c!.label]).toEqual(["Orc", "Orc 2", "Orc 3"]);
    expect(new Set([a!.assetId, b!.assetId, c!.assetId]).size).toBe(1);
  });

  it("places nothing if the GM moves to another scene while its picture uploads, then places it at once", async () => {
    const room = client();
    const uploads = fakeUpload(room);
    room.store.set((s) => ({ scenes: { ...s.scenes, scene2: { ...s.scenes.scene1, id: "scene2", name: "Tomb" } } }));
    const dropped = placeMonster(room, "orc", { x: 100, y: 100 }, false);
    room.store.set({ viewSceneId: "scene2" });
    expect(await dropped).toBeNull();
    expect(Object.keys(room.state.items)).toEqual([]);
    expect(room.state.toasts.map((t) => t.text)).toContain("Orc is ready. You moved to another scene, so place it again here.");
    const t = (await placeMonster(room, "orc", { x: 100, y: 100 }, false))!;
    expect(t.sceneId).toBe("scene2");
    expect(uploads).toHaveLength(1);
  });

  it("puts each one clicked in where it covers no other token, whatever their sizes", async () => {
    const room = client();
    const g = DEFAULT_GRID.size;
    fakeUpload(room);
    // A player's token on the square in the middle of the view.
    const pc = { ...token("pc", "scene1", "Aria"), x: 735, y: 525 };
    room.store.set({ items: { pc } });
    for (const id of ["ogre", "giant", "giant", "kraken", "imp", "goblin", "ogre"]) {
      expect(await placeMonster(room, id, undefined, false), id).not.toBeNull();
    }
    const all = Object.values(room.state.items) as TokenItem[];
    expect(all).toHaveLength(8);
    for (const a of all) {
      for (const b of all) {
        if (a.id >= b.id) continue;
        const gap = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
        expect(gap, `${a.label} and ${b.label}`).toBeGreaterThanOrEqual(((a.size + b.size) / 2) * g - 0.5);
      }
    }
    // A Large one goes right next to the player's token, not on it.
    const ogre = all.find((t) => t.label === "Ogre")!;
    expect(Math.max(Math.abs(ogre.x - pc.x), Math.abs(ogre.y - pc.y))).toBe(1.5 * g);
  });

  it("puts tokens side by side, not apart, on a hex grid", () => {
    const room = client();
    room.store.set((s) => ({ scenes: { scene1: { ...s.scenes.scene1, grid: { ...DEFAULT_GRID, type: "hex-pointy" } } } }));
    const a = room.addToken({ label: "A" })!;
    const b = room.addToken({ label: "B" })!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(DEFAULT_GRID.size, 6);
  });

  it("is the GM's alone, and needs a creature that exists", async () => {
    const player = client({ connId: "c2", userId: "alice", name: "Alice", color: "#00ff00", role: "player" });
    expect(await placeMonster(player, "goblin")).toBeNull();
    expect(await placeMonster(client(), "nothing")).toBeNull();
    // Nor can a player add a hidden token another way.
    expect(player.addToken({ label: "Sneaky", hidden: true })?.hidden).toBe(false);
  });
});

describe("dragging a creature onto the map", () => {
  it("carries the creature and the Add hidden the list showed", () => {
    expect(readMonsterDrag(monsterDragData("goblin", true))).toEqual({ id: "goblin", hidden: true });
    expect(readMonsterDrag(monsterDragData("ogre", false))).toEqual({ id: "ogre", hidden: false });
  });

  it("ignores anything else", () => {
    for (const junk of [undefined, "", "goblin", "null", "{}", '{"id":""}', '{"id":3}', "[1]"]) {
      expect(readMonsterDrag(junk), String(junk)).toBeNull();
    }
    expect(readMonsterDrag('{"id":"orc","hidden":"yes"}')).toEqual({ id: "orc", hidden: false });
  });

  it("places it hidden or not as the drag says, whatever this device has stored since", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "0", setItem: () => undefined });
    const room = client();
    const drag = readMonsterDrag(monsterDragData("goblin", true))!;
    const t = (await placeMonster(room, drag.id, { x: 300, y: 300 }, drag.hidden))!;
    expect(t.hidden).toBe(true);
  });
});

describe("Add hidden", () => {
  it("is remembered in the browser", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    expect(loadAddHidden()).toBe(false);
    saveAddHidden(true);
    expect(loadAddHidden()).toBe(true);
    expect(store.get("tabletop-monsters-hidden")).toBe("1");
    saveAddHidden(false);
    expect(loadAddHidden()).toBe(false);
  });

  it("lasts as long as the page where the browser won't store it", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    saveAddHidden(true);
    expect(loadAddHidden()).toBe(true);
    saveAddHidden(false);
    expect(loadAddHidden()).toBe(false);
  });
});

describe("the guide", () => {
  const parts = GUIDE.flatMap((s) => s.parts);
  const text = (title: string) => {
    const p = parts.find((x) => x.title === title);
    if (!p) throw new Error(`no guide part "${title}"`);
    return [...p.steps, ...p.notes].join("\n");
  };

  it("keeps the monsters in What's new, second to the NPCs, with the compass and loading entries", () => {
    const news = GUIDE.find((s) => s.id === "whats-new")!.parts.map((p) => p.title);
    expect(news[1]).toBe("Monsters ready to use (3 October 2026, later)");
    expect(news).toContain("A compass for any map (3 October 2026)");
    expect(news).toContain("Maps say when they're loading (3 October 2026)");
  });

  it("lists the token bar's sizes as the bar does", () => {
    const all = TOKEN_SIZES.map((s) => sizeOptionLabel(s));
    const bar = text("Change a token with the bar that appears");
    expect(bar).toContain(`${all.slice(0, -1).join(", ")} or ${all[all.length - 1]}`);
  });

  it("credits the icons, with links", () => {
    const credit = text("Where the pictures come from");
    for (const who of ["Lorc", "Delapouite", "Caro Asercion", "Cathelineau", "Skoll"]) expect(credit).toContain(who);
    // CC BY asks for changes to be said.
    expect(credit).toContain("(recoloured and set on token discs)");
    expect(credit).toContain("(https://game-icons.net)");
    expect(credit).toContain("(https://creativecommons.org/licenses/by/3.0/)");
  });

  it("names every size letter and type colour the list shows", () => {
    const sizes = text("Sizes");
    for (const s of Object.keys(SIZE_LETTERS) as DndSize[]) expect(sizes).toContain(`**${SIZE_LETTERS[s]}** ${DND_SIZE_NAMES[s]}`);
    const place = text("Place a monster");
    // (Plurals: "for monstrosities", "for fey".)
    for (const t of CREATURE_TYPES) expect(place.toLowerCase()).toContain(`for ${t.slice(0, 6)}`);
  });
});
