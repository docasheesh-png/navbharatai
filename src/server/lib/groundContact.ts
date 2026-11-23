/**
 * GROUND CONTACT — the one implementation every 3D game uses (owner 2026-11-23).
 *
 * A car was sinking because the kit put the model's ORIGIN on the ground. A model whose origin sits at
 * its centre then has half its body under the surface. This module places and clamps by the lowest point
 * of the bounding box, and keeps a vehicle's wheel bottoms on the surface with a spring that is not
 * allowed to finish a frame below it.
 *
 * The text below is the file written to src/game/three/groundContact.ts. It has no imports, so the same
 * source runs in the game and in the drop test. Do not keep a second copy of the arithmetic.
 */
export const GROUND_EPSILON = 0.02;

export const GROUND_CONTACT_SOURCE = `/**
 * Ground contact. The lowest point of a model sits on the surface. A vehicle's wheels do too.
 * Copied from the platform's groundContact module — one implementation, no second copy.
 */
export const GROUND_EPSILON = 0.02;

/** Origin Y that puts the model's lowest point on the surface (lift is extra metres above it). */
export function restOriginY(surfaceY: number, lowestOffsetY: number, lift = 0): number {
  const surface = Number.isFinite(surfaceY) ? surfaceY : 0;
  const offset = Number.isFinite(lowestOffsetY) ? lowestOffsetY : 0;
  const up = Number.isFinite(lift) ? lift : 0;
  return surface - offset + up;
}

/** World Y of the lowest point. lowestOffsetY is that point's Y minus the origin's Y. */
export function lowestWorldY(originY: number, lowestOffsetY: number): number {
  return (Number.isFinite(originY) ? originY : 0) + (Number.isFinite(lowestOffsetY) ? lowestOffsetY : 0);
}

/** True when the lowest point is not below the surface by more than epsilon. */
export function standsOn(originY: number, lowestOffsetY: number, surfaceY: number, epsilon = GROUND_EPSILON): boolean {
  return lowestWorldY(originY, lowestOffsetY) >= surfaceY - epsilon;
}

/** Raise the origin if it would leave the model inside the surface. Never lowers it. */
export function clampOriginY(originY: number, lowestOffsetY: number, surfaceY: number, lift = 0): number {
  const floor = restOriginY(surfaceY, lowestOffsetY, lift);
  return (Number.isFinite(originY) ? originY : floor) < floor ? floor : originY;
}

export interface WheelSpec {
  /** Metres from the origin: +x to the right, +y up, +z forward. y is the wheel CENTRE. */
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface ContactBody {
  x: number;
  y: number;
  z: number;
  pitch: number;
  roll: number;
  vy: number;
  /** Local Y of the mesh's lowest vertex at zero pitch and roll. */
  meshBottom: number;
  wheels: WheelSpec[];
  /** How far each wheel's spring is compressed, in metres. The tyre itself stays on the surface. */
  compression: number[];
}

export interface ContactTuning {
  gravity?: number;
  /** How quickly the spring settles, per second. */
  stiffness?: number;
  travel?: number;
}

function rotateY(x: number, y: number, z: number, pitch: number, roll: number): { x: number; y: number; z: number } {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const y1 = y * cp - z * sp;
  const z1 = y * sp + z * cp;
  const x2 = x * cr - y1 * sr;
  const y2 = x * sr + y1 * cr;
  return { x: x2, y: y2, z: z1 };
}

/** World position of the bottom of a tyre. */
export function wheelContact(body: ContactBody, wheel: WheelSpec, _compression = 0): { x: number; y: number; z: number } {
  const radius = Math.max(0, wheel.radius);
  const turned = rotateY(wheel.x, wheel.y, wheel.z, body.pitch, body.roll);
  return { x: body.x + turned.x, y: body.y + turned.y - radius, z: body.z + turned.z };
}

export function meshLowestY(body: ContactBody): number {
  const turned = rotateY(0, body.meshBottom, 0, body.pitch, body.roll);
  return body.y + turned.y;
}

/**
 * One frame of a body dropped onto the ground. Gravity, then the wheel springs, then a hard clamp so
 * the frame never ends with a wheel or the mesh inside the surface.
 */
export function stepGroundContact(body: ContactBody, heightAt: (x: number, z: number) => number, dt: number, tuning: ContactTuning = {}): ContactBody {
  const h = Math.max(0, Math.min(0.05, dt));
  const gravity = tuning.gravity ?? 9.81;
  const travel = tuning.travel ?? 0.12;
  const next: ContactBody = {
    x: body.x, y: body.y, z: body.z, pitch: body.pitch, roll: body.roll,
    vy: body.vy - gravity * h, meshBottom: body.meshBottom, wheels: body.wheels,
    compression: body.compression.slice(),
  };
  next.y += next.vy * h;
  if (next.wheels.length === 0) {
    const floor = restOriginY(heightAt(next.x, next.z), next.meshBottom, 0);
    if (next.y < floor) { next.y = floor; next.vy = 0; }
    return next;
  }
  let sunkMost = 0;
  let pitchPush = 0;
  let rollPush = 0;
  for (let i = 0; i < next.wheels.length; i++) {
    const wheel = next.wheels[i];
    const contact = wheelContact(next, wheel, 0);
    const sunk = heightAt(contact.x, contact.z) - contact.y;
    next.compression[i] = Math.max(0, Math.min(travel, sunk));
    if (sunk > sunkMost) sunkMost = sunk;
    pitchPush += Math.max(0, sunk) * wheel.z;
    rollPush -= Math.max(0, sunk) * wheel.x;
  }
  const settle = 1 - Math.exp(-(tuning.stiffness ?? 14) * h);
  if (sunkMost > 0) {
    next.y += sunkMost * Math.min(1, settle + 0.25);
    next.vy *= 0.4;
  }
  const count = next.wheels.length;
  next.pitch = Math.max(-0.45, Math.min(0.45, next.pitch + (pitchPush / count) * 0.15 * h));
  next.roll = Math.max(-0.45, Math.min(0.45, next.roll + (rollPush / count) * 0.15 * h));
  for (let guard = 0; guard < 6; guard++) {
    let more = 0;
    for (const wheel of next.wheels) {
      const contact = wheelContact(next, wheel, 0);
      more = Math.max(more, heightAt(contact.x, contact.z) - contact.y);
    }
    more = Math.max(more, heightAt(next.x, next.z) - meshLowestY(next));
    if (more <= GROUND_EPSILON) break;
    next.y += more - GROUND_EPSILON * 0.25;
    next.vy = 0;
  }
  return next;
}

/** Run stepGroundContact for N frames. The drop test uses this. */
export function dropOnto(body: ContactBody, heightAt: (x: number, z: number) => number, frames: number, dt = 1 / 60): ContactBody {
  let current = body;
  const steps = Math.max(0, Math.min(6000, frames | 0));
  for (let i = 0; i < steps; i++) current = stepGroundContact(current, heightAt, dt);
  return current;
}
`;
