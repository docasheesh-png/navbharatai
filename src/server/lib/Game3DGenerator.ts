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
export type CameraKind = 'third-person' | 'first-person' | 'top-down' | 'side-scroller' | 'orbit' | 'fixed' | 'chase';

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
  private readonly followPos = new THREE.Vector3();
  private readonly followQuat = new THREE.Quaternion();
  private readonly followFwd = new THREE.Vector3();

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
  setCollidables(list: THREE.Object3D[]): void {
    this.collidables = list;
    // Raycasts read WORLD matrices, which three.js refreshes only when it renders — and the world is
    // built before the first render. Same class as CharacterController.setColliders.
    for (const c of list) c.updateMatrixWorld(true);
  }

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

  /**
   * CHASE — sit BEHIND a vehicle (or any model), whichever way it is pointing, and look past it.
   *
   * 🔴 USE THIS FOR ANYTHING YOU DRIVE OR RIDE, never update(car.position). Every model in objects.ts
   * faces its local +Z (MODEL_FORWARD). update() places the camera from the rig's own yaw, which starts
   * at +Z of the target — that is IN FRONT of a +Z-facing car. Games built that way showed the car's FACE,
   * drove it toward the camera, and every control felt reversed (admin 2026-10-05: "gadi ka front side
   * dikhta hai, jisse button ulte kaam karte hai… backside dikhna chahiye"). follow() reads the object's
   * real heading every frame, so the camera stays at its BACK through every turn, and the rig's yaw is
   * kept in step so camera-relative movement elsewhere still agrees with what is on screen.
   */
  follow(object: THREE.Object3D, delta: number, lookAhead = 4): void {
    object.getWorldPosition(this.followPos);
    object.getWorldQuaternion(this.followQuat);
    const fwd = this.followFwd.set(0, 0, 1).applyQuaternion(this.followQuat);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, 1);
    fwd.normalize();

    const focus = this.followPos.clone();
    focus.y += this.height * 0.5;
    let wanted = this.followPos.clone().addScaledVector(fwd, -this.distance);
    wanted.y += this.height;

    if (this.collidables.length > 0) {
      const dir = wanted.clone().sub(focus);
      const dist = dir.length();
      this.ray.set(focus, dir.normalize());
      this.ray.far = dist;
      const hit = this.ray.intersectObjects(this.collidables, true)[0];
      if (hit) wanted = focus.clone().add(dir.multiplyScalar(Math.max(0.6, hit.distance - 0.3)));
    }

    this.dampTo(wanted, delta);
    const look = this.followPos.clone().addScaledVector(fwd, lookAhead);
    look.y += this.height * 0.35;
    this.camera.lookAt(look);
    // The yaw whose third-person offset (sin yaw, cos yaw) points BEHIND the object: offset = -fwd.
    this.yawAngle = Math.atan2(-fwd.x, -fwd.z);
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
import { surfaceMaterial, enableAO, getDetailLevel, mergeGeometries, type Detail, type SurfaceKind } from './surfaces';

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
  /** Override the tier set with setDetailLevel(). */
  detail?: Detail;
  /** What the ground is made of in the \`real\` tier. Defaults from the palette (grass, sand, …). */
  surface?: SurfaceKind;
}

/** The ground a palette implies: a desert is sand, a village or a forest is grass. */
function groundSurface(palette: PaletteName): SurfaceKind {
  if (palette === 'desert') return 'sand';
  if (palette === 'neon' || palette === 'monochrome') return 'tile';
  return 'grass';
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

  // PATCHES. A field is never one green: broad, soft light-and-dark patches (two octaves of the same
  // noise) are what the eye reads as ground rather than a painted board — in BOTH tiers, at no runtime
  // cost (a vertex colour, multiplied in by the GPU).
  const palette = options.palette ?? 'indianVillage';
  const patch = valueNoise2D((options.seed ?? 1) + 101);
  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), z = posAttr.getZ(i);
    const n = patch(x * 0.035, z * 0.035) * 0.7 + patch(x * 0.12, z * 0.12) * 0.3; // 0..1
    const k = 0.82 + n * 0.3; // 0.82..1.12 — visible, never blotchy
    colors[i * 3] = k; colors[i * 3 + 1] = k; colors[i * 3 + 2] = k * 0.97;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // 🔴 THE REAL TIER IS TEXTURED. This used to be a flat palette colour in every tier, so after
  // setDetailLevel('real') the car, the road and the trees were textured and the ground under all of
  // them — the largest thing on screen — was not. One texel per ~3 m reads as grass, not as a pattern.
  const detail = options.detail ?? getDetailLevel();
  let material: THREE.Material;
  if (detail === 'real') {
    const m = surfaceMaterial(options.surface ?? groundSurface(palette), { repeat: Math.max(8, Math.round(size / 3)) });
    m.vertexColors = true;
    enableAO(geo);
    material = m;
  } else {
    const base = sharedMaterial('ground', paletteColor(palette, 4)) as THREE.MeshStandardMaterial;
    const m = base.clone(); // its own copy: vertexColors on the SHARED material would tint everything else
    m.vertexColors = true;
    material = m;
  }
  const mesh = new THREE.Mesh(geo, material);
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
`;

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// SURFACES — the reason "realistic" scenes still looked like coloured cardboard (admin 2026-08-26).
//
// The lighting in this file was already right: sRGB output, ACES tone mapping, a three-light rig with
// a fitted shadow camera. And a realistic-3D request STILL came back looking flat, which is the
// interesting part — correct lighting on featureless geometry is exactly what "not so realistic"
// looks like. `makeMaterial` gave every surface ONE FLAT COLOUR: no normal map, no roughness
// variation, no ambient occlusion. A brick wall was a solid brown rectangle. Light it perfectly and
// it is still a solid brown rectangle.
//
// So this module makes surfaces, not settings. Every map is generated on a canvas at runtime from
// seeded noise — no downloads, no licences, no CDN that can move, nothing to 404 in a published app.
//
// 🔒 COLOUR SPACE IS THE TRAP HERE, and getting it backwards is worse than having no maps at all.
// A COLOUR map is sRGB data; a NORMAL/ROUGHNESS/AO map is raw numbers that must NOT be gamma-decoded.
// Tag them all sRGB (the easy mistake) and normals push the wrong way and roughness goes glossy —
// a scene that looks worse than the flat colours it replaced.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const SURFACES = `import * as THREE from 'three';

export type Detail = 'real' | 'lite';

/**
 * The tier every builder uses when not told otherwise. Set ONCE at start-up from what the user asked
 * for — the game should not be deciding this per object.
 *
 * It lives HERE, in the module every textured thing already imports, so the ground (world.ts) and the
 * objects (objects.ts) read ONE setting. It used to live in objects.ts, which world.ts never imported —
 * so after setDetailLevel('real') every car, tree and road was textured and the ground under them stayed
 * a flat colour, the exact "flat colour" the realism checklist forbids.
 */
let DEFAULT_DETAIL: Detail = 'lite';
export function setDetailLevel(detail: Detail): void { DEFAULT_DETAIL = detail; }
export function getDetailLevel(): Detail { return DEFAULT_DETAIL; }

export type SurfaceKind =
  | 'brick' | 'plaster' | 'wood' | 'bark' | 'stone' | 'asphalt'
  | 'soil' | 'grass' | 'metal' | 'fabric' | 'tile' | 'sand';

export interface SurfaceMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  aoMap: THREE.Texture;
}

/** Deterministic value noise — the same seed rebuilds the same wall, so a scene is reproducible. */
function makeRng(seed: number): () => number {
  let t = (seed >>> 0) || 1;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Value noise that TILES. 🔴 The lattice used to be (cells + 1)² independent values, so the last row and
 * column were unrelated to the first — every texture built on it had a hard seam at its edge, and since
 * every surface is drawn REPEATED (grass ×100 across a field, plaster ×2 across a wall), that seam
 * became a visible grid of squares over the whole scene (seen in a real render, 2026-10-05). The lattice
 * now wraps (the cell after the last is the first), so the right edge continues into the left exactly.
 */
function smoothNoise(size: number, cells: number, rng: () => number): Float32Array {
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const out = new Float32Array(size * size);
  const step = size / cells;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = x / step, gy = y / step;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const fx = gx - x0, fy = gy - y0;
      // Smoothstep, so cell boundaries do not show as a visible grid.
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const xa = x0 % cells, xb = (x0 + 1) % cells, ya = y0 % cells, yb = (y0 + 1) % cells;
      const a = grid[ya * cells + xa];
      const b = grid[ya * cells + xb];
      const c = grid[yb * cells + xa];
      const d = grid[yb * cells + xb];
      out[y * size + x] = (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
    }
  }
  return out;
}

/** Several octaves of noise — one octave is a blur, several is a material. */
function fbm(size: number, seed: number, octaves = 4): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0, cells = 4;
  for (let o = 0; o < octaves; o++) {
    const layer = smoothNoise(size, cells, makeRng(seed + o * 7919));
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp;
    total += amp;
    amp *= 0.5;
    cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function canvasOf(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return { canvas, ctx };
}

/**
 * A height field per surface kind. Everything else — colour, normal, roughness, AO — is derived from
 * this ONE field, which is why the maps agree with each other: a mortar groove is dark in the colour
 * map, dented in the normal map, rougher, and occluded, all from the same number.
 */
function heightField(kind: SurfaceKind, size: number, seed: number): Float32Array {
  const h = fbm(size, seed, kind === 'plaster' || kind === 'fabric' ? 5 : 4);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let v = h[i];
      if (kind === 'brick' || kind === 'tile') {
        // Courses of bricks with staggered joints; the groove is what the eye actually reads.
        const rowH = size / 8;
        const row = Math.floor(y / rowH);
        const offset = kind === 'brick' && row % 2 === 1 ? size / 16 : 0;
        const colW = size / 8;
        const inRow = ((x + offset) % colW) / colW;
        const inCol = (y % rowH) / rowH;
        const joint = Math.min(inRow, 1 - inRow, inCol, 1 - inCol);
        v = v * 0.35 + (joint < 0.06 ? 0 : 0.85);
      } else if (kind === 'wood' || kind === 'bark') {
        // Grain: rings along one axis, warped by noise so it is not a barcode.
        const warp = h[i] * (kind === 'bark' ? 26 : 9);
        const rings = Math.sin((x / size) * Math.PI * (kind === 'bark' ? 30 : 14) + warp);
        v = 0.5 + rings * (kind === 'bark' ? 0.42 : 0.22);
      } else if (kind === 'asphalt' || kind === 'stone' || kind === 'soil') {
        v = Math.pow(v, kind === 'asphalt' ? 1.6 : 1.2);
      } else if (kind === 'grass') {
        v = v * 0.6 + (h[(y * size + ((x * 7) % size))] * 0.4);
      } else if (kind === 'metal') {
        // Brushed: stretched along one axis so highlights streak the way metal does.
        v = h[y * size + ((x / 6) | 0)] * 0.8 + v * 0.2;
      } else if (kind === 'fabric') {
        const weave = (Math.sin((x / size) * Math.PI * 90) + Math.sin((y / size) * Math.PI * 90)) * 0.25;
        v = 0.5 + weave * 0.5 * (0.6 + v * 0.4);
      }
      out[i] = Math.max(0, Math.min(1, v));
    }
  }
  return out;
}

/** Per-kind look: the two base colours the height field mixes between, and the roughness window. */
const SURFACE_LOOK: Record<SurfaceKind, { low: [number, number, number]; high: [number, number, number]; rough: [number, number]; metal: number; bump: number }> = {
  brick:   { low: [96, 84, 78],   high: [166, 84, 62],  rough: [0.72, 0.95], metal: 0,   bump: 1.4 },
  plaster: { low: [196, 190, 178], high: [232, 228, 216], rough: [0.82, 0.96], metal: 0,  bump: 0.5 },
  wood:    { low: [92, 60, 32],   high: [162, 112, 62], rough: [0.5, 0.78],  metal: 0,   bump: 0.7 },
  bark:    { low: [48, 36, 24],   high: [104, 82, 56],  rough: [0.85, 1.0],  metal: 0,   bump: 1.8 },
  stone:   { low: [92, 92, 88],   high: [156, 154, 146], rough: [0.7, 0.94], metal: 0,   bump: 1.2 },
  asphalt: { low: [38, 38, 40],   high: [78, 78, 82],   rough: [0.78, 0.98], metal: 0,   bump: 0.9 },
  soil:    { low: [58, 42, 28],   high: [122, 94, 62],  rough: [0.88, 1.0],  metal: 0,   bump: 1.1 },
  grass:   { low: [42, 72, 32],   high: [104, 148, 62], rough: [0.85, 1.0],  metal: 0,   bump: 0.8 },
  metal:   { low: [104, 108, 114], high: [188, 194, 202], rough: [0.18, 0.45], metal: 1, bump: 0.35 },
  fabric:  { low: [72, 68, 92],   high: [132, 126, 158], rough: [0.9, 1.0],   metal: 0,  bump: 0.5 },
  tile:    { low: [188, 192, 196], high: [236, 240, 244], rough: [0.12, 0.4], metal: 0,  bump: 0.8 },
  sand:    { low: [166, 136, 90], high: [226, 200, 152], rough: [0.86, 1.0],  metal: 0,  bump: 0.6 },
};

function textureFromRGB(size: number, write: (i: number, px: Uint8ClampedArray, o: number) => void, srgb: boolean): THREE.Texture {
  const { canvas, ctx } = canvasOf(size);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) write(i, img.data, i * 4);
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // 🔒 THE COLOUR-SPACE RULE. Only the COLOUR map is sRGB. Normal/roughness/AO are raw numbers, and
  // gamma-decoding them pushes normals the wrong way and turns rough surfaces glossy.
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Build the full PBR map set for a surface. Cached by kind+seed+size: a scene with forty brick walls
 * must generate the brick maps ONCE, or texture memory and startup time both multiply by forty.
 */
const surfaceCache = new Map<string, SurfaceMaps>();

export function surfaceMaps(kind: SurfaceKind, opts: { seed?: number; size?: number } = {}): SurfaceMaps {
  const size = opts.size ?? 256;
  const seed = opts.seed ?? 1337;
  const cacheKey = kind + ':' + seed + ':' + size;
  const hit = surfaceCache.get(cacheKey);
  if (hit) return hit;

  const look = SURFACE_LOOK[kind] ?? SURFACE_LOOK.stone;
  const h = heightField(kind, size, seed);

  const map = textureFromRGB(size, (i, px, o) => {
    const t = h[i];
    px[o] = look.low[0] + (look.high[0] - look.low[0]) * t;
    px[o + 1] = look.low[1] + (look.high[1] - look.low[1]) * t;
    px[o + 2] = look.low[2] + (look.high[2] - look.low[2]) * t;
    px[o + 3] = 255;
  }, true);

  // Normals by central difference on the height field — the standard, and cheap.
  const normalMap = textureFromRGB(size, (i, px, o) => {
    const x = i % size, y = (i / size) | 0;
    const at = (xx: number, yy: number) => h[((yy + size) % size) * size + ((xx + size) % size)];
    const dx = (at(x + 1, y) - at(x - 1, y)) * look.bump;
    const dy = (at(x, y + 1) - at(x, y - 1)) * look.bump;
    let nx = -dx, ny = -dy, nz = 1;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len; ny /= len; nz /= len;
    px[o] = (nx * 0.5 + 0.5) * 255;
    px[o + 1] = (ny * 0.5 + 0.5) * 255;
    px[o + 2] = (nz * 0.5 + 0.5) * 255;
    px[o + 3] = 255;
  }, false);

  const roughnessMap = textureFromRGB(size, (i, px, o) => {
    const r = look.rough[0] + (look.rough[1] - look.rough[0]) * (1 - h[i]);
    const v = r * 255;
    px[o] = v; px[o + 1] = v; px[o + 2] = v; px[o + 3] = 255;
  }, false);

  // Cheap AO: low points in the height field sit in their own shadow. Not a ray trace, but it is what
  // stops a mortar groove reading as a painted line.
  const aoMap = textureFromRGB(size, (i, px, o) => {
    const v = (0.55 + 0.45 * h[i]) * 255;
    px[o] = v; px[o + 1] = v; px[o + 2] = v; px[o + 3] = 255;
  }, false);

  const maps: SurfaceMaps = { map, normalMap, roughnessMap, aoMap };
  surfaceCache.set(cacheKey, maps);
  return maps;
}

