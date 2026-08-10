import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateGameSystems, GAME_SYSTEM_MODULES } from './GameSystemsGenerator';
import { generateGame3D } from './Game3DGenerator';

/**
 * THESE TESTS RUN THE GENERATED CODE.
 *
 * Every earlier phase could only assert that the emitted text CONTAINS the right thing, because the
 * emitted code needs three.js and a browser. These systems are deliberately pure arithmetic, which
 * means the rules can be PROVEN instead of pattern-matched — and the two rules that matter most here
 * (i-frames and bullet tunneling) are precisely the ones a string match cannot verify.
 *
 * A test that asserts `content.includes('invulnerable')` passes on a broken implementation. A test
 * that fires a 40 m/s bullet past a 0.5 m enemy and asserts it connects does not.
 */
const all = generateGameSystems();

const emittedEvents: Array<{ name: string; payload: any }> = [];

/** Compile a generated module and actually load it, stubbing its imports. */
function load(path: string, stubs: Record<string, unknown> = {}): any {
  const source = all.files[path];
  expect(source, `${path} was not emitted`).toBeTruthy();
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const req = (id: string) => stubs[id] ?? {};
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', js)(exports, req);
  return exports;
}

const eventStub = {
  events: {
    emit: (name: string, payload: any) => { emittedEvents.push({ name, payload }); },
    on: () => () => {},
  },
};

/** The spawner uses the 3D layer's seeded RNG — use the REAL one, not a lookalike. */
function realMakeRng(): (seed?: number) => () => number {
  const world = generateGame3D(['world']).files['src/game/three/world.ts'];
  const at = world.indexOf('export function makeRng');
  const src = world.slice(at, world.indexOf('\n}', at) + 2).replace('export function', 'function');
  // It is TypeScript, so it has to be transpiled before it can be evaluated.
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  // eslint-disable-next-line no-new-func
  return new Function(`${js}; return makeRng;`)();
}

const combat = load('src/game/systems/combat.ts', { '../core/events': eventStub });
const ai = load('src/game/systems/ai.ts');
const projectile = load('src/game/systems/projectile.ts', { '../core/events': eventStub });
const spawner = load('src/game/systems/spawner.ts', { '../three/world': { makeRng: realMakeRng() } });

describe('i-frames — the bug that kills a player in half a second', () => {
  it('a second hit in the same instant is BLOCKED', () => {
    // Without this, an adjacent enemy deals its damage on every frame: 10 damage becomes 600/second.
    const hp = new combat.Health({ max: 100, invulnerable: 0.5 });
    expect(hp.damage(10).applied).toBe(10);
    expect(hp.damage(10).blocked).toBe(true);
    expect(hp.current).toBe(90);
  });

  it('sixty frames of contact deal ONE hit, not sixty', () => {
    // This is the actual scenario, simulated: an enemy touching the player for one second.
    const hp = new combat.Health({ max: 100, invulnerable: 0.5 });
    for (let f = 0; f < 60; f++) { hp.tick(1 / 60); hp.damage(10); }
    // 1 second at 0.5s i-frames = 2 hits, not 60. The naive version leaves the player dead 5× over.
    expect(hp.current).toBe(80);
    expect(hp.isDead).toBe(false);
  });

  it('the window is real time, not frames — it expires', () => {
    const hp = new combat.Health({ max: 100, invulnerable: 0.5 });
    hp.damage(10);
    hp.tick(0.6);
    expect(hp.damage(10).applied).toBe(10);
  });

  it('invulnerable: 0 is honoured, for destructibles that should take every hit', () => {
    const crate = new combat.Health({ max: 30, invulnerable: 0 });
    crate.damage(10); crate.damage(10); crate.damage(10);
    expect(crate.isDead).toBe(true);
  });
});

