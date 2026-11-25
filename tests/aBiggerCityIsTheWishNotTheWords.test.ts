/**
 * Admin 2026-11-25 (problem 8): "city bahut choti banti hai, ok. par badh karne ko kahi to usi city aur ghar road etc add nahi kiye
 * jate, na city badi ki jati hai" — and: "user ke words par nahi intention par kam ho".
 *
 * The platform grows a city itself (worldTurn.ts), but only for the exact phrasings its patterns knew: "city badi karo" grew it;
 * "bigger city", "10x bigger", "badi city banao", "city bahut chhoti hai" and "make it bigger" — the same wish — did not, and a map
 * with no city yet answered "no-city". The wish is read now, not the words (queue Q-3355).
 */
import { describe, expect, it } from 'vitest';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH, gameWorldFileSource } from '../src/server/lib/GameOpenWorldGenerator';
import { cityGrowthAsked, growCity, citiesOnMap } from '../src/server/AgentV3/worldTurn';

const KIT = recipeFilePool().get(OPEN_WORLD_BRIDGE_PATH)!.content;
const ONE_CITY = gameWorldFileSource({ city: true });
const NO_CITY = gameWorldFileSource({ city: false });

describe('a wish for a bigger map is read, however it is said', () => {
  it.each([
    'city badi karo', 'make the city bigger', 'city ka size badhao',              // already worked
    'bigger city', '10x bigger city', 'city ko 10x bada karo', 'make the city 10x bigger', 'make it bigger',
    'badi city banao', 'city bahut chhoti hai', 'shehar ko vishal banao', 'double the city size', 'town bahut chota lagta hai',
  ])('%s', (p) => expect(cityGrowthAsked(p)).not.toBeNull());

  it.each([
    'car ko bada karo', 'make the text bigger', 'hero ki speed badhao', 'city me ek bada mall banao', 'ek badi sadak banao',
    'joystick bada karo', 'add police to the game', 'traffic badhao',
    'map bada karo', // a bigger MAP is WORLD.spreadMeters, a different wish (theCityReallyGrows.test.ts)
  ])('🔒 not the map: %s', (p) => expect(cityGrowthAsked(p)).toBeNull());

  it('🔒 a bigger city AND separate new cities is still a question, never a guess', () => {
    expect(cityGrowthAsked('ek aur badi city banao')).toBe('mixed');
  });
});

describe('the city really grows', () => {
  it('"10x bigger city" adds nine joined tiles to the one city', () => {
    const g = growCity(ONE_CITY, '10x bigger city', KIT);
    expect(g.ok).toBe(true);
    if (g.ok) expect(g.added).toHaveLength(9);
  });
  it('a map with no city gets its main city first, then the city grows', () => {
    const g = growCity(NO_CITY, 'make it bigger', KIT);
    expect(g.ok).toBe(true);
    if (g.ok) {
      expect(g.added[0]).toBe('main-city');
      const cities = citiesOnMap(g.source);
      expect(cities).toHaveLength(1);
      expect(cities[0].tiles).toBeGreaterThan(1);
    }
  });
});
