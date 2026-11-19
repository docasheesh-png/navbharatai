/**
 * L3 STEP 4 — downloaded models make a WORLD, not a lone object (admin 2026-11-04: "complete, playable
 * environments — not just isolated objects").
 *
 * Until now a reviewed model was fetched only when the prompt NAMED it ("a car", "trees"), and the builder was told
 * to load each one by hand. So "make a racing game" got a road and nothing beside it. Two pieces fix that:
 *   1. `sceneryFor(prompt)` — the scenery a KIND of game needs, from the genre the platform already reads
 *      (`buildGameContract`) plus village/train words. It only ever names subjects the reviewed catalogue serves.
 *   2. `generateWorldDressingModule()` — `src/game/three/worldDressing.ts` in the built game: ONE call,
 *      `dressWorld(scene, { layout, heightAt, accept })`, loads each scenery model once, clones it into a seeded
 *      layout (roadside / village / range) that honours the kit's own `accept` (stay off the road and the play
 *      space) and `heightAt` (sit on the terrain), and returns how many were placed. A model that did not arrive is
 *      simply not placed — never an unrelated substitute, never a fake.
 */
import { asksForBattleRoyale, buildGameContract } from '../gameIntent';

export type DressingLayout = 'roadside' | 'village' | 'range';

const VILLAGE = /\b(village|gaon|gaanv|hamlet|farm|pueblo|aldea)\b|गाँव|गांव|ग्राम/i;
const TRAIN = /\b(train|railway|locomotive|rail)\b|ट्रेन|रेलगाड़ी|रेल/i;
const CITY = /\b(city|town|street|downtown|traffic)\b|शहर|सड़क/i;

/** Scenery subjects and the layout for this kind of game, or null. PURE. Every subject is a catalogue subject. */
export function sceneryFor(prompt: string): { layout: DressingLayout; subjects: string[] } | null {
  const text = String(prompt ?? '');
  let genre = 'unknown';
  try { genre = buildGameContract(text).genre; } catch { /* unknown genre: keyword rules below still apply */ }
  if (VILLAGE.test(text)) return { layout: 'village', subjects: ['house', 'tree', 'well', 'windmill', 'rock'] };
  // A royale is a shooter in a lived-in world, not on a firing range (autopsy aba63ead: naming PUBG now reads as
  // 'shooter', and a shooting range is not the world that was asked for).
  if (asksForBattleRoyale(text)) return { layout: 'village', subjects: ['house', 'tree', 'rock', 'barrel'] };
  if (genre === 'shooter') return { layout: 'range', subjects: ['target', 'barrel', 'wall'] };
  if (genre === 'racing' || genre === 'runner') {
    return { layout: 'roadside', subjects: CITY.test(text) ? ['building', 'streetlight', 'tree', 'bush'] : ['tree', 'rock', 'bush', 'building'] };
  }
  if (TRAIN.test(text)) return { layout: 'roadside', subjects: ['tree', 'hill', 'house', 'rock'] };
  if (genre === 'rpg') return { layout: 'village', subjects: ['tree', 'rock', 'house', 'hill'] };
  return null;
}