/**
 * A ready PBR material for a surface. \`repeat\` is in tiles across the face — a wall wants more
 * repeats than a pebble, and one setting for everything is what makes textures look pasted on.
 *
 * ⚠️ aoMap needs a SECOND uv set. Geometry that has none gets no AO rather than a broken lookup, so
 * call \`enableAO(geometry)\` on anything you want occlusion on.
 */
export function surfaceMaterial(
  kind: SurfaceKind,
  opts: { color?: number; repeat?: number; seed?: number; size?: number } = {},
): THREE.MeshStandardMaterial {
  const repeat = opts.repeat ?? 4;
  const maps = repeatedMaps(kind, repeat, opts);
  const look = SURFACE_LOOK[kind] ?? SURFACE_LOOK.stone;
  return new THREE.MeshStandardMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    roughnessMap: maps.roughnessMap,
    aoMap: maps.aoMap,
    aoMapIntensity: 0.85,
    metalness: look.metal,
    roughness: 1,
    ...(opts.color !== undefined ? { color: opts.color } : {}),
  });
}

/**
 * The maps at ONE repeat. 🔴 \`repeat\` used to be set on the CACHED textures themselves, so every
 * material of a kind shared one repeat — whichever was asked for LAST. A road (asphalt ×40) followed by
 * anything else asphalt (×4) silently rescaled the road's grain tenfold. A clone shares the image (no
 * new pixels are generated or uploaded twice) and owns its own repeat.
 */
const repeatCache = new Map<string, SurfaceMaps>();
function repeatedMaps(kind: SurfaceKind, repeat: number, opts: { seed?: number; size?: number }): SurfaceMaps {
  const key = kind + ':' + (opts.seed ?? '') + ':' + (opts.size ?? '') + ':' + repeat;
  let maps = repeatCache.get(key);
  if (!maps) {
    const base = surfaceMaps(kind, { seed: opts.seed, size: opts.size });
    const at = (t: THREE.Texture) => { const c = t.clone(); c.repeat.set(repeat, repeat); c.needsUpdate = true; return c; };
    maps = { map: at(base.map), normalMap: at(base.normalMap), roughnessMap: at(base.roughnessMap), aoMap: at(base.aoMap) };
    repeatCache.set(key, maps);
  }
  return maps;
}

/** Copy uv → uv2 so aoMap works. three.js reads AO from the second uv set and silently ignores it otherwise. */
export function enableAO(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const uv = geometry.getAttribute('uv');
  if (uv && !geometry.getAttribute('uv2')) geometry.setAttribute('uv2', uv.clone());
  return geometry;
}

/**
 * THE ONE MERGE for every 3D module (world, objects, humanoid) — without pulling in BufferGeometryUtils,
 * which keeps the generated app's import surface small. A Mesh in the list is merged AT ITS POSE (its
 * position/rotation/scale are applied to its vertices), so small details that share a material become
 * one mesh: one draw call instead of one each, which is what keeps a scene of ten cars smooth on a phone.
 *
 * 🔴 UVs TRAVEL WITH THE MESH. An earlier copy of this copied only positions and normals, so every merged
 * shape came out with NO uv set: a brick or plaster surfaceMaterial then had nothing to map its texture
 * with and rendered as one flat colour, and enableAO() (which copies uv) silently did nothing. A part
 * without uvs gets zeros rather than shifting the rest.
 */
export function mergeGeometries(list: Array<THREE.BufferGeometry | THREE.Mesh>): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (const item of list) {
    let g: THREE.BufferGeometry;
    if ((item as THREE.Mesh).isMesh) {
      const m = item as THREE.Mesh;
      m.updateMatrix();
      g = m.geometry.clone().applyMatrix4(m.matrix);
    } else {
      g = item as THREE.BufferGeometry;
    }
    const flat = g.index ? g.toNonIndexed() : g;
    const p = flat.attributes.position.array as ArrayLike<number>;
    const n = flat.attributes.normal.array as ArrayLike<number>;
    const uv = flat.attributes.uv?.array as ArrayLike<number> | undefined;
    for (let i = 0; i < p.length; i++) positions.push(p[i]);
    for (let i = 0; i < n.length; i++) normals.push(n[i]);
    const vertices = p.length / 3;
    for (let i = 0; i < vertices * 2; i++) uvs.push(uv ? uv[i] : 0);
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return merged;
}
`;

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT — why "realistic metal" came out looking like grey plastic (admin 2026-08-26).
//
// A PBR material is mostly a description of what it REFLECTS. With `metalness: 1` and no environment,
// a metal surface has nothing to reflect and renders near-black or dead grey; glass has nothing to
// refract; every glossy thing looks like painted plastic. The materials in this file were already
// physically correct — they were being asked to reflect an empty room.
//
// This builds a real image-based light from a procedural sky (no HDRI download, no CDN, nothing to
// 404 in a published app) and hands it to the scene. It is the single change that improves EVERY
// material in EVERY scene at once, which is why it is worth its ~100 lines.
//
// 🔒 PMREM IS EXPENSIVE AND MUST BE DISPOSED. Generating it every frame — or per material — is the
// classic leak that turns a smooth scene into a stutter after two minutes. It is generated ONCE per
// preset and cached, and `disposeEnvironment()` exists so a scene teardown can actually free it.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const ENVIRONMENT = `import * as THREE from 'three';

export type SkyPreset = 'day' | 'sunset' | 'night' | 'overcast' | 'horror' | 'desert' | 'forest' | 'underwater' | 'neon';

interface SkyLook { top: number; horizon: number; ground: number; sun: number; sunSize: number; sunStrength: number }

/** Sky colours per preset, matched to the lighting presets so the reflections agree with the lights. */
const SKY: Record<SkyPreset, SkyLook> = {
  day:        { top: 0x2f6ecb, horizon: 0xbfd9f2, ground: 0x6b5a3e, sun: 0xfff6e0, sunSize: 0.035, sunStrength: 9 },
  sunset:     { top: 0x2a2b6b, horizon: 0xff9a56, ground: 0x3a2418, sun: 0xff7b3d, sunSize: 0.06,  sunStrength: 7 },
  night:      { top: 0x030614, horizon: 0x16233d, ground: 0x05070d, sun: 0xaac4ff, sunSize: 0.02,  sunStrength: 1.2 },
  overcast:   { top: 0x9aa7b4, horizon: 0xd4dce4, ground: 0x6e6a62, sun: 0xdfe6ee, sunSize: 0.25,  sunStrength: 1.6 },
  horror:     { top: 0x020306, horizon: 0x0b1018, ground: 0x000000, sun: 0x8fa8c8, sunSize: 0.02,  sunStrength: 0.6 },
  desert:     { top: 0x4a86c8, horizon: 0xf2d6a2, ground: 0xa87d4a, sun: 0xfff1cf, sunSize: 0.03,  sunStrength: 11 },
  forest:     { top: 0x3d6b8a, horizon: 0x9dc48a, ground: 0x2f3d22, sun: 0xe8f5c8, sunSize: 0.05,  sunStrength: 5 },
  underwater: { top: 0x04202e, horizon: 0x1e6f92, ground: 0x02141d, sun: 0x7fd4f0, sunSize: 0.12,  sunStrength: 2.5 },
  neon:       { top: 0x0a0416, horizon: 0x3a1a6b, ground: 0x0a0416, sun: 0xff3fb4, sunSize: 0.08,  sunStrength: 3 },
};

/**
 * A sky dome drawn in a shader — a vertical gradient plus a sun disc. Rendered from the INSIDE
 * (BackSide) and unlit, so it is the light source rather than something the lights have to reach.
 */
function skyScene(look: SkyLook, sunDirection: THREE.Vector3): THREE.Scene {
  const scene = new THREE.Scene();
  const geometry = new THREE.SphereGeometry(100, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(look.top) },
      uHorizon: { value: new THREE.Color(look.horizon) },
      uGround: { value: new THREE.Color(look.ground) },
      uSun: { value: new THREE.Color(look.sun) },
      uSunDir: { value: sunDirection.clone().normalize() },
      uSunSize: { value: look.sunSize },
      uSunStrength: { value: look.sunStrength },
    },
    vertexShader: [
      'varying vec3 vDir;',
      'void main() {',
      '  vDir = normalize(position);',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\\n'),
    fragmentShader: [
      'uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSun;',
      'uniform vec3 uSunDir; uniform float uSunSize; uniform float uSunStrength;',
      'varying vec3 vDir;',
      'void main() {',
      '  vec3 d = normalize(vDir);',
      '  float h = d.y;',
      // Above the horizon: horizon → top. Below: horizon → ground. A hard split reads as a seam,
      // so both sides ease with a power curve.
      '  vec3 sky = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55))',
      '                     : mix(uHorizon, uGround, pow(clamp(-h, 0.0, 1.0), 0.4));',
      '  float sun = pow(max(dot(d, normalize(uSunDir)), 0.0), 1.0 / max(uSunSize, 0.001));',
      '  gl_FragColor = vec4(sky + uSun * sun * uSunStrength, 1.0);',
      '}',
    ].join('\\n'),
  });
  scene.add(new THREE.Mesh(geometry, material));
  return scene;
}

const envCache = new Map<string, THREE.Texture>();

export interface EnvironmentOptions {
  /** Also paint the sky as the scene background, not just as reflections. Default true. */
  asBackground?: boolean;
  /** Where the sun is, so reflections agree with the key light. Pass the same vector you lit with. */
  sunDirection?: THREE.Vector3;
}

/**
 * Give the scene a real image-based light. Returns the environment texture (already assigned).
 *
 * Call this ONCE per scene, AFTER the renderer exists. Every MeshStandardMaterial/MeshPhysicalMaterial
 * in the scene picks it up automatically — no per-material wiring, which is exactly why this is the
 * cheapest large visual win available.
 */
export function applyEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  preset: SkyPreset = 'day',
  options: EnvironmentOptions = {},
): THREE.Texture {
  const look = SKY[preset] ?? SKY.day;
  const sunDirection = options.sunDirection ?? new THREE.Vector3(0.5, 0.75, 0.35);
  const cacheKey = preset + ':' + sunDirection.toArray().map((n) => n.toFixed(2)).join(',');

  let texture = envCache.get(cacheKey);
  if (!texture) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const sky = skyScene(look, sunDirection);
    texture = pmrem.fromScene(sky, 0.04).texture;
    // The temporary sky scene has done its job; its geometry and shader are not needed again.
    sky.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material as THREE.Material | undefined;
      if (m && typeof m.dispose === 'function') m.dispose();
    });
    pmrem.dispose();
    envCache.set(cacheKey, texture);
  }

  scene.environment = texture;
  if (options.asBackground !== false) scene.background = texture;
  return texture;
}

/** Free every cached environment. Call on teardown — PMREM textures are large and do not GC themselves. */
export function disposeEnvironment(): void {
  for (const t of envCache.values()) t.dispose();
  envCache.clear();
}

/**
 * How strongly the environment lights the scene. 1 is physically neutral; below 1 for a scene that
 * should feel enclosed (an interior, a horror level), above 1 only for a deliberately airy look.
 */
export function setEnvironmentIntensity(scene: THREE.Scene, intensity: number): void {
  scene.environmentIntensity = Math.max(0, intensity);
}
`;

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// HUMANOID — the capsule problem (admin 2026-08-26: the character in a "realistic" game was a shape).
//
// 🔒 THE HONEST BOUNDARY, STATED IN CODE SO NOBODY OVERSELLS IT. There is no way to turn a text
// prompt into a photorealistic rigged human here — that needs scanned assets, and inventing one would
// be exactly the fake feature this codebase forbids. What IS achievable, and is a large visible jump
// from a capsule, is a correctly PROPORTIONED, correctly JOINTED figure that moves like a body:
// segmented limbs on a real hierarchy, driven by procedural locomotion. Stylised, not photoreal —
// and it reads as a character rather than a shape.
//
// PROPORTION IS THE WHOLE TRICK. Bodies are read by ratio, not detail: head ≈ 1/7.5 of height, arm
// span ≈ height, elbow at the waist, knee at mid-thigh-to-floor. Get them wrong with a beautiful mesh
// and it reads as a toy. Proportion is necessary but NOT sufficient: built from plain boxes, even the
// right ratios read as stacked blocks (Phase 2, 2026-10-05 — the admin's "FAIL" bar). So the parts are
// rounded and tapered too; see createHumanoid.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const HUMANOID = `import * as THREE from 'three';
import { mergeGeometries } from './surfaces';

export interface HumanoidOptions {
  /** Total height in world units. Everything else is derived from it. Default 1.8 (an adult). */
  height?: number;
  skin?: number;
  shirt?: number;
  trousers?: number;
  shoes?: number;
  hair?: number;
  /** Slimmer or heavier build. 1 is average; 0.85 slight, 1.2 heavy. */
  build?: number;
}

export interface Humanoid {
  root: THREE.Group;
  /** Named joints, so gameplay code can aim a head or raise an arm without hunting the hierarchy. */
  joints: {
    hips: THREE.Group; spine: THREE.Group; chest: THREE.Group; neck: THREE.Group; head: THREE.Group;
    leftShoulder: THREE.Group; leftElbow: THREE.Group;
    rightShoulder: THREE.Group; rightElbow: THREE.Group;
    leftHip: THREE.Group; leftKnee: THREE.Group;
    rightHip: THREE.Group; rightKnee: THREE.Group;
  };
  /** Drive the pose. dt in seconds; speed in world units/second; grounded false while airborne. */
  update: (dt: number, speed: number, grounded?: boolean) => void;
  dispose: () => void;
}

/**
 * A rounded limb segment hanging DOWN from its joint at y = 0: a lathed capsule that tapers from r0 at
 * the joint to r1 at the far end. The joint at the top is what makes a rotated group swing the limb from
 * the shoulder or hip instead of from its middle — the difference between a walk and a puppet flailing.
 * Rounded and tapered is the difference between an arm and a stack of blocks.
 */