describe('death fires exactly once', () => {
  it('two lethal hits produce ONE death', () => {
    // Otherwise: two death sounds, two explosions, and score awarded twice.
    const hp = new combat.Health({ max: 10, invulnerable: 0 });
    const first = hp.damage(50);
    const second = hp.damage(50);
    expect(first.died).toBe(true);
    expect(second.died).toBe(false);
    expect(second.blocked).toBe(true);
  });

  it('a dead thing cannot be healed back by accident', () => {
    const hp = new combat.Health({ max: 10, invulnerable: 0 });
    hp.damage(50);
    expect(hp.heal(100)).toBe(0);
    expect(hp.isDead).toBe(true);
  });

  it('health never goes negative and the fraction stays 0..1', () => {
    const hp = new combat.Health({ max: 40, invulnerable: 0 });
    hp.damage(1000);
    expect(hp.current).toBe(0);
    expect(hp.fraction).toBe(0);
  });

  it('heal cannot overshoot the maximum', () => {
    const hp = new combat.Health({ max: 50, invulnerable: 0 });
    hp.damage(10);
    expect(hp.heal(999)).toBe(10);
    expect(hp.current).toBe(50);
  });
});

describe('the attack cooldown is a SEPARATE rule from i-frames', () => {
  it('limits how often an attacker swings', () => {
    const cd = new combat.Cooldown(1);
    expect(cd.tryUse()).toBe(true);
    expect(cd.tryUse()).toBe(false);
    cd.tick(1.01);
    expect(cd.tryUse()).toBe(true);
  });

  it('two enemies together still cannot delete the player — that is what i-frames add', () => {
    // Each attacker has its own cooldown, so cooldowns alone do not bound incoming damage. This is
    // exactly why both rules exist.
    const hp = new combat.Health({ max: 100, invulnerable: 0.5 });
    const a = new combat.Cooldown(0.2);
    const b = new combat.Cooldown(0.2);
    for (let f = 0; f < 60; f++) {
      hp.tick(1 / 60); a.tick(1 / 60); b.tick(1 / 60);
      if (a.tryUse()) hp.damage(10);
      if (b.tryUse()) hp.damage(10);
    }
    expect(hp.current).toBe(80); // bounded by i-frames, not by the two cooldowns
  });
});

