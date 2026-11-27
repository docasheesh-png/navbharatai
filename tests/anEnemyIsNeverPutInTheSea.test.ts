// 🌊 AN ENEMY IS NEVER PUT IN THE SEA (builds #2565/#2566, PUBG-like game: red hit arrows came from enemies nobody could see).
// streetDanger put each enemy anywhere in its 18–34 m ring and only checked that the height was a number; on a map that is
// 44% sea, about half of them stood under the water and shot from there. The open world now answers "is this dry land a
// character can stand on?" in one place (world.dryAt: above the sea with a margin, not in a river), and the spawner keeps
// trying the ring until it finds dry land — or does not spawn at all.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { GAME_STREET_DANGER_FEATURE } from '../src/server/lib/GameOpenWorldGenerator';

const kit = readFileSync('src/server/lib/GameOpenWorldGenerator.ts', 'utf8');

describe('🌊 dry land only', () => {
  it('the open world exposes dryAt, computed from the sea level (with a margin) and the rivers', () => {
    expect(kit).toMatch(/dryAt\(x: number, z: number\): boolean;/);
    expect(kit).toMatch(/dryAt: \(x, z\) => \{ const h = map\.world\.heightAt\(x, z\); return Number\.isFinite\(h\) && h >= map\.world\.seaLevel \+ DRY_MARGIN_M && !map\.world\.waterAt\(x, z\); \}/);
    expect(kit).toMatch(/const DRY_MARGIN_M = 0\.\d+;/);
  });
  it('streetDanger asks dryAt for every spot it tries, and spawns nothing when the ring has no dry land', () => {
    const bring = GAME_STREET_DANGER_FEATURE.slice(GAME_STREET_DANGER_FEATURE.indexOf('const bring ='), GAME_STREET_DANGER_FEATURE.indexOf('run = {'));
    expect(bring).toMatch(/found = world\.dryAt\(wx, wz\);/);
    expect(bring).toMatch(/if \(!found\) return;/);
    expect(bring).not.toMatch(/if \(!Number\.isFinite\(world\.heightAt\(wx, wz\)\)\) return;/);   // the old "a height is a number" test
  });
  it('census: no feature on the open world spawns a character without asking dryAt', () => {
    const features = [...kit.matchAll(/export const GAME_[A-Z_]+_FEATURE = String\.raw`([\s\S]*?)`;/g)].map((m) => m[1]);
    expect(features.length).toBeGreaterThan(0);
    for (const f of features) if (/npcs\.spawn\(|\.spawn\(\{ x/.test(f)) expect(f, 'a feature spawns a character without world.dryAt').toMatch(/world\.dryAt\(/);
  });
});
