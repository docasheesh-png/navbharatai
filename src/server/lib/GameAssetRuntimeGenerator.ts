import { gameAssetLodSource } from './GameAssetLodGenerator.ts';
import { gameAssetTextureVerifier } from './GameAssetTextureVerifier.ts';

export const GAME_ASSET_MODELS_PATH = 'src/game/three/assetModels.ts';

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

/** Loader used by individually placed models and world dressing. */
export function generateAssetModelLoader(models: Readonly<Record<string, unknown>>): string {
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
import { events } from '../core/events';
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

let assetJobs = 0;

/** Own one instance per call: skinned meshes and animation mixers are never shared across actors. */
export async function loadGameAsset(
  asset: LocalGameAsset,
  fallback: () => GameAssetHandle,
  signal?: AbortSignal,
): Promise<GameAssetHandle> {
  let loaded: THREE.Group | undefined;
  // The player sees this model arrive on the loading bar — real bytes, never a timer. Sent on the event bus that every
  // kit has (core/loading.ts turns it into progress), so a project without loading.ts still compiles and plays.
  const job = ++assetJobs;
  events.emit('ASSET_LOADING', { id: job, fraction: 0, done: false });
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
    if (!/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isFinite(asset.height) || asset.height <= 0 || !Number.isFinite(asset.yaw)) throw Error('Invalid asset manifest');
    const url = new URL(import.meta.env.BASE_URL + 'game-assets/' + asset.sha256 + '.glb', location.href);
    if (url.origin !== location.origin) throw Error('External gameplay asset refused');
    const response = await fetch(url, { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10000)]), redirect: 'error' });
    if (!response.ok || !response.body) throw Error('Model unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let total = 0;
    const expected = Number(response.headers.get('content-length')) || 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        total += value.byteLength; if (total > 5 * 1024 * 1024) throw Error('Model exceeds mobile budget');
        if (expected > 0) events.emit('ASSET_LOADING', { id: job, fraction: Math.min(0.9, (total / expected) * 0.9), done: false });
        chunks.push(value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    if (Array.from(digest, n => n.toString(16).padStart(2, '0')).join('') !== asset.sha256) throw Error('Model integrity mismatch');
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
  } finally {
    events.emit('ASSET_LOADING', { id: job, fraction: 1, done: true });
  }
}
`;
}
