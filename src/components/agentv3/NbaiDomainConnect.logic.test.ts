import { describe, it, expect } from 'vitest';
import { connectStage, relativeRecordName } from './NbaiDomainConnect';

describe('connectStage — plain-language, honest connect stages', () => {
  it('active domain: done, no further action — but only CONNECTED until something SAW it serve', () => {
    // ⚠️ The `/Live/i` this used to assert was the bug (2026-08-21). DNS + certificate active is not
    // evidence the domain SHOWS THE APP: the admin's screen printed "Live!" directly above a browser
    // tab showing "Site Not Found" on that same domain. With no serving verdict, "Connected" is the
    // most we can honestly say. See the `unknown` case below for the full reasoning.
    const s = connectStage({ active: true, ownershipState: 'ACTIVE', hostState: 'ACTIVE', sslState: 'ACTIVE' });
    expect(s.action).toBe('none');
    expect(s.headline).toContain('Connected');
    // …and the moment a check actually sees the app, the word is earned.
    expect(connectStage({
      active: true, ownershipState: 'ACTIVE', hostState: 'ACTIVE', sslState: 'ACTIVE',
      serving: { state: 'serving', note: '' },
    }).headline).toMatch(/Live/i);
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

/**
 * 🔒 "LIVE!" MUST BE EARNED (admin 2026-08-21, mitrify.com).
 *
 * The screen said, in green, "✅ Live! Your domain is connected, with HTTPS · ownership: active ·
 * host: active · SSL: active" — while opening mitrify.com gave Firebase's "Site Not Found". Both were
 * true: those three states describe DNS and a CERTIFICATE, not whether anything was ever published to
 * the site the domain points at. A domain connected AFTER the last publish points at an empty site.
 *
 * The old copy DID say "publish your app once" — but under a green ✅ Live headline that reads as a
 * tip, not as "your domain shows an error page until you do this". The headline is what people act
 * on, so the headline is what had to change.
 */
describe('connectStage — the word "Live" is earned by SERVING, not by DNS', () => {
  const ACTIVE = { active: true, ownershipState: 'ACTIVE', hostState: 'ACTIVE', sslState: 'ACTIVE' };

  it('THE BUG: active but nothing published ⇒ NOT "Live", and it names the one step left', () => {
    const s = connectStage({ ...ACTIVE, serving: { state: 'nothing_published', note: '' } });
    expect(s.headline).not.toMatch(/Live/i);
    expect(s.headline).toMatch(/press Publish/i);
    expect(s.tone).toBe('warn');          // never a green tick over an error page
    expect(s.action).toBe('publish');      // and a real way to get there
  });

  it('active but the domain answers with an error ⇒ also not "Live"', () => {
    const s = connectStage({ ...ACTIVE, serving: { state: 'error', note: 'HTTP 503' } });
    expect(s.headline).not.toMatch(/^Live/i);
    expect(s.tone).toBe('warn');
  });

  it('active AND serving ⇒ genuinely Live', () => {
    const s = connectStage({ ...ACTIVE, serving: { state: 'serving', note: '' } });
    expect(s.headline).toMatch(/Live/i);
    expect(s.tone).toBe('ok');
    expect(s.action).toBe('none');
  });

  /**
   * ⚠️ THIS TEST WAS REVERSED ON 2026-08-21, and the old assertion was the bug.
   *
   * It required "Live!" for `unknown` too, reasoning that our own failed check must not demote a
   * working domain. Then the admin sent a screenshot: our check could not reach mitrify.com, and the
   * screen printed "Live!" directly above a browser tab showing Firebase's "Site Not Found" on that
   * exact domain. "Best evidence we have" is not the same as "we saw it work", and only the second
   * one earns the word Live.
   */
  it('UNKNOWN says CONNECTED and admits what it could not check — it never claims Live', () => {
    const s = connectStage({ ...ACTIVE, serving: { state: 'unknown', note: '' } });
    expect(s.headline).not.toMatch(/Live/i);
    expect(s.headline).toContain('Connected');
    expect(s.tone).toBe('ok');            // not a warning — the connection really is done
    expect(s.note).toContain('could not open your domain from here');
  });

  it('an older server that sends no `serving` at all is treated the same way — never a bare Live', () => {
    // Absence of a verdict is exactly the `unknown` case; it must not be luckier than an explicit one.
    expect(connectStage(ACTIVE).headline).not.toMatch(/Live/i);
    expect(connectStage(ACTIVE).tone).toBe('ok');
  });

  it('a domain that is not active yet is unaffected by any serving result', () => {
    const s = connectStage({ active: false, ownershipState: 'PENDING', hostState: 'PENDING', sslState: 'PENDING', serving: { state: 'nothing_published', note: '' } });
    expect(s.action).toBe('check');
  });
});