function segment(r0: number, r1: number, length: number, material: THREE.Material, radial = 12): THREE.Mesh {
  const pts: THREE.Vector2[] = [];
  const cap = 5;
  // Caps are held to 45% of the length each, so a short thick piece can never fold through itself.
  const h0 = Math.min(r0, length * 0.45), h1 = Math.min(r1, length * 0.45);
  for (let i = 0; i <= cap; i++) {                     // the far end's rounded cap, from its pole up
    const a = -Math.PI / 2 + (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r1, -length + h1 + Math.sin(a) * h1));
  }
  for (let i = 0; i <= cap; i++) {                     // the joint end's cap, up to its pole
    const a = (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r0, -h0 + Math.sin(a) * h0));
  }
  pts[0].x = 0; pts[pts.length - 1].x = 0;
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, radial), material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** An ellipsoid: heads, hands, shoulders, the pelvis. */
function blob(rx: number, ry: number, rz: number, material: THREE.Material, w = 14, h = 10): THREE.Mesh {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Build a proportioned, jointed figure. Pure geometry + groups — no loaders, no network, so it can
 * never fail to arrive.
 *
 * 🔒 ROUNDED ANATOMY, NOT BLOCKS (admin 2026-10-05, Phase 2: "if the human still looks like stacked
 * blocks: FAIL"). Every part is a lathed or ellipsoid shape: a torso that narrows at the waist and widens
 * at the chest, flattened front-to-back; tapered capsule limbs; round shoulders, hands, a head with ears,
 * eyes, a nose and a hair cap; shoes with a heel and a toe. The joints and the gait are unchanged.
 */
export function createHumanoid(options: HumanoidOptions = {}): Humanoid {
  const H = options.height ?? 1.8;
  const build = options.build ?? 1;
  const disposables: Array<{ dispose: () => void }> = [];

  const mat = (color: number, roughness: number) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    disposables.push(m);
    return m;
  };
  const skinM = mat(options.skin ?? 0xc99a6b, 0.72);
  const shirtM = mat(options.shirt ?? 0x35506b, 0.86);
  const trouserM = mat(options.trousers ?? 0x2a2f3a, 0.9);
  const shoeM = mat(options.shoes ?? 0x14161a, 0.7);
  const hairM = mat(options.hair ?? 0x1b1410, 0.85);
  const eyeM = mat(0x1a1410, 0.4);
  const keep = <T extends THREE.Mesh>(m: T): T => { disposables.push(m.geometry); return m; };
  // Parts of one joint that share a material become ONE mesh (one draw call): a crowd of figures at
  // ~16 draw calls each instead of ~27 is the difference on a phone.
  const baked = (parts: THREE.Mesh[], material: THREE.Material): THREE.Mesh => {
    const m = keep(new THREE.Mesh(mergeGeometries(parts), material));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  // The ratios. These numbers are the character. torsoH is crotch → base of the neck: with the neck
  // and the head on top it lands the crown at H (it was 0.30·H, which left a 1.8 m figure 1.66 m tall).
  const headH = H / 7.5;
  const legH = H * 0.47;
  const thighH = legH * 0.52;
  const shinH = legH - thighH;
  const torsoH = H * 0.35;
  const neckLen = headH * 0.18;
  const armH = H * 0.44;
  const upperArmH = armH * 0.47;
  const foreArmH = armH - upperArmH;
  const shoulderW = H * 0.115 * build;
  const hipW = H * 0.085 * build;
  const limbT = H * 0.055 * build;

  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = legH;
  root.add(hips);

  const spine = new THREE.Group();
  hips.add(spine);
  const chest = new THREE.Group();
  chest.position.y = torsoH * 0.55;
  spine.add(chest);

  // Torso: lathed from a side profile — hips, a narrower waist, a broad chest, sloping shoulders into
  // the neck — then flattened front-to-back, because a body is not round.
  const t = torsoH;
  const torsoProfile = [
    [0, -0.6 * t], [hipW * 1.42, -0.58 * t], [hipW * 1.5, -0.45 * t], [shoulderW * 0.68, -0.12 * t],
    [shoulderW * 0.78, 0.1 * t], [shoulderW * 0.84, 0.28 * t], [shoulderW * 0.8, 0.4 * t],
    [shoulderW * 0.5, 0.48 * t], [headH * 0.2, 0.51 * t], [0, 0.52 * t],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torsoGeo = new THREE.LatheGeometry(torsoProfile, 18);
  torsoGeo.scale(1, 1, 0.58);
  const torso = keep(new THREE.Mesh(torsoGeo, shirtM));
  torso.castShadow = true;
  torso.receiveShadow = true;
  chest.add(torso);
  // Pelvis in the trouser colour, so the legs grow out of a body rather than out of the shirt hem.
  const pelvis = keep(blob(hipW * 1.42, t * 0.15, hipW * 0.95, trouserM));
  pelvis.position.y = -0.02 * H;
  hips.add(pelvis);

  const neck = new THREE.Group();
  neck.position.y = torsoH * 0.5;
  chest.add(neck);
  const neckMesh = keep(segment(headH * 0.18, headH * 0.2, headH * 0.5, skinM, 10));
  neckMesh.position.y = neckLen + headH * 0.32;
  neck.add(neckMesh);
  const head = new THREE.Group();
  head.position.y = neckLen;       // a visible neck: the head sits ON it, not sunk into the shoulders
  neck.add(head);

  // Head: an egg, wider at the cranium than the jaw, deeper than it is wide. Face on +Z.
  const hw = headH * 0.38, hh = headH * 0.52, hd = headH * 0.44;
  const skull = blob(hw, hh, hd, skinM, 18, 14);
  skull.position.y = headH * 0.5;
  const jaw = blob(hw * 0.78, hh * 0.46, hd * 0.8, skinM, 14, 8);
  jaw.position.set(0, headH * 0.3, hd * 0.06);
  const nose = blob(hw * 0.13, hh * 0.17, hd * 0.2, skinM, 8, 6);
  nose.position.set(0, headH * 0.47, hd * 0.98);
  const face: THREE.Mesh[] = [skull, jaw, nose];
  const eyes: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const ear = blob(hw * 0.12, hh * 0.22, hd * 0.2, skinM, 8, 6);
    ear.position.set(side * hw * 0.98, headH * 0.5, 0);
    face.push(ear);
    const eye = blob(hw * 0.11, hw * 0.11, hw * 0.06, eyeM, 8, 6);
    eye.position.set(side * hw * 0.38, headH * 0.58, hd * 0.9);
    eyes.push(eye);
  }
  head.add(baked(face, skinM));
  head.add(baked(eyes, eyeM));
  // Hair: a cap over the crown and the back of the head, leaving the face open.
  const hairGeo = new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.56);
  hairGeo.scale(hw * 1.08, hh * 1.04, hd * 1.1);
  const hair = keep(new THREE.Mesh(hairGeo, hairM));
  hair.position.set(0, headH * 0.53, -hd * 0.06);
  hair.rotation.x = -0.32;
  hair.castShadow = true;
  head.add(hair);

  const arm = (side: number) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * shoulderW, torsoH * 0.38, 0);
    chest.add(shoulder);
    const deltoid = blob(limbT * 0.56, limbT * 0.5, limbT * 0.54, shirtM, 12, 8);
    deltoid.position.set(-side * limbT * 0.12, -limbT * 0.08, 0);
    shoulder.add(baked([deltoid, segment(limbT * 0.55, limbT * 0.46, upperArmH + limbT * 0.2, shirtM)], shirtM));
    const elbow = new THREE.Group();
    elbow.position.y = -upperArmH;
    shoulder.add(elbow);
    // A hand: a flattened mitten with a thumb, palm turned in toward the thigh.
    const hand = blob(limbT * 0.3, limbT * 0.62, limbT * 0.45, skinM, 10, 8);
    hand.position.y = -foreArmH - limbT * 0.35;
    const thumb = blob(limbT * 0.13, limbT * 0.28, limbT * 0.13, skinM, 6, 5);
    thumb.position.set(-side * limbT * 0.05, -foreArmH - limbT * 0.2, limbT * 0.32);
    thumb.rotation.x = 0.5;
    elbow.add(baked([segment(limbT * 0.43, limbT * 0.33, foreArmH, skinM), hand, thumb], skinM));
    return { shoulder, elbow };
  };

  const leg = (side: number) => {
    const hip = new THREE.Group();
    hip.position.set(side * hipW, 0, 0);
    hips.add(hip);
    hip.add(keep(segment(limbT * 0.72, limbT * 0.52, thighH + limbT * 0.3, trouserM)));
    const knee = new THREE.Group();
    knee.position.y = -thighH;
    hip.add(knee);
    knee.add(keep(segment(limbT * 0.52, limbT * 0.4, shinH, trouserM)));
    // Shoe: a side profile — heel, low instep, rounded toe — extruded and bevelled. Toe on +Z.
    const fl = limbT * 2.3, fh = limbT * 0.78, fw = limbT * 0.95, fb = limbT * 0.12;
    const shoeShape = new THREE.Shape();
    const sp = [[-0.3, 0], [0.62, 0], [0.74, 0.14], [0.72, 0.36], [0.5, 0.52], [0.12, 0.8], [-0.18, 1], [-0.32, 0.7]];
    shoeShape.moveTo(sp[0][0] * fl, sp[0][1] * fh);
    for (let i = 1; i < sp.length; i++) shoeShape.lineTo(sp[i][0] * fl, sp[i][1] * fh);
    shoeShape.closePath();
    const shoeGeo = new THREE.ExtrudeGeometry(shoeShape, {
      depth: fw - 2 * fb, bevelEnabled: true, bevelThickness: fb, bevelSize: fb, bevelSegments: 2, curveSegments: 1,
    });
    shoeGeo.translate(0, 0, -(fw - 2 * fb) / 2);
    shoeGeo.rotateY(-Math.PI / 2);
    const foot = keep(new THREE.Mesh(shoeGeo, shoeM));
    foot.position.set(0, -shinH - limbT * 0.08 + fb, 0);
    foot.castShadow = true;
    knee.add(foot);
    return { hip, knee };
  };

  const left = arm(-1), right = arm(1);
  const leftLeg = leg(-1), rightLeg = leg(1);

  let phase = 0;
  const update = (dt: number, speed: number, grounded = true) => {
    const moving = speed > 0.05;
    // Stride frequency rises with speed but saturates — a sprint is a faster stride, not a blur.
    const freq = Math.min(2.2 + speed * 0.85, 9);
    phase += dt * (moving ? freq : 2.0);

    const swing = moving ? Math.min(0.42 + speed * 0.06, 0.95) : 0.06;
    const s = Math.sin(phase);
    const c = Math.sin(phase + Math.PI);

    if (!grounded) {
      // Airborne: tuck. A body in the air does not keep walking, which is the tell in most AI games.
      leftLeg.hip.rotation.x = -0.5; rightLeg.hip.rotation.x = 0.25;
      leftLeg.knee.rotation.x = 0.9; rightLeg.knee.rotation.x = 0.4;
      left.shoulder.rotation.x = -1.9; right.shoulder.rotation.x = -1.9;
      left.elbow.rotation.x = -0.3; right.elbow.rotation.x = -0.3;
      return;
    }

    leftLeg.hip.rotation.x = s * swing;
    rightLeg.hip.rotation.x = c * swing;
    // A knee only bends one way. Clamping to >= 0 is what stops the classic backwards-knee look.
    leftLeg.knee.rotation.x = Math.max(0, -s * swing * 1.5);
    rightLeg.knee.rotation.x = Math.max(0, -c * swing * 1.5);

    // Arms swing OPPOSITE the legs — the thing everyone forgets, and the thing that makes it read.
    left.shoulder.rotation.x = c * swing * 0.8;
    right.shoulder.rotation.x = s * swing * 0.8;
    left.elbow.rotation.x = -Math.abs(c) * swing * 0.5 - 0.12;
    right.elbow.rotation.x = -Math.abs(s) * swing * 0.5 - 0.12;

    // Small counter-rotations: the body twists against the stride and bobs twice per cycle. Tiny
    // numbers, and they are most of the difference between "animated" and "alive".
    chest.rotation.y = -s * swing * 0.18;
    hips.rotation.y = s * swing * 0.1;
    hips.position.y = legH + (moving ? Math.abs(Math.sin(phase * 2)) * 0.02 * (1 + speed * 0.1) : Math.sin(phase) * 0.006);
    spine.rotation.x = moving ? Math.min(0.02 + speed * 0.012, 0.16) : 0.01;
  };

  update(0, 0, true);

  return {
    root,
    joints: {
      hips, spine, chest, neck, head,
      leftShoulder: left.shoulder, leftElbow: left.elbow,
      rightShoulder: right.shoulder, rightElbow: right.elbow,
      leftHip: leftLeg.hip, leftKnee: leftLeg.knee,
      rightHip: rightLeg.hip, rightKnee: rightLeg.knee,
    },
    update,
    dispose: () => { for (const d of disposables) d.dispose(); },
  };
}
`;

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// OBJECTS — the actual things a world is made of (admin 2026-08-27).
//
// Admin, verbatim: "sabhi objects asli (real) chahiye — car, tree, river, pahad, sky, registan,
// animal, road … agar user bole real/asli/100% to ek dam hu-ba-hu real object banane hai. agar user
// sirf 3d bol raha hai to lite se kaam chal jayega."
//
// So every builder here takes a DETAIL TIER and there are genuinely two builds, not one build with a
// slider. `lite` is the fast, phone-friendly shape. `real` is the one that has to survive being looked
// at closely.
//
// 🔒 WHAT MAKES AN OBJECT READ AS REAL, AND IT IS NOT POLYGON COUNT. It is SILHOUETTE and PROPORTION.
// A car is not a box with wheels: it is a bonnet line, a raked windscreen, a roof, a boot, and wheels
// sunk into arches — get that outline wrong in twelve thousand triangles and it stays a shape. (The
// first version drew the right outline in twelve boxes, and the render still read as boxes: since Phase
// 2, 2026-10-05, the outline is the SHAPE itself — an extruded side profile, lathed limbs and bodies.) Every builder below is written to that rule, which
// is also why they stay cheap enough to run on a mid-range Android.
//
// 🔒 THE HONEST CEILING, IN CODE SO NOBODY OVERSELLS IT. This produces objects that unmistakably READ
// as a car, a tree, a mountain — with real materials, reflections and shadows. It does NOT produce a
// photograph. A scanned-quality asset comes from a scanner, and inventing one here would be the fake
// feature this codebase forbids. Say "real-looking", never "photorealistic".
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const OBJECTS = `import * as THREE from 'three';
import { surfaceMaterial, enableAO, getDetailLevel, setDetailLevel, mergeGeometries, type SurfaceKind, type Detail } from './surfaces';

// The detail tier lives in surfaces.ts so the ground reads the same setting as the objects; it is
// re-exported here so \`import { setDetailLevel } from './objects'\` keeps working everywhere.
export { setDetailLevel, getDetailLevel };
export type { Detail };

interface BaseOpts { detail?: Detail; seed?: number }
const tier = (o?: BaseOpts): Detail => o?.detail ?? getDetailLevel();

