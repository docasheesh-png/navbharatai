// The 3D layer — where a generated game stops looking like a school project.
//
// PHASE 2 of game building (phase 1 was the runtime: GameRuntimeGenerator.ts).
//
// THE THING EVERYONE GETS WRONG. Ask why an AI-generated three.js scene looks bad and the answer comes
// back "the models are too simple". Usually it is not. The same low-poly geometry can look deliberate
// and expensive or flat and unfinished, and the difference is almost entirely in four settings that
// have nothing to do with assets:
//
//   1. COLOUR MANAGEMENT. three.js renders linear by default. Without `outputColorSpace = SRGBColorSpace`
//      and a filmic tone map, every scene is either washed out or blown out — the single most common
//      reason a WebGL scene "looks wrong" in a way people cannot name.
//   2. LIGHTING SHAPE. One light gives you flat shading and black shadows. A hemisphere (sky/ground)
//      + a directional key + a soft fill is the difference between "3D shapes" and "a place".
//   3. SHADOW FITTING. A directional light's shadow camera defaults to a box that rarely matches the
//      scene, so shadows come out blocky, missing, or crawling with acne. It has to be fitted, and the
//      bias tuned, or shadows are worse than none.
//   4. RESTRAINT IN POST. A little bloom and vignette reads as cinematic; the default strength reads as
//      amateur. Bloom is the classic tell of a first WebGL project.
//
// So this file is mostly craft knowledge, not code volume. Get these right and simple geometry looks
// intentional; get them wrong and no asset library will save the scene.
//
// PERFORMANCE IS A DESIGN CONSTRAINT, NOT A LATER PASS. Most Indian users are on mid-range Android.
// Uncapped `devicePixelRatio` on a 3x phone screen renders NINE times the pixels of a 1x desktop and
// tanks the frame rate before a single model loads — so it is capped here, by default, forever.
// Scatter uses InstancedMesh because a thousand separate trees is a thousand draw calls.
//
// PURE builder → the caller writes the files. The generated code imports three; the generator does not.

export interface Game3DResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const RENDERER = `import * as THREE from 'three';

/**
 * The renderer, set up the way a scene actually needs — not the defaults.
 *
 * COLOUR MANAGEMENT FIRST. three.js works in linear space; a texture and a colour written as sRGB must
 * be converted, and the final image tone-mapped. Skip this and everything is washed out or blown out,
 * which is the most common reason a WebGL scene "looks wrong" in a way nobody can name. ACES Filmic is
 * the film-industry curve: it rolls highlights off instead of clipping them to white.
 *
 * PIXEL RATIO IS CAPPED. A 3x phone screen would otherwise render nine times the pixels of a 1x
 * desktop — the frame rate is gone before a single model loads. 2 is the point past which almost
 * nobody can see a difference.
 */
export interface RendererOptions {
  canvas?: HTMLCanvasElement;
  /** Cap for devicePixelRatio. Lower to 1 on a weak device; never uncap it. */
  maxPixelRatio?: number;
  antialias?: boolean;
  shadows?: boolean;
}

export function createRenderer(options: RendererOptions = {}): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas: options.canvas,
    antialias: options.antialias ?? true,
    powerPreference: 'high-performance',
    // Only ask for alpha when it is really needed: a transparent canvas costs blending every frame.
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.maxPixelRatio ?? 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  // The four lines that decide whether the scene looks right.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  if (options.shadows !== false) {
    renderer.shadowMap.enabled = true;
    // PCF-soft is the best quality/cost trade on the web. Hard shadows read as cheap.
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  return renderer;
}

/**
 * Keep the canvas correct through rotation, window resize AND layout changes. Returns a disposer.
 *
 * PASS THE CONTAINER whenever the game is not the whole page. Sizing to window.innerWidth is right for
 * a fullscreen game and wrong for every embedded one — the canvas overflows its panel and the view is
 * stretched. And a window 'resize' event never fires when a sidebar collapses or a flex sibling grows,
 * so a window-only listener misses the most common layout change there is; ResizeObserver catches it.
 */
export function handleResize(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  container?: HTMLElement | null,
): () => void {
  const measure = () => {
    if (container) {
      const r = container.getBoundingClientRect();
      // A container collapsed to zero (display:none, an unopened tab) would make aspect NaN and blank
      // the canvas permanently — keep the last good size instead.
      if (r.width > 0 && r.height > 0) return { w: r.width, h: r.height };
      return null;
    }
    return { w: window.innerWidth, h: window.innerHeight };
  };

  const onResize = () => {
    const size = measure();
    if (!size) return;
    camera.aspect = size.w / size.h;
    // Without this the view stays stretched after a rotate — the most visible mobile bug there is.
    camera.updateProjectionMatrix();
    // updateStyle=false when embedded: the CSS size is the layout's business, not the renderer's.
    renderer.setSize(size.w, size.h, !container);
  };

  onResize(); // size correctly on the first frame, not only after the first resize

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  let observer: ResizeObserver | null = null;
  if (container && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(onResize);
    observer.observe(container);
  }

  return () => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    observer?.disconnect();
  };
}
`;

