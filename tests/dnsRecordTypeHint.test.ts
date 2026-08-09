import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { relativeRecordName } from '../src/components/agentv3/NbaiDomainConnect';

/**
 * DNS record cards vs the registrar's add-record form (admin 2026-08-08, Hostinger screenshot:
 * "type me kya choose kare? user confuse hota hai"). The form leads with a "Type" dropdown and a
 * RELATIVE Name box; our cards led with a tiny corner badge and a fully-qualified name. The card
 * must now map 1:1 onto that form: Type → Type, Name → Name (with the relative fallback named),
 * Value → Value.
 */

describe('relativeRecordName', () => {
  it('apex → "@", subdomain → its prefix, foreign/junk names pass through untouched', () => {
    expect(relativeRecordName('mitrify.in', 'mitrify.in')).toBe('@');
    expect(relativeRecordName('mitrify.in.', 'mitrify.in')).toBe('@');           // API trailing dot
    expect(relativeRecordName('_acme-challenge.mitrify.in', 'mitrify.in')).toBe('_acme-challenge');
    expect(relativeRecordName('www.shop.mitrify.in', 'mitrify.in')).toBe('www.shop');
    expect(relativeRecordName('MITRIFY.IN', 'mitrify.in')).toBe('@');            // case-tolerant
    expect(relativeRecordName('other.com', 'mitrify.in')).toBe('other.com');     // not ours — unchanged
    expect(relativeRecordName('', 'mitrify.in')).toBe('');
  });
});

describe('the record card answers the registrar form', () => {
  const src = readFileSync(join(__dirname, '..', 'src/components/agentv3/NbaiDomainConnect.tsx'), 'utf8');

  it('Type is a first-class copyable Field — not only a corner badge', () => {
    expect(src).toContain('<Field label="Type" value={rec.type}');
  });

  it('the hint names the exact dropdown choice and the relative-Name fallback', () => {
    expect(src).toContain('in the "Type" dropdown choose');
    expect(src).toContain('If the Name box rejects the full name');
    expect(src).toContain('relativeRecordName(rec.name, cleanDomain)');
  });
});