function rng(seed: number): () => number {
  let t = (seed >>> 0) || 1;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shared per-kind materials — a hundred trees must not build a hundred bark materials. */
const matCache = new Map<string, THREE.Material>();
function shared(kind: SurfaceKind, detail: Detail, color?: number, repeat = 3): THREE.Material {
  const key = kind + ':' + detail + ':' + (color ?? 'x') + ':' + repeat;
  let m = matCache.get(key);
  if (!m) {
    m = detail === 'real'
      ? surfaceMaterial(kind, { color, repeat })
      // The light tier deliberately skips the texture maps: on a phone the generation cost and the
      // texture memory are the whole budget, and a plain colour is what "just 3D" asked for.
      : new THREE.MeshStandardMaterial({ color: color ?? 0x9aa0a6, roughness: 0.85, metalness: kind === 'metal' ? 1 : 0 });
    matCache.set(key, m);
  }
  return m;
}
export function disposeObjectMaterials(): void {
  for (const m of matCache.values()) m.dispose();
  matCache.clear();
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, detail: Detail): THREE.Mesh {
  if (detail === 'real') enableAO(geo);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ── CAR ──────────────────────────────────────────────────────────────────────────────────────────
export interface CarOptions extends BaseOpts { color?: number; length?: number }

/**
 * A car built from its real silhouette, at real proportions: ~4.3 m long, 1.8 m wide, 1.45 m tall,
 * 2.6 m wheelbase, 0.32 m wheel radius. Those five numbers are most of why it reads as a car.
 *
 * 🔒 THE BODY IS A PROFILE, NOT BOXES (admin 2026-10-05, Phase 2: "if the player vehicle still looks like
 * a box: FAIL"). The side outline — nose, bonnet, raked windscreen, curved roof, backlight, boot, and the
 * two wheel wells cut out of the sill — is drawn once and extruded across the width with a rounded bevel.
 * Both tiers get that shape; \`real\` adds what you only notice up close: door seams and handles, spoked
 * rims, grilles, a plate, dark well liners, clearcoat paint. Locked by tests/aHeroObjectIsNotABox.test.ts.
 */
export function createCar(options: CarOptions = {}): THREE.Group {
  const d = tier(options);
  const L = options.length ?? 4.3;
  const s = L / 4.3;                 // every number below is metres on a 4.3 m saloon, scaled by s
  const W = L * 0.42;
  const paint = options.color ?? 0xb42b2b;
  const real = d === 'real';
  const group = new THREE.Group();

  const bodyMat = real
    ? new THREE.MeshPhysicalMaterial({ color: paint, roughness: 0.28, metalness: 0.85, clearcoat: 1, clearcoatRoughness: 0.08 })
    : new THREE.MeshStandardMaterial({ color: paint, roughness: 0.5, metalness: 0.3 });
  // Glass is DARK and REFLECTIVE, not see-through: the greenhouse is a solid volume, so transmission
  // would show the sky through the whole cabin and read as a glass brick.
  const glassMat = real
    ? new THREE.MeshPhysicalMaterial({ color: 0x0b0f13, roughness: 0.04, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02 })
    : new THREE.MeshStandardMaterial({ color: 0x10151a, roughness: 0.2, metalness: 0.3 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.6, metalness: 0.5 });
  const tyreMat = shared('fabric', d, 0x14161a, 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xc6ccd4, roughness: 0.25, metalness: 1 });

  const wheelR = L * 0.075;
  const axleZ = 1.3 * s;             // 2.6 m wheelbase
  const wellR = 0.41 * s;            // the cut-out the tyre sits in, a little larger than the tyre
  const sill = 0.2 * s;              // ground clearance under the doors

  // A side profile is the car. It is drawn in (z = length, y = height), front at +z, then extruded
  // across the width with a bevel so every edge is rounded — never a box with a box on top.
  const scaled = (pts: number[][]) => pts.map(([z, y]) => [z * s, y * s]);
  const wellArc = (cz: number): number[][] => {
    const a = Math.asin(Math.min(1, (wheelR - sill) / wellR));
    const out: number[][] = [];
    const n = real ? 14 : 6;
    for (let i = 0; i <= n; i++) {
      const t = Math.PI + a - ((Math.PI + 2 * a) * i) / n; // rear foot → over the top → front foot
      out.push([cz + Math.cos(t) * wellR, wheelR + Math.sin(t) * wellR]);
    }
    return out;
  };
  const shapeOf = (pts: number[][]): THREE.Shape => {
    const sh = new THREE.Shape();
    sh.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
    sh.closePath();
    return sh;
  };
  const extrudeAcross = (pts: number[][], width: number, bevel: number): THREE.BufferGeometry => {
    const depth = Math.max(0.01, width - 2 * bevel);
    const g = new THREE.ExtrudeGeometry(shapeOf(pts), {
      depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
      bevelSegments: real ? 4 : 1, curveSegments: 1,
    });
    g.translate(0, 0, -depth / 2);
    g.rotateY(-Math.PI / 2);          // profile z → model +Z (the front), extrusion → model X
    g.computeVertexNormals();
    return g;
  };

  // Body: nose, bonnet, shoulder line, boot deck, tail — with the two wheel wells cut out of the sill.
  const bodyPts = [
    ...scaled([[2.02, 0.22], [2.12, 0.3], [2.16, 0.42], [2.15, 0.56], [2.1, 0.66], [1.98, 0.74],
      [1.6, 0.8], [1.2, 0.85], [0.92, 0.88], [0, 0.9], [-1, 0.93], [-1.5, 0.95], [-1.85, 0.96],
      [-2.05, 0.93], [-2.13, 0.86], [-2.17, 0.72], [-2.17, 0.5], [-2.12, 0.32], [-2.04, 0.22]]),
    ...wellArc(-axleZ),
    ...wellArc(axleZ),
  ];
  const bodyBevel = 0.05 * s;
  group.add(mesh(extrudeAcross(bodyPts, W, bodyBevel), bodyMat, d));

  // Greenhouse: raked windscreen, curved roof, sloping backlight — narrower than the body, so the
  // glass sits on a shoulder the way it does on every real car.
  const Wg = W * 0.8;
  const glassBevel = 0.06 * s;
  group.add(mesh(extrudeAcross(scaled([[0.98, 0.86], [0.12, 1.36], [-0.1, 1.41], [-0.5, 1.43], [-0.9, 1.4],
    [-1.05, 1.36], [-1.62, 0.92], [-1.6, 0.86]]), Wg, glassBevel), glassMat, d));
  // Roof skin in paint over the top of the glass.
  group.add(mesh(extrudeAcross(scaled([[0.16, 1.3], [0.16, 1.33], [0.1, 1.375], [-0.1, 1.425], [-0.5, 1.445],
    [-0.9, 1.415], [-1.07, 1.355], [-1.07, 1.3]]), Wg + 0.02 * s, glassBevel), bodyMat, d));

  // Small parts that share a material are BAKED into one mesh per material: a car of 70 separate
  // meshes is 70 draw calls, and ten of them in a scene is what makes a mid-range phone stutter.
  const paintParts: THREE.Mesh[] = [];
  const trimParts: THREE.Mesh[] = [];
  const chromeParts: THREE.Mesh[] = [];
  const box = (w: number, h: number, dd: number, x: number, y: number, z: number, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd));
    m.position.set(x, y, z);
    m.rotation.x = rx;
    return m;
  };
  // A thin box laid along a line of the profile, on one side of the car.
  const strut = (z0: number, y0: number, z1: number, y1: number, x: number, thick: number) => {
    const dz = (z1 - z0) * s, dy = (y1 - y0) * s;
    return box(0.09 * s, thick * s, Math.hypot(dz, dy), x, ((y0 + y1) / 2) * s, ((z0 + z1) / 2) * s, Math.atan2(-dy, dz));
  };
  // A pillar WRAPS the greenhouse's rounded corner (0.09 m deep, its outer face just proud of the side
  // glass). A thin strip on the side face left the curved glass beside it, so it read as a loose fin.
  const glassSide = Wg / 2 + glassBevel - 0.042 * s;
  const bodySide = W / 2;
  for (const side of [-1, 1]) {
    // Pillars frame the glass into a windscreen, side windows and a backlight.
    paintParts.push(strut(0.98, 0.88, 0.2, 1.32, side * glassSide, 0.07));
    paintParts.push(strut(-0.3, 0.9, -0.34, 1.37, side * glassSide, 0.09));
    paintParts.push(strut(-1.02, 1.32, -1.56, 0.95, side * glassSide, 0.1));
    // Wing mirror on a stalk, at the front of the door.
    paintParts.push(box(0.1 * s, 0.09 * s, 0.17 * s, side * (bodySide + 0.09 * s), 1.0 * s, 0.8 * s));
    trimParts.push(box(0.1 * s, 0.03 * s, 0.05 * s, side * (bodySide + 0.03 * s), 0.96 * s, 0.82 * s));
    // Black sill between the wheels.
    trimParts.push(box(0.03 * s, 0.09 * s, 1.75 * s, side * (bodySide + 0.01 * s), 0.25 * s, 0));
    if (real) {
      // Door shut-lines and handles: what makes a painted surface read as a door.
      for (const [z, y0, y1] of [[0.93, 0.62, 0.9], [-0.3, 0.3, 0.92], [-1.04, 0.74, 0.95]]) {
        trimParts.push(box(0.006 * s, (y1 - y0) * s, 0.014 * s, side * (bodySide + 0.002 * s), ((y0 + y1) / 2) * s, z * s));
      }
      for (const z of [0.15, -0.95]) chromeParts.push(box(0.025 * s, 0.03 * s, 0.16 * s, side * (bodySide + 0.012 * s), 0.8 * s, z * s));
    }
  }
  if (real) {
    // Grilles and diffuser: dark breaks that stop the nose and tail reading as a slab.
    trimParts.push(box(W * 0.56, 0.13 * s, 0.03 * s, 0, 0.4 * s, 2.215 * s));
    trimParts.push(box(W * 0.36, 0.07 * s, 0.03 * s, 0, 0.6 * s, 2.19 * s));
    trimParts.push(box(W * 0.7, 0.1 * s, 0.03 * s, 0, 0.29 * s, -2.21 * s));
    const plate = mesh(new THREE.BoxGeometry(0.52 * s, 0.11 * s, 0.03 * s), new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.6 }), d);
    plate.position.set(0, 0.52 * s, -2.225 * s);
    group.add(plate);
  }
  group.add(mesh(mergeGeometries(paintParts), bodyMat, d));
  group.add(mesh(mergeGeometries(trimParts), trimMat, d));
  if (chromeParts.length) group.add(mesh(mergeGeometries(chromeParts), rimMat, d));

  // Lights that EMIT, laid on the nose and tail surfaces. An unlit "light" is a coloured sticker.
  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(W * 0.24, 0.12 * s, 0.025 * s), new THREE.MeshBasicMaterial({ color: 0xfff3d0 }));
    head.position.set(side * W * 0.31, 0.722 * s, 2.098 * s);
    head.rotation.x = -0.985;
    group.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(W * 0.27, 0.09 * s, 0.025 * s), new THREE.MeshBasicMaterial({ color: 0xd82b1e }));
    tail.position.set(side * W * 0.3, 0.8 * s, -2.215 * s);
    group.add(tail);
  }

  // Wheels: a rounded tyre (lathed from its cross-section) on a spoked rim, sitting IN the wells.
  const seg = real ? 28 : 12;
  const tyreW = 0.22 * s;
  const rimR = wheelR * 0.64;
  const linerMat = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.95, side: THREE.DoubleSide });
  for (const sx of [-1, 1]) {
    for (const sz of [1, -1]) {
      const wheel = new THREE.Group();
      const h = tyreW / 2;
      const profile = [[rimR, -h], [wheelR * 0.9, -h], [wheelR * 0.97, -h * 0.86], [wheelR, -h * 0.55], [wheelR, h * 0.55],
        [wheelR * 0.97, h * 0.86], [wheelR * 0.9, h], [rimR, h], [rimR, -h]].map(([r, y]) => new THREE.Vector2(r, y));
      const tyre = mesh(new THREE.LatheGeometry(profile, seg), tyreMat, d);
      tyre.rotation.z = Math.PI / 2;
      wheel.add(tyre);
      const rim = mesh(new THREE.CylinderGeometry(rimR, rimR, tyreW * 0.8, seg), real ? trimMat : rimMat, d);
      rim.rotation.z = Math.PI / 2;
      wheel.add(rim);
      if (real) {
        // Five spokes, a hub and the rim's bright lip on the OUTER face, baked into one mesh, so a
        // rolling wheel visibly turns. The lip is a flat ring, not a torus — a torus in a wheel group is
        // what the old floating arch was, and the arch test keeps wheel groups free of them.
        const face = sx * tyreW * 0.42;
        const faceParts: THREE.Mesh[] = [];
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.28, rimR * 0.28, 0.03 * s, 12));
        hub.rotation.z = Math.PI / 2;
        hub.position.x = face;
        faceParts.push(hub);
        const lip = new THREE.Mesh(new THREE.RingGeometry(rimR * 0.84, rimR, seg));
        lip.rotation.y = (sx * Math.PI) / 2;
        lip.position.x = face + sx * 0.012 * s;
        faceParts.push(lip);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          faceParts.push(box(0.03 * s, rimR * 0.8, 0.045 * s, face, Math.cos(a) * rimR * 0.5, Math.sin(a) * rimR * 0.5, a));
        }
        wheel.add(mesh(mergeGeometries(faceParts), rimMat, d));
        // 🔴 THE ARCH BELONGS TO THE BODY, NOT THE WHEEL (a child of the wheel group spun with it and,
        // offset twice, floated a car-width outside the body). It is the dark liner of the wheel well,
        // fixed to the body over the wheel's own centre, so the well reads as a hole, not painted metal.
        // Its radius is the well's AFTER the body bevel (the bevel grows the outline into the well).
        const linerR = wellR - bodyBevel - 0.01 * s;
        const arch = mesh(new THREE.CylinderGeometry(linerR, linerR, 0.5 * s, 18, 1, true, -0.35, Math.PI + 0.7), linerMat, d);
        arch.rotation.z = Math.PI / 2;
        arch.position.set(sx * (bodySide - 0.25 * s), wheelR, sz * axleZ);
        arch.name = 'wheel-arch';
        group.add(arch);
      }
      wheel.position.set(sx * (bodySide - h - 0.01 * s), wheelR, sz * axleZ);
      wheel.name = 'wheel';
      group.add(wheel);
    }
  }
  return group;
}

/** Spin the wheels. Call with the car's speed each frame — still wheels on a moving car is the tell. */
export function rollWheels(car: THREE.Group, speed: number, dt: number): void {
  for (const child of car.children) {
    if (child.name === 'wheel') child.rotation.x += speed * dt * 3.2;
  }
}

// ── DRIVING ──────────────────────────────────────────────────────────────────────────────────────
/**
 * THE ONE FORWARD. Every model in this file — car, motorcycle, bicycle, animal, house — faces its local
 * +Z (headlights, handlebars, head and front door are all on +Z). Drive, aim and place by THIS, and put
 * the camera behind it with CameraRig.follow(). Want a car to drive "into the screen" (−Z)? Turn it:
 * car.rotation.y = Math.PI — never mirror a model or flip a control to fake it.
 */
export const MODEL_FORWARD = new THREE.Vector3(0, 0, 1);

export interface VehicleTuning {
  /** Top speed, m/s (≈ 25 = 90 km/h). */
  maxSpeed?: number;
  reverseSpeed?: number;
  /** Acceleration, m/s². */
  accel?: number;
  brake?: number;
  /** Fraction of speed lost per second when coasting. */
  drag?: number;
  /** Turn rate at full lock, radians per second. */
  steerRate?: number;
  /** Speed at start. NOT zero: a racing/driving game whose car sits still reads as broken. */
  startSpeed?: number;
}
export interface VehicleState { speed: number; heading: number }

/** The vehicle's state, starting from where the model already points (its rotation.y). */
export function createVehicleState(vehicle: THREE.Object3D, tuning: VehicleTuning = {}): VehicleState {
  return { speed: tuning.startSpeed ?? 5, heading: vehicle.rotation.y };
}

/**
 * Drive a vehicle from the RAW input axis — \`input.axis()\` exactly as the runtime gives it — so the
 * signs are decided here, once, and cannot be got wrong in a game:
 *   • up / W (axis.y = −1) → accelerate TOWARD THE FRONT (+Z of the model); down / S brakes, then reverses;
 *   • left / A (axis.x = −1) → turn to the DRIVER'S left; right / D → the driver's right — which, with
 *     the camera behind (CameraRig.follow), is also the left and right of the SCREEN.
 * Steering follows the direction of travel, so reversing steers like a real car, and it fades in with
 * speed, so a parked car does not spin on the spot. Wheels roll if the model has them (createCar).
 *
 * 🔴 WHY THIS EXISTS (admin 2026-10-05, "button ulte kaam karte hai"): the runtime's up key is −1, and a
 * game that used axis.y as throttle drove BACKWARDS on W; with the camera in front of the car on top of
 * that, every control felt mirrored. Call this; never hand-write a car's movement.
 */
export function driveVehicle(
  vehicle: THREE.Object3D,
  state: VehicleState,
  axis: { x: number; y: number },
  dt: number,
  tuning: VehicleTuning = {},
): VehicleState {
  const maxSpeed = tuning.maxSpeed ?? 25;
  const reverseSpeed = tuning.reverseSpeed ?? 6;
  const accel = tuning.accel ?? 9;
  const brake = tuning.brake ?? 18;
  const drag = tuning.drag ?? 0.35;
  const steerRate = tuning.steerRate ?? 1.6;

  const throttle = -axis.y; // up is −1 in the runtime; here up means "go forward"
  let speed = state.speed;
  if (throttle > 0.05) {
    speed += accel * throttle * dt;
  } else if (throttle < -0.05) {
    if (speed > 0.5) speed -= brake * -throttle * dt;            // braking first…
    else speed -= accel * 0.6 * -throttle * dt;                   // …then reversing
  } else {
    speed -= speed * drag * dt;                                   // coasting
  }
  speed = Math.max(-reverseSpeed, Math.min(maxSpeed, speed));

  // Positive rotation.y turns +Z toward +X, the DRIVER'S LEFT — so a right turn lowers the heading.
  const grip = Math.min(1, Math.abs(speed) / 4);
  const heading = state.heading - axis.x * steerRate * grip * Math.sign(speed) * dt;

  vehicle.rotation.y = heading;
  vehicle.position.x += Math.sin(heading) * speed * dt;
  vehicle.position.z += Math.cos(heading) * speed * dt;
  if (vehicle.children.some((c) => c.name === 'wheel')) rollWheels(vehicle as THREE.Group, speed, dt);
  return { speed, heading };
}

