import { gameAssetLodSource } from './GameAssetLodGenerator.ts';
import { gameAssetTextureVerifier } from './GameAssetTextureVerifier.ts';

export const GAME_ASSET_MODELS_PATH = 'src/game/three/assetModels.ts';
/** The game's own model changes. Written once with a new game; after that it belongs to the game and is never regenerated. */
export const GAME_ASSET_CUSTOMIZATIONS_PATH = 'src/game/three/assetCustomizations.ts';

/** Starting customization file: empty (nothing changed), with worked examples of every kind of change. */
export function generateAssetCustomizations(subjects: readonly string[] = []): string {
  return `import type { GameAssetCustomization } from './externalAssets';

/**
 * Change any 3D model in this game here — no model is fixed. Key = the subject name used with loadRequestedAsset().
 * Models in this game: ${subjects.length ? subjects.join(', ') : '(none yet)'}.
 *
 *   car: { tint: '#e53935' }                                  // recolour the whole model
 *   car: { colors: { Body: '#1e88e5' } }                      // recolour one material or mesh by name
 *   house: { height: 9, yaw: 90, offset: [0, 0.2, 0] }        // size in metres, turn in degrees, nudge in metres
 *   truck: { scale: 1.5, shadows: false, opacity: 0.8 }
 *   skeleton: { animation: 'Running_A', roles: { attack: '1H_Melee_Attack_Chop' } }
 *   knight: { hide: ['Shield'] }                              // remove a part by node name
 *   tree: { source: 'procedural' }                            // use the code-built object instead of the model
 *   car: { source: { file: 'public/models/my-car.glb' } }     // replace the model 100% with your own .glb
 *   dragon: { source: { file: 'public/models/dragon.glb' }, height: 6 }  // add a brand-new model
 *
 * An invalid value is ignored and a model that cannot load falls back to the code-built object, so a change here
 * can never break the game.
 */
export const assetCustomizations: Record<string, GameAssetCustomization> = {};
`;
}

/** Shared metadata read by the 3D kit. Object3D clones retain this key. */
export const GAME_WORLD_COLLIDER_KEY = 'navbharatWorldCollider';

const legacyModelPrefix = `import { loadGameAsset, type GameAssetHandle, type LocalGameAsset } from './externalAssets';
const assets: Record<string, LocalGameAsset> = `;
const legacyModelSuffix = `;
export function loadRequestedAsset(subject: string, fallback: () => GameAssetHandle, signal?: AbortSignal): Promise<GameAssetHandle> {
  return assets[subject] ? loadGameAsset(assets[subject], fallback, signal) : Promise.resolve(fallback());
}
`;

