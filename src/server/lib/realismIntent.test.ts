import { describe, it, expect } from 'vitest';
import { realismIntent, wantsRealObjects } from './realismIntent';

const tier = (s: string) => realismIntent(s).tier;

/**
 * REAL OR JUST 3D? (admin 2026-08-27: "wording par nahi jana, intension samjhna hai".)
 *
 * This decision spends real money and real device budget — the REAL tier builds far more geometry and
 * larger textures. So the FALSE POSITIVES are pinned as hard as the true ones: a multiplayer game that
 * says "real-time" must not silently become a heavyweight render on someone's phone.
 */
describe('realismIntent — the user asked for something REAL', () => {
  it('English realism words, in the shapes people actually type', () => {
    for (const s of [
      'make a realistic 3d racing game',
      'I want photorealistic graphics',
      'hyper realistic forest',
      'a lifelike character',
      'AAA quality game please',
      'cinematic next-gen visuals',
      'real looking cars',
      'high fidelity 3d world',
    ]) expect(tier(s), s).toBe('real');
  });

  it('Hinglish and Hindi, including the admin own words', () => {
    for (const s of [
      'ek dam asli gaadi banao',
      'hubahu real object chahiye',
      'bilkul asli jaisa jungle',
      '100% real game',
      'sabhi objects asli chahiye',
      'yatharth drishya',
      'असली गाड़ी बनाओ',
      'हूबहू असली पेड़',
      'रियलिस्टिक गेम',
    ]) expect(tier(s), s).toBe('real');
  });

  it('naming a photoreal AAA title IS the realism ask', () => {
    for (const s of ['GTA jaisa game banao', 'make it like Forza', 'PUBG style graphics']) {
      expect(tier(s), s).toBe('real');
    }
  });
});

describe('realismIntent — plain 3D stays LIGHT (the admin second rule)', () => {
  it('"3d game" alone does not buy the expensive tier', () => {
    for (const s of [
      'make a 3d game',
      'ek 3d racing game banao',
      'three dimensional maze',
      '3डी गेम बनाओ',
    ]) expect(tier(s), s).toBe('lite');
  });

  it('a prompt with no visual signal at all defaults to light', () => {
    expect(tier('build me a car racing game')).toBe('lite');
    expect(tier('')).toBe('lite');
    expect(realismIntent(null).tier).toBe('lite');
  });
});

describe('🔒 the false positives that would cost real money', () => {
  it('"real-time" is about LATENCY, not looks — the trap a naive /real/ match falls into', () => {
    for (const s of [
      'a real-time multiplayer 3d game',
      'realtime chat in the game',
      'real time leaderboard',
    ]) expect(tier(s), s).toBe('lite');
  });

  it('"real money", "real users", "real data" are not visual requests either', () => {
    for (const s of [
      'let players pay with real money',
      'test it with real users',
      'connect real data from an API',
    ]) expect(tier(s), s).toBe('lite');
  });
});

describe('🔒 a named art style WINS over a realism word', () => {
  it('"realistic low-poly" is a style request, not a scanned world', () => {
    const d = realismIntent('a realistic low-poly island');
    expect(d.tier).toBe('lite');
    expect(d.stylisedOverride).toBe(true);
    expect(d.reason).toMatch(/art style/i);
  });

  it('cartoon / voxel / pixel / minecraft all stay light even beside "real"', () => {
    for (const s of [
      'cartoon game with realistic lighting',
      'minecraft style but real physics',
      'pixel art realistic racing',
      'cute chibi realistic characters',
    ]) expect(tier(s), s).toBe('lite');
  });
});

describe('the decision explains itself', () => {
  it('every outcome carries a reason a human can read', () => {
    for (const s of ['realistic city', 'make a 3d game', 'cartoon world', '']) {
      expect(realismIntent(s).reason.length, s).toBeGreaterThan(20);
    }
  });

  it('wantsRealObjects is the same decision, as a boolean', () => {
    expect(wantsRealObjects('bilkul asli gaadi')).toBe(true);
    expect(wantsRealObjects('simple 3d game')).toBe(false);
  });
});