// ── TREE ─────────────────────────────────────────────────────────────────────────────────────────
export interface TreeOptions extends BaseOpts { height?: number; leafColor?: number }

/**
 * A tree with a TAPERED, root-flared trunk and real recursive branches, with leaves in clusters at the
 * BRANCH ENDS.
 *
 * The classic AI tree is a cylinder with a green sphere on top, and the reason it looks wrong is not
 * detail — it is that real trunks taper and flare, and real leaves grow where the branches end.
 */
export function createTree(options: TreeOptions = {}): THREE.Group {
  const d = tier(options);
  const H = options.height ?? 6;
  const r = rng(options.seed ?? 7);
  const group = new THREE.Group();
  const barkMat = shared('bark', d, 0x6b5236, 2);
  const leafMat = d === 'real'
    ? new THREE.MeshStandardMaterial({ color: options.leafColor ?? 0x4c7a2e, roughness: 0.9, metalness: 0, side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ color: options.leafColor ?? 0x4c7a2e, roughness: 0.9, flatShading: true });

  const trunkH = H * 0.45;
  // Taper: the top radius is a third of the base. Root flare is the wider disc at the ground.
  const trunk = mesh(new THREE.CylinderGeometry(H * 0.026, H * 0.075, trunkH, d === 'real' ? 12 : 6), barkMat, d);
  trunk.position.y = trunkH / 2;
  group.add(trunk);
  if (d === 'real') {
    const flare = mesh(new THREE.CylinderGeometry(H * 0.075, H * 0.11, H * 0.06, 12), barkMat, d);
    flare.position.y = H * 0.03;
    group.add(flare);
  }

  const branches = d === 'real' ? 6 : 3;
  const leafGeo = d === 'real'
    ? new THREE.IcosahedronGeometry(H * 0.16, 1)
    : new THREE.IcosahedronGeometry(H * 0.2, 0);

  for (let i = 0; i < branches; i++) {
    const angle = (i / branches) * Math.PI * 2 + r() * 0.6;
    // Branches leave the trunk at 30-50 degrees, thinner than it, and higher ones are shorter.
    const t = 0.55 + (i / branches) * 0.4;
    const len = H * (0.32 - t * 0.12) * (0.8 + r() * 0.4);
    const lift = Math.PI / 2 - (0.55 + r() * 0.35);
    const b = mesh(new THREE.CylinderGeometry(H * 0.012, H * 0.024, len, d === 'real' ? 8 : 5), barkMat, d);
    const pivot = new THREE.Group();
    pivot.position.y = trunkH * t;
    pivot.rotation.y = angle;
    pivot.rotation.z = lift - Math.PI / 2;
    b.position.y = len / 2;
    pivot.add(b);
    // Leaves at the END of the branch, which is where they actually grow.
    const cluster = mesh(leafGeo.clone(), leafMat, d);
    cluster.scale.setScalar(0.7 + r() * 0.5);
    cluster.position.y = len * (d === 'real' ? 0.95 : 0.85);
    pivot.add(cluster);
    group.add(pivot);
  }
  // A crown so the canopy closes over the middle instead of leaving a bald trunk top.
  const crown = mesh(leafGeo.clone(), leafMat, d);
  crown.scale.setScalar(d === 'real' ? 1.25 : 1.5);
  crown.position.y = trunkH + H * 0.12;
  group.add(crown);
  return group;
}

// ── MOUNTAIN ─────────────────────────────────────────────────────────────────────────────────────
export interface MountainOptions extends BaseOpts { size?: number; height?: number; snow?: boolean }

/**
 * A mountain built by displacing a plane along RIDGES, with a snow line by altitude.
 *
 * A cone is not a mountain. What the eye reads is ridge lines running down from the peak and the
 * valleys between them, plus snow that starts at a height rather than being painted on the top.
 */
export function createMountain(options: MountainOptions = {}): THREE.Mesh {
  const d = tier(options);
  const size = options.size ?? 120;
  const H = options.height ?? 45;
  const seg = d === 'real' ? 96 : 32;
  const r = rng(options.seed ?? 31);
  const offsets = Array.from({ length: 8 }, () => r() * Math.PI * 2);

  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const rock = new THREE.Color(0x6d6a63);
  const snow = new THREE.Color(0xf2f5f8);
  const grass = new THREE.Color(0x4a5c35);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const dist = Math.sqrt(x * x + z * z) / (size / 2);
    // A dome that falls off to nothing at the edge — no cliff at the boundary of the tile.
    const base = Math.max(0, 1 - dist) ** 1.7;
    const theta = Math.atan2(z, x);
    // RIDGES: several angular waves, each sharpened with abs() so they crease instead of rolling.
    let ridge = 0;
    for (let k = 0; k < (d === 'real' ? 5 : 2); k++) {
      ridge += (1 - Math.abs(Math.sin(theta * (2 + k * 1.7) + offsets[k]))) / (k + 1.6);
    }
    const detail = d === 'real' ? (Math.sin(x * 0.35 + offsets[5]) * Math.cos(z * 0.31 + offsets[6])) * 0.06 : 0;
    const y = H * base * (0.55 + ridge * 0.5) + H * detail * base;
    pos.setY(i, y);

    const alt = y / H;
    const c = options.snow !== false && alt > 0.62 ? snow : alt < 0.12 ? grass : rock;
    // Blend across the snow line rather than a hard edge, which is what makes it look painted on.
    const mix = options.snow !== false && alt > 0.5 && alt <= 0.62 ? (alt - 0.5) / 0.12 : 0;
    const col = mix > 0 ? rock.clone().lerp(snow, mix) : c;
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = d === 'real'
    ? surfaceMaterial('stone', { repeat: 14 })
    : new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true });
  mat.vertexColors = true;
  const m = mesh(geo, mat, d);
  m.castShadow = false; // A whole mountain casting into the shadow map eats the resolution.
  return m;
}

// ── RIVER ────────────────────────────────────────────────────────────────────────────────────────
export interface RiverOptions extends BaseOpts { length?: number; width?: number }
export interface River { mesh: THREE.Mesh; update: (t: number) => void }

/**
 * A river that MOVES. Still water is the fastest way to make a scene look like a screenshot, so the
 * surface scrolls two normal-ish waves against each other and the material is transmissive.
 */
/** Mean water level above the ground plane. Waves never dip below ground (amplitude is 0.1 m). */
export const RIVER_SURFACE_Y = 0.14;

export function createRiver(options: RiverOptions = {}): River {
  const d = tier(options);
  const L = options.length ?? 200;
  const W = options.width ?? 14;
  const segL = d === 'real' ? 200 : 60;
  const geo = new THREE.PlaneGeometry(W, L, d === 'real' ? 12 : 4, segL);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const base = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    base[i * 2] = x; base[i * 2 + 1] = z;
    // The course MEANDERS. A straight river is a canal, and the eye knows the difference.
    pos.setX(i, x + Math.sin(z * 0.03) * W * 0.9 + Math.sin(z * 0.011) * W * 1.6);
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshPhysicalMaterial({
    color: d === 'real' ? 0x2d5f74 : 0x2f6f8a,
    roughness: d === 'real' ? 0.08 : 0.3,
    metalness: 0,
    transmission: d === 'real' ? 0.65 : 0,
    thickness: 2.2,
    transparent: true,
    opacity: d === 'real' ? 0.82 : 0.9,
  });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;

  const update = (t: number) => {
    const p = m.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = base[i * 2], z = base[i * 2 + 1];
      // Two waves at different speeds and angles — one wave reads as a flag, two read as water.
      // 🔴 Around RIVER_SURFACE_Y, never around 0. The waves used to swing ±10 cm through the ground's
      // own plane, so wherever a trough dipped under y = 0 the grass covered the water and the river
      // rendered as scattered blue scraps (seen in a real render, 2026-10-05 — the road's bug again).
      p.setY(i, RIVER_SURFACE_Y + Math.sin(z * 0.35 + t * 1.7) * 0.06 + Math.sin(x * 0.5 - t * 1.1) * 0.04);
    }
    p.needsUpdate = true;
    m.geometry.computeVertexNormals();
  };
  update(0);
  return { mesh: m, update };
}

// ── DESERT ───────────────────────────────────────────────────────────────────────────────────────
export interface DesertOptions extends BaseOpts { size?: number }

/**
 * Dunes with a real wind shape: a long gentle windward slope and a SHORT STEEP slip face — sand
 * collapses at about 34 degrees, and that asymmetry is what separates a desert from bumpy ground.
 */
export function createDesert(options: DesertOptions = {}): THREE.Mesh {
  const d = tier(options);
  const size = options.size ?? 300;
  const seg = d === 'real' ? 128 : 40;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const wave = Math.sin(x * 0.045) * 0.5 + 0.5;
    // Skew the wave so its rise is long and its fall is short: the slip face.
    const skew = Math.pow(wave, 0.55);
    let y = skew * 5.5 + Math.sin(z * 0.02 + x * 0.01) * 1.8;
    if (d === 'real') y += Math.sin(x * 0.7 + z * 0.25) * 0.08; // wind ripples
    pos.setY(i, y);
  }
  geo.computeVertexNormals();
  const mat = d === 'real'
    ? surfaceMaterial('sand', { repeat: 30 })
    : new THREE.MeshStandardMaterial({ color: 0xd9b877, roughness: 0.95, metalness: 0 });
  const m = mesh(geo, mat, d);
  m.castShadow = false;
  return m;
}

// ── ROAD ─────────────────────────────────────────────────────────────────────────────────────────
export interface RoadOptions extends BaseOpts { length?: number; width?: number; lanes?: number }

/**
 * How high the road's surface sits above the ground plane (y = 0). Place a vehicle's wheels on it.
 *
 * 🔴 IT USED TO BE 0, and that was the worst-looking bug in the whole layer: the asphalt sat in exactly
 * the same plane as the ground, so the depth buffer could not decide which was in front and the road
 * flickered into black zebra stripes over the grass the moment the camera moved (seen in a real render,
 * 2026-10-05). Three centimetres is invisible to a player and is many depth steps at any distance a game
 * draws. Markings sit above the asphalt the same way, never in its plane.
 */
export const ROAD_SURFACE_Y = 0.03;

/**
 * Asphalt with the markings that make it a road rather than a grey strip: a dashed centre line, solid
 * edge lines and kerbs on BOTH sides. \`real\` also adds the darker worn tracks where wheels actually run.
 */
export function createRoad(options: RoadOptions = {}): THREE.Group {
  const d = tier(options);
  const L = options.length ?? 300;
  const W = options.width ?? 8;
  const lanes = options.lanes ?? 2;
  const group = new THREE.Group();

  const surface = mesh(new THREE.PlaneGeometry(W, L, 1, d === 'real' ? 60 : 1), shared('asphalt', d, 0x3a3c40, d === 'real' ? 40 : 1), d);
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = ROAD_SURFACE_Y;
  surface.castShadow = false;
  group.add(surface);

  // polygonOffset pulls the paint toward the camera in DEPTH as well as lifting it, so a mark never
  // fights the asphalt under it even at a grazing angle far down the road.
  const paint = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  // Dashed centre line — 3 m mark, 6 m gap is close to the real Indian standard.
  const dashes = Math.floor(L / 9);
  for (let i = 0; i < dashes; i++) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 3), paint);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, ROAD_SURFACE_Y + 0.008, -L / 2 + i * 9 + 4.5);
    group.add(dash);
  }
  // BOTH sides. This loop used to end in \`break\` after the first pass, so a road had one edge line and
  // one kerb — and that kerb, at (side * W) / 2 + 0.15, sat INSIDE the asphalt on the left.
  for (const side of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.12, L), paint);
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(side * (W / 2 - 0.35), ROAD_SURFACE_Y + 0.008, 0);
    group.add(edge);
    if (d === 'real') {
      const kerb = mesh(new THREE.BoxGeometry(0.3, 0.16, L), shared('stone', d, 0xb9b3a6, 20), d);
      kerb.position.set(side * (W / 2 + 0.15), 0.08, 0);
      group.add(kerb);
    }
  }
  if (d === 'real') {
    // Worn wheel tracks — two slightly darker, slightly smoother bands per lane, built once (not once
    // per side) and sharing ONE material instead of a new one per band.
    const wearMat = new THREE.MeshStandardMaterial({ color: 0x303237, roughness: 0.72, metalness: 0, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    for (let lane = 0; lane < lanes; lane++) {
      const laneCentre = -W / 2 + (W / lanes) * (lane + 0.5);
      for (const off of [-0.75, 0.75]) {
        const wear = new THREE.Mesh(new THREE.PlaneGeometry(0.55, L), wearMat);
        wear.rotation.x = -Math.PI / 2;
        wear.position.set(laneCentre + off, ROAD_SURFACE_Y + 0.004, 0);
        group.add(wear);
      }
    }
  }
  return group;
}

// ── HOUSE ────────────────────────────────────────────────────────────────────────────────────────
export interface HouseOptions extends BaseOpts {
  width?: number;
  depth?: number;
  /** 1 or 2. Each storey is 3 m. */
  storeys?: number;
  /** Wall colour. Defaults to one of the washes Indian houses are actually painted in. */
  wallColor?: number;
  /** 'flat' — RCC roof with a parapet and a water tank (towns, most villages). 'tiled' — sloped clay tiles. */
  roof?: 'flat' | 'tiled';
}

/** The colours houses in an Indian village or town are really washed in — not white boxes. */
export const HOUSE_WASHES: readonly number[] = [0xe9c46a, 0xf4a6a6, 0x9ec9e6, 0xf1e3c8, 0xc7e0b4, 0xe8b07a, 0xd7c3e6];

/**
 * A HOUSE, not a box with a hat. What makes a building read as a home is the stuff on its face: a door
 * you could walk through, windows with frames and a sun-shade over them, a darker plinth where the wall
 * meets the ground, and a roof line — here the flat RCC roof with a parapet and a black water tank that
 * is on nearly every house in India, or sloped clay tiles. Front face is +Z; place it facing the road.
 *
 * Walls are textured plaster in \`real\` (the same plaster everywhere, tinted, so a street of ten houses
 * builds the texture ONCE). Returns a Group whose origin is the centre of the footprint at ground level.
 */
export function createHouse(options: HouseOptions = {}): THREE.Group {
  const d = tier(options);
  const r = rng(options.seed ?? 11);
  const W = options.width ?? 6 + r() * 3;
  const D = options.depth ?? 5 + r() * 2;
  const storeys = Math.max(1, Math.min(2, Math.round(options.storeys ?? 1)));
  const H = storeys * 3;
  const wash = options.wallColor ?? HOUSE_WASHES[Math.floor(r() * HOUSE_WASHES.length)];
  const roofKind = options.roof ?? (r() < 0.7 ? 'flat' : 'tiled');
  const group = new THREE.Group();

  const wall = shared('plaster', d, wash, 2);
  // Tints are chosen to read right in BOTH tiers: in \`lite\` the tint IS the colour, in \`real\` it is
  // MULTIPLIED by the texture's own colour — a dark tint on a dark texture goes black (the first render
  // of this house had a black plinth, black sun-shades and a black door).
  const plinthMat = shared('stone', d, 0xb8b0a4, 3);
  const concreteMat = shared('plaster', d, 0xd6d1c7, 2);
  const woodMat = shared('wood', d, 0xc08a5a, 1);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.6, metalness: 0 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.15, metalness: 0.2 });

  const body = mesh(new THREE.BoxGeometry(W, H, D), wall, d);
  body.position.y = H / 2;
  group.add(body);
  const plinth = mesh(new THREE.BoxGeometry(W + 0.12, 0.45, D + 0.12), plinthMat, d);
  plinth.position.y = 0.225;
  group.add(plinth);

  // Door — centred on the front, 2.1 m, with a frame so it is a door and not a brown rectangle.
  const doorW = 1.0;
  const door = mesh(new THREE.BoxGeometry(doorW, 2.1, 0.08), woodMat, d);
  door.position.set(0, 0.45 + 1.05, D / 2 + 0.03);
  group.add(door);
  const doorFrame = mesh(new THREE.BoxGeometry(doorW + 0.2, 2.2, 0.05), frameMat, d);
  doorFrame.position.set(0, 0.45 + 1.1, D / 2 + 0.01);
  group.add(doorFrame);
  const step = mesh(new THREE.BoxGeometry(doorW + 0.6, 0.18, 0.5), plinthMat, d);
  step.position.set(0, 0.09, D / 2 + 0.3);
  group.add(step);

  // Windows: front (either side of the door, each storey) and both sides. Frame + glass + chhajja.
  const addWindow = (x: number, y: number, z: number, rotY: number) => {
    const win = new THREE.Group();
    const frame = mesh(new THREE.BoxGeometry(1.1, 1.2, 0.06), frameMat, d);
    win.add(frame);
    const glass = mesh(new THREE.BoxGeometry(0.92, 1.02, 0.07), glassMat, d);
    glass.position.z = 0.01;
    win.add(glass);
    const bar = mesh(new THREE.BoxGeometry(0.05, 1.02, 0.08), frameMat, d);
    bar.position.z = 0.02;
    win.add(bar);
    // The chhajja — the concrete sun-shade over every Indian window. It is what throws the shadow line.
    const shade = mesh(new THREE.BoxGeometry(1.4, 0.07, 0.45), concreteMat, d);
    shade.position.set(0, 0.72, 0.22);
    win.add(shade);
    win.position.set(x, y, z);
    win.rotation.y = rotY;
    group.add(win);
  };
  for (let s2 = 0; s2 < storeys; s2++) {
    const y = s2 * 3 + 1.75;
    const fx = Math.min(W / 2 - 0.9, doorW / 2 + 1.1);
    for (const side of [-1, 1]) {
      if (s2 > 0 || W > 4.5) addWindow(side * fx, y, D / 2 + 0.04, 0);
      addWindow(side * (W / 2 + 0.04), y, 0, side * Math.PI / 2);
    }
  }

  if (roofKind === 'flat') {
    // RCC slab overhang, a parapet you can see over the edge of, and the black Sintex-style tank.
    const slab = mesh(new THREE.BoxGeometry(W + 0.5, 0.18, D + 0.5), concreteMat, d);
    slab.position.y = H + 0.09;
    group.add(slab);
    const t = 0.15;
    for (const [w2, d2, x, z] of [[W, t, 0, D / 2 - t / 2], [W, t, 0, -D / 2 + t / 2], [t, D, W / 2 - t / 2, 0], [t, D, -W / 2 + t / 2, 0]] as const) {
      const parapet = mesh(new THREE.BoxGeometry(w2, 0.9, d2), wall, d);
      parapet.position.set(x, H + 0.18 + 0.45, z);
      group.add(parapet);
    }
    const tank = mesh(new THREE.CylinderGeometry(0.55, 0.6, 1.1, d === 'real' ? 20 : 10), new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.55, metalness: 0 }), d);
    tank.position.set(W / 2 - 1.1, H + 0.18 + 0.55, -D / 2 + 1.1);
    group.add(tank);
  } else {
    // Sloped clay tiles: two pitched planes with an overhang, terracotta, ridge along the width.
    const tileMat = shared('tile', d, 0xb5532f, 3);
    const pitch = 0.5;
    const run = D / 2 + 0.5;
    const len = run / Math.cos(pitch);
    for (const side of [-1, 1]) {
      const plane = mesh(new THREE.BoxGeometry(W + 0.8, 0.12, len), tileMat, d);
      // Centred so the slope crosses the wall line (|z| = D/2) exactly at the wall top and the ridge meets
      // the gable apex — the overhang then dips below the wall top instead of leaving a gap above it.
      plane.position.set(0, H + Math.tan(pitch) * (run / 2 - 0.5), side * run / 2);
      plane.rotation.x = side * pitch;
      group.add(plane);
    }
    // Gable ends so the roof is closed, not two boards balanced on a box.
    const gableShape = new THREE.Shape();
    gableShape.moveTo(-D / 2, 0); gableShape.lineTo(D / 2, 0); gableShape.lineTo(0, Math.tan(pitch) * (D / 2)); gableShape.closePath();
    for (const side of [-1, 1]) {
      const gable = mesh(new THREE.ShapeGeometry(gableShape), wall, d);
      gable.position.set(side * (W / 2), H, 0);
      gable.rotation.y = side * Math.PI / 2;
      group.add(gable);
    }
  }
  return group;
}

