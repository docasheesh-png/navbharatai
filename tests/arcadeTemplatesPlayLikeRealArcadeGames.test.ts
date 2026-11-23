// 🕹️ THE ARCADE AND ACTION TEMPLATES PLAY LIKE REAL ARCADE GAMES (template round R10). These run the REAL materialised App.tsx.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_LIBRARY, materializeGame } from '../src/server/AgentV3/gameLibrary/registry';

const DIR = join(__dirname, `.tmp-arcade-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
const M: Record<string, any> = {}; const SRC: Record<string, string> = {};
const IDS = ['lane-dash', 'dodge-fall'];
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

describe('✏️ editable by chat', () => {
  it.each(IDS)('%s has named OPTIONS and COPY blocks, both languages, and no line too long to edit', (id) => {
    expect(SRC[id]).toMatch(/export const OPTIONS = \{/);
    expect(SRC[id]).toMatch(/const COPY = \{/);
    expect(SRC[id]).toContain('खेल खत्म'); expect(SRC[id]).toContain('Play again');
    for (const line of SRC[id].split('\n')) expect(line.length).toBeLessThan(220);
  });
});