const LIGHTING = `import * as THREE from 'three';

/**
 * Lighting presets — the biggest single lever on how a scene FEELS.
 *
 * Each preset is a hemisphere light (sky colour above, bounced ground colour below), a directional key
 * with fitted shadows, and fog whose colour MATCHES the background. That last detail is what makes a
 * world feel like it continues past the draw distance instead of ending at a visible edge.
 *
 * One light is what a first attempt uses, and it is why the result looks like shaded geometry rather
 * than a place: no bounce, no sky contribution, and shadows that go pure black.
 */
export type LightingPresetName =
  | 'day' | 'sunset' | 'night' | 'overcast' | 'horror' | 'desert' | 'forest' | 'underwater' | 'neon';

export interface LightingPreset {
  background: number;
  fog: { color: number; near: number; far: number };
  hemisphere: { sky: number; ground: number; intensity: number };
  key: { color: number; intensity: number; position: [number, number, number] };
  ambient: number;
  exposure: number;
}

export const LIGHTING_PRESETS: Record<LightingPresetName, LightingPreset> = {
  day:        { background: 0x87ceeb, fog: { color: 0x87ceeb, near: 40, far: 220 }, hemisphere: { sky: 0xbfe3ff, ground: 0x6b5a3e, intensity: 0.9 }, key: { color: 0xfff4e0, intensity: 2.2, position: [60, 90, 40] }, ambient: 0.15, exposure: 1.0 },
  sunset:     { background: 0xff9a56, fog: { color: 0xff9a56, near: 25, far: 160 }, hemisphere: { sky: 0xffb877, ground: 0x4a2c17, intensity: 0.7 }, key: { color: 0xff7b3d, intensity: 2.6, position: [-80, 22, 30] }, ambient: 0.18, exposure: 1.05 },
  night:      { background: 0x0a0f1e, fog: { color: 0x0a0f1e, near: 12, far: 90 },  hemisphere: { sky: 0x2a3b5c, ground: 0x05070d, intensity: 0.45 }, key: { color: 0xaac4ff, intensity: 0.55, position: [40, 70, -30] }, ambient: 0.08, exposure: 1.15 },
  overcast:   { background: 0xb8c0c8, fog: { color: 0xb8c0c8, near: 30, far: 150 }, hemisphere: { sky: 0xd4dce4, ground: 0x6e6a62, intensity: 1.1 }, key: { color: 0xdfe6ee, intensity: 0.9, position: [30, 80, 20] }, ambient: 0.25, exposure: 0.95 },
  horror:     { background: 0x05060a, fog: { color: 0x05060a, near: 4,  far: 42 },  hemisphere: { sky: 0x141a24, ground: 0x000000, intensity: 0.25 }, key: { color: 0x8fa8c8, intensity: 0.3, position: [10, 40, -20] }, ambient: 0.04, exposure: 1.25 },
  desert:     { background: 0xf2d6a2, fog: { color: 0xf2d6a2, near: 50, far: 300 }, hemisphere: { sky: 0xffe9bd, ground: 0xa87d4a, intensity: 1.0 }, key: { color: 0xfff1cf, intensity: 2.8, position: [50, 110, 30] }, ambient: 0.2, exposure: 0.95 },
  forest:     { background: 0x5d7a52, fog: { color: 0x5d7a52, near: 18, far: 110 }, hemisphere: { sky: 0x9dc48a, ground: 0x2f3d22, intensity: 0.8 }, key: { color: 0xe8f5c8, intensity: 1.6, position: [40, 95, 25] }, ambient: 0.14, exposure: 1.0 },
  underwater: { background: 0x0b3b52, fog: { color: 0x0b3b52, near: 6,  far: 55 },  hemisphere: { sky: 0x1e6f92, ground: 0x04202e, intensity: 0.7 }, key: { color: 0x7fd4f0, intensity: 0.9, position: [20, 80, 10] }, ambient: 0.16, exposure: 1.1 },
  neon:       { background: 0x0a0416, fog: { color: 0x0a0416, near: 15, far: 120 }, hemisphere: { sky: 0x3a1a6b, ground: 0x0a0416, intensity: 0.5 }, key: { color: 0xff3fb4, intensity: 1.1, position: [-30, 50, 40] }, ambient: 0.1, exposure: 1.2 },
};

export interface AppliedLighting {
  key: THREE.DirectionalLight;
  hemisphere: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  preset: LightingPreset;
}

/**
 * Apply a preset to a scene.
 *
 * \`shadowRadius\` fits the key light's shadow camera to the area that actually matters. The default box
 * almost never matches the scene: too big and shadows are blocky mush, too small and they vanish at the
 * edges. The bias values remove shadow acne without introducing peter-panning — those two numbers are
 * the difference between shadows that help and shadows that look broken.
 */
export function applyLighting(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  name: LightingPresetName = 'day',
  shadowRadius = 60,
): AppliedLighting {
  const preset = LIGHTING_PRESETS[name] ?? LIGHTING_PRESETS.day;

  scene.background = new THREE.Color(preset.background);
  // Fog colour MUST match the background or the world ends at a visible seam.
  scene.fog = new THREE.Fog(preset.fog.color, preset.fog.near, preset.fog.far);
  renderer.toneMappingExposure = preset.exposure;

  const hemisphere = new THREE.HemisphereLight(preset.hemisphere.sky, preset.hemisphere.ground, preset.hemisphere.intensity);
  scene.add(hemisphere);

  const ambient = new THREE.AmbientLight(0xffffff, preset.ambient);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(preset.key.color, preset.key.intensity);
  key.position.set(...preset.key.position);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const cam = key.shadow.camera as THREE.OrthographicCamera;
  cam.left = -shadowRadius; cam.right = shadowRadius;
  cam.top = shadowRadius; cam.bottom = -shadowRadius;
  cam.near = 0.5; cam.far = shadowRadius * 6;
  cam.updateProjectionMatrix();
  key.shadow.bias = -0.0005;      // kills acne
  key.shadow.normalBias = 0.02;   // without this, thin geometry self-shadows into stripes
  scene.add(key);
  scene.add(key.target);

  return { key, hemisphere, ambient, preset };
}

/** Move the key light so its shadow box follows the player — shadows stay sharp on a big map. */
export function followShadow(key: THREE.DirectionalLight, target: THREE.Vector3): void {
  const offset = key.position.clone().sub(key.target.position);
  key.target.position.copy(target);
  key.position.copy(target).add(offset);
  key.target.updateMatrixWorld();
}
`;

