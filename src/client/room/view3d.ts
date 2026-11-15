// The map in 3D (14 November 2026): the scene as this page sees it, tilted like a map on a table.
// The floor is the 2D map exactly as drawn here (the picture, built map, grid, drawings, and the dark
// and the fog over them, so a player sees no more than in 2D); walls and shut doors rise from it
// where this page has seen them; tokens stand up as cardboard figures on stands, and props lie flat.
// It only looks: everything is done on the 2D map, and the 3D view follows it live. Drag to swing
// round, pinch or wheel to zoom, two fingers or a right-drag to slide along. A table display follows
// where the GM points it. three.js (installed with the 3D dice) loads only when a device first
// shows the map in 3D; the arithmetic is in view3dModel.ts.

import {
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
  MAX_TILT,
  START_TILT,
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
  type Board3dSource,
  type Change3d,
  type CoverMap,
  type Standee,
  type View3dControls,
} from "./view3dModel";
import { objectMesh } from "./view3dObjects";

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

export class View3D implements View3dControls {
  private renderer: WebGLRenderer;
  private world = new World();
  private camera = new PerspectiveCamera(FOV, 1, 0.1, 1000);
  private controls: OrbitControls;
  private floorMesh: Mesh | null = null;
  private floorTex: CanvasTexture | null = null;
  private floorKey = "";
  private walls: Mesh | null = null;
  /** The built map's objects standing up: trees, rocks, pillars, tables... (view3dObjects.ts). */
  private objects: Mesh | null = null;
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

  dispose(): void {
    this.disposed = true;
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

    // The floor: a new texture when its size changes (WebGL keeps a texture's size), else the same one drawn again.
    const key = `${a.x0},${a.y0},${a.x1},${a.y1},${this.cell},${f.canvas.width}x${f.canvas.height}`;
    if (!this.floorMesh || !this.floorTex || key !== this.floorKey) {
      this.dropFloor();
      const tex = (this.floorTex = new CanvasTexture(f.canvas));
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      const geo = new PlaneGeometry(w, h);
      geo.rotateX(-Math.PI / 2);
      this.floorMesh = new Mesh(geo, new MeshBasicMaterial({ map: tex }));
      this.floorMesh.position.set((a.x0 + a.x1) / 2 / this.cell, 0, (a.y0 + a.y1) / 2 / this.cell);
      this.world.add(this.floorMesh);
      this.floorKey = key;
    } else {
      this.floorTex.needsUpdate = true;
    }

    // The walls and the built map's objects, where this page has seen them.
    this.dropWalls();
    const all = this.src.gmView();
    const pieces = wallPieces(this.src.walls(), this.cell, f.cover, all);
    if (pieces.length) this.walls = this.lit(wallMesh(pieces, this.cell));
    const things = objectMesh(this.src.objects(), this.cell, f.cover, all);
    if (things.position.length) this.objects = this.lit(things);

    // How far the camera may go, for this scene's size.
    const reach = Math.max(20, 2.5 * Math.hypot(w, h));
    this.controls.maxDistance = reach;
    this.camera.far = reach * 4;
    this.camera.updateProjectionMatrix();

    this.refreshStandees();
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
      if (!f) {
        f = this.makeFig(s, look);
        f.group.position.set(x, 0, z);
        this.world.add(f.group);
        this.figs.set(s.id, f);
      }
      f.to.set(x, 0, z);
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

  /** Triangles lit by the scene's lights, each in its own colour, added to the world. */
  private lit(m: { position: Float32Array; normal: Float32Array; color: Float32Array }): Mesh {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(m.position, 3));
    geo.setAttribute("normal", new BufferAttribute(m.normal, 3));
    geo.setAttribute("color", new BufferAttribute(m.color, 3));
    const mesh = new Mesh(geo, new MeshLambertMaterial({ vertexColors: true }));
    this.world.add(mesh);
    return mesh;
  }

  /** Takes away the walls and the objects (they're made again together). */
  private dropWalls(): void {
    for (const m of [this.walls, this.objects]) {
      if (!m) continue;
      this.world.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.walls = null;
    this.objects = null;
  }

  private clearScene(): void {
    this.dropFloor();
    this.dropWalls();
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
    }
    const aiming = this.stepTween();
    const moved = this.controls.update();
    this.keepOnScene();
    const sliding = this.stepFigs();
    if (moved || aiming || sliding || this.dirty) {
      // Every figure's card faces the camera's way.
      const turn = this.controls.getAzimuthalAngle();
      for (const f of this.figs.values()) if (f.face) f.face.rotation.y = turn;
      this.renderer.render(this.world, this.camera);
      this.dirty = false;
    }
    if ((moved || aiming || sliding || this.held) && !this.raf) this.raf = requestAnimationFrame(this.frame);
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
