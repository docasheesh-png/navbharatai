import { describe, it, expect } from 'vitest';
import { generateRetryIntegration } from './RetryGenerator';

describe('generateRetryIntegration', () => {
  const c = generateRetryIntegration();
  const server = c.files['server/lib/retry.ts'];

  it('emits a generic retry() helper, dependency-free and server-side', () => {
    expect(server).toContain('export async function retry<T>(');
    expect(server).not.toContain('import ');
    expect(c.files['src/lib/retry.ts']).toBeUndefined();
    expect((c as { dependency?: unknown }).dependency).toBeUndefined();
  });

  it('uses exponential backoff with full jitter (no retry-storm lockstep)', () => {
    expect(server).toContain('baseMs * 2 ** (attempt - 1)');
    expect(server).toContain('fullJitter(');
    expect(server).toContain('Math.random() * cap');
  });

  it('honours a shouldRetry predicate and caps attempts', () => {
    expect(server).toContain('shouldRetry(error, attempt)');
    expect(server).toContain('attempt >= attempts');
  });

  it('rethrows the LAST error on give-up (never a fake success) and supports AbortSignal', () => {
    expect(server).toContain('throw lastError');
    expect(server).toContain('signal?: AbortSignal');
    expect(server).toContain("reject(new Error('Aborted'))");
  });

  it('warns (in instructions) to only retry idempotent work', () => {
    expect(c.instructions.toLowerCase()).toContain('idempotent');
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/retry.ts']);
  });
});