// ── ANIMAL ───────────────────────────────────────────────────────────────────────────────────────
export interface AnimalOptions extends BaseOpts { height?: number; color?: number; kind?: 'deer' | 'dog' | 'cow' | 'horse' }
export interface Animal { root: THREE.Group; update: (dt: number, speed: number) => void }

/** Height to the top of the head, in metres, by kind. The built animal is scaled to land exactly on it. */
export const ANIMAL_HEIGHT: Readonly<Record<'deer' | 'dog' | 'cow' | 'horse', number>> = { dog: 0.62, deer: 1.25, cow: 1.5, horse: 1.75 };

/**
 * A rounded, tapered piece rising from y = 0 to y = len (r0 at the base, r1 at the tip).
 * 🔴 The end caps are capped at 45% of the length each: with round caps, a piece shorter than r0 + r1
 * folded back through itself and rendered as a flat disc (a dog's short thick neck did exactly that).
 */
function taperGeo(r0: number, r1: number, len: number, radial: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const cap = 4;
  const h0 = Math.min(r0, len * 0.45), h1 = Math.min(r1, len * 0.45);
  for (let i = 0; i <= cap; i++) {
    const a = -Math.PI / 2 + (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r0, h0 + Math.sin(a) * h0));
  }
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r1, len - h1 + Math.sin(a) * h1));
  }
  pts[0].x = 0; pts[pts.length - 1].x = 0;
  return new THREE.LatheGeometry(pts, radial);
}

function ellipsoid(rx: number, ry: number, rz: number, d: Detail): THREE.BufferGeometry {
  const g = d === 'real' ? new THREE.SphereGeometry(1, 16, 12) : new THREE.SphereGeometry(1, 9, 6);
  g.scale(rx, ry, rz);
  return g;
}

/**
 * Anatomy per kind, in units of the animal's own height (the whole rig is scaled to ANIMAL_HEIGHT
 * afterwards). These numbers ARE the animal: a horse is a long neck carried high on long legs, a cow is
 * a deep barrel on short legs with its head forward, a deer is slender legs and a small head held up, a
 * dog is a short body, a snout and a tail that curls up.
 */
const ANATOMY = {
  horse: { bL: 0.9, bR: 0.165, bW: 0.78, bY: 0.6, legR: 0.03, neckL: 0.4, neckTilt: 0.62, neckR: 0.075, headL: 0.3, headR: 0.06, snout: 0.62, droop: 0.78, ear: 'up', tail: 'hair', mane: true, horns: false, antlers: false, hump: false, paw: false },
  cow:   { bL: 0.95, bR: 0.2, bW: 0.86, bY: 0.62, legR: 0.046, neckL: 0.22, neckTilt: 1.0, neckR: 0.095, headL: 0.27, headR: 0.075, snout: 0.85, droop: 0.75, ear: 'side', tail: 'tuft', mane: false, horns: true, antlers: false, hump: true, paw: false },
  deer:  { bL: 0.72, bR: 0.12, bW: 0.74, bY: 0.6, legR: 0.022, neckL: 0.34, neckTilt: 0.42, neckR: 0.05, headL: 0.2, headR: 0.05, snout: 0.5, droop: 0.95, ear: 'big', tail: 'short', mane: false, horns: false, antlers: true, hump: false, paw: false },
  dog:   { bL: 0.92, bR: 0.17, bW: 0.78, bY: 0.55, legR: 0.045, neckL: 0.26, neckTilt: 0.6, neckR: 0.1, headL: 0.36, headR: 0.12, snout: 0.45, droop: 0.6, ear: 'up', tail: 'curl', mane: false, horns: false, antlers: false, hump: false, paw: true },
} as const;

/**
 * A quadruped with real anatomy and a real GAIT.
 *
 * 🔒 SILHOUETTE, NOT BOXES (admin 2026-10-05, Phase 2). The body is a lathed barrel, deeper at the chest
 * than the rump; legs are tapered, thick at the shoulder and fine at the cannon, ending in hooves or paws;
 * the neck rises from the chest and the head tapers to a muzzle with eyes, ears and a dark nose. Each kind
 * carries what identifies it at a glance: a horse's mane and hair tail, an Indian cow's hump and horns, a
 * deer's antlers and white scut, a dog's snout and curled tail.
 *
 * The gait is the other half: a four-legged animal moves DIAGONAL pairs together (front-left with
 * rear-right). Move all four in phase and it reads as a toy being dragged.
 */
export function createAnimal(options: AnimalOptions = {}): Animal {
  const d = tier(options);
  const real = d === 'real';
  const kind = options.kind ?? 'deer';
  // 🔴 SIZE BY KIND. Every kind used to default to 1.4 m, so a dog stood as tall as a horse — the four
  // animals rendered as one animal four times. Real heights to the top of the head, roughly.
  const H = options.height ?? ANIMAL_HEIGHT[kind];
  const A = ANATOMY[kind] ?? ANATOMY.deer;
  const col = options.color ?? (kind === 'cow' ? 0xd8cfc2 : kind === 'dog' ? 0x9a6b3f : 0x8a5f38);
  // The hide is the near-white PLASTER grain, so the tint IS the animal's colour. It used to be 'fabric',
  // whose own texture is blue-grey: multiplied by a tint it turned a white cow purple and browns black.
  const hide = shared('plaster', d, col, 3);
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a211a, roughness: 0.8, metalness: 0 });
  const hair = new THREE.MeshStandardMaterial({ color: kind === 'horse' ? 0x2b1d14 : 0x3a2c22, roughness: 0.95, metalness: 0 });
  const radial = real ? 14 : 7;
  const root = new THREE.Group();
  const rig = new THREE.Group();   // built at unit height, then scaled so the head lands on H
  root.add(rig);
  const torso = new THREE.Group(); // body, neck and tail move together; the legs stay planted
  rig.add(torso);

  // Body: a barrel lathed along its length — rounded rump, deepest at the chest.
  const prof = [[0, -0.5], [0.55, -0.48], [0.86, -0.4], [0.95, -0.2], [0.93, 0], [0.98, 0.2], [1, 0.32], [0.82, 0.44], [0.45, 0.49], [0, 0.5]];
  const bodyGeo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * A.bR, y * A.bL)), radial + 4);
  bodyGeo.rotateX(Math.PI / 2);          // length along +Z, chest at the front
  bodyGeo.scale(A.bW, 1, 1);
  const body = mesh(bodyGeo, hide, d);
  body.position.y = A.bY;
  torso.add(body);
  if (A.hump) {
    // The zebu hump over the shoulders — the Indian cow's silhouette.
    const hump = mesh(ellipsoid(A.bR * 0.42, A.bR * 0.4, A.bR * 0.55, d), hide, d);
    hump.position.set(0, A.bY + A.bR * 0.82, A.bL * 0.3);
    torso.add(hump);
  }

  // Neck: rises from the top of the chest, leaning forward by neckTilt.
  const neck = new THREE.Group();
  neck.position.set(0, A.bY + A.bR * 0.45, A.bL * 0.38);
  neck.rotation.x = A.neckTilt;
  torso.add(neck);
  const neckMesh = mesh(taperGeo(A.neckR * 1.35, A.neckR, A.neckL, radial), hide, d);
  neckMesh.scale.x = 0.8;
  neck.add(neckMesh);
  if (A.mane) {
    const mane = mesh(taperGeo(A.neckR * 0.5, A.neckR * 0.35, A.neckL * 1.02, radial), hair, d);
    mane.scale.set(0.35, 1, 1);
    mane.position.z = -A.neckR * 0.75;
    neck.add(mane);
  }

  // Head: tapers from the cranium to the muzzle, carried forward and tipped down by droop.
  const head = new THREE.Group();
  head.position.y = A.neckL;
  head.rotation.x = A.droop - A.neckTilt;
  neck.add(head);
  const headGeo = taperGeo(A.headR, A.headR * A.snout, A.headL, radial);
  headGeo.rotateX(Math.PI / 2);           // its length along +Z
  headGeo.translate(0, 0, -A.headR * 0.7);
  // The head's parts are baked into one mesh per material — a head of eight pieces is one draw call
  // for the hide, one for the dark nose and eyes, one for horns or antlers.
  const part = (geo: THREE.BufferGeometry) => new THREE.Mesh(geo);
  const headMesh = part(headGeo);
  headMesh.scale.set(0.82, 1, 1);
  const hideParts: THREE.Mesh[] = [headMesh];
  const darkParts: THREE.Mesh[] = [];
  const hornParts: THREE.Mesh[] = [];
  const tipZ = A.headL - A.headR * 0.7;
  const nose = part(ellipsoid(A.headR * A.snout * 0.75, A.headR * A.snout * 0.6, A.headR * 0.25, d));
  nose.position.set(0, 0, tipZ - A.headR * 0.12);
  darkParts.push(nose);
  for (const side of [-1, 1]) {
    if (real) {
      const eye = part(ellipsoid(A.headR * 0.16, A.headR * 0.16, A.headR * 0.12, d));
      eye.position.set(side * A.headR * 0.68, A.headR * 0.35, A.headR * 0.15);
      darkParts.push(eye);
    }
    // Ears: upright and pointed (horse, dog), big and spread (deer), out to the side (cow).
    const earLen = A.ear === 'big' ? A.headR * 1.7 : A.ear === 'side' ? A.headR * 1.0 : A.headR * 0.95;
    const ear = part(taperGeo(A.headR * 0.28, A.headR * 0.06, earLen, real ? 8 : 5));
    ear.scale.z = 0.45;
    ear.position.set(side * A.headR * 0.5, A.headR * 0.65, -A.headR * 0.35);
    ear.rotation.z = -side * (A.ear === 'side' ? 1.35 : A.ear === 'big' ? 0.75 : 0.25);
    hideParts.push(ear);
    if (A.horns) {
      const horn = part(taperGeo(A.headR * 0.22, A.headR * 0.05, A.headR * 1.3, real ? 8 : 5));
      horn.position.set(side * A.headR * 0.45, A.headR * 0.8, -A.headR * 0.45);
      horn.rotation.set(-0.35, 0, -side * 0.55);
      hornParts.push(horn);
    }
    if (A.antlers) {
      // A main beam sweeping up and back, with two tines off it (posed in the beam's frame, then
      // carried into the head's frame so the whole rack bakes into one mesh).
      const beam = part(taperGeo(A.headR * 0.18, A.headR * 0.09, A.headR * 4, real ? 6 : 4));
      beam.position.set(side * A.headR * 0.4, A.headR * 0.8, -A.headR * 0.4);
      beam.rotation.set(-0.45, 0, -side * 0.45);
      beam.updateMatrix();
      hornParts.push(beam);
      for (const [at, tilt] of [[0.35, 0.9], [0.7, 0.7]]) {
        const tine = part(taperGeo(A.headR * 0.12, A.headR * 0.05, A.headR * 1.6, real ? 6 : 4));
        tine.position.y = A.headR * 4 * at;
        tine.rotation.x = tilt;
        tine.updateMatrix();
        tine.matrix.premultiply(beam.matrix);
        tine.matrix.decompose(tine.position, tine.quaternion, tine.scale);
        hornParts.push(tine);
      }
    }
  }
  head.add(mesh(mergeGeometries(hideParts), hide, d));
  head.add(mesh(mergeGeometries(darkParts), dark, d));
  if (hornParts.length) {
    const hornColor = A.antlers ? 0x6b5338 : 0xcfc3a8;
    head.add(mesh(mergeGeometries(hornParts), new THREE.MeshStandardMaterial({ color: hornColor, roughness: 0.7 }), d));
  }

  // Legs: tapered, thick at the top, fine at the cannon, ending in a hoof or a paw.
  const hipY = A.bY - A.bR * 0.25;
  const footH = A.paw ? A.legR * 1.2 : A.legR * 1.6;
  const upperL = (hipY - footH) * 0.52;
  const lowerL = hipY - footH - upperL;
  const legs: Array<{ hip: THREE.Group; knee: THREE.Group }> = [];
  for (const sz of [1, -1]) {
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group();
      // Inside the barrel's footprint: the top of a leg belongs to the body, it is not bolted beside it.
      hip.position.set(sx * A.bR * A.bW * 0.45, hipY, sz * A.bL * 0.33);
      rig.add(hip);
      const thick = sz < 0 ? 1.6 : 1.35;   // the hindquarters carry the bigger muscle
      const upper = mesh(taperGeo(A.legR * thick, A.legR * 1.05, upperL + A.legR, radial), hide, d);
      upper.rotation.x = Math.PI;          // hangs down from the hip
      upper.position.y = A.legR;
      hip.add(upper);
      const knee = new THREE.Group();
      knee.position.y = -upperL;
      hip.add(knee);
      const lower = mesh(taperGeo(A.legR * 1.0, A.legR * 0.8, lowerL + A.legR * 0.5, radial), hide, d);
      lower.rotation.x = Math.PI;
      lower.position.y = A.legR * 0.5;
      knee.add(lower);
      const foot = A.paw
        ? mesh(ellipsoid(A.legR * 1.15, footH * 0.55, A.legR * 1.6, d), hide, d)
        : mesh(new THREE.CylinderGeometry(A.legR * 0.95, A.legR * 1.2, footH, radial), dark, d);
      foot.position.set(0, -lowerL - footH * 0.5, A.paw ? A.legR * 0.5 : 0);
      knee.add(foot);
      legs.push({ hip, knee });
    }
  }

  // Tail: a long hair tail (horse), a thin tail with a tuft (cow), a white scut (deer), a curl (dog).
  const tail = new THREE.Group();
  tail.position.set(0, A.bY + A.bR * 0.55, -A.bL * 0.47);
  torso.add(tail);
  if (A.tail === 'hair') {
    const t = mesh(taperGeo(A.legR * 1.4, A.legR * 0.6, A.bY * 0.75, radial), hair, d);
    t.rotation.x = Math.PI + 0.3;      // down and BACK, away from the rump
    tail.add(t);
  } else if (A.tail === 'tuft') {
    const len = A.bY * 0.7, lean = 0.12;
    const t = mesh(taperGeo(A.legR * 0.45, A.legR * 0.35, len, real ? 6 : 4), hide, d);
    t.rotation.x = Math.PI + lean;
    tail.add(t);
    // The tuft sits ON the tail's tip, wherever the lean puts it.
    const tuft = mesh(ellipsoid(A.legR * 0.7, A.legR * 2.2, A.legR * 0.7, d), hair, d);
    tuft.position.set(0, -Math.cos(lean) * len, -Math.sin(lean) * len);
    tail.add(tuft);
  } else if (A.tail === 'short') {
    const t = mesh(ellipsoid(A.bR * 0.25, A.bR * 0.4, A.bR * 0.18, d), new THREE.MeshStandardMaterial({ color: 0xece6da, roughness: 0.9 }), d);
    t.position.z = -A.bR * 0.05;
    tail.add(t);
  } else {
    const t = mesh(taperGeo(A.legR * 0.9, A.legR * 0.45, A.bL * 0.38, radial), hide, d);
    t.rotation.x = -0.6;                 // up and back: a dog's tail is carried, not dragged
    tail.add(t);
  }

  let phase = 0;
  const update = (dt: number, speed: number) => {
    const moving = speed > 0.05;
    phase += dt * (moving ? Math.min(2.5 + speed * 1.1, 11) : 1.6);
    const swing = moving ? Math.min(0.3 + speed * 0.05, 0.75) : 0.03;
    // DIAGONAL PAIRS: legs 0 (front-left) and 3 (rear-right) share a phase.
    const pair = [0, 1, 1, 0];
    for (let i = 0; i < legs.length; i++) {
      const s = Math.sin(phase + pair[i] * Math.PI);
      legs[i].hip.rotation.x = s * swing;
      legs[i].knee.rotation.x = Math.max(0, -s * swing * 1.3);
    }
    torso.position.y = moving ? Math.abs(Math.sin(phase * 2)) * 0.012 : 0;
    neck.rotation.x = A.neckTilt + (moving ? 0.05 + swing * 0.1 : Math.sin(phase * 0.5) * 0.04);
    tail.rotation.x = Math.sin(phase * 0.8) * 0.14;
  };
  update(0, 0);
  // Land the top of the head on H exactly, whatever the anatomy table adds up to.
  rig.updateMatrixWorld(true);
  const top = new THREE.Box3().setFromObject(rig).max.y;
  rig.scale.setScalar(H / (top > 0 ? top : 1));
  return { root, update };
}

