// three.js 0.143 (installed with the 3D dice, @3d-dice/dice-box-threejs, which asks for it) publishes no
// types of its own. The 3D map (room/view3d.ts) is the only code that imports it: these are the parts
// it uses, as three.js has them, so nothing new is installed for it.

declare module "three" {
  export class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
    copy(v: Vector3): this;
    clone(): Vector3;
    add(v: Vector3): this;
    sub(v: Vector3): this;
    subVectors(a: Vector3, b: Vector3): this;
    multiplyScalar(s: number): this;
    length(): number;
    setLength(l: number): this;
    lerp(v: Vector3, alpha: number): this;
    lerpVectors(a: Vector3, b: Vector3, alpha: number): this;
    distanceTo(v: Vector3): number;
  }

  export class Euler {
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
  }

  export class Color {
    constructor(color?: string | number);
    r: number;
    g: number;
    b: number;
    set(color: string | number): this;
    setRGB(r: number, g: number, b: number): this;
    setScalar(s: number): this;
    multiplyScalar(s: number): this;
    copy(c: Color): this;
  }

  export class Object3D {
    position: Vector3;
    rotation: Euler;
    scale: Vector3;
    visible: boolean;
    renderOrder: number;
    children: Object3D[];
    add(...objects: Object3D[]): this;
    remove(...objects: Object3D[]): this;
    lookAt(x: number | Vector3, y?: number, z?: number): void;
  }

  export class Group extends Object3D {}

  export class Scene extends Object3D {}

  export class Camera extends Object3D {}

  export class PerspectiveCamera extends Camera {
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
    fov: number;
    aspect: number;
    near: number;
    far: number;
    updateProjectionMatrix(): void;
  }

  export class BufferAttribute {
    constructor(array: Float32Array, itemSize: number, normalized?: boolean);
  }

  export class BufferGeometry {
    setAttribute(name: string, attribute: BufferAttribute): this;
    rotateX(angle: number): this;
    translate(x: number, y: number, z: number): this;
    dispose(): void;
  }

  export class PlaneGeometry extends BufferGeometry {
    constructor(width?: number, height?: number);
  }

  export class CylinderGeometry extends BufferGeometry {
    constructor(radiusTop?: number, radiusBottom?: number, height?: number, radialSegments?: number);
  }

  export const FrontSide: number;
  export const DoubleSide: number;

  export interface MaterialParameters {
    transparent?: boolean;
    opacity?: number;
    alphaTest?: number;
    depthWrite?: boolean;
    side?: number;
    polygonOffset?: boolean;
    polygonOffsetFactor?: number;
    polygonOffsetUnits?: number;
    vertexColors?: boolean;
    color?: string | number | Color;
    map?: Texture | null;
  }

  export class Material {
    transparent: boolean;
    opacity: number;
    needsUpdate: boolean;
    dispose(): void;
  }

  export class MeshBasicMaterial extends Material {
    constructor(parameters?: MaterialParameters);
    color: Color;
    map: Texture | null;
  }

  export class MeshLambertMaterial extends Material {
    constructor(parameters?: MaterialParameters);
    color: Color;
  }

  export class Mesh extends Object3D {
    constructor(geometry?: BufferGeometry, material?: Material);
    geometry: BufferGeometry;
    material: Material;
  }

  export class Texture {
    constructor(image?: TexImageSource);
    image: unknown;
    needsUpdate: boolean;
    anisotropy: number;
    dispose(): void;
  }

  export class CanvasTexture extends Texture {
    constructor(canvas: HTMLCanvasElement);
  }

  export class Light extends Object3D {
    intensity: number;
  }

  export class HemisphereLight extends Light {
    constructor(skyColor?: string | number, groundColor?: string | number, intensity?: number);
  }

  export class DirectionalLight extends Light {
    constructor(color?: string | number, intensity?: number);
  }

  export interface WebGLRendererParameters {
    canvas?: HTMLCanvasElement;
    antialias?: boolean;
    alpha?: boolean;
    powerPreference?: "default" | "high-performance" | "low-power";
    failIfMajorPerformanceCaveat?: boolean;
  }

  export class WebGLRenderer {
    constructor(parameters?: WebGLRendererParameters);
    domElement: HTMLCanvasElement;
    capabilities: { maxTextureSize: number; getMaxAnisotropy(): number };
    setPixelRatio(ratio: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    setClearColor(color: string | number, alpha?: number): void;
    render(scene: Object3D, camera: Camera): void;
    dispose(): void;
    forceContextLoss(): void;
  }
}

declare module "three/examples/jsm/controls/OrbitControls.js" {
  import type { Camera, Vector3 } from "three";

  export class OrbitControls {
    constructor(object: Camera, domElement: HTMLElement);
    target: Vector3;
    enabled: boolean;
    enableDamping: boolean;
    dampingFactor: number;
    enablePan: boolean;
    screenSpacePanning: boolean;
    minDistance: number;
    maxDistance: number;
    minPolarAngle: number;
    maxPolarAngle: number;
    rotateSpeed: number;
    zoomSpeed: number;
    panSpeed: number;
    update(): boolean;
    getAzimuthalAngle(): number;
    getPolarAngle(): number;
    addEventListener(type: "change" | "start" | "end", listener: () => void): void;
    removeEventListener(type: "change" | "start" | "end", listener: () => void): void;
    dispose(): void;
  }
}