/** The built game's world-dressing module (TypeScript source). Loads each model once; clones are static. */
export function generateWorldDressingModule(subjects: readonly string[], layout: DressingLayout): string {
  return `import * as THREE from 'three';
import { loadRequestedAsset } from './assetModels';
import type { GameAssetHandle } from './externalAssets';

/** The scenery this game was prepared with, and its layout. Written at build time. */
export const SCENERY_SUBJECTS: readonly string[] = ${JSON.stringify(subjects)};
export const SCENERY_LAYOUT = ${JSON.stringify(layout)} as 'roadside' | 'village' | 'range';

export interface DressOptions {
  layout?: 'roadside' | 'village' | 'range';
  /** Total clones, all subjects together. Bounded for phones. */
  count?: number;
  /** Half-size of the dressed area, metres. */
  area?: number;
  /** Roadside: half the road width (the road runs along Z, centred on X = 0). */
  roadHalfWidth?: number;
  seed?: number;
  /** Return false to keep a spot clear (road, track, play space). */
  accept?: (x: number, z: number) => boolean;
  /** Ground height, so a model sits on the terrain instead of floating or sinking. */
  heightAt?: (x: number, z: number) => number;
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const empty = (): GameAssetHandle => ({ root: new THREE.Group(), source: 'procedural', update() {}, dispose() {} });

/**
 * Where each clone goes, as [subjectIndex, x, z, yaw]. PURE — the layout is the same on every load.
 * The arguments are the placed subjects' NAMES: in a range, targets stand far and cover stands near, so a wall
 * never hides the target behind it (seen in the first browser proof, 2026-11-04).
 */
export function planDressing(names: readonly string[], o: DressOptions): Array<[number, number, number, number]> {
  const subjects = names.length;
  const layout = o.layout ?? SCENERY_LAYOUT;
  const total = Math.max(0, Math.min(o.count ?? 48, 120));
  const area = o.area ?? 120;
  const r = rng(o.seed ?? 11);
  const out: Array<[number, number, number, number]> = [];
  let tries = 0;
  while (out.length < total && tries++ < total * 20 && subjects > 0) {
    const i = out.length % subjects;
    let x = 0, z = 0, yaw = r() * Math.PI * 2;
    if (layout === 'roadside') {
      const side = r() < 0.5 ? -1 : 1;
      x = side * ((o.roadHalfWidth ?? 5) + 3 + r() * Math.max(4, area * 0.25));
      z = (r() - 0.5) * 2 * area;
      yaw = side < 0 ? Math.PI / 2 : -Math.PI / 2; // face the road
    } else if (layout === 'village') {
      const a = r() * Math.PI * 2, d = 10 + r() * Math.max(8, area * 0.5);
      x = Math.cos(a) * d; z = Math.sin(a) * d;
      yaw = Math.atan2(-x, -z); // face the village centre
    } else {
      // A range in front of a player at the origin facing -Z. The FIRING LANE (|x| < 6) stays open: targets stand in
      // it, far (25–45 m); cover (walls, barrels) stands only beside it (6–14 m out), nearer. The second browser
      // proof showed full-height walls across the lane hiding every target — cover belongs at the sides.
      const target = names[i] === 'target';
      x = target ? (r() - 0.5) * 10 : (r() < 0.5 ? -1 : 1) * (6 + r() * 8);
      z = target ? -(25 + r() * 20) : -(10 + r() * 20);
      yaw = 0;
    }
    if (o.accept && !o.accept(x, z)) continue;
    out.push([i, x, z, yaw]);
  }
  return out;
}

/**
 * Dress the world with the prepared scenery. Each model is loaded ONCE and cloned; a model that is not available
 * is skipped (nothing unrelated is put in its place). Returns how many clones were placed.
 */
export async function dressWorld(scene: THREE.Object3D, o: DressOptions = {}, signal?: AbortSignal): Promise<number> {
  const handles = await Promise.all(SCENERY_SUBJECTS.map((s) => loadRequestedAsset(s, empty, signal).catch(() => empty())));
  const ready = handles.map((h, i) => ({ h, i })).filter(({ h }) => h.source === 'model');
  if (!ready.length) return 0;
  const group = new THREE.Group();
  group.name = 'world-dressing';
  for (const [k, x, z, yaw] of planDressing(ready.map(({ i }) => SCENERY_SUBJECTS[i]), o)) {
    const clone = ready[k].h.root.clone(true);
    clone.position.set(x, o.heightAt ? o.heightAt(x, z) : 0, z);
    clone.rotation.y += yaw;
    group.add(clone);
  }
  scene.add(group);
  return group.children.length;
}
`;
}