const MATERIALS = `import * as THREE from 'three';

/**
 * Material presets and a shared palette.
 *
 * ART DIRECTION IS CONSISTENCY, NOT DETAIL. A scene where every object was given its own hand-picked
 * colour and roughness looks like a parts bin, however good each part is. A scene drawn from ONE small
 * palette with a few disciplined material types reads as designed — which is exactly why low-poly
 * games look deliberate rather than unfinished.
 *
 * Roughness/metalness are kept in believable ranges on purpose. Real dielectrics are metalness 0; only
 * actual metal is 1. Everything at 0.5/0.5 — the default many generators emit — is the plastic look
 * that makes a scene feel cheap.
 */
export const PALETTES = {
  indianVillage: [0xd9a066, 0x8f563b, 0xc8b88a, 0x6a8f3c, 0x4e6b25, 0xe8d5a8, 0xa63d2f, 0xf2e7d0],
  forest:        [0x3f5c2a, 0x6b8f3c, 0x2d4a1c, 0x8a6b3f, 0x5c4423, 0xa8c47a, 0x1f3312, 0xd4e0b8],
  desert:        [0xe6c288, 0xc9a05e, 0xa87d42, 0xf2dfb0, 0x8a6535, 0xd9b877, 0x6b4f28, 0xfff2d6],
  neon:          [0xff3fb4, 0x00e5ff, 0x7b2fff, 0x1a0a2e, 0xff9500, 0x00ffa3, 0x2d1b4e, 0xffffff],
  monochrome:    [0x1a1a1a, 0x333333, 0x4d4d4d, 0x666666, 0x999999, 0xcccccc, 0xe6e6e6, 0xffffff],
  pastel:        [0xffd6e0, 0xc1e7e3, 0xfff3b0, 0xd4c5f9, 0xffe5b4, 0xb8e0d2, 0xf6c6ea, 0xfdfdfd],
} as const;

export type PaletteName = keyof typeof PALETTES;

export type MaterialKind =
  | 'ground' | 'rock' | 'wood' | 'foliage' | 'metal' | 'plaster' | 'fabric'
  | 'glass' | 'water' | 'emissive' | 'toon';

/** Believable roughness/metalness per kind — this is what stops everything looking like plastic. */
export function makeMaterial(kind: MaterialKind, color: number): THREE.Material {
  switch (kind) {
    case 'ground':   return new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0 });
    case 'rock':     return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true });
    case 'wood':     return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0 });
    case 'foliage':  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, flatShading: true, side: THREE.DoubleSide });
    case 'metal':    return new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 1 });
    case 'plaster':  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 });
    case 'fabric':   return new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 });
    case 'glass':    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.05, metalness: 0, transmission: 0.9, thickness: 0.5, transparent: true });
    case 'water':    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.1, metalness: 0, transmission: 0.6, thickness: 1, transparent: true, opacity: 0.85 });
    // Emissive must NOT also be lit, or it reads as a grey object with a glow stuck on it.
    case 'emissive': return new THREE.MeshBasicMaterial({ color });
    case 'toon':     return new THREE.MeshToonMaterial({ color });
    default:         return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0 });
  }
}

/**
 * A deterministic colour from a palette.
 *
 * Deterministic so the same seed rebuilds the same world — a scene that reshuffles its colours on every
 * reload cannot be art-directed, and a bug in it cannot be reproduced.
 */
export function paletteColor(palette: PaletteName, index: number): number {
  const list = PALETTES[palette] ?? PALETTES.indianVillage;
  return list[Math.abs(Math.floor(index)) % list.length];
}

/**
 * SHARE materials across objects that look the same.
 *
 * A thousand trees with a thousand material instances is a thousand shader programs to bind. One cached
 * material per (kind, colour) is the difference between a scene that runs on a phone and one that does
 * not.
 */
const cache = new Map<string, THREE.Material>();
export function sharedMaterial(kind: MaterialKind, color: number): THREE.Material {
  const key = kind + ':' + color;
  let mat = cache.get(key);
  if (!mat) { mat = makeMaterial(kind, color); cache.set(key, mat); }
  return mat;
}

export function disposeMaterials(): void {
  for (const mat of cache.values()) mat.dispose();
  cache.clear();
}
`;

