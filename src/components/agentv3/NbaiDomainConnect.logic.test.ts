import { describe, it, expect } from 'vitest';
import { connectStage, relativeRecordName } from './NbaiDomainConnect';

describe('connectStage — plain-language, honest connect stages', () => {
  it('active domain: done, no further action', () => {
    const s = connectStage({ active: true, ownershipState: 'ACTIVE', hostState: 'ACTIVE', sslState: 'ACTIVE' });
    expect(s.action).toBe('none');
    expect(s.headline).toMatch(/Live/i);
  });

  it('ownership pending: sets an HONEST multi-hour expectation and says progress is saved', () => {
    const s = connectStage({ active: false, ownershipState: 'PENDING', hostState: 'PENDING', sslState: 'PENDING' });
    expect(s.action).toBe('check');
    // The admin's real Hostinger wait was hours, not minutes — the copy must not under-promise, and must
    // reassure that leaving is safe now that records are remembered.
    expect(s.note).toMatch(/hour/i);
    expect(s.note).toMatch(/saved|safely|nothing is lost/i);
    // A regression guard against the old under-promise, which made a normal multi-hour wait look broken.
    expect(s.note).not.toMatch(/usually takes a few minutes \(sometimes longer\)/i);
  });

  it('ownership done, host pending: honest "almost done", safe to leave', () => {
    const s = connectStage({ active: false, ownershipState: 'ACTIVE', hostState: 'PENDING', sslState: 'PENDING' });
    expect(s.action).toBe('check');
    expect(s.headline).toMatch(/Ownership confirmed/i);
    expect(s.note).toMatch(/leave|safe/i);
  });

  it('host done, cert pending: certificate stage, safe to leave', () => {
    const s = connectStage({ active: false, ownershipState: 'ACTIVE', hostState: 'ACTIVE', sslState: 'PENDING' });
    expect(s.action).toBe('check');
    expect(s.headline).toMatch(/certificate/i);
    expect(s.note).toMatch(/saved|safely|leave/i);
  });

  it('never claims "check" is unnecessary while any stage is pending (stays honest)', () => {
    for (const st of [
      { active: false, ownershipState: 'PENDING', hostState: 'PENDING', sslState: 'PENDING' },
      { active: false, ownershipState: 'ACTIVE', hostState: 'PENDING', sslState: 'PENDING' },
      { active: false, ownershipState: 'ACTIVE', hostState: 'ACTIVE', sslState: 'PENDING' },
    ]) {
      expect(connectStage(st).action).toBe('check');
    }
  });
});

describe('relativeRecordName — registrar add-record form names', () => {
  it('maps the apex to "@"', () => {
    expect(relativeRecordName('example.com', 'example.com')).toBe('@');
    expect(relativeRecordName('example.com.', 'example.com')).toBe('@');
  });

  it('strips the domain suffix from a subdomain', () => {
    expect(relativeRecordName('www.example.com', 'example.com')).toBe('www');
    expect(relativeRecordName('_acme-challenge.example.com', 'example.com')).toBe('_acme-challenge');
  });

  it('leaves an unrelated / empty name untouched', () => {
    expect(relativeRecordName('other.org', 'example.com')).toBe('other.org');
    expect(relativeRecordName('', 'example.com')).toBe('');
  });
});
