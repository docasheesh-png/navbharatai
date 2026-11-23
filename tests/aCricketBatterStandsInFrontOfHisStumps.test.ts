// 🏏 THE BATTER STANDS IN FRONT OF HIS STUMPS AND PLAYS THE SHOT (admin 2026-11-23: the batter stood behind his
// stumps, the wickets were between bowler and batter, and the batter never played a shot). These run the REAL generated src/game/board/cricket.ts (the field) and three/humanoid.ts (the bat swing).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateBoardGames } from '../src/server/lib/BoardGamesGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';

const DIR = join(__dirname, `.tmp-cricket-field-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let K: any; let H: any;
beforeAll(async () => {
  const files = { ...generateBoardGames(['cricket']).files, ...generateGame3D().files };
  for (const [p, c] of Object.entries(files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c as string); }
  K = await import(join(DIR, 'src/game/board/cricket.ts'));
  H = await import(join(DIR, 'src/game/three/humanoid.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const d = (a: any, b: any) => Math.hypot(a.x - b.x, a.z - b.z);

describe('🏏 cricketLayout — the field a fan recognises', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -2.1]) {
    for (const leftHanded of [false, true]) {
      it(`heading ${heading.toFixed(2)}, ${leftHanded ? 'left' : 'right'}-hander: batter in front of his stumps, facing the bowler`, () => {
        const f = K.cricketLayout({ centre: { x: 30, z: -12 }, heading, leftHanded });
        expect(d(f.strikerStumps, f.bowlerStumps)).toBeCloseTo(K.PITCH_LENGTH, 6);
        // The batter is nearer the bowler than his own stumps are: the stumps are BEHIND him.
        expect(d(f.batter, f.bowler.release)).toBeLessThan(d(f.strikerStumps, f.bowler.release));
        expect(d(f.batter, f.strikerStumps)).toBeGreaterThan(0.6);
        expect(d(f.batter, f.strikerStumps)).toBeLessThan(K.POPPING_CREASE + 0.6);
        expect(K.checkCricketLayout({ batter: f.batter, strikerStumps: f.strikerStumps, bowler: f.bowler.release })).toEqual([]);
        // The keeper is behind the striker's stumps; the bowler releases from the other end.
        expect(d(f.keeper, f.bowlerStumps)).toBeGreaterThan(d(f.strikerStumps, f.bowlerStumps));
        expect(d(f.bowler.release, f.bowlerStumps)).toBeLessThan(2);
        expect(d(f.bowler.runUp, f.strikerStumps)).toBeGreaterThan(d(f.bowler.release, f.strikerStumps));
      });
    }
  }
  it('a right-hander stands on his leg side (his left as he faces the bowler), a left-hander on the other', () => {
    const r = K.cricketLayout({}), l = K.cricketLayout({ leftHanded: true });
    // heading 0: the bowler is towards +Z; facing +Z with Y up, the left is -X.
    expect(r.batter.x).toBeLessThan(0);
    expect(l.batter.x).toBeGreaterThan(0);
  });
});

describe('🏏 checkCricketLayout catches the reported wrong field', () => {
  const f = () => K.cricketLayout({});
  it('a batter behind his own stumps (the stumps between him and the bowler)', () => {
    const x = f();
    const behind = { x: x.strikerStumps.x, z: x.strikerStumps.z - 0.8, yaw: x.batter.yaw };
    expect(K.checkCricketLayout({ batter: behind, strikerStumps: x.strikerStumps, bowler: x.bowler.release }).join(' ')).toMatch(/behind/);
  });
  it('a batter facing away from the bowler', () => {
    const x = f();
    expect(K.checkCricketLayout({ batter: { ...x.batter, yaw: x.batter.yaw + Math.PI }, strikerStumps: x.strikerStumps, bowler: x.bowler.release }).join(' ')).toMatch(/face/);
  });
});

describe('🏏 deliveryPath — the ball reaches the bat, then the stumps', () => {
  it('released high, bounces before the batter, arrives at bat height when the shot is due, then hits the stumps line', () => {
    const f = K.cricketLayout({ heading: 0.7 });
    const p = K.deliveryPath(f, { speed: 25, lengthFromBatter: 5 });
    expect(p.bounceTime).toBeLessThan(p.batTime);
    expect(p.batTime).toBeLessThan(p.stumpsTime);
    expect(p.at(0).y).toBeGreaterThan(1.8);
    expect(p.at(p.bounceTime).y).toBeLessThan(0.1);
    const atBat = p.at(p.batTime);
    expect(atBat.y).toBeGreaterThan(0.25);
    expect(atBat.y).toBeLessThan(1.4);
    expect(d(p.at(p.stumpsTime), f.strikerStumps)).toBeLessThan(0.2);
  });
});

describe('🏏 the batter plays the shot', () => {
  it("act('bat') lifts the bat back, then drives it through — the arms reach forward and the shoulders turn", () => {
    expect(H.ACTION_SECONDS.bat).toBeGreaterThan(0.3);
    const h = H.createHumanoid(); const twin = H.createHumanoid();
    h.update(1 / 60, 0, true); twin.update(1 / 60, 0, true);
    h.act('bat');
    let minChest = 0, maxChest = 0, maxArmForward = 0;
    for (let i = 0; i < Math.ceil(H.ACTION_SECONDS.bat * 60); i++) {
      h.update(1 / 60, 0, true); twin.update(1 / 60, 0, true);
      const dc = h.joints.chest.rotation.y - twin.joints.chest.rotation.y;
      minChest = Math.min(minChest, dc); maxChest = Math.max(maxChest, dc);
      maxArmForward = Math.max(maxArmForward, -(h.joints.rightShoulder?.rotation.x ?? h.joints.shoulderR?.rotation.x ?? 0));
    }
    expect(maxChest, 'the back-lift turns the shoulders away').toBeGreaterThan(0.2);
    expect(minChest, 'the drive turns them through the shot').toBeLessThan(-0.2);
    expect(maxArmForward, 'the arms lift and drive the bat through').toBeGreaterThan(0.5);
    expect(h.acting()).toBeNull();
  });
});
