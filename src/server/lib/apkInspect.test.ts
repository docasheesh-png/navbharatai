import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAX_APK_BYTES, publishableApkLimitBytes } from './apkInspect';

// THE ADVERTISED LIMIT MUST BE THE ONE THAT CAN ACTUALLY PUBLISH (2026-07-28).
// The store showed MAX_APK_BYTES (150 MB) while "no scan ⇒ no publication" plus a 32 MB scanner cap
// meant anything over 32 MB uploaded fine and was then refused as unscannable. Deriving the number
// keeps the promise true by construction instead of by remembering to update it.
describe('publishableApkLimitBytes', () => {
  it('is the SMALLER of the store cap and the scanner cap', () => {
    expect(publishableApkLimitBytes(150 * 1024 * 1024, 32 * 1024 * 1024)).toBe(32 * 1024 * 1024);
  });

  it('rises automatically when the scanner is upgraded (the whole point of deriving it)', () => {
    expect(publishableApkLimitBytes(150 * 1024 * 1024, 650 * 1024 * 1024)).toBe(150 * 1024 * 1024);
  });

  it('still respects the store cap when the scanner is the larger of the two', () => {
    expect(publishableApkLimitBytes(50 * 1024 * 1024, 650 * 1024 * 1024)).toBe(50 * 1024 * 1024);
  });

  it('never exceeds either input', () => {
    for (const [a, b] of [[10, 20], [20, 10], [15, 15]] as Array<[number, number]>) {
      const out = publishableApkLimitBytes(a, b);
      expect(out).toBeLessThanOrEqual(a);
      expect(out).toBeLessThanOrEqual(b);
    }
  });
});

describe('the store advertises and enforces the SAME derived limit', () => {
  const STORE = readFileSync(fileURLToPath(new URL('../routes/navStore.ts', import.meta.url)), 'utf8');

  it('the advertised maxSizeMb is derived, not the raw store cap', () => {
    expect(STORE).toContain('maxSizeMb: publishableApkLimitBytes(MAX_APK_BYTES, MAX_SCANNABLE_BYTES)');
    expect(STORE).not.toContain('maxSizeMb: MAX_APK_BYTES / 1024 / 1024');
  });

  it('the 413 refusal uses the same derived cap, so it can never contradict the promise', () => {
    expect(STORE).toContain('const publishCap = publishableApkLimitBytes(MAX_APK_BYTES, MAX_SCANNABLE_BYTES)');
    expect(STORE).toContain('if (bytes.length > publishCap)');
  });
});
