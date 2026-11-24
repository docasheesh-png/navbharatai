// Physics profiles for the Game Maker. Numbers only — this does not replace cannon-es or the 2D kit.
// A 2D game never receives the 3D runtime. PURE.

import type { PhysicsProfile, PhysicsRuntime } from './gameDesignDocument';

export interface PhysicsProfileSpec {
  profile: PhysicsProfile;
  /** Metres per second squared. 0 means the genre does not use a gravity world. */
  gravity: number;
  friction: number;
  restitution: number;
  /** Fixed simulation step, seconds. */
  fixedDt: number;
}

const SPECS: Readonly<Record<PhysicsProfile, PhysicsProfileSpec>> = {
  platformer: { profile: 'platformer', gravity: 28, friction: 0.1, restitution: 0, fixedDt: 1 / 60 },
  racing: { profile: 'racing', gravity: 9.82, friction: 0.85, restitution: 0.05, fixedDt: 1 / 60 },
  shooter: { profile: 'shooter', gravity: 9.82, friction: 0.45, restitution: 0.1, fixedDt: 1 / 60 },
  fighting: { profile: 'fighting', gravity: 22, friction: 0.6, restitution: 0.05, fixedDt: 1 / 60 },
  sports: { profile: 'sports', gravity: 9.82, friction: 0.4, restitution: 0.35, fixedDt: 1 / 120 },
  simulation: { profile: 'simulation', gravity: 9.82, friction: 0.5, restitution: 0.15, fixedDt: 1 / 60 },
  'open-world': { profile: 'open-world', gravity: 9.82, friction: 0.7, restitution: 0.05, fixedDt: 1 / 60 },
  none: { profile: 'none', gravity: 0, friction: 0, restitution: 0, fixedDt: 0 },
};

export function physicsProfileSpec(profile: PhysicsProfile): PhysicsProfileSpec {
  return SPECS[profile];
}

/** 2D stays on the 2D kit. Board and quiz games do not get a rigid-body world. */
export function physicsRuntimeFor(profile: PhysicsProfile, engine: 'canvas-2d' | 'three-3d' | 'board' | 'dom'): PhysicsRuntime {
  if (engine === 'board' || engine === 'dom' || profile === 'none') return engine === 'canvas-2d' ? 'none' : 'rules';
  if (engine === 'canvas-2d') return '2d-kit';
  return 'cannon-es';
}
