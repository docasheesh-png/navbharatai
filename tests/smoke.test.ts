import { describe, it, expect } from 'vitest';
import { firebaseConfig } from '../src/config/firebase';

// Baseline smoke tests — guarantee the test runner and core config wiring work.
// More meaningful unit/integration tests are added as the monolith is modularized.
describe('smoke: test infrastructure', () => {
  it('runs the test runner', () => {
    expect(1 + 1).toBe(2);
  });
});

describe('smoke: firebase config', () => {
  it('exposes the required config keys', () => {
    for (const key of ['projectId', 'appId', 'apiKey', 'authDomain', 'storageBucket']) {
      expect(firebaseConfig).toHaveProperty(key);
      expect(typeof (firebaseConfig as Record<string, unknown>)[key]).toBe('string');
    }
  });
});
