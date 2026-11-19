// CARROM PLAYS LIKE THE REAL BOARD (admin 2026-11-19 game-gap audit, India games pack d). These run the REAL generated
// src/game/board/carrom.ts: the starting layout, collisions that keep momentum, friction that stops every disc, cushion
// bounces, a coin aimed at a corner dropping in, and the family rules (own coin continues, the striker foul, covering
// the queen, winning the board).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateBoardGames } from '../src/server/lib/BoardGamesGenerator';

const DIR = join(__dirname, `.tmp-carrom-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let K: any;

beforeAll(async () => {
  for (const [p, c] of Object.entries(generateBoardGames().files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  K = await import(join(DIR, 'src/game/board/carrom.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** A board with only the given discs on it (the rest already pocketed), striker on the current baseline. */
function only(keep: Record<string, [number, number]>, turn: 0 | 1 = 0) {
  const s = K.createCarrom();
  s.turn = turn;
  for (const d of s.discs) {
    if (d.kind === 'striker') continue;
    if (keep[d.id]) { [d.x, d.y] = keep[d.id]; d.pocketed = false; } else d.pocketed = true;
  }
  return s;
}
/** The angle from the striker at (sx, baseline) through (x, y). */
const aim = (s: any, x: number, y: number) => { const st = s.discs.find((d: any) => d.kind === 'striker'); return Math.atan2(y - st.y, x - st.x); };
const corner = (k: any) => k.HALF - k.POCKET_RADIUS;
/**
 * A soft straight shot. The striker is nearly three times heavier than a coin, so after a straight hit it keeps about half
 * its speed — hit hard and it FOLLOWS the coin into the pocket (a foul, as on a real board). Soft enough that the coin
 * still reaches the pocket ~190 mm away while the striker stops about 34 mm past the impact.
 */
const SOFT = 0.105;

describe('🎯 the board and the physics', () => {
  it('starts with the queen in the middle and 9 white + 9 black, none overlapping', () => {
    const s = K.createCarrom();
    const coins = s.discs.filter((d: any) => d.kind !== 'striker');
    expect(coins.filter((d: any) => d.kind === 'white')).toHaveLength(9);
    expect(coins.filter((d: any) => d.kind === 'black')).toHaveLength(9);
    expect(s.discs.find((d: any) => d.kind === 'queen')).toMatchObject({ x: 0, y: 0 });
    for (let i = 0; i < s.discs.length; i++) for (let j = i + 1; j < s.discs.length; j++) {
      const a = s.discs[i], b = s.discs[j];
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r - 0.01);
    }
  });
  it('a collision keeps the momentum (by mass) and the striker passes energy to the coin', () => {
    const discs = [
      { id: 's', kind: 'striker', x: 0, y: 0, vx: 1000, vy: 0, r: K.STRIKER_RADIUS, pocketed: false },
      { id: 'c', kind: 'white', x: K.STRIKER_RADIUS + K.COIN_RADIUS + 1, y: 0, vx: 0, vy: 0, r: K.COIN_RADIUS, pocketed: false },
    ];
    const before = 15 * 1000;
    for (let i = 0; i < 4; i++) K.stepPhysics(discs, 1 / 240);
    const after = 15 * discs[0].vx + 5.5 * discs[1].vx;
    expect(Math.abs(after - before) / before).toBeLessThan(0.03);   // friction takes only a little over 4 steps
    expect(discs[1].vx).toBeGreaterThan(discs[0].vx);
  });
  it('friction stops every disc; a cushion bounces a disc back with some energy lost', () => {
    const d = [{ id: 'c', kind: 'white', x: 300, y: 0, vx: 800, vy: 0, r: K.COIN_RADIUS, pocketed: false }];
    let bounced = false;
    for (let i = 0; i < 240 * 10; i++) { K.stepPhysics(d, 1 / 240); if (d[0].vx < 0) bounced = true; }
    expect(bounced).toBe(true);
    expect(d[0].vx).toBe(0);
    expect(Math.abs(d[0].x)).toBeLessThan(K.HALF);
  });
});

describe('🔴 the rules', () => {
  it('a coin aimed at a corner drops in, and pocketing your own coin keeps your turn', () => {
    const c = corner(K);
    // A second white coin stays on the board, or sinking w0 would be the "last coin before the queen" foul.
    const s = only({ w0: [0, 0], w1: [200, -250], queen: [-200, -250] });
    // Put the white coin on the line from the striker to the bottom-left pocket.
    const st = s.discs.find((d: any) => d.kind === 'striker');
    st.x = 0; st.y = K.BASELINE;
    const w = s.discs.find((d: any) => d.id === 'w0');
    const dir = Math.atan2(c - st.y, -c - st.x);
    w.x = st.x + Math.cos(dir) * 150; w.y = st.y + Math.sin(dir) * 150;
    const shot = K.shoot(s, dir, SOFT);
    expect(shot.pocketed.map((p: any) => p.id)).toContain('w0');
    expect(shot.foul).toBe(false);
    expect(shot.turnContinues).toBe(true);
    expect(shot.state.turn).toBe(0);
    expect(shot.state.pocketedBy[0]).toBe(1);
    expect(shot.frames.length).toBeGreaterThan(5);
  });
  it('missing passes the turn; the striker comes back onto the next player\'s baseline', () => {
    const s = only({ w0: [0, 0], b0: [100, 0] });
    const shot = K.shoot(s, Math.PI, 0.05);   // a gentle shot sideways, into nothing
    expect(shot.pocketed).toEqual([]);
    expect(shot.state.turn).toBe(1);
    const st = shot.state.discs.find((d: any) => d.kind === 'striker');
    expect(st.y).toBe(-K.BASELINE);
    expect(st.pocketed).toBe(false);
  });
  it('pocketing the striker is a foul: the turn passes and one of your coins comes back to the middle', () => {
    const c = corner(K);
    const s = only({ w0: [0, -200], w1: [50, -200] });
    s.pocketedBy[0] = 3;
    s.discs.find((d: any) => d.id === 'w2').pocketed = true;
    const shot = K.shoot(s, aim(s, -c, c), 0.45);
    expect(shot.pocketed.map((p: any) => p.kind)).toContain('striker');
    expect(shot.foul).toBe(true);
    expect(shot.state.turn).toBe(1);
    expect(shot.state.pocketedBy[0]).toBe(2);
    expect(shot.message).toMatch(/striker/);
  });
  it('the queen must be covered: pocketed alone it is pending, and if the next shot misses it goes back', () => {
    const c = corner(K);
    const s = only({ queen: [0, 0], w0: [-100, -150], b0: [150, 150] });
    const st = s.discs.find((d: any) => d.kind === 'striker');
    const q = s.discs.find((d: any) => d.kind === 'queen');
    const dir = Math.atan2(c - st.y, -c - st.x);
    q.x = st.x + Math.cos(dir) * 150; q.y = st.y + Math.sin(dir) * 150;
    const first = K.shoot(s, dir, SOFT);
    expect(first.pocketed.map((p: any) => p.kind)).toContain('queen');
    expect(first.state.queen).toBe('pending');
    expect(first.turnContinues).toBe(true);
    const miss = K.shoot(first.state, Math.PI, 0.02);
    expect(miss.state.queen).toBe('board');
    expect(miss.state.discs.find((d: any) => d.kind === 'queen').pocketed).toBe(false);
    expect(miss.message).toMatch(/not covered/);
  });
  it('the last coin cannot go in before the queen is covered; once covered, the last coin wins the board', () => {
    const c = corner(K);
    const lastBeforeQueen = only({ w0: [0, 0], queen: [200, -200], b0: [-200, -250] });
    const st = lastBeforeQueen.discs.find((d: any) => d.kind === 'striker');
    const w = lastBeforeQueen.discs.find((d: any) => d.id === 'w0');
    const dir = Math.atan2(c - st.y, -c - st.x);
    w.x = st.x + Math.cos(dir) * 150; w.y = st.y + Math.sin(dir) * 150;
    const early = K.shoot(lastBeforeQueen, dir, SOFT);
    expect(early.foul).toBe(true);
    expect(early.state.discs.find((d: any) => d.id === 'w0').pocketed).toBe(false);
    const covered = only({ w0: [0, 0], b0: [-200, -250], b1: [200, -250] });
    covered.queen = 'covered'; covered.queenOwner = 0;
    const w2 = covered.discs.find((d: any) => d.id === 'w0');
    w2.x = st.x + Math.cos(dir) * 150; w2.y = st.y + Math.sin(dir) * 150;
    const win = K.shoot(covered, dir, SOFT);
    expect(win.state.over).toBe(true);
    expect(win.state.winner).toBe(0);
    expect(win.state.points).toBe(2 + 3);
    expect(K.shoot(win.state, 0, 1).message).toMatch(/over/);
  });
  it('the striker slides only along its own baseline and refuses to sit on a coin', () => {
    const s = K.createCarrom();
    expect(K.placeStriker(s, 9999).discs.find((d: any) => d.kind === 'striker').x).toBe(K.BASELINE_HALF_LENGTH);
    const blocked = only({ w0: [100, K.BASELINE] });
    expect(K.strikerFits(blocked, 100)).toBe(false);
    expect(K.strikerFits(blocked, -100)).toBe(true);
  });
});
