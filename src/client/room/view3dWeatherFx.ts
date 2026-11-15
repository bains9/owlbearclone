// The day's weather drawn in the 3D view (view3d.ts), as view3dWeather.ts says it looks: rain as
// streaks and snow as soft flakes, falling through a space round what the camera looks at (so it's
// always where you're looking, and wider the further back you stand), the far part of the map
// fading into mist, and in a storm the sky flashing now and then.

import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Fog,
  Group,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  type Scene,
  type Vector3,
} from "three";
import { fallSpace, mistRange, nextLightning, scatter, stepFall, streaks, type WeatherLook } from "./view3dWeather";

/** The falling space is this tall for its width. */
const SPACE_HEIGHT = 0.6;
/** A rain streak's length, as a share of the falling space's height. */
const STREAK = 0.035;
/** Rain and snow move on at most this often (ms): enough to look smooth, and lighter on a phone. */
const STEP_MS = 33;

export class WeatherFx3d {
  private group = new Group();
  private rain: { heads: Float32Array; lines: Float32Array; attr: BufferAttribute; geo: BufferGeometry; mat: LineBasicMaterial; obj: LineSegments } | null = null;
  private snow: { pos: Float32Array; attr: BufferAttribute; geo: BufferGeometry; mat: PointsMaterial; obj: Points; tex: CanvasTexture } | null = null;
  private look: WeatherLook | null = null;
  private key = "";
  private last = 0;
  private flashAt = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private world: Scene,
    /** A white layer over the view, for lightning. */
    private flashEl: HTMLElement,
    /** Sets the sky round the map: the mist's colour, or null for the usual. */
    private setSky: (color: string | null) => void,
  ) {
    this.group.renderOrder = 2;
    this.world.add(this.group);
  }

  /** Whether anything moves (rain, snow or lightning): the view keeps drawing while it does. */
  get active(): boolean {
    return !!(this.rain || this.snow || this.look?.lightning);
  }

  /** Shows this weather (null: none). The same weather again changes nothing. */
  set(look: WeatherLook | null): void {
    const key = JSON.stringify(look);
    if (key === this.key) return;
    this.key = key;
    this.look = look;
    this.dropRain();
    this.dropSnow();
    if (look?.rain) {
      const heads = scatter(look.rain, Math.random);
      const lines = new Float32Array(look.rain * 6);
      streaks(heads, lines, STREAK, look.slant);
      const geo = new BufferGeometry();
      const attr = new BufferAttribute(lines, 3);
      geo.setAttribute("position", attr);
      const mat = new LineBasicMaterial({ color: 0xb4c4d8, transparent: true, opacity: look.rain > 1500 ? 0.55 : 0.4, depthWrite: false });
      const obj = new LineSegments(geo, mat);
      obj.frustumCulled = false;
      this.group.add(obj);
      this.rain = { heads, lines, attr, geo, mat, obj };
    }
    if (look?.snow) {
      const pos = scatter(look.snow, Math.random);
      const geo = new BufferGeometry();
      const attr = new BufferAttribute(pos, 3);
      geo.setAttribute("position", attr);
      const tex = new CanvasTexture(flake());
      const mat = new PointsMaterial({ map: tex, size: 0.1, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false, alphaTest: 0.05, color: 0xffffff });
      const obj = new Points(geo, mat);
      obj.frustumCulled = false;
      this.group.add(obj);
      this.snow = { pos, attr, geo, mat, obj, tex };
    }
    this.world.fog = look && look.mist > 0 ? new Fog(look.mistColor, 1, 1000) : null;
    this.setSky(look && look.mist > 0 ? look.mistColor : null);
    this.flashAt = 0;
    this.last = 0;
  }

  /**
   * A frame: the falling space follows what the camera looks at and grows with its distance, the
   * mist with it, and rain and snow move on. True when something changed to draw.
   */
  step(now: number, target: Vector3, distance: number): boolean {
    const look = this.look;
    if (!look) return false;
    const space = fallSpace(distance);
    this.group.position.set(target.x, 0, target.z);
    this.group.scale.set(space, space * SPACE_HEIGHT, space);
    const fog = this.world.fog;
    if (fog) {
      const r = mistRange(look.mist, distance);
      fog.near = r.near;
      fog.far = r.far;
    }
    if (look.lightning) this.storm(now);
    if (!this.rain && !this.snow) return false;
    if (this.last && now - this.last < STEP_MS) return false;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    if (this.rain) {
      stepFall(this.rain.heads, dt, look.rainFall, look.rainFall * look.slant, Math.random);
      streaks(this.rain.heads, this.rain.lines, STREAK, look.slant);
      this.rain.attr.needsUpdate = true;
    }
    if (this.snow) {
      stepFall(this.snow.pos, dt, look.snowFall, look.drift, Math.random);
      // A flake wanders a little as it falls.
      const p = this.snow.pos;
      for (let i = 0; i < p.length; i += 3) p[i + 2] += Math.sin(now / 900 + i) * 0.0006;
      this.snow.attr.needsUpdate = true;
      this.snow.mat.size = space * 0.006;
    }
    return true;
  }

  /** Lightning now and then, sometimes twice. */
  private storm(now: number): void {
    if (!this.flashAt) {
      this.flashAt = now + nextLightning(Math.random);
      return;
    }
    if (now < this.flashAt) return;
    this.flashAt = now + nextLightning(Math.random);
    this.flash(0);
    if (Math.random() < 0.5) this.flash(170);
  }

  private flash(after: number): void {
    this.timers.push(
      setTimeout(() => {
        this.flashEl.classList.add("on");
        this.timers.push(setTimeout(() => this.flashEl.classList.remove("on"), 90));
      }, after),
    );
  }

  private dropRain(): void {
    if (!this.rain) return;
    this.group.remove(this.rain.obj);
    this.rain.geo.dispose();
    this.rain.mat.dispose();
    this.rain = null;
  }

  private dropSnow(): void {
    if (!this.snow) return;
    this.group.remove(this.snow.obj);
    this.snow.geo.dispose();
    this.snow.mat.dispose();
    this.snow.tex.dispose();
    this.snow = null;
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.dropRain();
    this.dropSnow();
    this.world.remove(this.group);
    this.world.fog = null;
    this.flashEl.classList.remove("on");
  }
}

/** A soft round snowflake. */
function flake(): HTMLCanvasElement {
  const px = 32;
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.85)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, px, px);
  return c;
}
