import { describe, it, expect } from 'vitest';
import { ModuleClassifier } from '../src/server/AppMakerLab/intelligence/ModuleClassifier';

describe('ModuleClassifier.classify', () => {
  const classifier = new ModuleClassifier();

  it('always includes DATABASE module in output', () => {
    const result = classifier.classify([]);
    expect(result['DATABASE']).toBeDefined();
  });

  it('classifies "auth" feature as AUTH type', () => {
    const result = classifier.classify(['auth']);
    expect(result['auth'].type).toBe('AUTH');
  });

  it('"auth" has no dependencies', () => {
    const result = classifier.classify(['auth']);
    expect(result['auth'].dependencies).toHaveLength(0);
  });

  it('classifies "billing" as BACKEND type', () => {
    const result = classifier.classify(['billing']);
    expect(result['billing'].type).toBe('BACKEND');
  });

  it('"billing" depends on DATABASE', () => {
    const result = classifier.classify(['billing']);
    expect(result['billing'].dependencies).toContain('DATABASE');
  });

  it('classifies "settings" as CONFIG type', () => {
    const result = classifier.classify(['settings']);
    expect(result['settings'].type).toBe('CONFIG');
  });

  it('unknown feature defaults to FRONTEND type', () => {
    const result = classifier.classify(['unknown-feature-xyz']);
    expect(result['unknown-feature-xyz'].type).toBe('FRONTEND');
  });

  it('classifies multiple features in one call', () => {
    const result = classifier.classify(['auth', 'billing']);
    expect(result['auth']).toBeDefined();
    expect(result['billing']).toBeDefined();
  });
});
