/**
 * 🧱 THE MAP HAS AN EDGE THAT HOLDS (master audit 2026-11-25, Part F — characters and vehicles leave the map).
 *
 * Root cause, confirmed: the kit had a fall recovery (play/character.ts: 60 m below the last safe ground, back you go) and
 * no horizontal boundary at all. A player walked off the end of the terrain and FELL first; a car drove into empty space
 * (the vehicle is not a character, so it has no recovery at all); an NPC wandered off. Nothing defined where the map ends.
 *
 * `src/game/play/boundary.ts`, owned by the shell (GameOptions.bounds or ctx.world.setBounds):
 *   • real collider walls on the four edges — a visible low wall by default, or invisible when the map's own mountains,
 *     sea or fences are the visible edge (walls: 'invisible'), or none (walls: false — the clamp alone);
 *   • every step, the player, the vehicle the player drives (its speed is stopped at the edge), every Entities character and
 *     every dispatched car (userData.bounded) are kept inside — the safety net for whatever a wall cannot stop;
 *   • ctx.world.inside(x, z) answers "is this point on the map" — Dispatch uses it so nothing is sent from outside.
 * The bounds are DECLARED, never guessed from the ground loaded so far: a streamed open world grows as the player moves,
 * and an edge read from its first chunks would trap the player in them.
 */
export const GAME_BOUNDARY_PATH = 'src/game/play/boundary.ts';

export const GAME_BOUNDARY = String.raw`import * as THREE from 'three';
import { events } from '../core/events';
import { markWorldCollider } from '../three/collision';
import { groundHeightAt } from '../three/surfaces';

export interface WorldBounds { minX: number; maxX: number; minZ: number; maxZ: number }

export interface BoundaryOptions {
  /** 'visible' (default): a low wall the player sees. 'invisible': the map's own edge is seen. false: no walls, the clamp only. */
  walls?: 'visible' | 'invisible' | false;
  /** Wall height, metres. Default 2.5. */
  height?: number;
  /** Wall colour. */
  color?: number;
}

/** Are these real bounds (finite, min below max)? PURE. */
export function validBounds(b: WorldBounds | null | undefined): b is WorldBounds {
  return !!b && [b.minX, b.maxX, b.minZ, b.maxZ].every(Number.isFinite) && b.minX < b.maxX && b.minZ < b.maxZ;
}

/** Is (x, z) at least margin inside the bounds? PURE. */
export function insideBounds(b: WorldBounds, x: number, z: number, margin = 0): boolean {
  return x >= b.minX + margin && x <= b.maxX - margin && z >= b.minZ + margin && z <= b.maxZ - margin;
}

/** Put p back inside (margin in from the edge). True when it had to move. PURE (changes p only). */
export function clampToBounds(b: WorldBounds, p: { x: number; z: number }, margin = 0): boolean {
  const m = Math.min(margin, (b.maxX - b.minX) / 2, (b.maxZ - b.minZ) / 2);
  const x = Math.min(b.maxX - m, Math.max(b.minX + m, p.x));
  const z = Math.min(b.maxZ - m, Math.max(b.minZ + m, p.z));
  const moved = x !== p.x || z !== p.z;
  p.x = x; p.z = z;
  return moved;
}

export class WorldBoundary {
  bounds: WorldBounds | null = null;
  private walls: THREE.Group | null = null;
  private readonly disposables: Array<{ dispose: () => void }> = [];

  constructor(private readonly scene: THREE.Scene) {}

  /** Set (or clear, with null) the playable area. Bounds that are not real are refused and said — never half-applied. */
  set(bounds: WorldBounds | null, options: BoundaryOptions = {}): boolean {
    this.clearWalls();
    if (bounds === null) { this.bounds = null; return true; }
    if (!validBounds(bounds)) {
      this.bounds = null;
      console.warn('[world] bounds refused (need finite minX < maxX and minZ < maxZ):', bounds);
      events.emit('WORLD_BOUNDS_INVALID', { bounds });
      return false;
    }
    this.bounds = { ...bounds };
    const walls = options.walls ?? 'visible';
    if (walls) this.buildWalls(this.bounds, walls, options);
    events.emit('WORLD_BOUNDS_CHANGED', { bounds: this.bounds });
    return true;
  }

  inside(x: number, z: number, margin = 0): boolean { return !this.bounds || insideBounds(this.bounds, x, z, margin); }

  /** Keep an object inside; true when it was at the edge and was put back. */
  keep(object: THREE.Object3D, margin = 0.4): boolean {
    if (!this.bounds) return false;
    const moved = clampToBounds(this.bounds, object.position, margin);
    if (moved) events.emit('WORLD_EDGE', { name: object.name || object.type });
    return moved;
  }

  /** The wall meshes (colliders). */
  get wallMeshes(): THREE.Mesh[] { return (this.walls?.children ?? []) as THREE.Mesh[]; }

  dispose(): void { this.clearWalls(); this.bounds = null; }

  private buildWalls(b: WorldBounds, kind: 'visible' | 'invisible', o: BoundaryOptions): void {
    const h = o.height ?? 2.5;
    const t = 0.6;
    const group = new THREE.Group();
    group.name = 'World boundary';
    const material = new THREE.MeshStandardMaterial({ color: o.color ?? 0x8a8378, roughness: 0.95 });
    this.disposables.push(material);
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    // Each wall sits on the ground under its middle and reaches below it, so a slope never leaves a gap under it.
    const sides: Array<[number, number, number, number]> = [
      [cx, b.minZ - t / 2, w + t * 2, t], [cx, b.maxZ + t / 2, w + t * 2, t],
      [b.minX - t / 2, cz, t, d], [b.maxX + t / 2, cz, t, d],
    ];
    for (const [x, z, sx, sz] of sides) {
      const geometry = new THREE.BoxGeometry(sx, h + 40, sz);
      this.disposables.push(geometry);
      const wall = new THREE.Mesh(geometry, material);
      const ground = groundHeightAt(x, z);
      wall.position.set(x, (Number.isFinite(ground) ? ground : 0) + h / 2 - 20, z);
      wall.visible = kind === 'visible';
      wall.castShadow = wall.receiveShadow = kind === 'visible';
      wall.userData.noAim = kind !== 'visible';
      markWorldCollider(wall, 'solid');
      group.add(wall);
    }
    this.scene.add(group);
    this.walls = group;
  }

  private clearWalls(): void {
    if (this.walls) { this.scene.remove(this.walls); this.walls = null; }
    for (const d of this.disposables) { try { d.dispose(); } catch { /* never throws */ } }
    this.disposables.length = 0;
  }
}
`;
