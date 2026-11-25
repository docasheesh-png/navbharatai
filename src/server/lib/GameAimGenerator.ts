// ONE WAY EVERY GUN AIMS (master audit 2026-11-25, Part A: "bullets sometimes always travel north … their direction does not
// match the player's aim"). The kit's ProjectileSystem is correct — swept, fixed-step, frame-rate independent — but it is
// handed a direction, and the kit never said where that direction comes from. Every generated shooter wrote its own
// (a constant (0,0,1) is "always north"; the hero's rotation is "the way it last walked"), and a build was even seen
// guessing an API that does not exist (ctx.crosshairTarget). This kit file is the one source: a ray from the camera through
// the crosshair, the first thing in the world it meets, the muzzle where the gun really is, and the shot from the muzzle to
// that point. Pure generator — the kit file is a string.

export const GAME_AIM_PATH = 'src/game/play/aim.ts';

export const GAME_AIM = String.raw`// WHERE THE PLAYER AIMS — the one way every gun in the game finds its direction. Never write a direction by hand.
//
//   const a = ctx.aim();                    // the shell's own: the camera through the crosshair, the player's hand
//   gun.update(dt, fireHeld, a.muzzle, a.shot, bullets);   // the shot goes from the gun to what the crosshair is on
//   a.point / a.hit                         // where it will land, and what it is on (null for open sky)
//
// The ray starts at the camera and goes through the screen centre (the crosshair). The first visible solid thing it meets
// is the aim point — never the player's own body, its vehicle, particles or anything marked userData.noAim. The muzzle is
// the tip of what the hand holds (its far end along the aim), else the hand, else chest height in front of the player.
// The shot is the unit vector from the muzzle to the aim point, so a bullet goes where the crosshair is even though the gun
// is not at the camera. A point behind the muzzle (something between the camera and the player) falls back to the camera's
// own direction. In a top-down game there is no crosshair: the shot is the way the player faces, level with the ground.
import * as THREE from 'three';

export interface AimResult {
  /** Where the aim ray starts (the camera, or the muzzle in a top-down game). */
  origin: THREE.Vector3;
  /** The aim ray's direction (unit). */
  dir: THREE.Vector3;
  /** Where the crosshair is: the first thing hit, or a point far along the ray. */
  point: THREE.Vector3;
  /** What the crosshair is on, or null. */
  hit: THREE.Object3D | null;
  /** The muzzle, in world space — where a projectile is spawned. */
  muzzle: THREE.Vector3;
  /** The unit direction from the muzzle to the aim point — what to fire along. */
  shot: THREE.Vector3;
}

export interface AimOptions {
  /** How far the crosshair reaches (metres). Default 300. */
  range?: number;
  /** Objects that are the player's own (never aimed at): its body, its vehicle. */
  own?: Array<THREE.Object3D | null | undefined>;
  /** What holds the gun (a hand bone or the kit person's hand). */
  holder?: THREE.Object3D | null;
  /** The player's root, for a fallback muzzle at chest height in front of it. */
  body?: THREE.Object3D | null;
  /** Top-down: no crosshair — the shot is the way the player faces (yaw, radians). */
  topDownFacing?: number | null;
}

const _box = new THREE.Box3(), _v = new THREE.Vector3(), _q = new THREE.Quaternion();
const ray = new THREE.Raycaster();

function inside(o: THREE.Object3D, roots: THREE.Object3D[]): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (roots.includes(p)) return true;
  return false;
}
function visible(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
/** Can this be aimed at? Meshes only — particles, sprites, lines and helpers are not targets. */
function solid(o: THREE.Object3D): boolean {
  const m = o as THREE.Mesh;
  return !!m.isMesh && !(o as unknown as { isSprite?: boolean }).isSprite && !o.userData.noAim && visible(o);
}

/** The muzzle: the far end of what the holder holds along dir, else the holder, else chest height in front of the body. */
export function muzzleOf(holder: THREE.Object3D | null | undefined, body: THREE.Object3D | null | undefined, dir: THREE.Vector3): THREE.Vector3 {
  if (holder) {
    holder.updateWorldMatrix(true, true);
    const held = holder.children.filter((c) => c.visible);
    if (held.length) {
      _box.makeEmpty();
      for (const c of held) _box.expandByObject(c);
      if (!_box.isEmpty()) {
        const centre = _box.getCenter(new THREE.Vector3());
        const half = _box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
        // The box's support point along dir: its far end in the direction of the shot.
        return centre.add(new THREE.Vector3(Math.sign(dir.x) * half.x, Math.sign(dir.y) * half.y, Math.sign(dir.z) * half.z));
      }
    }
    return holder.getWorldPosition(new THREE.Vector3());
  }
  if (body) {
    body.updateWorldMatrix(true, false);
    const at = body.getWorldPosition(new THREE.Vector3());
    const flat = new THREE.Vector3(dir.x, 0, dir.z);
    if (flat.lengthSq() < 1e-8) flat.set(0, 0, 1);
    return at.add(new THREE.Vector3(0, 1.4, 0)).addScaledVector(flat.normalize(), 0.5);
  }
  return new THREE.Vector3();
}

/** The unit shot from the muzzle to the point; the aim direction when the point is behind the muzzle or on it. */
export function shotFrom(muzzle: THREE.Vector3, point: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 {
  const shot = point.clone().sub(muzzle);
  if (shot.lengthSq() < 1e-8 || shot.dot(dir) <= 0) return dir.clone().normalize();
  return shot.normalize();
}

/** Aim from a camera through the screen centre into the scene. */
export function aimFrom(camera: THREE.Camera, scene: THREE.Object3D, options: AimOptions = {}): AimResult {
  const range = Math.max(1, options.range ?? 300);
  const own = (options.own ?? []).filter((o): o is THREE.Object3D => !!o);
  camera.updateMatrixWorld(true);
  let origin: THREE.Vector3, dir: THREE.Vector3;
  if (typeof options.topDownFacing === 'number' && Number.isFinite(options.topDownFacing)) {
    dir = new THREE.Vector3(Math.sin(options.topDownFacing), 0, Math.cos(options.topDownFacing));
    origin = muzzleOf(options.holder, options.body, dir);
  } else {
    origin = camera.getWorldPosition(new THREE.Vector3());
    dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(_q)).normalize();
  }
  ray.set(origin, dir);
  ray.near = 0.05;
  ray.far = range;
  scene.updateMatrixWorld(true);
  let point: THREE.Vector3 | null = null, hit: THREE.Object3D | null = null;
  for (const h of ray.intersectObjects(scene.children, true)) {
    if (!solid(h.object) || inside(h.object, own)) continue;
    point = h.point.clone(); hit = h.object; break;
  }
  if (!point) point = origin.clone().addScaledVector(dir, range);
  const muzzle = muzzleOf(options.holder, options.body, dir);
  const shot = shotFrom(muzzle, point, dir);
  // Spawned just past the muzzle along the shot, never inside the gun or the player.
  muzzle.addScaledVector(shot, 0.05);
  void _v;
  return { origin, dir, point, hit, muzzle, shot };
}
`;