describe('bullet tunneling — the bug that makes a shooter feel broken', () => {
  const target = { position: { x: 0, y: 0, z: 10 }, radius: 0.25 };

  it('a FAST bullet hits a SMALL enemy it would otherwise skip', () => {
    // 60 m/s = 1 metre per frame at 60Hz. The enemy is 0.5m across, so at no sampled position is the
    // bullet inside it. Endpoint testing misses completely; segment testing cannot.
    const sys = new projectile.ProjectileSystem(16);
    sys.fire({ position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 }, speed: 60, damage: 7 });
    let hits: any[] = [];
    for (let f = 0; f < 30 && hits.length === 0; f++) hits = sys.update(1 / 60, [target]);
    expect(hits).toHaveLength(1);
    expect(hits[0].damage).toBe(7);
  });

  it('and it still hits at an absurd speed, where the miss is guaranteed without segments', () => {
    const sys = new projectile.ProjectileSystem(16);
    sys.fire({ position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 }, speed: 600 });
    const hits = sys.update(1 / 60, [target]); // one frame: 10m travelled, straight past the enemy
    expect(hits).toHaveLength(1);
  });

  it('does NOT hit something the bullet passed beside', () => {
    // The complement: a segment test that hits everything would be just as wrong.
    const sys = new projectile.ProjectileSystem(16);
    sys.fire({ position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 }, speed: 60 });
    const beside = { position: { x: 3, y: 0, z: 10 }, radius: 0.25 };
    let hits: any[] = [];
    for (let f = 0; f < 30; f++) hits = hits.concat(sys.update(1 / 60, [beside]));
    expect(hits).toHaveLength(0);
  });

  it('does not hit BEHIND the muzzle — the segment is clamped, not an infinite line', () => {
    const sys = new projectile.ProjectileSystem(16);
    sys.fire({ position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 }, speed: 60 });
    const behind = { position: { x: 0, y: 0, z: -10 }, radius: 0.25 };
    let hits: any[] = [];
    for (let f = 0; f < 10; f++) hits = hits.concat(sys.update(1 / 60, [behind]));
    expect(hits).toHaveLength(0);
  });

  it('credits the NEAREST target when two are in the path', () => {
    const sys = new projectile.ProjectileSystem(16);
    sys.fire({ position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 }, speed: 600 });
    const near = { position: { x: 0, y: 0, z: 4 }, radius: 0.5, ref: 'near' };
    const far = { position: { x: 0, y: 0, z: 8 }, radius: 0.5, ref: 'far' };
    const hits = sys.update(1 / 60, [far, near]); // deliberately out of order
    expect(hits).toHaveLength(1);
    expect(hits[0].target.ref).toBe('near');
  });

  it('a bullet is consumed by its hit and cannot hit twice', () => {
    const sys = new projectile.ProjectileSystem(16);
    sys.fire({ position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 }, speed: 600 });
    sys.update(1 / 60, [target]);
    expect(sys.update(1 / 60, [target])).toHaveLength(0);
    expect(sys.activeCount).toBe(0);
  });

  it('expires on its lifetime instead of flying forever', () => {
    const sys = new projectile.ProjectileSystem(16);
    sys.fire({ position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 }, speed: 10, life: 0.5 });
    for (let f = 0; f < 60; f++) sys.update(1 / 60, []);
    expect(sys.activeCount).toBe(0);
  });

  it('a zero direction is refused, not left sitting at the muzzle', () => {
    const sys = new projectile.ProjectileSystem(4);
    expect(sys.fire({ position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 0 } })).toBe(false);
    expect(sys.activeCount).toBe(0);
  });

  it('a full pool recycles instead of silently refusing to shoot', () => {
    // A weapon that stops working at the busiest moment feels broken, not "at capacity".
    const sys = new projectile.ProjectileSystem(2);
    for (let i = 0; i < 5; i++) {
      expect(sys.fire({ position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 }, speed: 5 })).toBe(true);
    }
    expect(sys.activeCount).toBe(2);
  });

  it('the segment maths is exact, including the degenerate zero-length case', () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 10 };
    expect(projectile.distanceToSegmentSq({ x: 0, y: 0, z: 5 }, a, b)).toBeCloseTo(0, 6);
    expect(projectile.distanceToSegmentSq({ x: 3, y: 0, z: 5 }, a, b)).toBeCloseTo(9, 6);
    expect(projectile.distanceToSegmentSq({ x: 0, y: 0, z: -4 }, a, b)).toBeCloseTo(16, 6); // clamped
    // A stationary bullet would divide by zero and return NaN, so every test would silently fail.
    expect(projectile.distanceToSegmentSq({ x: 0, y: 0, z: 3 }, a, a)).toBeCloseTo(9, 6);
  });
});

