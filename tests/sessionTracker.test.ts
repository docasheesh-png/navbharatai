import { describe, it, expect } from 'vitest';
import { hashValue, computeFingerprint, evaluateDevice } from '../src/server/lib/sessionTracker';

/**
 * P-SEC.13 — device fingerprinting + session binding (pure logic).
 */
describe('sessionTracker — hashValue', () => {
  it('is deterministic and fixed-length', () => {
    expect(hashValue('1.2.3.4')).toBe(hashValue('1.2.3.4'));
    expect(hashValue('1.2.3.4')).toHaveLength(32);
  });
  it('does not leak the raw value (it is a hash)', () => {
    expect(hashValue('1.2.3.4')).not.toContain('1.2.3.4');
  });
  it('differs for different inputs', () => {
    expect(hashValue('a')).not.toBe(hashValue('b'));
  });
});

describe('sessionTracker — computeFingerprint', () => {
  it('hashes UA + IP independently', () => {
    const fp = computeFingerprint('Mozilla/5.0', '8.8.8.8');
    expect(fp.uaHash).toBe(hashValue('Mozilla/5.0'));
    expect(fp.ipHash).toBe(hashValue('8.8.8.8'));
  });
  it('handles missing UA/IP without throwing', () => {
    const fp = computeFingerprint(undefined, null);
    expect(fp.uaHash).toBe(hashValue('unknown'));
    expect(fp.ipHash).toBe(hashValue('unknown'));
  });
});

describe('sessionTracker — evaluateDevice', () => {
  const chrome = computeFingerprint('Chrome/120', '10.0.0.1');
  const chromeNewIp = computeFingerprint('Chrome/120', '10.0.0.2');
  const firefox = computeFingerprint('Firefox/121', '10.0.0.9');

  it('first-ever device is not an anomaly (baseline)', () => {
    const e = evaluateDevice([], chrome);
    expect(e.risk).toBe('none');
    expect(e.known).toBe(false);
  });

  it('exact match → no risk', () => {
    const e = evaluateDevice([chrome], chrome);
    expect(e.known).toBe(true);
    expect(e.risk).toBe('none');
  });

  it('known UA, new IP → low risk (e.g. mobile handover)', () => {
    const e = evaluateDevice([chrome], chromeNewIp);
    expect(e.uaSeen).toBe(true);
    expect(e.ipSeen).toBe(false);
    expect(e.known).toBe(false);
    expect(e.risk).toBe('low');
  });

  it('brand-new UA → high risk (different device/browser)', () => {
    const e = evaluateDevice([chrome], firefox);
    expect(e.uaSeen).toBe(false);
    expect(e.risk).toBe('high');
  });

  it('matches across a multi-device history', () => {
    const e = evaluateDevice([chrome, firefox], firefox);
    expect(e.known).toBe(true);
    expect(e.risk).toBe('none');
  });
});
