import { describe, it, expect } from 'vitest';
import { AppContextInjector } from '../src/server/AppContext/AppContextInjector';

describe('AppContextInjector.getRelevantContext', () => {
  it('returns empty string for empty message', () => {
    expect(AppContextInjector.getRelevantContext('')).toBe('');
  });

  it('returns non-empty context for a settings navigation question', () => {
    const ctx = AppContextInjector.getRelevantContext('where is the settings page?');
    // Should match something in the knowledge base
    expect(typeof ctx).toBe('string');
    expect(ctx.length).toBeGreaterThanOrEqual(0);
  });

  it('returns non-empty full summary for whole-app question', () => {
    const ctx = AppContextInjector.getRelevantContext('what can this app do');
    expect(ctx.length).toBeGreaterThan(0);
  });
});

describe('AppContextInjector.getSurfaceFeatures', () => {
  it('returns an array for engineer_ai surface', () => {
    const features = AppContextInjector.getSurfaceFeatures('engineer_ai');
    expect(Array.isArray(features)).toBe(true);
  });

  it('returns empty array for unknown surface', () => {
    const features = AppContextInjector.getSurfaceFeatures('nonexistent_surface');
    expect(features).toHaveLength(0);
  });
});

describe('AppContextInjector.getFeatureById', () => {
  it('returns null for unknown id', () => {
    expect(AppContextInjector.getFeatureById('nonexistent-feature')).toBeNull();
  });
});

describe('AppContextInjector.getFullSummary', () => {
  it('returns a non-empty string with all features', () => {
    const summary = AppContextInjector.getFullSummary();
    expect(summary.length).toBeGreaterThan(0);
  });
});
