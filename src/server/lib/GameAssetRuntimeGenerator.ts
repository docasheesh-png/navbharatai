import { gameAssetLodSource } from './GameAssetLodGenerator.ts';
import { gameAssetTextureVerifier } from './GameAssetTextureVerifier.ts';
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
}
export interface GameAssetHandle {
  root: THREE.Group;
  source: 'model' | 'procedural';
  update(dt: number): void;
  dispose(): void;
}

/** Own one instance per call: skinned meshes and animation mixers are never shared across actors. */
export async function loadGameAsset(
  asset: LocalGameAsset,
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
    if (!/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isFinite(asset.height) || asset.height <= 0 || !Number.isFinite(asset.yaw)) throw Error('Invalid asset manifest');
    const url = new URL(import.meta.env.BASE_URL + 'game-assets/' + asset.sha256 + '.glb', location.href);
    if (url.origin !== location.origin) throw Error('External gameplay asset refused');
    const response = await fetch(url, { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10000)]), redirect: 'error' });
    if (!response.ok || !response.body) throw Error('Model unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let total = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        total += value.byteLength; if (total > 5 * 1024 * 1024) throw Error('Model exceeds mobile budget');
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
    const mixer = clip ? new THREE.AnimationMixer(visual) : undefined;
    if (mixer && clip) mixer.clipAction(clip).play();
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
      dispose() { if (disposed) return; disposed = true; credit?.remove(); mixer?.stopAllAction(); mixer?.uncacheRoot(visual); root.removeFromParent(); disposeRoot(root); },
    };
  } catch {
    if (loaded) disposeRoot(loaded);
    return fallback();
  }
}
`;
}