describe('enemy AI — the rules that stop a crowd being one blob', () => {
  const cfg = ai.DEFAULT_ENEMY;

  it('SEPARATION pushes two enemies apart instead of letting them merge', () => {
    const sep = ai.separationVector({ x: 0, z: 0 }, [{ x: 0.5, z: 0 }], 2.4);
    expect(sep.x).toBeLessThan(0); // pushed away from the neighbour
    expect(Math.abs(sep.z)).toBeLessThan(1e-9);
  });

  it('pushes HARDER the closer the neighbour is', () => {
    const close = ai.separationVector({ x: 0, z: 0 }, [{ x: 0.2, z: 0 }], 2.4);
    const far = ai.separationVector({ x: 0, z: 0 }, [{ x: 2.0, z: 0 }], 2.4);
    expect(Math.abs(close.x)).toBeGreaterThan(Math.abs(far.x));
  });

  it('a pack chasing the same player does NOT converge to one point', () => {
    // The real scenario, simulated: five enemies, same target, two seconds.
    let states = [0, 1, 2, 3, 4].map((i) => ai.initialEnemyState(-10 + i * 0.6, 0));
    const player = { x: 10, z: 0 };
    for (let f = 0; f < 120; f++) {
      states = states.map((s, i) => ai.stepEnemyAI(
        s,
        { player, neighbours: states.filter((_, j) => j !== i).map((o) => o.position), canSeePlayer: true },
        cfg,
        1 / 60,
      ).state);
    }
    let minGap = Infinity;
    for (let i = 0; i < states.length; i++) {
      for (let j = i + 1; j < states.length; j++) {
        minGap = Math.min(minGap, Math.hypot(states[i].position.x - states[j].position.x, states[i].position.z - states[j].position.z));
      }
    }
    expect(minGap).toBeGreaterThan(0.5); // without separation this collapses to ~0
  });

  it('DE-AGGRO IS LARGER THAN AGGRO, so the enemy cannot flicker at the boundary', () => {
    expect(cfg.loseRadius).toBeGreaterThan(cfg.detectRadius);

    const between = { x: 20, z: 0 }; // outside detect (16), inside lose (24)
    const idle = ai.initialEnemyState(0, 0);
    const chasing = { ...ai.initialEnemyState(0, 0), mode: 'chase' as const };
    const p = { player: between, neighbours: [], canSeePlayer: true };

    expect(ai.stepEnemyAI(idle, p, cfg, 1 / 60).state.mode).toBe('idle');
    expect(ai.stepEnemyAI(chasing, p, cfg, 1 / 60).state.mode).toBe('chase');
  });

  it('does not aggro through a wall', () => {
    const idle = ai.initialEnemyState(0, 0);
    const d = ai.stepEnemyAI(idle, { player: { x: 2, z: 0 }, neighbours: [], canSeePlayer: false }, cfg, 1 / 60);
    expect(d.state.mode).toBe('idle');
    expect(d.wantsAttack).toBe(false);
  });

  it('only REQUESTS an attack — it never decides to hit', () => {
    const near = ai.initialEnemyState(0, 0);
    const d = ai.stepEnemyAI(near, { player: { x: 1, z: 0 }, neighbours: [], canSeePlayer: true }, cfg, 1 / 60);
    expect(d.state.mode).toBe('attack');
    expect(d.wantsAttack).toBe(true);
  });

  it('reports the frame it became alerted, once', () => {
    const idle = ai.initialEnemyState(0, 0);
    const p = { player: { x: 8, z: 0 }, neighbours: [], canSeePlayer: true };
    const first = ai.stepEnemyAI(idle, p, cfg, 1 / 60);
    expect(first.alerted).toBe(true);
    expect(ai.stepEnemyAI(first.state, p, cfg, 1 / 60).alerted).toBe(false);
  });

  it('turns at a finite rate — instant snapping reads as robotic', () => {
    const s = { ...ai.initialEnemyState(0, 0), facing: 0 };
    const d = ai.stepEnemyAI(s, { player: { x: 0, z: -10 }, neighbours: [], canSeePlayer: true }, cfg, 1 / 60);
    expect(Math.abs(d.state.facing)).toBeLessThanOrEqual(cfg.turnRate / 60 + 1e-9);
  });

  it('takes the SHORT way round when turning', () => {
    expect(ai.angleDelta(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2, 6);
    expect(ai.angleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 6);
  });

  it('never exceeds its speed, however hard separation pushes', () => {
    const crowd = Array.from({ length: 8 }, (_, i) => ({ x: Math.cos(i) * 0.3, z: Math.sin(i) * 0.3 }));
    const d = ai.stepEnemyAI(
      ai.initialEnemyState(0, 0),
      { player: { x: 5, z: 0 }, neighbours: crowd, canSeePlayer: true },
      cfg,
      1 / 60,
    );
    expect(Math.hypot(d.velocity.x, d.velocity.z)).toBeLessThanOrEqual(cfg.chaseSpeed + 1e-6);
  });

  it('is PURE — it never mutates the state it was given', () => {
    const before = ai.initialEnemyState(3, 4);
    const snapshot = JSON.stringify(before);
    ai.stepEnemyAI(before, { player: { x: 5, z: 0 }, neighbours: [{ x: 3.1, z: 4 }], canSeePlayer: true }, cfg, 1 / 60);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('a dead enemy stops thinking and stops moving', () => {
    const dead = { ...ai.initialEnemyState(0, 0), mode: 'dead' as const };
    const d = ai.stepEnemyAI(dead, { player: { x: 1, z: 0 }, neighbours: [], canSeePlayer: true }, cfg, 1 / 60);
    expect(d.velocity).toEqual({ x: 0, z: 0 });
    expect(d.wantsAttack).toBe(false);
  });

  it('patrol is deterministic — the same seed replays identically', () => {
    const a = ai.initialEnemyState(0, 0, 5);
    const runOnce = () => {
      let s = a;
      for (let f = 0; f < 100; f++) {
        s = ai.stepEnemyAI(s, { player: { x: 999, z: 999 }, neighbours: [], canSeePlayer: false }, cfg, 1 / 60).state;
      }
      return s.position;
    };
    expect(runOnce()).toEqual(runOnce());
  });
});

describe('waves', () => {
  it('difficulty rises but does NOT double — wave 8 must stay winnable', () => {
    const w0 = spawner.planWave(0);
    const w8 = spawner.planWave(8);
    expect(w8.count).toBeGreaterThan(w0.count);
    expect(w8.count).toBeLessThan(w0.count * 8);
    expect(w8.healthMultiplier).toBeGreaterThan(w0.healthMultiplier);
  });

  it('enemy speed is CAPPED — unoutrunnable is not difficulty', () => {
    expect(spawner.planWave(99).speedMultiplier).toBeLessThanOrEqual(1.7);
  });

  it('a negative or fractional wave index cannot produce nonsense', () => {
    expect(spawner.planWave(-5).count).toBeGreaterThan(0);
    expect(spawner.planWave(2.7).index).toBe(2);
  });

  it('NEVER spawns on top of the player', () => {
    // Spawning in the player's lap reads as the game cheating, not as difficulty.
    const player = { x: 5, z: -3 };
    const points = spawner.spawnRing(24, player, { minDistance: 14, maxDistance: 26, arenaRadius: 60 });
    expect(points).toHaveLength(24);
    for (const p of points) {
      expect(Math.hypot(p.x - player.x, p.z - player.z)).toBeGreaterThanOrEqual(13.999);
    }
  });

  it('keeps spawns inside the arena even when the player stands at its edge', () => {
    const player = { x: 58, z: 0 };
    for (const p of spawner.spawnRing(16, player, { arenaRadius: 60, minDistance: 10 })) {
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(60.001);
      // and clamping must not have dragged it onto the player
      expect(Math.hypot(p.x - player.x, p.z - player.z)).toBeGreaterThanOrEqual(9.999);
    }
  });

  it('BOTH constraints hold from every player position, not just the easy one', () => {
    // The fix has two branches (inside the arena vs clamped to its edge) and the edge case is exactly
    // where the obvious implementation walks the point back outside. Sweep instead of sampling one.
    const arena = 60;
    const min = 12;
    for (let r = 0; r <= arena; r += 6) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 5) {
        const player = { x: Math.cos(a) * r, z: Math.sin(a) * r };
        for (const p of spawner.spawnRing(10, player, { arenaRadius: arena, minDistance: min, maxDistance: 24, seed: 3 })) {
          expect(Math.hypot(p.x, p.z), `outside arena for player r=${r}`).toBeLessThanOrEqual(arena + 0.001);
          expect(Math.hypot(p.x - player.x, p.z - player.z), `too close for player r=${r}`).toBeGreaterThanOrEqual(min - 0.001);
        }
      }
    }
  });

  it('spreads around the player instead of clustering on one side', () => {
    // A clustered wave arrives from one direction and is trivially kited.
    const pts = spawner.spawnRing(12, { x: 0, z: 0 }, { minDistance: 10, maxDistance: 20 });
    const quadrants = new Set(pts.map((p: any) => `${p.x > 0}${p.z > 0}`));
    expect(quadrants.size).toBe(4);
  });

  it('is SEEDED — the same seed gives the same wave', () => {
    const a = spawner.spawnRing(8, { x: 0, z: 0 }, { seed: 7 });
    const b = spawner.spawnRing(8, { x: 0, z: 0 }, { seed: 7 });
    const c = spawner.spawnRing(8, { x: 0, z: 0 }, { seed: 8 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('a count of zero is empty, not a crash', () => {
    expect(spawner.spawnRing(0, { x: 0, z: 0 })).toEqual([]);
    expect(spawner.spawnRing(-3, { x: 0, z: 0 })).toEqual([]);
  });

  it('AN ENEMY THROUGH THE FLOOR DOES NOT HANG THE WAVE FOREVER', () => {
    // Without this the player stands in an empty arena waiting for a wave that can never clear.
    const enemies = [
      { alive: false, position: { x: 0, y: 0, z: 0 } },
      { alive: true, position: { x: 0, y: -800, z: 0 } },
    ];
    expect(spawner.waveCleared(enemies)).toBe(true);
    expect(spawner.fallenOutOfWorld(enemies)).toHaveLength(1);
  });

  it('but a living enemy DOES keep the wave open', () => {
    expect(spawner.waveCleared([{ alive: true, position: { x: 0, y: 1, z: 0 } }])).toBe(false);
  });
});

describe('the systems announce themselves through events, not by calling VFX', () => {
  it('damage and death emit, so particles and sound stay decoupled', () => {
    emittedEvents.length = 0;
    const hp = new combat.Health({ max: 20, invulnerable: 0, damagedEvent: 'ENEMY_DAMAGED', diedEvent: 'ENEMY_DIED' });
    hp.damage(5, { x: 1, y: 2, z: 3 });
    hp.damage(100, { x: 1, y: 2, z: 3 });
    const names = emittedEvents.map((e) => e.name);
    expect(names).toContain('ENEMY_DAMAGED');
    expect(names).toContain('ENEMY_DIED');
    // Position must travel with the event, or feedback.ts refuses to spawn the particle.
    expect(emittedEvents.find((e) => e.name === 'ENEMY_DIED')?.payload.position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('firing and hitting emit the events the feedback table already handles', () => {
    emittedEvents.length = 0;
    const sys = new projectile.ProjectileSystem(8);
    sys.fire({ position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 }, speed: 600 });
    sys.update(1 / 60, [{ position: { x: 0, y: 0, z: 5 }, radius: 0.5 }]);
    const names = emittedEvents.map((e) => e.name);
    expect(names).toContain('WEAPON_FIRED');
    expect(names).toContain('PROJECTILE_HIT');
  });

  it('every event name it emits is a real GameEvent', () => {
    const runtime = readFileSync(join(__dirname, 'GameRuntimeGenerator.ts'), 'utf8');
    const union = runtime.slice(runtime.indexOf('export type GameEvent ='), runtime.indexOf('type Handler ='));
    const src = Object.values(all.files).join('\n');
    const used = new Set([...src.matchAll(/events\.emit\('([A-Z_]+)'/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThanOrEqual(3);
    for (const ev of used) expect(union, `${ev} is not a GameEvent`).toContain(`'${ev}'`);
  });
});

describe('the pack itself', () => {
  it('adds no dependency', () => {
    expect(all.dependencies).toEqual([]);
  });

  it('emits every advertised module', () => {
    expect(Object.keys(all.files)).toHaveLength(GAME_SYSTEM_MODULES.length);
  });

  it('junk input never throws and falls back to the full pack', () => {
    for (const bad of [undefined, [], ['nope'], [null as unknown as string]]) {
      expect(() => generateGameSystems(bad)).not.toThrow();
      expect(Object.keys(generateGameSystems(bad).files).length).toBeGreaterThan(0);
    }
  });

  it('the instructions state the rules, not just the API', () => {
    const { instructions } = generateGameSystems();
    expect(instructions).toContain('i-frames');
    expect(instructions).toContain('SEGMENT');
    expect(instructions).toContain('separation');
  });
});

describe('the builder can really call this', () => {
  const catalog = readFileSync(join(__dirname, '../AgentV3/ToolCatalog.ts'), 'utf8');
  const dispatcher = readFileSync(join(__dirname, '../AgentV3/ToolDispatcher.ts'), 'utf8');

  it('is registered in BOTH the definition and the exposed list', () => {
    expect(catalog).toContain("name: 'generate_game_systems'");
    expect(catalog).toContain("  'generate_game_systems',");
  });

  it('the dispatcher handles it and writes the files', () => {
    expect(dispatcher).toContain("case 'generate_game_systems': {");
    expect(dispatcher).toContain('generateGameSystems(gsyInclude)');
  });

  it('the description names the rules so the model does not reimplement them badly', () => {
    const at = catalog.indexOf("name: 'generate_game_systems'");
    const def = catalog.slice(at, at + 2500);
    expect(def).toContain('i-frames');
    expect(def).toContain('tunnel');
  });
});
