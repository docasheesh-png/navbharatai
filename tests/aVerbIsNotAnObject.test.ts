// failedbr #1261 (2026-11-20): "…rondemly spawn car honi chahiye…" — "spawn" as a VERB — added a checkpoint "marker" to a car
// game's hero objects. And its sibling: a plural named no object ("a racing game with checkpoints" matched nothing).
import { describe, expect, it } from 'vitest';
import { heroObjectContract } from '../src/server/lib/heroObjectSpec';

const ids = (p: string) => (heroObjectContract(p) as { specs: Array<{ id: string }> }).specs.map((s) => s.id);

describe('a verb is not an object, and a plural is (failedbr #1261)', () => {
  it('"randomly spawn car" adds no marker', () => {
    expect(ids('Muje ek car game banani hai usme red colour ki car or rondemly spawn car honi chahiye')).toEqual(['car']);
  });
  it('a spawn POINT is still a marker', () => {
    expect(ids('shooter with a spawn point')).toContain('marker');
  });
  it('a plural names the same object', () => {
    expect(ids('a racing game with checkpoints')).toContain('marker');
    expect(ids('a farm game with trees and cows')).toEqual(expect.arrayContaining(['tree', 'cow']));
  });
});
