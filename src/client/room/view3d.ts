// The map in 3D (14 November 2026): the scene as this page sees it, tilted like a map on a table.
// The floor is the 2D map exactly as drawn here (the picture, built map, grid, drawings, and the dark
// and the fog over them, so a player sees no more than in 2D); walls and shut doors rise from it
// where this page has seen them; tokens stand up as cardboard figures on stands, and props lie flat.
// It only looks: everything is done on the 2D map, and the 3D view follows it live. Drag to swing
// round, pinch or wheel to zoom, two fingers or a right-drag to slide along. A table display follows
// where the GM points it. three.js (installed with the 3D dice) loads only when a device first
// shows the map in 3D; the arithmetic is in view3dModel.ts.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene as World,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SceneArea } from "../../shared/types";
import {
  FLYING_LIFT,
  FOV,
  GLASS_OPACITY,
  MAX_TILT,
  WALL_HEIGHT,
  START_TILT,
  WALL_SEEN,
  brightnessAt,
  cameraAt,
  cardSize,
  clampTo,
  flatSize,
  frameDistance,
  initialsOf,
  shadeOf,
  standeeLook,
  standeeShown,
  wallMesh,
  wallPieces,
  windowGlass,
  type Board3dSource,
  type Change3d,
  type CoverMap,
  type Standee,
  type View3dControls,
} from "./view3dModel";
import { objectMesh } from "./view3dObjects";
import { cliffMesh } from "./view3dCliffs";
import { rockMask, rockSides, rockTop } from "./view3dRock";
import { groundOf, heightAt, onGround, type Ground } from "./view3dGround";
import { edgeColour, groundMesh, rangeMesh, sceneryOf, skyMesh } from "./view3dScenery";
import { roofColour, roofMesh, roofShown, buildingLight } from "./view3dRoofs";
import { EFFECT_STEP_MS, effectScale, meanColour, sameSize, sameVolume, sheetLayers, skinMesh, type Effect3d } from "./view3dEffects";
import { weatherLook } from "./view3dWeather";
import { WeatherFx3d } from "./view3dWeatherFx";
import type { Weather } from "../../shared/calendar";

/** The floor picture's long side at most: on a touch screen (phones and tablets), and elsewhere. */
const FLOOR_PX_TOUCH = 2048;
const FLOOR_PX = 4096;
/** While things change, the floor is drawn again at most this often (ms). */
const FLOOR_EVERY_MS = 300;
/** Round the map. */
const BACKGROUND = "#14161a";
/** A token that jumps further than this (squares) is put there at once rather than slid. */
const JUMP = 8;
/** How long the camera takes to swing to where a table display is pointed (ms). */
const AIM_MS = 700;

/** A token standing (or lying) in the 3D view. */
interface Fig {
  group: Group;
  /** The card, turned to face the camera (standing figures; null for flat ones). */
  face: Group | null;
  /** Its materials, each with its own colour before shading. */
  tints: { material: MeshBasicMaterial | MeshLambertMaterial; color: Color }[];
  geometries: BufferGeometry[];
  look: string;
  /** Where it's going (it slides there). */
  to: Vector3;
  shade: number;
}

export interface View3dOptions {
  /** A table display: the camera swings to wherever the GM points the display (it can still be turned by hand). */
  follow: boolean;
  /** A touch screen (a phone or tablet): a smaller floor picture and fewer pixels, to stay quick. */
  touch: boolean;
  /** The device took WebGL back (too many pages using it, or the GPU reset): the page goes back to 2D. */
  onLost: () => void;
}

/**
 * A spell in the scene: its drawing on a canvas, laid once or in layers up through its height
 * (view3dEffects.ts sheetLayers), and the skin round it, in its drawing's colour, where it has one.
 */
interface Sheet {
  e: Effect3d;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: CanvasTexture;
  mats: MeshBasicMaterial[];
  geo: PlaneGeometry;
  meshes: Mesh[];
  k: number;
  skin: { mesh: Mesh; geo: BufferGeometry; mat: MeshBasicMaterial; rise: Float32Array; color: Float32Array } | null;
  /** Its drawing's colour, for its skin: found the first time it's drawn. */
  rgb: [number, number, number] | null;
}

