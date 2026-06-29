import { describe, it, expect } from 'vitest';
import {
  parseSemver, formatSemver, bumpVersion, classifyBump, computeNextVersion,
} from '../src/server/AppMakerLab/intelligence/SemanticVersionManager';

/**
 * P-PME.13 — semantic version manager.
 */
describe('SemanticVersionManager — parse/format', () => {
  it('parses leniently', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver('v2.0.0')).toEqual({ major: 2, minor: 0, patch: 0 });
    expect(parseSemver('garbage')).toEqual({ major: 0, minor: 0, patch: 0 });
    expect(parseSemver(undefined)).toEqual({ major: 0, minor: 0, patch: 0 });
    expect(parseSemver('1.2')).toEqual({ major: 1, minor: 2, patch: 0 });
  });
  it('formats', () => {
    expect(formatSemver({ major: 1, minor: 4, patch: 2 })).toBe('1.4.2');
  });
});

describe('SemanticVersionManager — bumpVersion', () => {
  it('major resets minor+patch', () => expect(bumpVersion('1.4.2', 'major')).toBe('2.0.0'));
  it('minor resets patch', () => expect(bumpVersion('1.4.2', 'minor')).toBe('1.5.0'));
  it('patch increments', () => expect(bumpVersion('1.4.2', 'patch')).toBe('1.4.3'));
});

describe('SemanticVersionManager — classifyBump', () => {
  it('MAJOR on page count change', () => {
    expect(classifyBump({ pages: 3, entities: 2 }, { pages: 4, entities: 2 })).toBe('major');
  });
  it('MAJOR on entity count change', () => {
    expect(classifyBump({ pages: 3, entities: 2 }, { pages: 3, entities: 3 })).toBe('major');
  });
  it('MINOR on new features (no structural change)', () => {
    expect(classifyBump({ pages: 3, entities: 2, features: 5 }, { pages: 3, entities: 2, features: 7 })).toBe('minor');
  });
  it('PATCH when nothing structural/feature changed', () => {
    expect(classifyBump({ pages: 3, entities: 2, features: 5 }, { pages: 3, entities: 2, features: 5 })).toBe('patch');
  });
  it('repairOnly forces PATCH even if structure changed', () => {
    expect(classifyBump({ pages: 3, entities: 2 }, { pages: 9, entities: 9 }, { repairOnly: true })).toBe('patch');
  });
});

describe('SemanticVersionManager — computeNextVersion', () => {
  it('bumps from the current version per the diff', () => {
    expect(computeNextVersion('1.2.3', { pages: 2, entities: 1 }, { pages: 3, entities: 1 }))
      .toEqual({ previous: '1.2.3', next: '2.0.0', bump: 'major' });
    expect(computeNextVersion('1.2.3', { pages: 2, entities: 1, features: 4 }, { pages: 2, entities: 1, features: 6 }))
      .toEqual({ previous: '1.2.3', next: '1.3.0', bump: 'minor' });
    expect(computeNextVersion('1.2.3', { pages: 2, entities: 1 }, { pages: 2, entities: 1 }, { repairOnly: true }))
      .toEqual({ previous: '1.2.3', next: '1.2.4', bump: 'patch' });
  });
  it('defaults a missing current to 0.0.0', () => {
    expect(computeNextVersion('', { pages: 1, entities: 0 }, { pages: 1, entities: 0 }).previous).toBe('0.0.0');
  });
});
