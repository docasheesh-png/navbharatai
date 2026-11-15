// MAP KINDS: 12 kinds of land x 10 sizes = 120 kinds of map, chosen by a user's words (English, Hinglish) or by the builder. The registry
// is data, so the tests hold it to what it claims; the worlds it describes are tested in AthreeSizes.test.ts.
import { describe, it, expect } from 'vitest';
import {
  ARCHETYPES, ARCHETYPE_IDS, SIZE_CLASSES_KM, MAP_KIND_COUNT, mapOptionsFor, mapChoiceFor, sizeKmIn, archetypeIn, clampSizeKm, describeMap, type Archetype,
} from './athreeMapKinds';
import { generateAthreeMap } from './AthreeMapGenerator';
import { loadAthree } from '../../../../tests/helpers/loadAthree';

describe('the space of maps', () => {
  it('is at least 100 kinds: 12 kinds of land x 10 sizes, 1 km to 1000 km', () => {
    expect(ARCHETYPE_IDS.length).toBe(12);
    expect([...SIZE_CLASSES_KM]).toEqual([1, 2, 5, 10, 25, 50, 100, 250, 500, 1000]);
    expect(MAP_KIND_COUNT).toBe(120);
    expect(MAP_KIND_COUNT).toBeGreaterThanOrEqual(100);
  });

  it('every kind is distinct: no two archetypes share a style, so no two kinds of land are the same map', () => {
    const seen = new Set<string>();
    for (const id of ARCHETYPE_IDS) { const k = JSON.stringify([ARCHETYPES[id].mode, ARCHETYPES[id].style]); expect(seen.has(k), id).toBe(false); seen.add(k); }
  });

  it('every archetype describes itself and has words a user could type', () => {
    for (const id of ARCHETYPE_IDS) { expect(ARCHETYPES[id].what.length).toBeGreaterThan(10); expect(ARCHETYPES[id].words.length).toBeGreaterThan(2); expect(ARCHETYPES[id].id).toBe(id); }
  });

  it('every style number is inside the range the world understands', () => {
    for (const id of ARCHETYPE_IDS) {
      const s = ARCHETYPES[id].style;
      if (s.relief !== undefined) { expect(s.relief).toBeGreaterThanOrEqual(0.2); expect(s.relief).toBeLessThanOrEqual(2); }
      if (s.seaShift !== undefined) { expect(s.seaShift).toBeGreaterThanOrEqual(-0.6); expect(s.seaShift).toBeLessThanOrEqual(0.6); }
      if (s.aridity !== undefined) { expect(s.aridity).toBeGreaterThanOrEqual(-0.4); expect(s.aridity).toBeLessThanOrEqual(0.5); }
      if (s.warmth !== undefined) { expect(s.warmth).toBeGreaterThanOrEqual(-0.5); expect(s.warmth).toBeLessThanOrEqual(0.4); }
      if (s.rivers !== undefined) { expect(s.rivers).toBeGreaterThanOrEqual(0); expect(s.rivers).toBeLessThanOrEqual(3); }
    }
  });

  it('the style type here lists exactly the knobs the emitted world has (the two lists cannot drift)', () => {
    const A = loadAthree();
    expect(Object.keys(A.NEUTRAL_STYLE).sort()).toEqual(['aridity', 'relief', 'rivers', 'seaShift', 'warmth']);
    for (const id of ARCHETYPE_IDS) for (const key of Object.keys(ARCHETYPES[id].style)) expect(Object.keys(A.NEUTRAL_STYLE), `${id}.${key}`).toContain(key);
  });

  it('options for a choice: the island is bounded, everything else a loop, sizes in metres and clamped to 1..1000 km', () => {
    expect(mapOptionsFor({ archetype: 'island', sizeKm: 5 })).toMatchObject({ mode: 'bounded', sizeMeters: 5000 });
    expect(mapOptionsFor({ archetype: 'desert', sizeKm: 250 })).toMatchObject({ mode: 'loop', sizeMeters: 250000 });
    expect(mapOptionsFor({ archetype: 'desert', sizeKm: 0.01 }).sizeMeters).toBe(1000);
    expect(mapOptionsFor({ archetype: 'desert', sizeKm: 99999 }).sizeMeters).toBe(1_000_000);
    expect(clampSizeKm(NaN)).toBe(100);
    expect(mapOptionsFor({ archetype: 'nonsense' as Archetype, sizeKm: 10 }).mode).toBe('loop');
  });
});