export class View3D implements View3dControls {
  private renderer: WebGLRenderer;
  private world = new World();
  private camera = new PerspectiveCamera(FOV, 1, 0.1, 1000);
  private controls: OrbitControls;
  private floorMesh: Mesh | null = null;
  private floorTex: CanvasTexture | null = null;
  private floorKey = "";
  private walls: Mesh | null = null;
  /** The glass in the Build tool's windows: see-through, so drawn apart from the walls. */
  private glass: Mesh | null = null;
  /** The built map's objects standing up: trees, rocks, pillars, tables... (view3dObjects.ts). */
  private objects: Mesh | null = null;
  /** Their parts that glow by themselves (flames, magic), drawn unlit. */
  private glowing: Mesh | null = null;
  /** A Dungeondraft map's cliffs, standing up as rock (view3dCliffs.ts). */
  private cliffs: Mesh | null = null;
  /** A cave or dungeon map's black, standing up as rock (view3dRock.ts): its faces, and its top as a picture laid over it. */
  private rock: Mesh | null = null;
  private rockTop: { mesh: Mesh; tex: CanvasTexture; canvas: HTMLCanvasElement; geo: PlaneGeometry; mat: MeshLambertMaterial } | null = null;
  /**
   * The scenery round an outdoor map (view3dScenery.ts): sky, ground to the horizon and distant
   * ranges, made for the weather region and the day's weather, and what it was made from.
   */
  private scenery: { meshes: Mesh[]; key: string } | null = null;
  private sceneryFor: { region: string | null; weather: Weather | null } = { region: null, weather: null };
  /** The map's edge colour (the ground it runs on into) and whether it's a cave (no scenery), as the floor last had them. */
  private groundEdge: [number, number, number] | null = null;
  private cave = false;
  /** High and low ground (view3dGround.ts): where cliffs cut land off, it lies a cliff's height lower. */
  private ground: Ground | null = null;
  /** What the ground is, in brief: the floor and the scenery round it are made again when it changes. */
  private groundKey = "flat";
  /** The Build tool's walls in the scene's wall texture, and that texture (made from its picture). */
  private texturedWalls: Mesh | null = null;
  private wallTex: { canvas: HTMLCanvasElement; tex: CanvasTexture } | null = null;
  /**
   * The buildings' roofs (view3dRoofs.ts), by building: how far each is lifted off (0 on, 1 off)
   * and how far it's going, and how see-through it is at most (the GM's are half).
   */
  private roofs = new Map<string, { mesh: Mesh; mat: MeshLambertMaterial; lift: number; to: number; opacity: number }>();
  private roofAt = 0;
  /**
   * The spells on the map (view3dEffects.ts), each drawn on a canvas of its own laid in the scene
   * as one sheet or two, by its key.
   */
  private sheets = new Map<string, Sheet>();
  private sheetsAt = 0;
  private sheetsListedAt = 0;
  /** What covers the floor (the fog and the dark) as a picture, to take out of spells under it. */
  private coverCanvas: HTMLCanvasElement | null = null;
  private figs = new Map<string, Fig>();
  /** Token pictures as textures, by picture (an image's address, or a disc's colour and initials). */
  private pictures = new Map<string, { tex: Texture; w: number; h: number }>();
  /** The stands under figures: one disc, scaled to each. */
  private disc = new CylinderGeometry(1, 1, 0.06, 32);
  private sceneId: string | null = null;
  private area: SceneArea = { x0: 0, y0: 0, x1: 1, y1: 1 };
  private cell = 1;
  private cover: CoverMap | null = null;
  private raf = 0;
  private dirty = true;
  /** The camera is being dragged round (a finger or button is down). */
  private held = false;
  private floorTimer: ReturnType<typeof setTimeout> | null = null;
  private floorAt = -Infinity;
  private tokensQueued = false;
  private tween: { fromT: Vector3; toT: Vector3; fromP: Vector3; toP: Vector3; t0: number } | null = null;
  private stop: () => void;
  private observer: ResizeObserver;
  private disposed = false;
  /** The day's weather: rain, snow, mist and lightning (view3dWeatherFx.ts). */
  private weather: WeatherFx3d;
  private flashEl: HTMLDivElement;