const CAMERA = `import * as THREE from 'three';
import { damp } from '../core/feel';

/**
 * Camera rigs.
 *
 * Every rig damps toward its target with \`damp()\` rather than a per-frame lerp, because
 * \`a + (b - a) * 0.1\` moves twice as fast at 120 fps as at 60 — the camera literally feels different
 * on different monitors, which is the kind of bug nobody thinks to look for.
 *
 * The third-person rig casts a ray back from the player and pulls in on a hit. Without that, walking
 * against a wall puts the camera inside it and the player sees the inside of the level.
 */
export type CameraKind = 'third-person' | 'first-person' | 'top-down' | 'side-scroller' | 'orbit' | 'fixed';

export interface CameraRigOptions {
  kind?: CameraKind;
  distance?: number;
  height?: number;
  /** Higher = snappier. 6–10 feels responsive; 2–4 feels cinematic. */
  stiffness?: number;
  fov?: number;
  /** Meshes the camera must not pass through (third-person only). */
  collidables?: THREE.Object3D[];
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private readonly kind: CameraKind;
  private readonly distance: number;
  private readonly height: number;
  private readonly stiffness: number;
  private collidables: THREE.Object3D[];
  private readonly ray = new THREE.Raycaster();
  private yawAngle = 0;
  private pitch = -0.2;
  private readonly desired = new THREE.Vector3();

  constructor(options: CameraRigOptions = {}) {
    this.kind = options.kind ?? 'third-person';
    this.distance = options.distance ?? 7;
    this.height = options.height ?? 2.2;
    this.stiffness = options.stiffness ?? 7;
    this.collidables = options.collidables ?? [];
    this.camera = new THREE.PerspectiveCamera(options.fov ?? 60, window.innerWidth / window.innerHeight, 0.1, 1000);
  }

  /**
   * The character controller needs this so movement is CAMERA-RELATIVE: pressing forward must go where
   * the player is looking, not along a fixed world axis. Without it, turning the camera makes the
   * controls feel inverted and unusable.
   */
  get yaw(): number { return this.yawAngle; }

  /**
   * The world is usually built AFTER the rig exists, so colliders cannot only be a constructor option —
   * otherwise third-person camera collision silently never works and the view clips through walls.
   */
  setCollidables(list: THREE.Object3D[]): void { this.collidables = list; }

  /** Feed the frame's look delta (Input.lookX/lookY). */
  look(dx: number, dy: number, sensitivity = 0.0025): void {
    this.yawAngle -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    // Clamped just short of straight up/down: at exactly ±90° the view flips over.
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  }

  update(target: THREE.Vector3, delta: number): void {
    if (this.kind === 'first-person') {
      this.camera.position.copy(target).add(new THREE.Vector3(0, this.height * 0.8, 0));
      this.camera.rotation.set(this.pitch, this.yawAngle, 0, 'YXZ');
      return;
    }
    if (this.kind === 'top-down') {
      this.desired.set(target.x, target.y + this.distance * 1.6, target.z + this.distance * 0.35);
      this.dampTo(this.desired, delta);
      this.camera.lookAt(target);
      return;
    }
    if (this.kind === 'side-scroller') {
      this.desired.set(target.x, target.y + this.height, target.z + this.distance);
      this.dampTo(this.desired, delta);
      this.camera.lookAt(target.x, target.y + this.height * 0.5, target.z);
      return;
    }

    // third-person / orbit
    const offset = new THREE.Vector3(
      Math.sin(this.yawAngle) * Math.cos(this.pitch),
      -Math.sin(this.pitch),
      Math.cos(this.yawAngle) * Math.cos(this.pitch),
    ).multiplyScalar(this.distance);

    const focus = target.clone().add(new THREE.Vector3(0, this.height, 0));
    let wanted = focus.clone().add(offset);

    if (this.collidables.length > 0) {
      const dir = wanted.clone().sub(focus);
      const dist = dir.length();
      this.ray.set(focus, dir.normalize());
      this.ray.far = dist;
      const hit = this.ray.intersectObjects(this.collidables, true)[0];
      // Pull in slightly PAST the hit so the near plane does not clip into the wall.
      if (hit) wanted = focus.clone().add(dir.multiplyScalar(Math.max(0.6, hit.distance - 0.3)));
    }

    this.dampTo(wanted, delta);
    this.camera.lookAt(focus);
  }

  private dampTo(wanted: THREE.Vector3, delta: number): void {
    this.camera.position.set(
      damp(this.camera.position.x, wanted.x, this.stiffness, delta),
      damp(this.camera.position.y, wanted.y, this.stiffness, delta),
      damp(this.camera.position.z, wanted.z, this.stiffness, delta),
    );
  }

  /** Apply GameFeel.shake() — offsets the camera without disturbing the rig's own target. */
  applyShake(shake: { x: number; y: number; roll: number }): void {
    this.camera.position.x += shake.x * 0.02;
    this.camera.position.y += shake.y * 0.02;
    this.camera.rotation.z += shake.roll;
  }
}
`;