/** Upgrade the original generated loader and keep its per-game asset manifest. */
export function upgradeAssetModelLoader(source: string | undefined): string | null {
  const previous = source ? previousLoaderManifest(source) : null;
  if (previous) return generateAssetModelLoader(previous);
  if (!source?.startsWith(legacyModelPrefix) || !source.endsWith(legacyModelSuffix)) return null;
  const manifest = source.slice(legacyModelPrefix.length, -legacyModelSuffix.length);
  try {
    const models: unknown = JSON.parse(manifest);
    if (!models || typeof models !== 'object' || Array.isArray(models) || JSON.stringify(models) !== manifest) return null;
    return generateAssetModelLoader(models as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** The manifest of an UNEDITED previous-generation loader (byte-identical to what it generated), else null. */
function previousLoaderManifest(source: string): Record<string, unknown> | null {
  const marker = 'const assets: Record<string, LocalGameAsset> = ';
  const at = source.indexOf(marker);
  if (at < 0 || source.includes('assetCustomizations')) return null;
  const end = source.indexOf(';\n', at);
  try {
    const models: unknown = JSON.parse(source.slice(at + marker.length, end));
    if (!models || typeof models !== 'object' || Array.isArray(models)) return null;
    return previousAssetModelLoader(models as Record<string, unknown>) === source ? models as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Loader used by individually placed models and world dressing. */
export function generateAssetModelLoader(models: Readonly<Record<string, unknown>>): string {
  return `import * as THREE from 'three';
import { applyGameAssetCustomization, customizedGameAsset, loadGameAsset, loadOwnGameAsset, type GameAssetCustomization, type GameAssetHandle, type LocalGameAsset } from './externalAssets';

const assets: Record<string, LocalGameAsset> = ${JSON.stringify(models)};
const solidScenery = new Set(['building', 'house', 'wall', 'rock', 'hill', 'mountain', 'well', 'barrel', 'streetlight', 'windmill']);
const markSolid = (object: THREE.Object3D) => { object.userData[${JSON.stringify(GAME_WORLD_COLLIDER_KEY)}] = 'solid'; };

function markSceneryCollider(subject: string, root: THREE.Object3D): void {
  if (subject === 'tree') {
    // The loader returns a centred, grounded model. A trunk proxy keeps space under the canopy open.
    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.min(size.x, size.z) * 0.1;
    const height = size.y * 0.48;
    if (!Number.isFinite(radius + height) || radius <= 0 || height <= 0) return;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.7, radius, height, 8), new THREE.MeshBasicMaterial());
    trunk.position.set(center.x, bounds.min.y + height / 2, center.z);
    trunk.visible = false;
    markSolid(trunk);
    root.add(trunk);
  } else if (solidScenery.has(subject)) {
    root.traverseVisible((object) => {
      const lod = object.parent as THREE.LOD | null;
      if ((object as THREE.Mesh).isMesh && (!lod?.isLOD || lod.levels[0]?.object === object)) markSolid(object);
    });
  }
}

// The game's own changes (src/game/three/assetCustomizations.ts). A missing file means no changes, never a broken build.
const customizationModules = import.meta.glob('./assetCustomizations.ts', { eager: true }) as Record<string, { assetCustomizations?: Record<string, GameAssetCustomization> }>;
const customizations: Record<string, GameAssetCustomization> = Object.values(customizationModules)[0]?.assetCustomizations ?? {};

/** Subjects the game can load: every library model plus every subject the game added with its own file. */
export const availableAssetSubjects = (): string[] => [...new Set([...Object.keys(assets), ...Object.keys(customizations).filter((s) => typeof customizations[s]?.source === 'object')])];

export async function loadRequestedAsset(subject: string, fallback: () => GameAssetHandle, signal?: AbortSignal): Promise<GameAssetHandle> {
  const custom = customizations[subject];
  const asset = assets[subject];
  if (custom?.source === 'procedural') return fallback();
  let handle: GameAssetHandle;
  if (custom?.source && typeof custom.source === 'object') {
    // 100% replacement (or a brand-new subject): the project's own .glb, with the same customization fields.
    const base = asset ?? { sha256: '', height: 1, yaw: 0 };
    handle = await loadOwnGameAsset(custom.source, customizedGameAsset({ ...base, serviceCredit: undefined, attributionCredit: undefined, hidden: undefined, roles: undefined, animation: undefined }, custom), fallback, signal);
  } else if (asset) {
    handle = await loadGameAsset(customizedGameAsset(asset, custom), fallback, signal);
  } else {
    return fallback();
  }
  if (handle.source === 'model') {
    applyGameAssetCustomization(handle, custom);
    markSceneryCollider(subject, handle.root);
  }
  return handle;
}
`;
}

/** FROZEN copy of the loader generated until 2026-11-19 (before customizations). Used only to recognise an UNEDITED one to upgrade. */
export function previousAssetModelLoader(models: Readonly<Record<string, unknown>>): string {
  return `import * as THREE from 'three';
import { loadGameAsset, type GameAssetHandle, type LocalGameAsset } from './externalAssets';

const assets: Record<string, LocalGameAsset> = ${JSON.stringify(models)};
const solidScenery = new Set(['building', 'house', 'wall', 'rock', 'hill', 'mountain', 'well', 'barrel', 'streetlight', 'windmill']);
const markSolid = (object: THREE.Object3D) => { object.userData[${JSON.stringify(GAME_WORLD_COLLIDER_KEY)}] = 'solid'; };

function markSceneryCollider(subject: string, root: THREE.Object3D): void {
  if (subject === 'tree') {
    // The loader returns a centred, grounded model. A trunk proxy keeps space under the canopy open.
    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.min(size.x, size.z) * 0.1;
    const height = size.y * 0.48;
    if (!Number.isFinite(radius + height) || radius <= 0 || height <= 0) return;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.7, radius, height, 8), new THREE.MeshBasicMaterial());
    trunk.position.set(center.x, bounds.min.y + height / 2, center.z);
    trunk.visible = false;
    markSolid(trunk);
    root.add(trunk);
  } else if (solidScenery.has(subject)) {
    root.traverseVisible((object) => {
      const lod = object.parent as THREE.LOD | null;
      if ((object as THREE.Mesh).isMesh && (!lod?.isLOD || lod.levels[0]?.object === object)) markSolid(object);
    });
  }
}

export async function loadRequestedAsset(subject: string, fallback: () => GameAssetHandle, signal?: AbortSignal): Promise<GameAssetHandle> {
  const asset = assets[subject];
  if (!asset) return fallback();
  const handle = await loadGameAsset(asset, fallback, signal);
  if (handle.source === 'model') markSceneryCollider(subject, handle.root);
  return handle;
}
`;
}

/** Optional L3 runtime. Kept separate from the L1/L2 kit until build-time acquisition is enabled. */
export function generateGameAssetRuntime(): string {
  return `import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
${gameAssetLodSource()}

${gameAssetTextureVerifier(true)}
export interface LocalGameAsset {
  sha256: string;
  height: number;
  yaw: number;
  animation?: string;
  /** Disable bounded static mesh LOD generation when exact geometry at all distances is required. */
  lod?: boolean;
  serviceCredit?: string;
  attributionCredit?: string;
  /** Node names removed on load (e.g. a character pack's swords and shields on a boxer). Reviewed per entry. */
  hidden?: string[];
  /** Role → clip name (idle, walk, punch, block, hit…). With roles, handle.play(role) switches clips. */
  roles?: Record<string, string>;
}
export interface GameAssetHandle {
  root: THREE.Group;
  source: 'model' | 'procedural';
  update(dt: number): void;
  dispose(): void;
  /** Cross-fade to the clip for a role (e.g. 'punch'); false when this model has no such clip. Models only. */
  play?(role: string, fadeSeconds?: number): boolean;
}

/**
 * Per-subject changes a game (or its user) makes to a model without touching the library: edit
 * src/game/three/assetCustomizations.ts. Every field is optional; an empty object changes nothing.
 * source: 'library' (default) | 'procedural' (always the code-built object) | { file } — the project's OWN .glb
 * (e.g. 'public/models/my-car.glb'), which replaces the library model 100%, or adds a subject the library lacks.
 */
export interface GameAssetCustomization {
  source?: 'library' | 'procedural' | { file: string; sha256?: string };
  /** Target height in metres (replaces the library height); scale multiplies on top of it. */
  height?: number;
  scale?: number;
  /** Extra turn in DEGREES, added to the library orientation. */
  yaw?: number;
  /** Metres, applied inside the model's root so the game's own positioning keeps working. */
  offset?: [number, number, number];
  /** Multiplied into every material colour, e.g. '#ff8800'. */
  tint?: string;
  /** Exact colour per material OR mesh name, e.g. { Body: '#1e88e5' }. Wins over tint. */
  colors?: Record<string, string>;
  /** 0..1; below 1 makes the model see-through. */
  opacity?: number;
  /** Node names to remove, added to the library's own hidden list. */
  hide?: string[];
  /** Clip that plays on load, and role → clip overrides (handle.play(role)). */
  animation?: string;
  roles?: Record<string, string>;
  lod?: boolean;
  shadows?: boolean;
}
const OWN_MODEL_MAX_BYTES = 16 * 1024 * 1024;
const finitePositive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Library metadata with the user's changes merged in; invalid values are ignored, never thrown. */
export function customizedGameAsset(asset: LocalGameAsset, c: GameAssetCustomization | undefined): LocalGameAsset {
  if (!c) return asset;
  const height = (finitePositive(c.height) ? c.height : asset.height) * (finitePositive(c.scale) ? c.scale : 1);
  const yaw = asset.yaw + (typeof c.yaw === 'number' && Number.isFinite(c.yaw) ? c.yaw * Math.PI / 180 : 0);
  return {
    ...asset, height, yaw,
    ...(typeof c.animation === 'string' ? { animation: c.animation } : {}),
    ...(typeof c.lod === 'boolean' ? { lod: c.lod } : {}),
    ...(Array.isArray(c.hide) ? { hidden: [...(asset.hidden ?? []), ...c.hide.filter((n) => typeof n === 'string')] } : {}),
    ...(c.roles && typeof c.roles === 'object' ? { roles: { ...(asset.roles ?? {}), ...c.roles } } : {}),
  };
}

/** Colour, opacity, offset and shadow changes on a mounted model. Materials are cloned first, so nothing is shared. */
export function applyGameAssetCustomization(handle: GameAssetHandle, c: GameAssetCustomization | undefined): void {
  if (!c || handle.source !== 'model') return;
  const pivot = handle.root.children[0];
  if (pivot && Array.isArray(c.offset) && c.offset.length === 3 && c.offset.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    pivot.position.add(new THREE.Vector3(c.offset[0], c.offset[1], c.offset[2]));
  }
  const color = (value: unknown): THREE.Color | null => {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return null;
    return new THREE.Color(value);
  };
  const tint = color(c.tint);
  const opacity = typeof c.opacity === 'number' && Number.isFinite(c.opacity) ? Math.max(0, Math.min(1, c.opacity)) : null;
  const named = c.colors && typeof c.colors === 'object' ? c.colors : {};
  handle.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (typeof c.shadows === 'boolean') { object.castShadow = c.shadows; object.receiveShadow = c.shadows; }
    if (!tint && opacity === null && !Object.keys(named).length) return;
    const list = (Array.isArray(object.material) ? object.material : [object.material]).map((m: THREE.Material) => {
      const own = m.clone();
      const target = (own as THREE.MeshStandardMaterial).color as THREE.Color | undefined;
      const exact = color(named[own.name]) ?? color(named[object.name]);
      if (target && exact) target.copy(exact); else if (target && tint) target.multiply(tint);
      if (opacity !== null) { own.transparent = opacity < 1; own.opacity = opacity; }
      m.dispose();
      return own;
    });
    object.material = Array.isArray(object.material) ? list : list[0];
  });
}

async function readOwnedModel(url: URL, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (url.origin !== location.origin) throw Error('External gameplay asset refused');
  const response = await fetch(url, { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10000)]), redirect: 'error' });
  if (!response.ok || !response.body) throw Error('Model unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.byteLength; if (total > maxBytes) throw Error('Model exceeds mobile budget');
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, n => n.toString(16).padStart(2, '0')).join('');
}

/** Own one instance per call: skinned meshes and animation mixers are never shared across actors. */
export async function loadGameAsset(
  asset: LocalGameAsset,
  fallback: () => GameAssetHandle,
  signal?: AbortSignal,
): Promise<GameAssetHandle> {
  return mountGameAsset(asset, async () => {
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) throw Error('Invalid asset manifest');
    const bytes = await readOwnedModel(new URL(import.meta.env.BASE_URL + 'game-assets/' + asset.sha256 + '.glb', location.href), 5 * 1024 * 1024, signal);
    if (await sha256Hex(bytes) !== asset.sha256) throw Error('Model integrity mismatch');
    return bytes;
  }, fallback, signal);
}

/**
 * The project's OWN model replacing (or adding to) the library: a same-origin .glb under public/, e.g.
 * 'public/models/my-car.glb' or 'models/my-car.glb'. Optional sha256 pins its exact bytes.
 */
export async function loadOwnGameAsset(
  source: { file: string; sha256?: string },
  asset: Omit<LocalGameAsset, 'sha256'>,
  fallback: () => GameAssetHandle,
  signal?: AbortSignal,
): Promise<GameAssetHandle> {
  return mountGameAsset({ ...asset, sha256: source.sha256 ?? '' }, async () => {
    let path = String(source.file ?? '');
    while (path.startsWith('/')) path = path.slice(1);
    if (path.startsWith('public/')) path = path.slice('public/'.length);
    const parts = path.split('/');
    const safePart = (part: string) => part.length > 0 && part !== '.' && part !== '..' && [...part].every((ch) => /[A-Za-z0-9_ .-]/.test(ch));
    if (path.length > 240 || !path.toLowerCase().endsWith('.glb') || !parts.every(safePart)) throw Error('Own model path refused');
    const bytes = await readOwnedModel(new URL(import.meta.env.BASE_URL + path, location.href), OWN_MODEL_MAX_BYTES, signal);
    if (source.sha256 !== undefined && await sha256Hex(bytes) !== source.sha256) throw Error('Own model changed');
    return bytes;
  }, fallback, signal);
}

async function mountGameAsset(
  asset: LocalGameAsset,
  readBytes: () => Promise<Uint8Array>,
  fallback: () => GameAssetHandle,
  signal?: AbortSignal,
): Promise<GameAssetHandle> {
  let loaded: THREE.Group | undefined;
  const disposeRoot = (root: THREE.Object3D) => {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
  };
  try {
    if (!Number.isFinite(asset.height) || asset.height <= 0 || !Number.isFinite(asset.yaw)) throw Error('Invalid asset manifest');
    const bytes = await readBytes();
    // Server policy accepts self-contained GLBs only. Block every URI even if storage is corrupted.
    await verifyGameAssetTextures(bytes);
    const manager = new THREE.LoadingManager();
    let textureFailed = false; manager.onError = () => { textureFailed = true; };
    manager.setURLModifier(url => {
      if (url.startsWith('blob:' + location.origin + '/')) return url;
      throw Error('External model reference refused');
    });
    const gltf = await new GLTFLoader(manager).parseAsync(bytes.buffer, '');
    loaded = gltf.scene;
    if (textureFailed) throw Error('Texture load failed');
    signal?.throwIfAborted();
    const clip = asset.animation ? gltf.animations.find(a => a.name === asset.animation) : undefined;
    if (asset.animation && !clip) throw Error('Required animation unavailable');
    const root = new THREE.Group(); const visual = gltf.scene;
    // Remove reviewed hidden nodes BEFORE measuring, so a sword the boxer is not holding does not set its scale.
    if (asset.hidden?.length) {
      const doomed: THREE.Object3D[] = [];
      visual.traverse(o => { if (asset.hidden!.includes(o.name)) doomed.push(o); });
      for (const o of doomed) { o.removeFromParent(); disposeRoot(o); }
    }
    visual.rotation.y += asset.yaw;
    visual.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(visual);
    const size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y <= 0) throw Error('Invalid model dimensions');
    const scale = asset.height / size.y;
    const pivot = new THREE.Group(); pivot.add(visual); pivot.scale.setScalar(scale);
    pivot.position.set(-(bounds.min.x + bounds.max.x) * scale / 2, -bounds.min.y * scale, -(bounds.min.z + bounds.max.z) * scale / 2);
    root.add(pivot);
    visual.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    if (asset.lod !== false) addStaticGameAssetLods(visual, asset.height, gltf.animations.length > 0);
    const roleClips = new Map<string, THREE.AnimationClip>();
    for (const [role, name] of Object.entries(asset.roles ?? {})) {
      const c = gltf.animations.find(a => a.name === name);
      if (c) roleClips.set(role, c);
    }
    const mixer = clip || roleClips.size ? new THREE.AnimationMixer(visual) : undefined;
    let current = mixer && clip ? mixer.clipAction(clip) : undefined;
    current?.play();
    const creditText = [asset.serviceCredit, asset.attributionCredit].filter(Boolean).join(' · ');
    const credit = creditText ? document.createElement('a') : undefined;
    if (credit) {
      credit.textContent = creditText;
      credit.href = import.meta.env.BASE_URL + 'game-assets/ATTRIBUTION.txt';
      credit.setAttribute('aria-label', '3D model source');
      Object.assign(credit.style, { position: 'fixed', bottom: '4px', right: '4px', zIndex: '20' });
      document.body.appendChild(credit);
    }
    let disposed = false;
    return {
      root, source: 'model',
      update(dt) { if (!disposed && Number.isFinite(dt) && dt > 0) mixer?.update(Math.min(dt, 0.1)); },
      play(role, fadeSeconds = 0.15) {
        const c = roleClips.get(role);
        if (disposed || !mixer || !c) return false;
        const next = mixer.clipAction(c);
        if (next === current) return true;
        next.reset().setEffectiveWeight(1).play();
        if (current) current.crossFadeTo(next, Math.max(0, Math.min(fadeSeconds, 1)), false);
        current = next;
        return true;
      },
      dispose() { if (disposed) return; disposed = true; credit?.remove(); mixer?.stopAllAction(); mixer?.uncacheRoot(visual); root.removeFromParent(); disposeRoot(root); },
    };
  } catch {
    if (loaded) disposeRoot(loaded);
    return fallback();
  }
}
`;
}