  constructor(
    private el: HTMLElement,
    private src: Board3dSource,
    private opts: View3dOptions,
  ) {
    // Throws where there's no WebGL: the page says so and stays in 2D.
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.touch ? 1.5 : 2));
    this.renderer.setClearColor(BACKGROUND, 1);
    const canvas = this.renderer.domElement;
    canvas.className = "view3d-canvas";
    el.appendChild(canvas);
    canvas.addEventListener("webglcontextlost", this.onLost);
    this.flashEl = document.createElement("div");
    this.flashEl.className = "view3d-flash";
    el.appendChild(this.flashEl);
    this.weather = new WeatherFx3d(this.world, this.flashEl, (sky) => {
      this.renderer.setClearColor(sky ?? BACKGROUND, 1);
      this.redraw();
    });

    // The floor and figures are drawn as they are in 2D (unlit); the walls are lit, so their sides show.
    this.world.add(new HemisphereLight(0xffffff, 0x4a443c, 0.75));
    const sun = new DirectionalLight(0xffffff, 0.45);
    sun.position.set(-0.6, 1, 0.4);
    this.world.add(sun);

    const c = (this.controls = new OrbitControls(this.camera, canvas));
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.screenSpacePanning = false;
    c.maxPolarAngle = MAX_TILT;
    c.minDistance = 1.5;
    c.rotateSpeed = 0.8;
    c.addEventListener("start", this.onStart);
    c.addEventListener("end", this.onEnd);
    c.addEventListener("change", this.onChange);

    this.observer = new ResizeObserver(() => this.fitSize());
    this.observer.observe(el);
    this.fitSize();
    this.stop = src.subscribe((what) => this.changed(what));
    this.refreshFloor();
  }

  // ---------------------------------------------------------------- the page's buttons

  zoomBy(factor: number): void {
    this.tween = null;
    const t = this.controls.target;
    const off = this.camera.position.clone().sub(t);
    const len = clampTo(off.length() / factor, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(t).add(off.setLength(len));
    this.redraw();
  }

  fit(): void {
    const a = this.area;
    const w = (a.x1 - a.x0) / this.cell, h = (a.y1 - a.y0) / this.cell;
    this.aim((a.x0 + a.x1) / 2 / this.cell, (a.y0 + a.y1) / 2 / this.cell, w, h, false, false);
  }

  /** The day's weather on this map (null: none, or it doesn't fall here). */
  setWeather(w: Weather | null, region: string | null = null): void {
    this.sceneryFor = { region, weather: w };
    this.applyWeather();
    this.makeScenery();
    this.redraw();
  }

  dispose(): void {
    this.disposed = true;
    this.weather.dispose();
    this.flashEl.remove();
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.floorTimer) clearTimeout(this.floorTimer);
    this.stop();
    this.observer.disconnect();
    this.controls.removeEventListener("start", this.onStart);
    this.controls.removeEventListener("end", this.onEnd);
    this.controls.removeEventListener("change", this.onChange);
    this.controls.dispose();
    this.clearScene();
    for (const p of this.pictures.values()) p.tex.dispose();
    this.pictures.clear();
    this.disc.dispose();
    const canvas = this.renderer.domElement;
    // Giving WebGL back on purpose isn't losing it.
    canvas.removeEventListener("webglcontextlost", this.onLost);
    this.renderer.dispose();
    // iPads and phones allow few WebGL pages at once (the 3D dice use one too): this one's let go now.
    this.renderer.forceContextLoss();
    canvas.remove();
  }

  // ---------------------------------------------------------------- what the board says

  private changed(what: Change3d): void {
    if (this.disposed) return;
    if (what === "floor") this.floorSoon();
    else if (what === "tokens") {
      // Many at once while a token's dragged: once a frame is enough.
      if (!this.tokensQueued) {
        this.tokensQueued = true;
        this.wake();
      }
    } else if (what === "effects") {
      this.refreshSheets();
    } else if (what === "view" && this.opts.follow) {
      const v = this.src.view();
      if (v) this.aim(v.x / this.cell, v.y / this.cell, v.w / this.cell, v.h / this.cell, false, true);
    }
  }

  private floorSoon(): void {
    if (this.floorTimer) return;
    const wait = Math.max(0, this.floorAt + FLOOR_EVERY_MS - performance.now());
    this.floorTimer = setTimeout(() => {
      this.floorTimer = null;
      if (!this.disposed) this.refreshFloor();
    }, wait);
  }

  /** The floor drawn again, the walls raised again (what's been seen may have changed), and the tokens. */
  private refreshFloor(): void {
    this.floorAt = performance.now();
    const maxPx = Math.min(this.opts.touch ? FLOOR_PX_TOUCH : FLOOR_PX, this.renderer.capabilities.maxTextureSize || FLOOR_PX_TOUCH);
    const f = this.src.floor(maxPx);
    if (!f) {
      this.clearScene();
      this.redraw();
      return;
    }
    const newScene = f.scene.id !== this.sceneId;
    if (newScene) this.clearScene();
    this.sceneId = f.scene.id;
    this.cell = f.scene.grid.size > 0 ? f.scene.grid.size : 1;
    this.area = f.area;
    this.cover = f.cover;
    const a = f.area;
    const w = (a.x1 - a.x0) / this.cell, h = (a.y1 - a.y0) / this.cell;

    // High and low ground, from the cliffs.
    const cliffs = this.src.cliffs();
    const g = (this.ground = groundOf(cliffs, a, this.cell));
    let lowSum = 0;
    if (g) for (let p = 0; p < g.low.length; p += 7) lowSum = (lowSum * 31 + g.low[p] * p) | 0;

    // The floor: a new texture when its size changes (WebGL keeps a texture's size), else the same one
    // drawn again; bent to the ground where cliffs make high and low ground.
    this.groundKey = g ? `${g.w}x${g.h}:${g.drop}:${lowSum}` : "flat";
    const key = `${a.x0},${a.y0},${a.x1},${a.y1},${this.cell},${f.canvas.width}x${f.canvas.height},${this.groundKey}`;
    if (!this.floorMesh || !this.floorTex || key !== this.floorKey) {
      this.dropFloor();
      const tex = (this.floorTex = new CanvasTexture(f.canvas));
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      const geo = g ? new PlaneGeometry(w, h, Math.min(512, g.w), Math.min(512, g.h)) : new PlaneGeometry(w, h);
      geo.rotateX(-Math.PI / 2);
      if (g) {
        const pos = geo.getAttribute("position");
        const cx = (a.x0 + a.x1) / 2, cz = (a.y0 + a.y1) / 2;
        for (let i = 0; i < pos.count; i++) {
          pos.array[i * 3 + 1] = heightAt(g, cx + pos.array[i * 3] * this.cell, cz + pos.array[i * 3 + 2] * this.cell);
        }
        pos.needsUpdate = true;
      }
      this.floorMesh = new Mesh(geo, new MeshBasicMaterial({ map: tex }));
      this.floorMesh.position.set((a.x0 + a.x1) / 2 / this.cell, 0, (a.y0 + a.y1) / 2 / this.cell);
      this.world.add(this.floorMesh);
      this.floorKey = key;
    } else {
      this.floorTex.needsUpdate = true;
    }

    // The walls, in their own colours (the Build tool's in the scene's wall texture, when it has
    // one), the built map's objects, and the buildings' roofs: where this page has seen them.
    this.dropWalls();
    const all = this.src.gmView();
    const pieces = wallPieces(this.src.walls(), this.cell, f.cover, all, f.paint);
    const tile = this.wallTexture();
    const textured = tile ? pieces.filter((p) => p.built && !p.door) : [];
    const plain = tile ? pieces.filter((p) => !(p.built && !p.door)) : pieces;
    // Each on the ground under it.
    const grounded = <M extends { position: Float32Array }>(m: M): M => {
      onGround(m.position, g, this.cell);
      return m;
    };
    if (plain.length) this.walls = this.lit(grounded(wallMesh(plain, this.cell)));
    if (tile && textured.length) this.texturedWalls = this.lit(grounded(wallMesh(textured, this.cell, true)), tile);
    const panes = windowGlass(pieces, this.cell);
    if (panes.position.length) {
      const glass = (this.glass = this.lit(grounded(panes)));
      glass.material.transparent = true;
      glass.material.opacity = GLASS_OPACITY;
      // What's behind it still shows: it doesn't hide what's drawn after it.
      (glass.material as MeshLambertMaterial).depthWrite = false;
    }
    const things = objectMesh(this.src.objects(), this.cell, f.cover, all, f.objectPaint);
    grounded(things);
    grounded(things.glow);
    if (things.position.length) this.objects = this.lit(things);
    if (things.glow.position.length) this.glowing = this.unlit(things.glow);
    const rock = cliffMesh(cliffs, this.cell, f.cover, all, f.paint, g);
    if (rock.position.length) this.cliffs = this.lit(rock);
    const rockMap = f.scene.mapAssetId ? rockMask(f.objectPaint, { w: f.scene.width, h: f.scene.height }, this.cell) : null;
    this.makeRock(rockMap, f.cover, all, f.paint);
    this.makeRoofs(all);
    if (this.cave !== !!rockMap) {
      this.cave = !!rockMap;
      this.applyWeather();
    }
    // The ground round the map: its edges' colour, but for a player only from what they've seen.
    const op = f.objectPaint;
    const seen = all ? undefined : (x: number, y: number) => !!op && brightnessAt(f.cover, op.x0 + (x + 0.5) / op.k, op.y0 + (y + 0.5) / op.k) >= WALL_SEEN;
    this.groundEdge = op ? edgeColour(op.rgba, op.w, op.h, seen) : null;
    this.makeScenery();

    // How far the camera may go, for this scene's size.
    const reach = Math.max(20, 2.5 * Math.hypot(w, h));
    this.controls.maxDistance = reach;
    this.camera.far = reach * 4;
    this.camera.updateProjectionMatrix();

    this.makeCoverCanvas();
    this.refreshStandees();
    // What covers the floor may have changed: every spell is drawn again over it.
    this.refreshSheets(true);
    if (newScene) {
      // A new scene: looking where the 2D map looks (the whole scene, for one just shown).
      const v = this.src.view();
      if (v) this.aim(v.x / this.cell, v.y / this.cell, v.w / this.cell, v.h / this.cell, true, false);
      else this.fit();
      this.prunePictures();
    }
    this.redraw();
  }

  /** The tokens as the board shows them now: new ones stood up, changed ones made again, gone ones taken away. */
  private refreshStandees(): void {
    const seen = new Set<string>();
    const all = this.src.gmView();
    for (const s of this.src.standees()) {
      const light = brightnessAt(this.cover, s.x, s.y);
      // Under the fog (or in the dark) for a player: not there, as the fog hides it in 2D.
      if (!standeeShown(light, all)) continue;
      seen.add(s.id);
      const look = standeeLook(s);
      let f = this.figs.get(s.id);
      if (f && f.look !== look) {
        this.dropFig(f);
        this.figs.delete(s.id);
        f = undefined;
      }
      const x = s.x / this.cell, z = s.y / this.cell;
      // On the ground where it stands (below a cliff, a cliff's height down).
      const y = heightAt(this.ground, s.x, s.y);
      if (!f) {
        f = this.makeFig(s, look);
        f.group.position.set(x, y, z);
        this.world.add(f.group);
        this.figs.set(s.id, f);
      }
      f.to.set(x, y, z);
      if (f.group.position.distanceTo(f.to) > JUMP) f.group.position.copy(f.to);
      // As lit as the floor it's on (the GM sees one under the fog dimmed, as in 2D).
      const shade = shadeOf(light);
      if (Math.abs(shade - f.shade) > 0.01) {
        f.shade = shade;
        for (const t of f.tints) t.material.color.copy(t.color).multiplyScalar(shade);
      }
    }
    for (const [id, f] of this.figs) {
      if (seen.has(id)) continue;
      this.dropFig(f);
      this.figs.delete(id);
    }
    this.redraw();
  }

  // ---------------------------------------------------------------- figures

  private makeFig(s: Standee, look: string): Fig {
    const group = new Group();
    const fig: Fig = { group, face: null, tints: [], geometries: [], look, to: new Vector3(), shade: 1 };
    const pic = this.pictureOf(s);
    const faded = s.opacity < 0.999;
    const tint = (material: MeshBasicMaterial | MeshLambertMaterial, color: string | number) => {
      const c = new Color(color);
      material.color.copy(c);
      fig.tints.push({ material, color: c });
    };
    if (s.flat) {
      // A prop lies on the floor, turned as on the map.
      const { w, h } = flatSize(s.size, pic.w, pic.h);
      const geo = new PlaneGeometry(w, h);
      geo.rotateX(-Math.PI / 2);
      fig.geometries.push(geo);
      const mat = new MeshBasicMaterial({
        map: pic.tex,
        transparent: true,
        opacity: s.opacity,
        alphaTest: 0.02,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      });
      tint(mat, 0xffffff);
      const mesh = new Mesh(geo, mat);
      mesh.position.y = 0.005;
      mesh.rotation.y = (-s.rotation * Math.PI) / 180;
      if (s.flip) mesh.scale.x = -1;
      mesh.renderOrder = 1;
      group.add(mesh);
      return fig;
    }
    // A stand in the token's colour...
    const standMat = new MeshLambertMaterial({ transparent: faded, opacity: s.opacity });
    tint(standMat, /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : "#8a8f98");
    const stand = new Mesh(this.disc, standMat);
    const r = s.size * 0.42;
    stand.scale.set(r, 1, r);
    stand.position.y = 0.03;
    group.add(stand);
    // ...and the card on it, its picture facing the camera.
    const { w, h } = cardSize(s.size, pic.w, pic.h);
    const geo = new PlaneGeometry(w, h);
    geo.translate(0, h / 2, 0);
    fig.geometries.push(geo);
    const mat = new MeshBasicMaterial({ map: pic.tex, transparent: true, opacity: s.opacity, alphaTest: 0.1, side: DoubleSide });
    tint(mat, 0xffffff);
    const card = new Mesh(geo, mat);
    if (s.flip) card.scale.x = -1;
    const face = new Group();
    face.position.y = 0.06 + (s.lifted ? FLYING_LIFT : 0);
    face.add(card);
    group.add(face);
    fig.face = face;
    return fig;
  }

  private dropFig(f: Fig): void {
    this.world.remove(f.group);
    for (const g of f.geometries) g.dispose();
    for (const t of f.tints) t.material.dispose();
  }

  /** A token's picture as a texture (made once), and its size in pixels: its own picture, or a disc in its colour with its initials. */
  private pictureOf(s: Standee): { tex: Texture; w: number; h: number } {
    const img = s.picture;
    const key = img ? `img:${img.src}` : `disc:${s.color}:${initialsOf(s.label)}`;
    const had = this.pictures.get(key);
    if (had) return had;
    let made: { tex: Texture; w: number; h: number };
    if (img) {
      const tex = new Texture(img);
      tex.needsUpdate = true;
      tex.anisotropy = 4;
      made = { tex, w: img.naturalWidth, h: img.naturalHeight };
    } else {
      const px = 128;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = px;
      const c = canvas.getContext("2d")!;
      c.beginPath();
      c.arc(px / 2, px / 2, px * 0.44, 0, Math.PI * 2);
      c.fillStyle = s.color;
      c.fill();
      c.lineWidth = px * 0.05;
      c.strokeStyle = "rgba(255,255,255,0.92)";
      c.stroke();
      const text = initialsOf(s.label);
      if (text) {
        c.fillStyle = "#fff";
        c.font = `bold ${Math.round(px * 0.36)}px system-ui, sans-serif`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(text, px / 2, px / 2 + px * 0.02);
      }
      made = { tex: new CanvasTexture(canvas), w: px, h: px };
    }
    this.pictures.set(key, made);
    return made;
  }

  /** Lets go of the pictures no figure uses any more (after a scene change). */
  private prunePictures(): void {
    const used = new Set<Texture>();
    for (const f of this.figs.values()) for (const t of f.tints) if (t.material instanceof MeshBasicMaterial && t.material.map) used.add(t.material.map);
    for (const [key, p] of this.pictures) {
      if (used.has(p.tex)) continue;
      p.tex.dispose();
      this.pictures.delete(key);
    }
  }

  // ---------------------------------------------------------------- the scene's parts

  private dropFloor(): void {
    if (this.floorMesh) {
      this.world.remove(this.floorMesh);
      this.floorMesh.geometry.dispose();
      this.floorMesh.material.dispose();
      this.floorMesh = null;
    }
    this.floorTex?.dispose();
    this.floorTex = null;
    this.floorKey = "";
  }

  /** Triangles in their own colours, not lit by the scene's lights (flames, glowing magic), added to the world. */
  private unlit(m: { position: Float32Array; normal: Float32Array; color: Float32Array }): Mesh {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(m.position, 3));
    geo.setAttribute("normal", new BufferAttribute(m.normal, 3));
    geo.setAttribute("color", new BufferAttribute(m.color, 3));
    const mesh = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true }));
    this.world.add(mesh);
    return mesh;
  }

  /** Triangles lit by the scene's lights, each in its own colour (over `map`, when given), added to the world. */
  private lit(m: { position: Float32Array; normal: Float32Array; color: Float32Array; uv?: Float32Array }, map?: CanvasTexture): Mesh {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(m.position, 3));
    geo.setAttribute("normal", new BufferAttribute(m.normal, 3));
    geo.setAttribute("color", new BufferAttribute(m.color, 3));
    if (m.uv) geo.setAttribute("uv", new BufferAttribute(m.uv, 2));
    const mesh = new Mesh(geo, new MeshLambertMaterial({ vertexColors: true, map: map ?? null }));
    this.world.add(mesh);
    return mesh;
  }

  /**
   * A cave or dungeon map's black as rock (view3dRock.ts): faces where it meets the ground, and its
   * top, a picture of the rock laid flat at the rock's height (see-through where there's none).
   */
  private makeRock(m: ReturnType<typeof rockMask>, cover: CoverMap | null, all: boolean, paint: Parameters<typeof rockSides>[5]): void {
    if (!m) return;
    const sides = rockSides(m, this.cell, WALL_HEIGHT, cover, all, paint);
    if (sides.position.length) this.rock = this.lit(sides);
    const canvas = document.createElement("canvas");
    canvas.width = m.w;
    canvas.height = m.h;
    const x = canvas.getContext("2d");
    if (!x) return;
    x.putImageData(new ImageData(rockTop(m, this.cell, cover, all), m.w, m.h), 0, 0);
    const tex = new CanvasTexture(canvas);
    const w = m.w / m.k / this.cell, h = m.h / m.k / this.cell;
    const geo = new PlaneGeometry(w, h);
    geo.rotateX(-Math.PI / 2);
    const mat = new MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
    const mesh = new Mesh(geo, mat);
    mesh.position.set(m.x0 / this.cell + w / 2, WALL_HEIGHT, m.y0 / this.cell + h / 2);
    this.world.add(mesh);
    this.rockTop = { mesh, tex, canvas, geo, mat };
  }

  /** The scene's wall texture as a repeating texture (made once for its picture), or null while it has none or it isn't made yet. */
  private wallTexture(): CanvasTexture | null {
    const tile = this.src.wallTexture();
    if (!tile) return null;
    if (this.wallTex?.canvas !== tile.canvas) {
      this.wallTex?.tex.dispose();
      const tex = new CanvasTexture(tile.canvas);
      tex.wrapS = tex.wrapT = RepeatWrapping;
      tex.repeat.set(1 / tile.squares, 1 / tile.squares);
      tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
      this.wallTex = { canvas: tile.canvas, tex };
    }
    return this.wallTex.tex;
  }

  /**
   * The buildings' roofs, made again (what's been seen, and how lit, may have changed): each
   * keeps how far it's lifted off, so one already off stays off.
   */
  private makeRoofs(all: boolean): void {
    const was = new Map([...this.roofs].map(([id, r]) => [id, r.lift]));
    this.dropRoofs();
    for (const b of this.src.buildings()) {
      // Made while it's seen, lifted or not: lifting is only how far off it is.
      if (!roofShown({ ...b, inside: false }, this.cover, all)) continue;
      const m = roofMesh(b.rects, this.cell, roofColour(b.id), buildingLight(b, this.cover));
      if (!m.position.length) continue;
      onGround(m.position, this.ground, this.cell);
      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(m.position, 3));
      geo.setAttribute("normal", new BufferAttribute(m.normal, 3));
      geo.setAttribute("color", new BufferAttribute(m.color, 3));
      const mat = new MeshLambertMaterial({ vertexColors: true, transparent: true });
      const mesh = new Mesh(geo, mat);
      mesh.renderOrder = 3;
      this.world.add(mesh);
      const to = b.inside ? 1 : 0;
      const roof = { mesh, mat, lift: was.get(b.id) ?? to, to, opacity: all ? 0.45 : 1 };
      this.roofs.set(b.id, roof);
      this.placeRoof(roof);
    }
  }

  /** Whether the party is inside each building now (a token moved): its roof lifts off or comes back. */
  private liftRoofs(): void {
    if (!this.roofs.size) return;
    for (const b of this.src.buildings()) {
      const r = this.roofs.get(b.id);
      if (r) r.to = b.inside ? 1 : 0;
    }
  }

  /** A roof as far up and as faded as it's lifted. */
  private placeRoof(r: { mesh: Mesh; mat: MeshLambertMaterial; lift: number; opacity: number }): void {
    r.mesh.position.y = r.lift * 1.5;
    r.mat.opacity = r.opacity * (1 - r.lift);
    r.mat.depthWrite = r.mat.opacity > 0.9;
    r.mesh.visible = r.lift < 0.99;
  }

  /** Lifts roofs on towards off or on again; true while any is still going. */
  private stepRoofs(now: number): boolean {
    const dt = this.roofAt ? Math.min(0.1, (now - this.roofAt) / 1000) : 0;
    this.roofAt = now;
    let going = false;
    for (const r of this.roofs.values()) {
      if (r.lift === r.to) continue;
      const step = dt * 2.5;
      r.lift = r.lift < r.to ? Math.min(r.to, r.lift + step) : Math.max(r.to, r.lift - step);
      this.placeRoof(r);
      going = true;
    }
    if (!going) this.roofAt = 0;
    return going;
  }

  // ---------------------------------------------------------------- spells

  /** The fog and the dark over the floor as a picture (black where covered), from the cover map. */
  private makeCoverCanvas(): void {
    const cover = this.cover;
    if (!cover) {
      this.coverCanvas = null;
      return;
    }
    const canvas = (this.coverCanvas ??= document.createElement("canvas"));
    if (canvas.width !== cover.w || canvas.height !== cover.h) {
      canvas.width = cover.w;
      canvas.height = cover.h;
    }
    const c = canvas.getContext("2d")!;
    const img = c.createImageData(cover.w, cover.h);
    for (let i = 0; i < cover.alpha.length; i++) img.data[i * 4 + 3] = cover.alpha[i];
    c.putImageData(img, 0, 0);
  }

  /**
   * The spells as the board has them now: new ones laid down, moved ones moved, gone ones taken
   * up. Only new and moved ones are drawn (moving ones are drawn on by stepSheets), or all with
   * `all` (what covers the floor changed).
   */
  private refreshSheets(all = false): void {
    this.sheetsListedAt = performance.now();
    const seen = new Set<string>();
    const now = performance.now();
    for (const e of this.src.effects()) {
      seen.add(e.key);
      let s = this.sheets.get(e.key);
      if (s && !(sameSize(s.e.bounds, e.bounds) && s.e.level === e.level && sameVolume(s.e.volume, e.volume))) {
        this.dropSheet(s);
        this.sheets.delete(e.key);
        s = undefined;
      }
      let fresh = all;
      if (!s) {
        s = this.makeSheet(e);
        this.sheets.set(e.key, s);
        fresh = true;
      } else {
        if (s.e.bounds.x0 !== e.bounds.x0 || s.e.bounds.y0 !== e.bounds.y0) fresh = true;
        s.e = e;
      }
      this.placeSheet(s);
      if (fresh) {
        this.drawSheet(s, now);
        this.shadeSkin(s);
      }
    }
    for (const [key, s] of this.sheets) {
      if (seen.has(key)) continue;
      this.dropSheet(s);
      this.sheets.delete(key);
    }
    this.redraw();
  }

  private makeSheet(e: Effect3d): Sheet {
    const b = e.bounds;
    const k = effectScale(b, this.cell, this.opts.touch);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((b.x1 - b.x0) * k));
    canvas.height = Math.max(1, Math.round((b.y1 - b.y0) * k));
    const ctx = canvas.getContext("2d")!;
    const tex = new CanvasTexture(canvas);
    const geo = new PlaneGeometry((b.x1 - b.x0) / this.cell, (b.y1 - b.y0) / this.cell);
    geo.rotateX(-Math.PI / 2);
    // One material for each see-through-ness its layers have (the bottom one and those above).
    const byOpacity = new Map<number, MeshBasicMaterial>();
    const meshes = sheetLayers(e).map((l) => {
      let mat = byOpacity.get(l.opacity);
      if (!mat) byOpacity.set(l.opacity, (mat = new MeshBasicMaterial({ map: tex, transparent: true, opacity: l.opacity, depthWrite: false, side: DoubleSide })));
      const m = new Mesh(geo, mat);
      m.renderOrder = 5;
      this.world.add(m);
      return m;
    });
    // Its skin: round its area, up its height.
    let skin: Sheet["skin"] = null;
    const v = e.volume;
    if (v && v.skin > 0 && v.top > v.bottom) {
      const shape = skinMesh(v, this.cell);
      const sg = new BufferGeometry();
      sg.setAttribute("position", new BufferAttribute(shape.position, 3));
      // Clear until its drawing's colour is known (shadeSkin).
      const color = new Float32Array((shape.position.length / 3) * 4);
      sg.setAttribute("color", new BufferAttribute(color, 4));
      const mat = new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide, blending: v.glow ? AdditiveBlending : undefined });
      const mesh = new Mesh(sg, mat);
      mesh.renderOrder = 6;
      this.world.add(mesh);
      skin = { mesh, geo: sg, mat, rise: shape.rise, color };
    }
    return { e, canvas, ctx, tex, mats: [...byOpacity.values()], geo, meshes, k, skin, rgb: null };
  }

  /**
   * A spell's skin in its drawing's colour, fading up it; where the fog and the dark cover the
   * ground under it, as hidden as its drawing is there.
   */
  private shadeSkin(s: Sheet): void {
    const sk = s.skin, v = s.e.volume;
    if (!sk || !v || !s.rgb) return;
    const pos = sk.geo.getAttribute("position").array;
    const cx = (v.area.x0 + v.area.x1) / 2, cz = (v.area.y0 + v.area.y1) / 2;
    const [r, g, b] = s.rgb;
    const fade = v.form === "dome" ? 0.35 : 0.75;
    for (let i = 0; i < sk.rise.length; i++) {
      const seen = s.e.mask && this.cover ? brightnessAt(this.cover, cx + pos[i * 3] * this.cell, cz + pos[i * 3 + 2] * this.cell) : 1;
      sk.color.set([r, g, b, v.skin * (1 - fade * sk.rise[i]) * seen], i * 4);
    }
    sk.geo.getAttribute("color").needsUpdate = true;
  }

  /** A spell's sheets over its place, at their heights (a dome's narrowing round its middle), and its skin round it. */
  private placeSheet(s: Sheet): void {
    const b = s.e.bounds;
    const a = s.e.volume?.area ?? b;
    const ax = (a.x0 + a.x1) / 2 / this.cell, az = (a.y0 + a.y1) / 2 / this.cell;
    const bx = (b.x0 + b.x1) / 2 / this.cell, bz = (b.y0 + b.y1) / 2 / this.cell;
    const base = heightAt(this.ground, ax * this.cell, az * this.cell);
    const layers = sheetLayers(s.e);
    s.meshes.forEach((m, i) => {
      const l = layers[i];
      m.position.set(ax + (bx - ax) * l.scale, base + l.y, az + (bz - az) * l.scale);
      m.scale.set(l.scale, 1, l.scale);
    });
    s.skin?.mesh.position.set(ax, base, az);
  }

  /** Draws a spell onto its sheet as it is at `now`, and takes out what the fog and the dark cover. */
  private drawSheet(s: Sheet, now: number): void {
    const { ctx: c, k, e } = s;
    const b = e.bounds;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    c.clearRect(0, 0, s.canvas.width, s.canvas.height);
    c.setTransform(k, 0, 0, k, -b.x0 * k, -b.y0 * k);
    try {
      e.draw(c, now, 1 / k);
    } catch {
      // One spell that can't be drawn doesn't stop the rest.
    }
    // Its skin's colour: what's drawn, before the fog and the dark take any out.
    if (s.skin && !s.rgb) {
      s.rgb = meanColour(c.getImageData(0, 0, s.canvas.width, s.canvas.height).data);
      if (s.rgb) this.shadeSkin(s);
    }
    const cover = this.cover;
    if (e.mask && cover && this.coverCanvas) {
      c.save();
      c.globalCompositeOperation = "destination-out";
      c.imageSmoothingEnabled = true;
      c.drawImage(this.coverCanvas, cover.x0, cover.y0, cover.w / cover.k, cover.h / cover.k);
      c.restore();
    }
    s.tex.needsUpdate = true;
  }

  /** Whether any spell showing moves (the view keeps drawing while one does). */
  private sheetsMove(): boolean {
    for (const s of this.sheets.values()) if (s.e.moving) return true;
    return false;
  }

  /** Moving spells drawn on (now and then, not every frame); spells cast that have ended taken up. True when something was drawn. */
  private stepSheets(now: number): boolean {
    if (!this.sheets.size || now - this.sheetsAt < EFFECT_STEP_MS) return false;
    this.sheetsAt = now;
    // Spells being cast end by themselves: look again twice a second.
    if (now - this.sheetsListedAt > 500 && [...this.sheets.keys()].some((k) => k.startsWith("cast:"))) this.refreshSheets();
    let drew = false;
    for (const s of this.sheets.values()) {
      if (!s.e.moving) continue;
      this.drawSheet(s, now);
      drew = true;
    }
    return drew;
  }

  private dropSheet(s: Sheet): void {
    for (const m of s.meshes) this.world.remove(m);
    s.geo.dispose();
    for (const m of s.mats) m.dispose();
    s.tex.dispose();
    if (s.skin) {
      this.world.remove(s.skin.mesh);
      s.skin.geo.dispose();
      s.skin.mat.dispose();
    }
  }

  private dropSheets(): void {
    for (const s of this.sheets.values()) this.dropSheet(s);
    this.sheets.clear();
  }

  private dropRoofs(): void {
    for (const r of this.roofs.values()) {
      this.world.remove(r.mesh);
      r.mesh.geometry.dispose();
      r.mat.dispose();
    }
    this.roofs.clear();
  }

  /** Takes away the walls, the objects and the roofs (they're made again together). */
  private dropWalls(): void {
    for (const m of [this.walls, this.texturedWalls, this.glass, this.objects, this.glowing, this.cliffs, this.rock]) {
      if (!m) continue;
      this.world.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.walls = null;
    this.texturedWalls = null;
    this.glass = null;
    this.objects = null;
    this.glowing = null;
    this.cliffs = null;
    this.rock = null;
    if (this.rockTop) {
      this.world.remove(this.rockTop.mesh);
      this.rockTop.geo.dispose();
      this.rockTop.mat.dispose();
      this.rockTop.tex.dispose();
      this.rockTop = null;
    }
    this.dropRoofs();
  }

  /** The day's rain and snow, but none in a cave (a map standing up as rock is underground, whatever the weather setting guessed). */
  private applyWeather(): void {
    const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.weather.set(this.cave ? null : weatherLook(this.sceneryFor.weather, { reducedMotion, touch: this.opts.touch }));
  }

  /**
   * The scenery round the map (view3dScenery.ts), made again only when what it's made from changes:
   * none for a cave, or where the weather doesn't reach (indoors, underground). The mist, if any,
   * fades into its sky.
   */
  private makeScenery(): void {
    const { region, weather } = this.sceneryFor;
    const s = this.cave || !this.sceneId ? null : sceneryOf(region, weather);
    const a = this.area, cell = this.cell;
    const cx = (a.x0 + a.x1) / 2 / cell, cz = (a.y0 + a.y1) / 2 / cell;
    const radius = Math.max(4, Math.hypot(a.x1 - a.x0, a.y1 - a.y0) / 2 / cell);
    const ground = this.groundEdge ?? s?.ground ?? [0.5, 0.5, 0.48];
    const key = JSON.stringify([s, a.x0, a.y0, a.x1, a.y1, cell, ground.map((v) => Math.round(v * 40)), this.groundKey]);
    if (this.scenery?.key === key) {
      this.tintToSky(s);
      return;
    }
    this.dropScenery();
    if (!s) return;
    const meshes = [
      skyMesh(s, cx, cz, radius * 8),
      groundMesh(
        s,
        ground,
        { x0: a.x0 / cell, z0: a.y0 / cell, x1: a.x1 / cell, z1: a.y1 / cell },
        radius * 7.6,
        // Just inside the map's edge: low ground there runs off it.
        (x, z) => heightAt(this.ground, (x + Math.sign(cx - x) * 0.5) * cell, (z + Math.sign(cz - z) * 0.5) * cell),
        10,
        // With high and low ground, its edge close enough to follow the map's (two a square).
        this.ground ? Math.min(256, Math.ceil((Math.max(a.x1 - a.x0, a.y1 - a.y0) / cell) * 2)) : 24,
      ),
      ...s.ranges.map((r) => rangeMesh(r, s, cx, cz, radius)),
    ].map((m) => {
      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(m.position, 3));
      geo.setAttribute("color", new BufferAttribute(m.color, 3));
      const mesh = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: false }));
      this.world.add(mesh);
      return mesh;
    });
    this.scenery = { meshes, key };
    this.tintToSky(s);
    this.redraw();
  }

  /** Rain, snow and mist fade into the scenery's sky rather than the dark round a map without it. */
  private tintToSky(s: { horizon: readonly number[] } | null): void {
    if (!s) return;
    const [r, g, b] = s.horizon;
    this.world.fog?.color.setRGB(r, g, b);
    this.renderer.setClearColor((Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255), 1);
  }

  private dropScenery(): void {
    if (!this.scenery) return;
    for (const m of this.scenery.meshes) {
      this.world.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.scenery = null;
    this.renderer.setClearColor(BACKGROUND, 1);
  }

  private clearScene(): void {
    this.dropScenery();
    this.dropFloor();
    this.dropWalls();
    this.dropSheets();
    this.wallTex?.tex.dispose();
    this.wallTex = null;
    for (const f of this.figs.values()) this.dropFig(f);
    this.figs.clear();
    this.sceneId = null;
    this.cover = null;
  }

  // ---------------------------------------------------------------- the camera

  /**
   * Looks at (x, z) with `w` by `h` squares in view: at once (`jump`) or swinging there; from the
   * south tilted, or keeping how the camera's turned and tilted now (`keep`).
   */
  private aim(x: number, z: number, w: number, h: number, jump: boolean, keep: boolean): void {
    const d = clampTo(frameDistance(w, h, this.camera.aspect), this.controls.minDistance, this.controls.maxDistance);
    const tilt = keep ? this.controls.getPolarAngle() : START_TILT;
    const turn = keep ? this.controls.getAzimuthalAngle() : 0;
    const p = new Vector3(...cameraAt(x, z, d, tilt, turn));
    const t = new Vector3(x, 0, z);
    if (jump) {
      this.tween = null;
      this.controls.target.copy(t);
      this.camera.position.copy(p);
    } else {
      this.tween = { fromT: this.controls.target.clone(), toT: t, fromP: this.camera.position.clone(), toP: p, t0: performance.now() };
    }
    this.redraw();
  }

  /** Swings the camera on towards where it's being aimed; true while it's still going. */
  private stepTween(): boolean {
    const tw = this.tween;
    if (!tw) return false;
    const k = Math.min(1, (performance.now() - tw.t0) / AIM_MS);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    this.controls.target.lerpVectors(tw.fromT, tw.toT, e);
    this.camera.position.lerpVectors(tw.fromP, tw.toP, e);
    if (k >= 1) this.tween = null;
    return true;
  }

  /** Keeps what the camera looks at on the scene: sliding off the map would leave nothing to see. */
  private keepOnScene(): void {
    const a = this.area, t = this.controls.target;
    const x = clampTo(t.x, a.x0 / this.cell, a.x1 / this.cell);
    const z = clampTo(t.z, a.y0 / this.cell, a.y1 / this.cell);
    if (x === t.x && z === t.z && t.y === 0) return;
    this.camera.position.x += x - t.x;
    this.camera.position.z += z - t.z;
    this.camera.position.y -= t.y;
    t.set(x, 0, z);
  }

  /** Slides each figure on towards where its token is; true while any is still going. */
  private stepFigs(): boolean {
    let moving = false;
    for (const f of this.figs.values()) {
      const d = f.group.position.distanceTo(f.to);
      if (d < 0.002) {
        if (d > 0) f.group.position.copy(f.to);
        continue;
      }
      f.group.position.lerp(f.to, 0.3);
      moving = true;
    }
    return moving;
  }

  private fitSize(): void {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (w < 2 || h < 2) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.redraw();
  }

  // ---------------------------------------------------------------- drawing

  /** Draws the view again on the next frame. */
  private redraw(): void {
    this.dirty = true;
    this.wake();
  }

  private wake(): void {
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(this.frame);
  }

  /**
   * A frame, only while something's changing: the camera moving or settling, a tween, figures
   * sliding, or something new to show. Nothing runs while it's all still.
   */
  private frame = (): void => {
    this.raf = 0;
    if (this.disposed) return;
    if (this.tokensQueued) {
      this.tokensQueued = false;
      this.refreshStandees();
      this.liftRoofs();
      this.refreshSheets();
    }
    const aiming = this.stepTween();
    const moved = this.controls.update();
    this.keepOnScene();
    const sliding = this.stepFigs() || this.stepRoofs(performance.now()) || this.stepSheets(performance.now());
    const weathering = this.weather.step(performance.now(), this.controls.target, this.camera.position.distanceTo(this.controls.target));
    if (moved || aiming || sliding || weathering || this.dirty) {
      // Every figure's card faces the camera's way.
      const turn = this.controls.getAzimuthalAngle();
      for (const f of this.figs.values()) if (f.face) f.face.rotation.y = turn;
      this.renderer.render(this.world, this.camera);
      this.dirty = false;
    }
    if ((moved || aiming || sliding || this.held || this.weather.active || this.sheetsMove()) && !this.raf) this.raf = requestAnimationFrame(this.frame);
  };

  private onStart = (): void => {
    this.held = true;
    this.tween = null;
    this.redraw();
  };

  private onEnd = (): void => {
    this.held = false;
    this.redraw();
  };

  private onChange = (): void => this.redraw();

  private onLost = (e: Event): void => {
    e.preventDefault();
    this.opts.onLost();
  };
}