const WORLD = `import * as THREE from 'three';
import { sharedMaterial, paletteColor, type PaletteName } from './materials';

/**
 * Procedural world building — an environment with no asset library.
 *
 * Terrain is value noise, not \`Math.random\` per vertex: random heights give you television static,
 * while smoothly interpolated noise gives you hills. Everything is SEEDED, so the same world rebuilds
 * identically — required for art direction, for save files, and for reproducing a bug.
 *
 * Scatter uses InstancedMesh. A thousand separate tree meshes is a thousand draw calls and a scene that
 * stutters on a phone; a thousand instances is ONE.
 */
export function makeRng(seed = 1): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; };
}

/** Smooth value noise — the reason terrain looks like hills instead of static. */
export function valueNoise2D(seed = 1) {
  const rng = makeRng(seed);
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) table[i] = rng();
  const at = (x: number, y: number) => table[(((x * 73856093) ^ (y * 19349663)) >>> 0) % 256];
  const smooth = (t: number) => t * t * (3 - 2 * t); // smoothstep
  return (x: number, y: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
}

export interface TerrainOptions {
  size?: number;
  segments?: number;
  amplitude?: number;
  frequency?: number;
  seed?: number;
  palette?: PaletteName;
  flat?: boolean;
}

/** A terrain mesh. flat:true gives a plane — right for a village or a city, where hills fight the buildings. */
export function createTerrain(options: TerrainOptions = {}): THREE.Mesh {
  const size = options.size ?? 200;
  // Segment count is the whole cost of the terrain; 128 is plenty at this size and safe on a phone.
  const segments = Math.min(options.segments ?? 128, 256);
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);

  if (!options.flat) {
    const noise = valueNoise2D(options.seed ?? 1);
    const amp = options.amplitude ?? 6;
    const freq = options.frequency ?? 0.02;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      // Two octaves: a broad shape plus a finer detail pass. One octave looks like rolling blobs.
      const h = noise(x * freq, z * freq) * amp + noise(x * freq * 3.7, z * freq * 3.7) * amp * 0.25;
      pos.setY(i, h);
    }
    pos.needsUpdate = true;
    // Without recomputed normals the lighting is flat and the hills are invisible.
    geo.computeVertexNormals();
  }

  const mesh = new THREE.Mesh(geo, sharedMaterial('ground', paletteColor(options.palette ?? 'indianVillage', 4)));
  mesh.receiveShadow = true;
  return mesh;
}

export interface ScatterOptions {
  count?: number;
  area?: number;
  seed?: number;
  minScale?: number;
  maxScale?: number;
  /** Return false to reject a position — keep props off roads and out of the play space. */
  accept?: (x: number, z: number) => boolean;
  heightAt?: (x: number, z: number) => number;
}

/**
 * Scatter one geometry many times as a SINGLE draw call.
 *
 * accept() matters more than it looks: unconditional scatter puts trees through buildings and rocks in
 * the middle of the road, which is the tell of a procedurally generated world nobody art-directed.
 */
export function scatterInstances(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  options: ScatterOptions = {},
): THREE.InstancedMesh {
  const count = Math.max(0, Math.min(options.count ?? 200, 5000));
  const area = options.area ?? 180;
  const rng = makeRng(options.seed ?? 7);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();

  let placed = 0;
  let attempts = 0;
  // Bounded attempts: a strict accept() with no cap would spin forever on a full map.
  while (placed < count && attempts < count * 12) {
    attempts++;
    const x = (rng() - 0.5) * area;
    const z = (rng() - 0.5) * area;
    if (options.accept && !options.accept(x, z)) continue;
    const y = options.heightAt ? options.heightAt(x, z) : 0;
    const s = (options.minScale ?? 0.8) + rng() * ((options.maxScale ?? 1.4) - (options.minScale ?? 0.8));
    pos.set(x, y, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
    scale.set(s, s * (0.9 + rng() * 0.3), s);
    m.compose(pos, q, scale);
    mesh.setMatrixAt(placed++, m);
  }
  mesh.count = placed; // never draw uninitialised instances — they render at the origin as a spike
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A low-poly tree — cone on a cylinder. Simple ON PURPOSE: it reads as a style, not as a shortfall. */
export function treeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.16, 0.22, 1.6, 6);
  trunk.translate(0, 0.8, 0);
  const crown = new THREE.ConeGeometry(1.1, 2.6, 7);
  crown.translate(0, 2.6, 0);
  return mergeGeometries([trunk, crown]);
}

/** A simple building block — the unit an Indian village or a town street is composed from. */
export function buildingGeometry(width = 4, height = 3, depth = 4): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(width, height, depth);
  base.translate(0, height / 2, 0);
  const roof = new THREE.ConeGeometry(Math.max(width, depth) * 0.78, height * 0.5, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, height + height * 0.25, 0);
  return mergeGeometries([base, roof]);
}

/** Merge without pulling in BufferGeometryUtils — keeps the generated app's import surface small. */
function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  for (const g of list) {
    const nonIndexed = g.index ? g.toNonIndexed() : g;
    const p = nonIndexed.attributes.position.array as ArrayLike<number>;
    const n = nonIndexed.attributes.normal.array as ArrayLike<number>;
    for (let i = 0; i < p.length; i++) positions.push(p[i]);
    for (let i = 0; i < n.length; i++) normals.push(n[i]);
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return merged;
}
`;

