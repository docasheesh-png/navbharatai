import { describe, it, expect, afterEach } from 'vitest';
import { clampLoadLimit, loadLanes, loadMaxConcurrency, loadMaxAttempts, LOAD_ABSOLUTE_MAX, LOAD_WAVE_MAX_CLAIM } from './providerLoadLimits';
import { providerLoadCorpus } from '../server/lib/providerLoadCorpus';
describe('flexible provider load limits (0 to 10 lakh)', () => {
  afterEach(() => { delete process.env.PROVIDER_LOAD_MAX_CONCURRENCY; delete process.env.PROVIDER_LOAD_MAX_ATTEMPTS; });
  it('defaults to 10 lakh', () => { expect(loadMaxConcurrency()).toBe(1_000_000); expect(loadMaxAttempts()).toBe(1_000_000); });
  it('env can lower but never raise past the absolute max', () => {
    process.env.PROVIDER_LOAD_MAX_CONCURRENCY = '500'; expect(loadMaxConcurrency()).toBe(500);
    process.env.PROVIDER_LOAD_MAX_ATTEMPTS = '99999999'; expect(loadMaxAttempts()).toBe(LOAD_ABSOLUTE_MAX);
    expect(clampLoadLimit('junk')).toBe(LOAD_ABSOLUTE_MAX); expect(clampLoadLimit(0)).toBe(LOAD_ABSOLUTE_MAX);
  });
  it('lanes keep every wave inside one Firestore transaction', () => {
    expect(loadLanes(1)).toBe(1); expect(loadLanes(140)).toBe(1); expect(loadLanes(LOAD_WAVE_MAX_CLAIM + 1)).toBe(2);
    expect(loadLanes(1_000_000) * LOAD_WAVE_MAX_CLAIM).toBeGreaterThanOrEqual(1_000_000);
    expect(LOAD_WAVE_MAX_CLAIM + 2).toBeLessThanOrEqual(500);
  });
  it('corpus scales to 10 lakh unique prompts', () => {
    const q = providerLoadCorpus(1_000_000); expect(q).toHaveLength(1_000_000);
    expect(new Set(q.map(x => x.prompt)).size).toBe(1_000_000);
    expect(() => providerLoadCorpus(1_000_001)).toThrow();
  });
});
