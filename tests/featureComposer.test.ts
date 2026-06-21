import { describe, it, expect } from 'vitest';
import { FeatureComposer } from '../src/server/BuildEngine/FeatureComposer';

describe('FeatureComposer', () => {
  it('always returns ui-atoms feature', () => {
    const composer = new FeatureComposer();
    const result = composer.compose('build a landing page');
    expect(result.some(f => f.id === 'ui-atoms')).toBe(true);
  });

  it('adds data-persistence and api-routes for CRM request', () => {
    const composer = new FeatureComposer();
    const result = composer.compose('build a CRM system');
    expect(result.some(f => f.id === 'data-persistence')).toBe(true);
    expect(result.some(f => f.id === 'api-routes')).toBe(true);
  });

  it('adds data-persistence for management request', () => {
    const composer = new FeatureComposer();
    const result = composer.compose('inventory management app');
    expect(result.some(f => f.id === 'data-persistence')).toBe(true);
  });

  it('returns only ui-atoms for simple request', () => {
    const composer = new FeatureComposer();
    const result = composer.compose('make a counter');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ui-atoms');
  });
});