const FILES: Record<string, string> = {
  'src/game/three/renderer.ts': RENDERER,
  'src/game/three/lighting.ts': LIGHTING,
  'src/game/three/materials.ts': MATERIALS,
  'src/game/three/camera.ts': CAMERA,
  'src/game/three/world.ts': WORLD,
};

export const GAME_3D_MODULES: readonly string[] = ['renderer', 'lighting', 'materials', 'camera', 'world'];

/**
 * Generate the 3D layer. `include` filters by module; default = all. `world` imports `materials` and
 * `camera` imports the runtime's `feel`, so dependencies are pulled in rather than emitting a file that
 * cannot compile. Pure; never throws.
 */
export function generateGame3D(include?: string[]): Game3DResult {
  const wanted = Array.isArray(include) && include.length
    ? new Set(include.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))
    : null;

  let files: Record<string, string>;
  if (!wanted) {
    files = { ...FILES };
  } else {
    files = {};
    for (const [path, content] of Object.entries(FILES)) {
      const base = (path.split('/').pop() || '').replace(/\.ts$/i, '').toLowerCase();
      if (wanted.has(base)) files[path] = content;
    }
    if (files['src/game/three/world.ts']) files['src/game/three/materials.ts'] = FILES['src/game/three/materials.ts'];
    if (Object.keys(files).length === 0) files = { ...FILES };
  }

  return {
    files,
    // The ONLY dependency the whole game stack takes, and only when 3D is actually used.
    dependencies: [{ name: 'three', version: '^0.180.0' }],
    instructions:
      `Added the 3D layer (${Object.keys(files).length} files under src/game/three). Install: three (+ @types/three).\n` +
      '```ts\n' +
      "const renderer = createRenderer({ canvas });\n" +
      "const scene = new THREE.Scene();\n" +
      "const { key } = applyLighting(scene, renderer, 'sunset');\n" +
      "const rig = new CameraRig({ kind: 'third-person', collidables: [terrain, buildings] });\n" +
      "scene.add(createTerrain({ palette: 'indianVillage' }));\n" +
      "scene.add(scatterInstances(treeGeometry(), sharedMaterial('foliage', paletteColor('forest', 1)), { count: 400 }));\n" +
      '```\n' +
      'WHAT ACTUALLY MAKES IT LOOK GOOD — do not skip these:\n' +
      '- createRenderer already sets sRGB output + ACES tone mapping. Without them a scene is washed out\n' +
      '  or blown out, and no amount of modelling fixes it.\n' +
      '- Use ONE palette for the whole scene. Per-object colours are what make a world look like a parts bin.\n' +
      '- Share materials (sharedMaterial) and scatter with InstancedMesh — a thousand trees must be ONE draw call.\n' +
      '- Give scatter an accept() so props stay off roads and out of the play space.\n' +
      '- Feed rig.update(playerPos, dt) the FIXED delta, and rig.applyShake(feel.shake()) after it.\n' +
      '- Call followShadow(key, playerPos) on a large map, or shadows blur out as the player walks away.\n' +
      '- Keep bloom subtle if you add post-processing. Heavy bloom is the classic first-WebGL-project tell.',
  };
}
