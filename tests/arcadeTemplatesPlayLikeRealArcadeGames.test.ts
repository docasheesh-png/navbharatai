// 🕹️ THE ARCADE AND ACTION TEMPLATES PLAY LIKE REAL ARCADE GAMES (template round R10). These run the REAL materialised App.tsx.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_LIBRARY, materializeGame } from '../src/server/AgentV3/gameLibrary/registry';

const DIR = join(__dirname, `.tmp-arcade-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
const M: Record<string, any> = {}; const SRC: Record<string, string> = {};
const IDS = ['lane-dash', 'dodge-fall', 'bolt-arena', 'shield-rush'];
beforeAll(async () => {
  for (const id of IDS) {
    const dir = join(DIR, id); mkdirSync(dir, { recursive: true });
    SRC[id] = materializeGame(GAME_LIBRARY.find((g) => g.id === id)!);
    writeFileSync(join(dir, 'App.tsx'), SRC[id]);
    writeFileSync(join(dir, 'theme.tsx'), 'export default function ThemeToggle() { return null; }\n');
    M[id] = await import(join(dir, 'App.tsx'));
  }
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe('🏃 Lane Dash', () => {
  const L = () => M['lane-dash'];
  it('the speed eases up from the start speed and never passes the top speed', () => {
    const o = L().OPTIONS;
    expect(L().speedAt(0)).toBe(o.startSpeed);
    let prev = 0;
    for (let s = 0; s <= 600; s += 15) { const v = L().speedAt(s); expect(v).toBeGreaterThanOrEqual(prev); expect(v).toBeLessThanOrEqual(o.topSpeed); prev = v; }
    expect(L().speedAt(o.rampSeconds)).toBeGreaterThan(o.topSpeed * 0.9);
  });
  it('every chunk can be got through, and harder chunks only come later in the run', () => {
    for (const [name, c] of Object.entries<any>(L().CHUNKS)) {
      const things = c.pieces.map(([dz, lane, kind]: any) => ({ lane: lane < 0 ? 1 : lane, z: dz, kind }));
      expect(L().passable(things), name).toBe(true);
    }
    const r = rng(7);
    for (let k = 0; k < 40; k++) {
      const early = L().nextChunk(0, 0, r);
      expect(L().passable(early.things)).toBe(true);
      expect(early.things.every((x: any) => x.lane >= 0 && x.lane < L().OPTIONS.lanes)).toBe(true);
    }
    const kindsEarly = new Set<string>(); const kindsLate = new Set<string>();
    for (let k = 0; k < 60; k++) {
      L().nextChunk(0, 0, r).things.forEach((x: any) => kindsEarly.add(x.kind));
      L().nextChunk(0, 2000, r).things.forEach((x: any) => kindsLate.add(x.kind));
    }
    expect(kindsEarly.has('high')).toBe(false);                 // sliding is taught later
    expect(kindsLate.has('high')).toBe(true);
  });
  it('jump clears low walls, slide clears high bars, a block needs a lane change; coins and magnets are picked up', () => {
    const run = { lane: 1, air: 0, slide: 0 };
    expect(L().touch(run, { lane: 1, z: 0, kind: 'low' })).toBe('crash');
    expect(L().touch({ ...run, air: 0.3 }, { lane: 1, z: 0, kind: 'low' })).toBeNull();
    expect(L().touch(run, { lane: 1, z: 0, kind: 'high' })).toBe('crash');
    expect(L().touch({ ...run, slide: 0.3 }, { lane: 1, z: 0, kind: 'high' })).toBeNull();
    expect(L().touch({ ...run, air: 0.3 }, { lane: 1, z: 0, kind: 'block' })).toBe('crash');
    expect(L().touch(run, { lane: 0, z: 0, kind: 'block' })).toBeNull();
    expect(L().touch(run, { lane: 1, z: 0, kind: 'coin' })).toBe('coin');
    expect(L().touch(run, { lane: 1, z: 0, kind: 'coin', taken: true })).toBeNull();
    expect(L().touch(run, { lane: 1, z: 0, kind: 'magnet' })).toBe('magnet');
  });
  it('a swipe reads the main direction, and a small move is only a tap', () => {
    expect(L().swipe(-60, 10)).toBe('left'); expect(L().swipe(60, -10)).toBe('right');
    expect(L().swipe(5, -70)).toBe('up'); expect(L().swipe(5, 70)).toBe('down');
    expect(L().swipe(4, 6)).toBeNull();
  });
  it('missions check the run', () => {
    const done = L().MISSIONS.filter((m: any) => m.goal({ metres: 600, coins: 10, jumps: 12, slides: 0 })).map((m: any) => m.en);
    expect(done).toEqual(['Run 500 m', 'Jump 10 times']);
  });
});

describe('☄️ Dodge Fall', () => {
  const D = () => M['dodge-fall'];
  it('every wave leaves a way through, for hundreds of waves', () => {
    const r = rng(11);
    for (let w = 1; w < 300; w++) {
      const wave = D().makeWave(w, r);
      expect(D().hasWayThrough(wave.map((f: any) => ({ ...f, y: 0 })))).toBe(true);
      for (const f of wave) { expect(f.x).toBeGreaterThan(0); expect(f.x).toBeLessThan(D().OPTIONS.width); }
    }
  });
  it('a hit box is round and a little forgiving; a long log hits along its length', () => {
    const rock = { kind: 'rock', x: 100, y: 100 };
    const pr = D().OPTIONS.playerRadius, rr = D().FALLERS.rock.r;
    expect(D().hits(rock, 100, 100)).toBe(true);
    expect(D().hits(rock, 100 + rr + pr * 0.9, 100)).toBe(false);          // drawn shapes touch, the hit box does not yet
    expect(D().hits(rock, 100 + rr + pr * 0.5, 100)).toBe(true);
    const log = { kind: 'log', x: 100, y: 100 };
    expect(D().hits(log, 130, 100)).toBe(true);
    expect(D().hits(log, 100, 140)).toBe(false);
  });
  it('a near miss counts only when it really is near and not a hit', () => {
    const rock = { kind: 'rock', x: 100, y: 100 };
    const pr = D().OPTIONS.playerRadius, rr = D().FALLERS.rock.r;
    expect(D().grazes(rock, 100 + rr + pr + 5, 100)).toBe(true);
    expect(D().grazes(rock, 100 + rr + pr + 40, 100)).toBe(false);
    expect(D().grazes(rock, 100, 100)).toBe(false);
  });
  it('the move eases toward the target without overshooting; falls speed up and waves come faster to a floor', () => {
    expect(D().moveToward(0, 100, 400, 0.1)).toBe(40);
    expect(D().moveToward(95, 100, 400, 0.1)).toBe(100);
    expect(D().moveToward(100, 0, 400, 0.1)).toBe(60);
    expect(D().fallSpeed(60)).toBeGreaterThan(D().fallSpeed(0));
    expect(D().waveGap(10)).toBeLessThan(D().waveGap(1));
    expect(D().waveGap(1000)).toBe(D().OPTIONS.fastestWave);
  });
});

describe('⚡ Bolt Arena', () => {
  const B = () => M['bolt-arena'];
  it('enemies never appear close to the player, wherever the player stands', () => {
    const r = rng(3), o = B().OPTIONS;
    for (let k = 0; k < 300; k++) {
      const px = r() * o.size, py = r() * o.size, p = B().spawnPoint(px, py, r);
      expect(Math.hypot(p.x - px, p.y - py)).toBeGreaterThanOrEqual(o.spawnSafeDistance - 1);
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(o.size);
    }
  });
  it('auto-aim picks the nearest living enemy; extra bolts fan evenly round the aim', () => {
    const es = [{ kind: 'chaser', x: 100, y: 0, hp: 2 }, { kind: 'chaser', x: 10, y: 0, hp: 0 }, { kind: 'chaser', x: 50, y: 0, hp: 1 }];
    expect(B().nearest(es, 0, 0).x).toBe(50);
    expect(B().nearest([], 0, 0)).toBeNull();
    expect(B().fan(1, 1)).toEqual([1]);
    const three = B().fan(1, 3);
    expect(three[1]).toBe(1); expect(three[0] + three[2]).toBeCloseTo(2);
  });
  it('waves grow and bring tougher kinds later; a splitter breaks into two minis', () => {
    expect(B().waveMix(1).every((k: string) => k === 'chaser')).toBe(true);
    expect(B().waveMix(5).length).toBeGreaterThan(B().waveMix(1).length);
    expect(B().waveMix(5)).toContain('splitter'); expect(B().waveMix(3)).toContain('orbiter');
    const sp = { kind: 'splitter', x: 0, y: 0, hp: 1, vx: 0, vy: 0, age: 0 };
    const res = B().hitEnemy(sp, 1, 0);
    expect(res.dead).toBe(true); expect(res.spawn.map((e: any) => e.kind)).toEqual(['mini', 'mini']);
    const ch = { kind: 'chaser', x: 0, y: 0, hp: 2, vx: 0, vy: 0, age: 0 };
    expect(B().hitEnemy(ch, 1, 0)).toEqual({ dead: false, spawn: [] }); expect(ch.vx).toBeGreaterThan(0);   // knocked back
  });
  it('a chaser closes in; upgrades are three different ones and each changes the stats', () => {
    const e = { kind: 'chaser', x: 0, y: 0, hp: 2, vx: 0, vy: 0, age: 0 };
    const p = B().steer(e, 100, 0, 0.1);
    expect(p.x).toBeGreaterThan(0); expect(Math.abs(p.y)).toBeLessThan(1e-9);
    const three = B().offer(rng(5)); expect(new Set(three).size).toBe(3);
    const base = B().baseStats();
    for (const [id, u] of Object.entries<any>(B().UPGRADES)) expect(u.apply(base), id).not.toEqual(base);
  });
});

describe('🛡️ Shield Rush', () => {
  const S = () => M['shield-rush'];
  it('turns take the short way round', () => {
    expect(S().angleDiff(0, 1)).toBeCloseTo(1);
    expect(S().angleDiff(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(-0.2);
    expect(S().angleDiff(3, -3)).toBeCloseTo(2 * Math.PI - 6);
  });
  it('a shot is blocked only when the shield faces it as it reaches the shield; centred blocks are perfect', () => {
    const o = S().OPTIONS, at = o.shieldRadius + 2;
    expect(S().resolve({ angle: 0, dist: at, kind: 'slow', delay: 0 }, 0, 4)).toBe('perfect');
    expect(S().resolve({ angle: 0, dist: at, kind: 'slow', delay: 0 }, o.shieldArc * 0.4, 4)).toBe('blocked');
    expect(S().resolve({ angle: 0, dist: at, kind: 'slow', delay: 0 }, Math.PI, 4)).toBe('flying');
    expect(S().resolve({ angle: 0, dist: o.coreRadius + 2, kind: 'slow', delay: 0 }, Math.PI, 4)).toBe('hit');
    expect(S().resolve({ angle: 0, dist: 150, kind: 'slow', delay: 0 }, 0, 4)).toBe('flying');
    expect(S().covers(2 * Math.PI - 0.1, 0.1)).toBe(true);                               // across the wrap-around
  });
  it('patterns: easy ones first, tougher ones later; shots come faster and more often, to a limit', () => {
    const r = rng(9), kinds1 = new Set<string>(), kinds3 = new Set<string>();
    for (let k = 0; k < 80; k++) {
      S().pickPattern(1, r).forEach((x: any) => kinds1.add(x.kind));
      S().pickPattern(5, r).forEach((x: any) => kinds3.add(x.kind));
    }
    expect([...kinds1]).toEqual(['slow']); expect(kinds3.has('heavy')).toBe(true);
    expect(S().patternGap(5)).toBeLessThan(S().patternGap(1)); expect(S().patternGap(99)).toBe(0.6);
    expect(S().speedScale(99)).toBe(2); expect(S().levelFor(0)).toBe(1); expect(S().levelFor(300)).toBe(3);
  });
});

describe('✏️ editable by chat', () => {
  it.each(IDS)('%s has named OPTIONS and COPY blocks, both languages, and no line too long to edit', (id) => {
    expect(SRC[id]).toMatch(/export const OPTIONS = \{/);
    expect(SRC[id]).toMatch(/const COPY = \{/);
    expect(SRC[id]).toContain('खेल खत्म'); expect(SRC[id]).toContain('Play again');
    for (const line of SRC[id].split('\n')) expect(line.length).toBeLessThan(220);
  });
});