// ── MOTORCYCLE ───────────────────────────────────────────────────────────────────────────────────
export interface MotorcycleOptions extends BaseOpts { color?: number; length?: number; kind?: 'sport' | 'commuter' | 'cruiser' }
export interface Motorcycle {
  root: THREE.Group;
  /** Attach a rider here — createHumanoid().root goes straight in, already seated and facing forward. */
  seat: THREE.Object3D;
  /** Lean into a corner (radians, + is right). A bike that corners flat reads as a prop on rails. */
  lean: (radians: number) => void;
  /** Turn the bars (radians). Moves the forks, wheel, mudguard and headlight together, as one assembly. */
  steer: (radians: number) => void;
  /** Spin the wheels from speed in m/s. Still wheels under a moving bike is the oldest tell there is. */
  roll: (speed: number, dt: number) => void;
}

/**
 * A motorcycle at real proportions: 2.05 m long, 1.35 m WHEELBASE, 0.30 m wheel radius, 0.80 m seat
 * height, 0.72 m across the bars. Those five numbers are most of why it reads as a bike.
 *
 * 🔴 THE ONE THING THAT DECIDES IT, AND THE ONE EVERY IMPROVISED BIKE GETS WRONG: a motorcycle is
 * mostly AIR. The wheels sit far apart with an open gap beneath the engine, the tank-to-tail line
 * falls backwards, and the forks are RAKED — not vertical. A body blob bridging two cylinders has
 * none of those, which is precisely why it reads as a toy however good the lighting is.
 *
 * \`real\` adds what you only notice up close and miss instantly when it is gone: a separate tyre and
 * rim with spokes, a front disc and caliper, the swingarm and chain run, an exhaust that leaves the
 * engine and ends in a can, mudguards over both wheels, mirrors, footpegs, and a headlight and tail
 * light that actually EMIT.
 */
export function createMotorcycle(options: MotorcycleOptions = {}): Motorcycle {
  const d = tier(options);
  const L = options.length ?? 2.05;
  const kind = options.kind ?? 'sport';
  const paint = options.color ?? 0xc4231f;

  const wheelR = L * 0.146;                                  // ~0.30 m — a 17" rim plus tyre
  const base = L * (kind === 'cruiser' ? 0.7 : 0.659);       // wheelbase: a cruiser is longer
  const seatY = L * (kind === 'cruiser' ? 0.34 : 0.39);      // ~0.80 m; cruisers sit lower
  const barW = L * 0.35;                                     // ~0.72 m across the grips
  const rake = kind === 'cruiser' ? 0.56 : kind === 'commuter' ? 0.44 : 0.46;  // fork angle, radians

  const root = new THREE.Group();

  const paintMat = d === 'real'
    ? new THREE.MeshPhysicalMaterial({ color: paint, roughness: 0.24, metalness: 0.8, clearcoat: 1, clearcoatRoughness: 0.07 })
    : new THREE.MeshStandardMaterial({ color: paint, roughness: 0.5, metalness: 0.3 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd6de, roughness: 0.18, metalness: 1 });
  const engineMat = new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.45, metalness: 0.9 });
  const matte = new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.72, metalness: 0.25 });
  const tyreMat = shared('fabric', d, 0x121418, 2);
  const seatMat = shared('fabric', d, 0x15171a, 2);
  const seg = d === 'real' ? 22 : 10;

  /** One wheel, as a GROUP so it can be rolled and steered independently of the frame. */
  const makeWheel = (radius: number, width: number): THREE.Group => {
    const w = new THREE.Group();
    const tyre = mesh(new THREE.TorusGeometry(radius * 0.86, radius * 0.15, d === 'real' ? 10 : 6, seg), tyreMat, d);
    tyre.rotation.y = Math.PI / 2;
    w.add(tyre);
    if (d === 'real') {
      const rim = mesh(new THREE.CylinderGeometry(radius * 0.72, radius * 0.72, width, seg), chrome, d);
      rim.rotation.z = Math.PI / 2;
      w.add(rim);
      // Spokes: five, because the gaps are what stop a wheel reading as a solid disc.
      for (let i = 0; i < 5; i++) {
        const spoke = mesh(new THREE.BoxGeometry(width * 0.6, radius * 1.34, radius * 0.09), chrome, d);
        spoke.rotation.x = (i * Math.PI) / 5;
        w.add(spoke);
      }
      const hub = mesh(new THREE.CylinderGeometry(radius * 0.2, radius * 0.2, width * 1.25, 10), engineMat, d);
      hub.rotation.z = Math.PI / 2;
      w.add(hub);
    } else {
      const disc = mesh(new THREE.CylinderGeometry(radius * 0.7, radius * 0.7, width * 0.9, seg), matte, d);
      disc.rotation.z = Math.PI / 2;
      w.add(disc);
    }
    w.name = 'wheel';
    return w;
  };

  // ── REAR: wheel, swingarm and the chain run ───────────────────────────────────────────────────
  const rearWheel = makeWheel(wheelR, L * 0.075);
  rearWheel.position.set(0, wheelR, -base / 2);
  root.add(rearWheel);

  if (d === 'real') {
    for (const side of [-1, 1]) {
      const arm = mesh(new THREE.BoxGeometry(L * 0.022, L * 0.038, base * 0.42), matte, d);
      arm.position.set(side * L * 0.048, wheelR * 1.02, -base * 0.29);
      arm.rotation.x = 0.06;
      root.add(arm);
    }
    const sprocket = mesh(new THREE.CylinderGeometry(wheelR * 0.34, wheelR * 0.34, L * 0.012, 14), chrome, d);
    sprocket.rotation.z = Math.PI / 2;
    sprocket.position.set(L * 0.055, wheelR, -base / 2);
    root.add(sprocket);
    const chain = mesh(new THREE.BoxGeometry(L * 0.008, wheelR * 0.5, base * 0.34), matte, d);
    chain.position.set(L * 0.055, wheelR * 1.05, -base * 0.33);
    root.add(chain);
    // Rear shock, visibly angled — a vertical strut looks like scaffolding.
    const shock = mesh(new THREE.CylinderGeometry(L * 0.014, L * 0.014, L * 0.17, 8), chrome, d);
    shock.position.set(0, wheelR * 1.75, -base * 0.2);
    shock.rotation.x = -0.4;
    root.add(shock);
  }

  // ── ENGINE: the mass low and CENTRAL, with daylight under it ───────────────────────────────────
  const engine = mesh(new THREE.BoxGeometry(L * 0.17, L * 0.16, L * 0.2), engineMat, d);
  engine.position.set(0, wheelR * 1.15, -L * 0.02);
  root.add(engine);
  if (d === 'real') {
    // Cooling fins: three thin plates. Nothing says "engine" faster at this scale.
    for (let i = 0; i < 3; i++) {
      const fin = mesh(new THREE.BoxGeometry(L * 0.19, L * 0.012, L * 0.19), chrome, d);
      fin.position.set(0, wheelR * 1.15 + (i - 1) * L * 0.042, -L * 0.02);
      root.add(fin);
    }
    // Exhaust: header out of the engine, then a can along the right side, rising slightly.
    const header = mesh(new THREE.CylinderGeometry(L * 0.017, L * 0.017, L * 0.3, 10), chrome, d);
    header.position.set(L * 0.05, wheelR * 0.8, L * 0.05);
    header.rotation.set(Math.PI / 2 - 0.25, 0, 0.18);
    root.add(header);
    const can = mesh(new THREE.CylinderGeometry(L * 0.033, L * 0.028, L * 0.36, 12), chrome, d);
    can.position.set(L * 0.075, wheelR * 1.15, -L * 0.24);
    can.rotation.set(Math.PI / 2 - 0.12, 0, 0.1);
    root.add(can);
    for (const side of [-1, 1]) {
      const peg = mesh(new THREE.CylinderGeometry(L * 0.009, L * 0.009, L * 0.05, 6), chrome, d);
      peg.position.set(side * L * 0.085, wheelR * 0.72, -L * 0.06);
      peg.rotation.z = Math.PI / 2;
      root.add(peg);
    }
  }

  // ── FRAME: a spine from the steering head down to the swingarm pivot ───────────────────────────
  const spine = mesh(new THREE.BoxGeometry(L * 0.05, L * 0.05, base * 0.5), matte, d);
  spine.position.set(0, seatY * 0.92, L * 0.06);
  spine.rotation.x = 0.2;
  root.add(spine);

  // ── TANK: the single most bike-defining shape. Widest at the knees, tapering to the seat ───────
  const tank = mesh(new THREE.BoxGeometry(L * 0.19, L * 0.14, L * 0.3), paintMat, d);
  tank.position.set(0, seatY * 1.02, L * 0.12);
  tank.rotation.x = -0.07;
  root.add(tank);
  if (d === 'real') {
    const tankNose = mesh(new THREE.BoxGeometry(L * 0.13, L * 0.1, L * 0.12), paintMat, d);
    tankNose.position.set(0, seatY * 1.04, L * 0.28);
    tankNose.rotation.x = -0.22;
    root.add(tankNose);
    const cap = mesh(new THREE.CylinderGeometry(L * 0.026, L * 0.026, L * 0.012, 12), chrome, d);
    cap.position.set(0, seatY * 1.11, L * 0.14);
    root.add(cap);
  }

  // ── SEAT + TAIL: the line that FALLS toward the back. Flat here and the bike reads as a bench ──
  const seatMesh = mesh(new THREE.BoxGeometry(L * 0.13, L * 0.05, L * 0.3), seatMat, d);
  seatMesh.position.set(0, seatY, -L * 0.11);
  seatMesh.rotation.x = kind === 'cruiser' ? 0.02 : -0.06;
  root.add(seatMesh);
  const tail = mesh(new THREE.BoxGeometry(L * 0.1, L * 0.07, L * 0.18), paintMat, d);
  tail.position.set(0, seatY * 1.06, -L * 0.29);
  tail.rotation.x = kind === 'sport' ? -0.3 : -0.12;   // a sport tail kicks UP; that is its signature
  root.add(tail);

  // The rider's anchor: at the seat, facing -Z like the bike. Empty until a game puts someone on it.
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, seatY, -L * 0.08);
  seatAnchor.name = 'seat';
  root.add(seatAnchor);

  // ── FRONT: ONE steering group, so bars, forks, wheel, mudguard and light turn TOGETHER ─────────
  //
  // 🔴 THE RAKE HAS TO BE PAID FOR, OR THE WHEELBASE IS NOT THE WHEELBASE. A raked fork carries its
  // wheel FORWARD of the steering head by sin(rake) x forkLen — about 0.32 m on this bike. Hang the
  // forks off a head placed at base/2 and the real wheelbase comes out ~1.62 m instead of 1.35: a
  // stretched, chopper-ish machine that is not what anyone asked for, and nothing in the render says
  // so. The head is therefore set BACK by exactly that offset, and the arithmetic below is what makes
  // the five numbers in the doc comment true rather than aspirational.
  const headY = seatY * 1.15;                              // steering-head height
  const forkLen = (headY - wheelR) / Math.cos(rake);        // reach the ground AT the rake, not beside it
  const frontZ = Math.sin(rake) * forkLen;                  // how far the rake throws the wheel forward
  const steerGroup = new THREE.Group();
  steerGroup.position.set(0, headY, base / 2 - frontZ);
  steerGroup.name = 'steer';
  root.add(steerGroup);

  // Forks are RAKED. Vertical forks are the second-clearest sign of an improvised bike.
  // NEGATIVE rotation.x, because a rotation about +X swings -Y toward -Z: the positive sign would
  // rake the forks BACKWARDS, under the engine.
  for (const side of [-1, 1]) {
    const fork = mesh(new THREE.CylinderGeometry(L * 0.017, L * 0.019, forkLen, d === 'real' ? 10 : 6), chrome, d);
    fork.position.set(side * L * 0.048, (-forkLen / 2) * Math.cos(rake), (forkLen / 2) * Math.sin(rake));
    fork.rotation.x = -rake;
    steerGroup.add(fork);
  }
  const frontWheel = makeWheel(wheelR * 0.98, L * 0.055);
  frontWheel.position.set(0, -(headY - wheelR), frontZ);
  steerGroup.add(frontWheel);

  const bar = mesh(new THREE.CylinderGeometry(L * 0.012, L * 0.012, barW, 8), matte, d);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, L * 0.03, 0);
  steerGroup.add(bar);

  if (d === 'real') {
    const clamp = mesh(new THREE.BoxGeometry(L * 0.13, L * 0.025, L * 0.05), matte, d);
    clamp.position.set(0, L * 0.01, L * 0.01);
    steerGroup.add(clamp);
    for (const side of [-1, 1]) {
      const grip = mesh(new THREE.CylinderGeometry(L * 0.017, L * 0.017, L * 0.055, 8), matte, d);
      grip.rotation.z = Math.PI / 2;
      grip.position.set(side * (barW / 2 - L * 0.03), L * 0.03, 0);
      steerGroup.add(grip);
      const mirror = mesh(new THREE.BoxGeometry(L * 0.035, L * 0.022, L * 0.012), matte, d);
      mirror.position.set(side * (barW / 2 - L * 0.02), L * 0.08, -L * 0.01);
      steerGroup.add(mirror);
    }
    // Front disc + caliper. A brakeless front wheel is a detail people feel without naming.
    const disc = mesh(new THREE.CylinderGeometry(wheelR * 0.55, wheelR * 0.55, L * 0.006, 18), chrome, d);
    disc.rotation.z = Math.PI / 2;
    disc.position.copy(frontWheel.position);
    disc.position.x = L * 0.04;
    steerGroup.add(disc);
    const caliper = mesh(new THREE.BoxGeometry(L * 0.016, L * 0.05, L * 0.035), matte, d);
    caliper.position.set(L * 0.04, frontWheel.position.y + wheelR * 0.55, frontWheel.position.z - L * 0.02);
    steerGroup.add(caliper);
    // Mudguard hugging the tyre — a wheel with clear sky above it looks unfinished.
    const guard = mesh(new THREE.BoxGeometry(L * 0.075, L * 0.014, wheelR * 1.5), paintMat, d);
    guard.position.set(0, frontWheel.position.y + wheelR * 0.95, frontWheel.position.z);
    steerGroup.add(guard);
  }

  // Lights that EMIT. An unlit "light" is a coloured sticker, on a bike as much as on a car.
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(L * 0.045, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xfff4d2 }),
  );
  head.position.set(0, -L * 0.01, L * 0.06);
  head.scale.set(1, 0.85, 0.55);
  steerGroup.add(head);
  const tailLight = new THREE.Mesh(
    new THREE.BoxGeometry(L * 0.055, L * 0.022, L * 0.012),
    new THREE.MeshBasicMaterial({ color: 0xe02a1c }),
  );
  tailLight.position.set(0, seatY * 1.08, -L * 0.375);
  root.add(tailLight);

  const wheels: THREE.Group[] = [rearWheel, frontWheel];
  return {
    root,
    seat: seatAnchor,
    lean: (radians: number) => { root.rotation.z = radians; },
    steer: (radians: number) => { steerGroup.rotation.y = radians; },
    roll: (speed: number, dt: number) => {
      const spin = (speed * dt) / wheelR;
      for (const w of wheels) w.rotation.x -= spin;
    },
  };
}

