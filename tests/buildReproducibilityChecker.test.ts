import { describe, it, expect } from 'vitest';
import {
  hashContent, manifestOf, compareManifests, compareBuilds,
} from '../src/server/AppMakerLab/BuildReproducibilityChecker';

/**
 * P-BRE.13 — deterministic-build verification logic.
 */
describe('BuildReproducibilityChecker — hashContent', () => {
  it('is deterministic and content-sensitive', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'));
    expect(hashContent('abc')).not.toBe(hashContent('abd'));
    expect(hashContent(Buffer.from('abc'))).toBe(hashContent('abc'));
  });
});

describe('BuildReproducibilityChecker — manifestOf', () => {
  it('maps each path to its content hash', () => {
    const m = manifestOf({ 'a.js': 'x', 'b.js': 'y' });
    expect(m['a.js']).toBe(hashContent('x'));
    expect(Object.keys(m)).toEqual(['a.js', 'b.js']);
  });
});

describe('BuildReproducibilityChecker — compareManifests', () => {
  it('reports identical for two equal manifests', () => {
    const a = manifestOf({ 'a.js': 'x', 'b.js': 'y' });
    const b = manifestOf({ 'a.js': 'x', 'b.js': 'y' });
    const r = compareManifests(a, b);
    expect(r.identical).toBe(true);
    expect(r.differing).toEqual([]);
    expect(r.onlyInA).toEqual([]);
    expect(r.onlyInB).toEqual([]);
  });

  it('detects a content difference (non-deterministic file)', () => {
    const a = manifestOf({ 'bundle.js': 'built-at-T1' });
    const b = manifestOf({ 'bundle.js': 'built-at-T2' });
    const r = compareManifests(a, b);
    expect(r.identical).toBe(false);
    expect(r.differing).toEqual(['bundle.js']);
  });

  it('detects files added/removed between builds', () => {
    const a = manifestOf({ 'a.js': 'x', 'old.js': 'z' });
    const b = manifestOf({ 'a.js': 'x', 'new.js': 'w' });
    const r = compareManifests(a, b);
    expect(r.identical).toBe(false);
    expect(r.onlyInA).toEqual(['old.js']);
    expect(r.onlyInB).toEqual(['new.js']);
    expect(r.differing).toEqual([]);
  });
});

describe('BuildReproducibilityChecker — compareBuilds', () => {
  it('hashes and diffs two output sets directly', () => {
    expect(compareBuilds({ 'a.js': 'same' }, { 'a.js': 'same' }).identical).toBe(true);
    expect(compareBuilds({ 'a.js': 'one' }, { 'a.js': 'two' }).identical).toBe(false);
  });
});
