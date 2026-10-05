// A RUN HAS RHYTHM AND FLOW (2026-10-05, the game-engine taxonomy: gameplay, game AI, playability).
//
// A generated action game spawned at one rate for ever and ramped difficulty on a fixed curve: a new player
// was crushed by wave 4 and a good one was bored by wave 2, with no breather in between. The Director gives
// a run its shape (build → peak → breather) and follows the player's skill — slowly, boundedly, honestly.
// These tests drive the GENERATED module.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';

const DIR = join(__dirname, `.tmp-game-meta-director-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let D: any; let E: any; let SP: any;
const store = new Map<string, string>();

beforeAll(async () => {
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  (globalThis as any).document = { createElement: () => ({ getContext: () => null }) };
  for (const r of [generateGameSystems(['director', 'spawner']), generateGameRuntime(), generateGame3D(['world'])]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  D = await import(join(DIR, 'src/game/systems/director.ts'));
  E = await import(join(DIR, 'src/game/core/events.ts'));
  SP = await import(join(DIR, 'src/game/systems/spawner.ts'));
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).localStorage; delete (globalThis as any).document; });

const tick = (d: any, seconds: number, each?: (t: number) => void) => { for (let i = 0; i < Math.round(seconds * 30); i++) { each?.(i / 30); d.update(1 / 30); } };

describe('flow: difficulty follows the player, slowly and within bounds', () => {
  it('a struggling player is eased; a dominating player is pushed; neither leaves the bounds', () => {
    const weak = new D.Director();
    tick(weak, 180, (t) => { if (Math.round(t * 30) % 90 === 0) weak.playerHurt(0.2); if (Math.round(t * 30) % 1500 === 0) weak.playerDied(); });
    expect(weak.difficulty).toBeLessThan(0.85);
    expect(weak.difficulty).toBeGreaterThanOrEqual(0.6);

    const strong = new D.Director();
    tick(strong, 180, (t) => { if (Math.round(t * 30) % 45 === 0) strong.enemyKilled(); });
    expect(strong.difficulty).toBeGreaterThan(1.3);
    expect(strong.difficulty).toBeLessThanOrEqual(1.8);
  });

  it('never changes faster than ~1.2% a second — nobody feels the game shift under them', () => {
    const d = new D.Director();
    let last = d.difficulty, worst = 0;
    tick(d, 60, (t) => { if (Math.round(t * 30) % 20 === 0) d.playerHurt(0.4); worst = Math.max(worst, Math.abs(d.difficulty - last)); last = d.difficulty; });
    expect(worst).toBeLessThanOrEqual(0.012 / 30 + 1e-9);
  });

  it('two quick deaths ease it AT ONCE (the moment a player quits) — once, not on every death', () => {
    const d = new D.Director();
    tick(d, 5);
    const before = d.difficulty;
    d.playerDied();
    expect(d.difficulty).toBeCloseTo(before, 6);              // one death: no jump
    tick(d, 20);
    const mid = d.difficulty;
    d.playerDied();
    expect(d.difficulty).toBeCloseTo(mid * 0.85, 6);          // the second, within 90 s: ease now
    const after = d.difficulty;
    d.playerDied();
    expect(d.difficulty).toBeCloseTo(after, 6);               // the window restarts — no spiral to the floor
  });

  it('adapt: false keeps every run identical, so a shared leaderboard stays fair', () => {
    const d = new D.Director({ adapt: false });
    tick(d, 120, (t) => { if (Math.round(t * 30) % 30 === 0) { d.playerHurt(0.5); d.playerDied(); } });
    expect(d.difficulty).toBe(1);
  });

  it('remembers this player between sessions (with a gameId), and never when not adapting', () => {
    const a = new D.Director({ gameId: 'g1' });
    tick(a, 120, (t) => { if (Math.round(t * 30) % 45 === 0) a.enemyKilled(); });
    a.save();
    const b = new D.Director({ gameId: 'g1' });
    expect(b.skill).toBeCloseTo(a.skill, 3);
    expect(b.difficulty).toBeGreaterThan(1.05);               // starts where the player left off
    new D.Director({ gameId: 'g2', adapt: false }).save();
    expect(store.has('nb-director-v1:g2')).toBe(false);
  });

  it('it feeds the spawner: a struggling player gets smaller waves than a strong one', () => {
    const weak = new D.Director({ startSkill: 0.1 }), strong = new D.Director({ startSkill: 0.9 });
    expect(SP.planWave(5, weak.difficulty).count).toBeLessThan(SP.planWave(5, 1).count);
    expect(SP.planWave(5, strong.difficulty).count).toBeGreaterThan(SP.planWave(5, 1).count);
  });
});

describe('rhythm: build, peak, breather', () => {
  it('a fight builds to a peak, the peak cannot last for ever, and the breather really stops spawns', () => {
    const d = new D.Director({ peakSeconds: 10, relaxSeconds: 6 });
    const paces: string[] = [];
    const off = E.events.on('PACE_CHANGED', (p: any) => paces.push(p.pace));
    let relaxSpawns = 0, relaxTime = 0;
    tick(d, 60, (t) => {
      if (Math.round(t * 30) % 15 === 0) d.playerHurt(0.08);      // a sustained fight
      if (d.pace === 'relax') { relaxTime += 1 / 30; if (d.canSpawn) relaxSpawns++; }
    });
    off();
    expect(paces.slice(0, 3)).toEqual(['peak', 'relax', 'build']);
    expect(relaxSpawns).toBe(0);
    expect(relaxTime).toBeGreaterThanOrEqual(5.9);
    expect(d.spawnRate).toBeGreaterThanOrEqual(0);
  });

  it('a calm run never peaks, and spawns at the full rate', () => {
    const d = new D.Director();
    tick(d, 60, (t) => { if (Math.round(t * 30) % 60 === 0) d.enemyKilled(); });
    expect(d.pace).toBe('build');
    expect(d.spawnRate).toBe(1);
  });

  it('bind() listens to the game\'s own events and unbinds cleanly', () => {
    const d = new D.Director();
    const off = d.bind();
    E.events.emit('PLAYER_DAMAGED', { amount: 50, health: 50 });
    expect(d.intensity).toBeGreaterThan(0.7);
    off();
    const i = d.intensity;
    E.events.emit('PLAYER_DAMAGED', { amount: 50, health: 0 });
    expect(d.intensity).toBe(i);
  });
});