// ── BICYCLE ──────────────────────────────────────────────────────────────────────────────────────
export interface BicycleOptions extends BaseOpts { color?: number; length?: number }

/**
 * A pedal cycle — 1.75 m long, 1.05 m wheelbase, 0.34 m wheel radius, and a DIAMOND frame.
 *
 * It is not a small motorcycle: the frame is open tubing you can see through, the wheels are larger
 * and far thinner, and there is no engine mass in the middle. Building it as a shrunken motorbike is
 * why most generated cycles look wrong.
 */
export function createBicycle(options: BicycleOptions = {}): Motorcycle {
  const d = tier(options);
  const L = options.length ?? 1.75;
  const wheelR = L * 0.194;
  const base = L * 0.6;
  const seatY = L * 0.55;
  const frameMat = new THREE.MeshStandardMaterial({ color: options.color ?? 0x1e88d6, roughness: 0.32, metalness: 0.7 });
  const matte2 = new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.75, metalness: 0.2 });
  const chrome2 = new THREE.MeshStandardMaterial({ color: 0xcfd6de, roughness: 0.2, metalness: 1 });
  const tyre2 = shared('fabric', d, 0x14161a, 2);
  const root = new THREE.Group();
  const seg2 = d === 'real' ? 20 : 10;

  const makeThinWheel = (): THREE.Group => {
    const w = new THREE.Group();
    const t = mesh(new THREE.TorusGeometry(wheelR * 0.9, wheelR * 0.07, 8, seg2), tyre2, d);
    t.rotation.y = Math.PI / 2;
    w.add(t);
    if (d === 'real') {
      for (let i = 0; i < 6; i++) {
        const spoke = mesh(new THREE.BoxGeometry(L * 0.004, wheelR * 1.7, L * 0.004), chrome2, d);
        spoke.rotation.x = (i * Math.PI) / 6;
        w.add(spoke);
      }
    }
    w.name = 'wheel';
    return w;
  };

  const rear = makeThinWheel(); rear.position.set(0, wheelR, -base / 2); root.add(rear);

  const tube = (len: number, x: number, y: number, z: number, rx: number): void => {
    const t = mesh(new THREE.CylinderGeometry(L * 0.013, L * 0.013, len, 8), frameMat, d);
    t.position.set(x, y, z); t.rotation.x = rx; root.add(t);
  };
  tube(base * 0.62, 0, seatY * 0.82, L * 0.02, Math.PI / 2 - 0.16);   // top tube
  tube(base * 0.6, 0, seatY * 0.5, L * 0.02, Math.PI / 2 + 0.1);       // down tube
  tube(seatY * 0.6, 0, seatY * 0.62, -L * 0.13, 0.25);                 // seat tube
  tube(base * 0.42, 0, wheelR * 1.05, -L * 0.16, Math.PI / 2 - 0.06);  // chain stay

  const saddle = mesh(new THREE.BoxGeometry(L * 0.055, L * 0.025, L * 0.13), matte2, d);
  saddle.position.set(0, seatY, -L * 0.14);
  root.add(saddle);
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, seatY, -L * 0.12);
  seatAnchor.name = 'seat';
  root.add(seatAnchor);

  if (d === 'real') {
    const crank = mesh(new THREE.CylinderGeometry(wheelR * 0.28, wheelR * 0.28, L * 0.01, 14), chrome2, d);
    crank.rotation.z = Math.PI / 2;
    crank.position.set(0, wheelR * 1.0, -L * 0.02);
    root.add(crank);
    for (const side of [-1, 1]) {
      const pedal = mesh(new THREE.BoxGeometry(L * 0.03, L * 0.012, L * 0.06), matte2, d);
      pedal.position.set(side * L * 0.055, wheelR * 0.78, -L * 0.02);
      root.add(pedal);
    }
  }

  // Same rake arithmetic as the motorcycle — a cycle's fork is raked too, and the wheelbase has to
  // survive it. See the comment there for why the offset is subtracted rather than guessed.
  const rake2 = 0.3;
  const headY2 = seatY * 1.05;
  const forkLen2 = (headY2 - wheelR) / Math.cos(rake2);
  const frontZ2 = Math.sin(rake2) * forkLen2;
  const steerGroup = new THREE.Group();
  steerGroup.position.set(0, headY2, base / 2 - frontZ2);
  steerGroup.name = 'steer';
  root.add(steerGroup);
  for (const side of [-1, 1]) {
    const fork = mesh(new THREE.CylinderGeometry(L * 0.009, L * 0.009, forkLen2, 6), frameMat, d);
    fork.position.set(side * L * 0.03, (-forkLen2 / 2) * Math.cos(rake2), (forkLen2 / 2) * Math.sin(rake2));
    fork.rotation.x = -rake2;
    steerGroup.add(fork);
  }
  const front = makeThinWheel();
  front.position.set(0, -(headY2 - wheelR), frontZ2);
  steerGroup.add(front);
  const bars = mesh(new THREE.CylinderGeometry(L * 0.01, L * 0.01, L * 0.32, 8), matte2, d);
  bars.rotation.z = Math.PI / 2;
  steerGroup.add(bars);

  const wheels2: THREE.Group[] = [rear, front];
  return {
    root,
    seat: seatAnchor,
    lean: (radians: number) => { root.rotation.z = radians; },
    steer: (radians: number) => { steerGroup.rotation.y = radians; },
    roll: (speed: number, dt: number) => {
      const spin = (speed * dt) / wheelR;
      for (const w of wheels2) w.rotation.x -= spin;
    },
  };
}
`;

const FILES: Record<string, string> = {
  'src/game/three/renderer.ts': RENDERER,
  'src/game/three/lighting.ts': LIGHTING,
  'src/game/three/materials.ts': MATERIALS,
  'src/game/three/camera.ts': CAMERA,
  'src/game/three/world.ts': WORLD,
  // The three modules added 2026-08-26, each closing one reason a "realistic" scene came out flat:
  // nothing to reflect (environment), no surface detail (surfaces), and a capsule for a body (humanoid).
  'src/game/three/environment.ts': ENVIRONMENT,
  'src/game/three/surfaces.ts': SURFACES,
  'src/game/three/humanoid.ts': HUMANOID,
  // The things a world is actually made of (admin 2026-08-27): car, tree, mountain, river, desert,
  // road, animal — each built at a REAL or a LITE tier, because "asli" and "3d" are different asks.
  'src/game/three/objects.ts': OBJECTS,
};

export const GAME_3D_MODULES: readonly string[] = [
  'renderer', 'lighting', 'materials', 'camera', 'world', 'environment', 'surfaces', 'humanoid', 'objects',
];

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
    if (files['src/game/three/world.ts']) {
      files['src/game/three/materials.ts'] = FILES['src/game/three/materials.ts'];
      // The ground is textured in the real tier and reads the detail level, both from surfaces.ts.
      files['src/game/three/surfaces.ts'] = FILES['src/game/three/surfaces.ts'];
    }
    // 🔒 SURFACES WITHOUT AN ENVIRONMENT IS A DOWNGRADE, NOT AN UPGRADE. Detailed roughness maps make
    // a material's reflections matter, and with nothing to reflect a glossy surface goes darker and
    // deader than the flat colour it replaced. So asking for one pulls in the other.
    if (files['src/game/three/surfaces.ts']) files['src/game/three/environment.ts'] = FILES['src/game/three/environment.ts'];
    // objects.ts imports surfaces.ts directly, and surfaces then pulls environment in above — so an
    // object asked for on its own still arrives with something to be made of and something to reflect.
    // objects.ts AND humanoid.ts import surfaces.ts (the detail tier, the one shared merge).
    if (files['src/game/three/objects.ts'] || files['src/game/three/humanoid.ts']) {
      files['src/game/three/surfaces.ts'] = FILES['src/game/three/surfaces.ts'];
      files['src/game/three/environment.ts'] = FILES['src/game/three/environment.ts'];
    }
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
      "applyEnvironment(scene, renderer, 'sunset');            // reflections — do NOT skip this\n" +
      "const wall = new THREE.Mesh(enableAO(geo), surfaceMaterial('brick', { repeat: 6 }));\n" +
      "const hero = createHumanoid({ height: 1.8 }); scene.add(hero.root);\n" +
      "setDetailLevel('real');   // 'real' when the user asked for real/asli; 'lite' for plain 3D\n" +
      "scene.add(createCar({ color: 0xb42b2b }));  scene.add(createTree({ height: 7 }));\n" +
      "scene.add(createMountain({ size: 140, height: 50 }));  scene.add(createRoad({ length: 400 }));\n" +
      "const house = createHouse({ roof: 'flat', storeys: 2 }); house.position.set(16, 0, 0); house.rotation.y = -Math.PI / 2; scene.add(house); // door faces +Z — turn it to the road\n" +
      "car.position.y = ROAD_SURFACE_Y;   // wheels ON the asphalt, which sits 3 cm above the ground\n" +
      "let drive = createVehicleState(car);                       // every model faces +Z (MODEL_FORWARD)\n" +
      "// each frame: drive = driveVehicle(car, drive, input.axis(), dt); rig.follow(car, dt);  // camera BEHIND the car\n" +
      "const river = createRiver(); scene.add(river.mesh);   // in the loop: river.update(elapsed)\n" +
      "const deer = createAnimal({ kind: 'deer' }); scene.add(deer.root); // deer.update(dt, speed)\n" +
      "const bike = createMotorcycle({ kind: 'sport', color: 0xc4231f }); scene.add(bike.root);\n" +
      "bike.seat.add(rider.root);            // a bike with no rider reads as a showroom prop\n" +
      "// in the loop: bike.roll(speed, dt); bike.lean(-steerInput * 0.5); bike.steer(steerInput * 0.3);\n" +
      "// in the loop: hero.update(dt, speed, grounded)\n" +
      "const rig = new CameraRig({ kind: 'third-person', collidables: [terrain, buildings] });\n" +
      "scene.add(createTerrain({ palette: 'indianVillage' }));\n" +
      "scene.add(scatterInstances(treeGeometry(), sharedMaterial('foliage', paletteColor('forest', 1)), { count: 400 }));\n" +
      '```\n' +
      'WHAT ACTUALLY MAKES IT LOOK GOOD — do not skip these:\n' +
      '- 🔴 applyEnvironment IS THE BIGGEST ONE. A PBR material is mostly a description of what it\n' +
      '  REFLECTS; with no environment, metal renders near-black and every glossy surface looks like\n' +
      '  painted plastic. Call it once per scene, with the SAME preset you lit with.\n' +
      '- 🔴 For anything a player gets close to — walls, floors, roads, ground, crates, bark — use\n' +
      '  surfaceMaterial(kind) instead of a flat colour, and enableAO(geometry) on that mesh. A flat\n' +
      '  colour under perfect lighting is exactly what "not realistic" looks like.\n' +
      '- 🔴 EVERY OBJECT COMES FROM objects.ts, never hand-modelled: createCar, createMotorcycle,\n' +
      '  createBicycle, createTree, createMountain, createRiver, createDesert, createRoad,\n' +
      '  createAnimal. Call setDetailLevel()\n' +
      "  ONCE at start-up — 'real' when the user asked for real/realistic/asli/100%, 'lite' when they\n" +
      '  only said 3D. A hand-written box car beside these reads as a bug, not a style.\n' +
      '- 🔴 A BIKE IS createMotorcycle() / createBicycle(), never a capsule over two cylinders. A\n' +
      '  motorcycle is mostly AIR: the wheels sit 1.35 m apart with daylight under the engine, the\n' +
      '  forks are RAKED, and the tank-to-tail line falls backwards. Put a rider in bike.seat, and\n' +
      '  call bike.lean() in corners — a bike that corners flat reads as a prop on rails.\n' +
      '- 🔴 A human character is createHumanoid(), never a capsule or a stack of spheres. Call\n' +
      '  hero.update(dt, speed, grounded) every frame — arms swing opposite the legs, knees only bend\n' +
      '  one way, and the body tucks in the air. A capsule with a hat is the single clearest sign of an\n' +
      '  AI-generated game.\n' +
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
