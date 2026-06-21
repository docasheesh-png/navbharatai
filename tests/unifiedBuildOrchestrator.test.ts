import { describe, it, expect, vi } from 'vitest';
import { isUnifiedEngineEnabled } from '../src/server/project/UnifiedBuildOrchestrator';

describe('isUnifiedEngineEnabled', () => {
  it('returns true when ENGINE env var is not set', () => {
    vi.stubEnv('ENGINE', '');
    expect(isUnifiedEngineEnabled()).toBe(true);
    vi.unstubAllEnvs();
  });

  it('returns true when ENGINE=v2', () => {
    vi.stubEnv('ENGINE', 'v2');
    expect(isUnifiedEngineEnabled()).toBe(true);
    vi.unstubAllEnvs();
  });

  it('returns false when ENGINE=v1 (rollback mode)', () => {
    vi.stubEnv('ENGINE', 'v1');
    expect(isUnifiedEngineEnabled()).toBe(false);
    vi.unstubAllEnvs();
  });

  it('returns true for any ENGINE value that is not v1', () => {
    vi.stubEnv('ENGINE', 'v3');
    expect(isUnifiedEngineEnabled()).toBe(true);
    vi.unstubAllEnvs();
  });
});
