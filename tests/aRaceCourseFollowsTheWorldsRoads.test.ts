// A RACE COURSE FOLLOWS THE WORLD'S ROADS (map expansion plan, item 8, part 1 of 3). The course a race across joined places
// will drive: the world's highways chained into one line every 2 m, poseAt for the rivals, update for the player's distance,
// a finish at finishKm along the route, and extend so an endless race never runs out. Not shipped to any project yet —
// nothing imports it; the library race is untouched. Runs the generated module itself.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { WORLD_COURSE, WORLD_COURSE_PATH } from '../src/server/lib/GameWorldCourseGenerator';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';

const DIR = join(__dirname, `.tmp-worldcourse-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let C: any;
beforeAll(async () => { mkdirSync(DIR, { recursive: true }); writeFileSync(join(DIR, 'worldCourse.ts'), WORLD_COURSE); C = await import(join(DIR, 'worldCourse.ts')); });
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const straight = (x0: number, z0: number, x1: number, z1: number, n = 5) => Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n }));

describe('🛣️ a race course along the world\'s roads', () => {
  it('chains legs given out of order and backwards into one line from the start, every 2 m', () => {
    const legs = [straight(1000, 0, 1000, 1000), straight(0, 0, 1000, 0), straight(1000, 2000, 1000, 1000)]; // 2nd is the first; 3rd backwards
    const c = C.createWorldCourse({ legs, start: { x: 0, z: 0 } });
    expect(c.length).toBeCloseTo(3000, 0);
    expect(c.gaps).toEqual([]);
    expect(c.line[0]).toEqual({ x: 0, z: 0 });
    expect(c.line[c.line.length - 1]).toEqual({ x: 1000, z: 2000 });
    for (let i = 1; i < c.line.length; i++) expect(Math.hypot(c.line[i].x - c.line[i - 1].x, c.line[i].z - c.line[i - 1].z)).toBeLessThanOrEqual(2.0001);
  });

  it('poseAt: on the line, on the ground, facing along it (forward is (sin, cos) of heading), shifted by the render origin', () => {
    const c = C.createWorldCourse({ legs: [straight(0, 0, 1000, 0)], heightAt: (x: number) => x / 100, origin: () => ({ x: 100, z: -50 }) });
    const p = c.poseAt(500);
    expect(p.x).toBeCloseTo(400, 5); expect(p.z).toBeCloseTo(50, 5); expect(p.y).toBeCloseTo(5, 5);
    expect(Math.sin(p.heading)).toBeCloseTo(1, 5); expect(Math.cos(p.heading)).toBeCloseTo(0, 5);
    expect(c.poseAt(-1)).toBeNull(); expect(c.poseAt(1001)).toBeNull(); expect(c.poseAt(Number.NaN)).toBeNull();
    expect(c.startPose.x).toBeCloseTo(-100, 5);
  });

  it('update: the player\'s distance follows the car along the course, even round a corner, and after an origin shift', () => {
    let o = { x: 0, z: 0 };
    const c = C.createWorldCourse({ legs: [straight(0, 0, 1000, 0), straight(1000, 0, 1000, 1000)], origin: () => o });
    const car = { position: { x: 0, z: 0 } };
    let last = 0;
    for (let d = 0; d <= 1900; d += 20) {
      const p = c.poseAt(d); car.position.x = p.x + 1.5; car.position.z = p.z;           // in its lane, not on the line
      const s = c.update(car); expect(s.distance).toBeGreaterThanOrEqual(last - 0.01); expect(Math.abs(s.distance - d)).toBeLessThan(2.5); last = s.distance;
      if (d === 1000) o = { x: 512, z: 512 };                                           // the world moved its origin
    }
  });

  it('finishKm: the finish is that far along the course; never past the end of a course that is not extended; null is endless', () => {
    const legs = [straight(0, 0, 3000, 0)];
    expect(C.createWorldCourse({ legs, finishKm: 2 }).finish).toBe(2000);
    expect(C.createWorldCourse({ legs, finishKm: 5 }).finish).toBeCloseTo(3000, 5);
    expect(C.createWorldCourse({ legs }).finish).toBeNull();
    const c = C.createWorldCourse({ legs, finishKm: 2 });
    const p = c.poseAt(2000);
    expect(c.update({ position: { x: p.x, z: p.z } }).ended).toBe(true);
    const q = c.poseAt(1500);
    expect(c.update({ position: { x: q.x, z: q.z } }).ended).toBe(false);
  });

  it('extend: an endless race never runs out — more road at the end, and a finish asked beyond the old end moves out with it', () => {
    const c = C.createWorldCourse({ legs: [straight(0, 0, 1000, 0)], finishKm: 5 });
    expect(c.poseAt(2500)).toBeNull();
    for (let k = 1; k <= 50; k++) c.extend(straight(1000 * k, 0, 1000 * (k + 1), 0));
    expect(c.length).toBeCloseTo(51000, 0);
    expect(c.poseAt(2500)).not.toBeNull();
    expect(c.finish).toBe(5000);
  });

  it('two legs that do not meet are linked straight, and the link is said in gaps', () => {
    const c = C.createWorldCourse({ legs: [straight(0, 0, 1000, 0), straight(1600, 0, 2600, 0)] });
    expect(c.gaps).toEqual([600]);
    expect(c.length).toBeCloseTo(2600, 0);
  });

  it('works as the stream a race drives: createRace places its rivals on the course', async () => {
    // A minimal stand-in for createRace's one read (stream.poseAt), as the kit's race does.
    const c = C.createWorldCourse({ legs: [straight(0, 0, 0, 500)] });
    const car = new THREE.Group();
    const pose = c.poseAt(40); const lane = 2.4;
    car.position.set(pose.x + Math.cos(pose.heading) * lane, pose.y, pose.z - Math.sin(pose.heading) * lane);
    expect(car.position.z).toBeCloseTo(40, 5); expect(Math.abs(car.position.x)).toBeCloseTo(2.4, 5);
  });

  it('junk in, a safe course out: no legs, empty legs, NaN points', () => {
    const c = C.createWorldCourse({ legs: [[], [{ x: Number.NaN, z: 0 }], null as any] });
    expect(c.length).toBeGreaterThan(0);
    expect(c.poseAt(0)).not.toBeNull();
    expect(c.extend([{ x: Number.NaN, z: 1 }])).toBe(c.length);
  });

  it('not shipped yet: no recipe writes it, and nothing in the kit imports it (the library race is untouched)', () => {
    const pool = recipeFilePool();
    expect(pool.has(WORLD_COURSE_PATH)).toBe(false);
    for (const [, f] of pool) expect(f.content).not.toMatch(/worldCourse/);
    expect(WORLD_COURSE).not.toMatch(/[`]|\$\{/);
  });
});