describe('reading the user\'s words', () => {
  const kind = (t: string) => mapChoiceFor(t);
  it('a size in km, in several spellings', () => {
    for (const [t, km] of [['5 km ka map', 5], ['1000 km map banao', 1000], ['a 50 kilometre world', 50], ['2.5 km', 2.5], ['10 KM', 10], ['25 किमी का नक्शा', 25], ['3,5 km', 3.5]] as Array<[string, number]>) expect(sizeKmIn(t), t).toBe(km);
  });
  it('a size in words when no number is given', () => {
    expect(sizeKmIn('chhota map')).toBeLessThan(10); expect(sizeKmIn('tiny arena')).toBe(1); expect(sizeKmIn('huge open world')).toBeGreaterThanOrEqual(250); expect(sizeKmIn('bahut bada')).toBeGreaterThanOrEqual(250);
  });
  it('a number beats a size word, and a map that names neither has no size', () => {
    expect(sizeKmIn('chhota 40 km map')).toBe(40);
    expect(sizeKmIn('ek racing game')).toBeNull();
  });
  it('the kind of land, in English and Hinglish', () => {
    const cases: Array<[string, Archetype]> = [
      ['registan ka map', 'desert'], ['a desert world', 'desert'], ['pahadi ilaka', 'alpine'], ['snowy mountains', 'alpine'], ['jungle game', 'jungle'], ['barf wala', 'tundra'], ['dweep samooh', 'archipelago'],
      ['an island', 'island'], ['daldal', 'wetland'], ['samundar kinara', 'coast'], ['maidan', 'plains'], ['rolling hills', 'hills'], ['savanna safari', 'savanna'],
    ];
    for (const [t, a] of cases) expect(archetypeIn(t), t).toBe(a);
  });
  it('a request that names neither a size nor a kind of land chooses nothing (the default world)', () => {
    expect(kind('3D racing game banao')).toBeNull();
    expect(kind('battle royale')).toBeNull();
  });
  it('one that names only one gets sensible defaults for the other', () => {
    expect(kind('registan racing')).toEqual({ archetype: 'desert', sizeKm: 100 });
    expect(kind('20 km ka racing game')).toEqual({ archetype: 'continental', sizeKm: 20 });
    expect(kind('5 km ka jungle')).toEqual({ archetype: 'jungle', sizeKm: 5 });
  });
  it('rubbish never throws', () => {
    for (const t of ['', '   ', '!!!', 'x'.repeat(10000), '\u0000', '-5 km', '0 km', 'NaN km']) expect(() => mapChoiceFor(t)).not.toThrow();
    expect(sizeKmIn('0 km')).toBe(1); expect(sizeKmIn('-5 km')).toBe(5);
  });
  it('describes a choice honestly, including what a small or huge map cannot give', () => {
    expect(describeMap({ archetype: 'desert', sizeKm: 2 })).toMatch(/no roads and no runway/);
    expect(describeMap({ archetype: 'desert', sizeKm: 500 })).toMatch(/mostly open land/);
    expect(describeMap({ archetype: 'island', sizeKm: 3 })).toMatch(/too small for roads/);
    expect(describeMap({ archetype: 'island', sizeKm: 10 })).not.toMatch(/too small/);
  });
});

describe('the chosen map is written into the project', () => {
  it('with no choice, MAP_OPTIONS is empty (the default world, exactly as before)', () => {
    const config = generateAthreeMap().files['src/game/athree/config.ts'];
    expect(config).toMatch(/export const MAP_OPTIONS: MapOptions = \{\};/);
  });
  it('with a choice, it records the kind and size, and the index applies it', () => {
    const r = generateAthreeMap(undefined, { archetype: 'desert', sizeKm: 5 });
    const config = r.files['src/game/athree/config.ts'];
    expect(config).toMatch(/"sizeMeters": 5000/); expect(config).toMatch(/"aridity": 0\.45/); expect(config).toMatch(/desert map, 5 km/);
    expect(r.files['src/game/athree/index.ts']).toContain('createAthreeWorld({ ...MAP_OPTIONS, ...options })');
    expect(r.instructions).toMatch(/THE MAP CHOSEN FOR THIS GAME: desert map, 5 km/);
  });
  it('the emitted world made through the index really is that size and kind', () => {
    const A = loadAthree(undefined, { archetype: 'island', sizeKm: 3 });
    const map = A.createAthreeMap({ seed: 5 });
    expect(map.world.sizeMeters).toBe(3000); expect(map.world.mode).toBe('bounded');
    expect(A.createAthreeMap({ seed: 5, sizeMeters: 4000 }).world.sizeMeters).toBe(4000); // the game's own option still wins
  });
});
