import { describe, it, expect } from 'vitest';
import {
  CAPACITOR_TOOLCHAINS,
  DEFAULT_CAPACITOR_MAJOR,
  defaultToolchainJava,
  toolchainForMajor,
} from './capacitorToolchain';
import { generateShipKit } from './mobileShipKit';

// G2 (audit 2026-08-11): the Capacitor major → Android toolchain mapping is ONE governed table, and the
// workflow's Java is derived from it — never a second hardcoded copy that can drift.

describe('capacitorToolchain — the governed table', () => {
  it('is ordered oldest → newest (toolchainForMajor relies on it for the forward-safe fallback)', () => {
    const majors = CAPACITOR_TOOLCHAINS.map((t) => t.major);
    expect(majors).toEqual([...majors].sort((a, b) => a - b));
  });

  it('every row names a real setup-java JDK and a sane sdk floor', () => {
    for (const t of CAPACITOR_TOOLCHAINS) {
      expect([17, 21]).toContain(t.java);
      expect(t.minSdk).toBeGreaterThanOrEqual(21);
      expect(t.compileSdk).toBeGreaterThanOrEqual(t.minSdk);
    }
  });

  it('resolves an exact major to its own row', () => {
    expect(toolchainForMajor(6).java).toBe(17);
    expect(toolchainForMajor(7).java).toBe(21);
    expect(toolchainForMajor(8).java).toBe(21);
  });

  it('is forward-safe: a brand-new major uses the NEWEST known toolchain, never a stale one', () => {
    const newest = CAPACITOR_TOOLCHAINS[CAPACITOR_TOOLCHAINS.length - 1];
    expect(toolchainForMajor(9)).toEqual(newest);
    expect(toolchainForMajor(99)).toEqual(newest);
  });

  it('clamps a major older than anything we list to the oldest supported row', () => {
    expect(toolchainForMajor(4)).toEqual(CAPACITOR_TOOLCHAINS[0]);
  });

  it('falls back to the governed default for a missing/invalid major', () => {
    const def = toolchainForMajor(DEFAULT_CAPACITOR_MAJOR);
    expect(toolchainForMajor(undefined)).toEqual(def);
    expect(toolchainForMajor(null)).toEqual(def);
    expect(toolchainForMajor(0)).toEqual(def);
    expect(toolchainForMajor(NaN)).toEqual(def);
  });

  it('the default major is one the table actually governs', () => {
    expect(CAPACITOR_TOOLCHAINS.some((t) => t.major === DEFAULT_CAPACITOR_MAJOR)).toBe(true);
  });
});

describe('capacitorToolchain — CO-VALIDATION: workflow Java can never drift from the app Capacitor', () => {
  // This is the whole point of G2: the Java the generated workflow pins MUST equal the Java the app's
  // Capacitor major requires. If a future edit moves one without the other, this test fails in CI.
  for (const t of CAPACITOR_TOOLCHAINS) {
    it(`Capacitor ${t.major} → both APK and AAB workflows pin Java ${t.java}`, () => {
      const kit = generateShipKit({ appName: 'X', capacitorMajor: t.major });
      const apk = kit.files['.github/workflows/android-apk.yml'];
      const aab = kit.files['.github/workflows/android-aab.yml'];
      expect(apk).toContain(`java-version: '${t.java}'`);
      expect(aab).toContain(`java-version: '${t.java}'`);
      // and never any OTHER java-version — the pin is single and unambiguous
      expect(apk.match(/java-version:/g)).toHaveLength(1);
      expect(aab.match(/java-version:/g)).toHaveLength(1);
    });
  }

  it('the DEFAULT (no major supplied) workflow pins the default toolchain Java', () => {
    const kit = generateShipKit({ appName: 'X' });
    const apk = kit.files['.github/workflows/android-apk.yml'];
    expect(apk).toContain(`java-version: '${defaultToolchainJava()}'`);
  });
});
