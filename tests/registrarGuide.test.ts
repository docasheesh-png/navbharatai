import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { REGISTRARS, registrarById, detectRegistrarId, registrarNameFromRdap } from '../src/lib/registrarGuide';

/**
 * "Where did you buy this domain?" (admin suggestion 2026-08-06, adapted): after the nameservers,
 * every registrar hides the paste-them-here form somewhere different. The guide maps the majors to
 * their panel + a three-line path, preselected from public RDAP data — and the user's pick always
 * wins over detection.
 */
describe('registrar guide data', () => {
  it('ids are unique, names/steps present, panel URLs are https (Other legitimately has none)', () => {
    expect(new Set(REGISTRARS.map((r) => r.id)).size).toBe(REGISTRARS.length);
    for (const r of REGISTRARS) {
      expect(r.name.length).toBeGreaterThan(1);
      expect(r.steps.length).toBeGreaterThan(10);
      if (r.id !== 'other') expect(r.panelUrl).toMatch(/^https:\/\//);
    }
    expect(registrarById('other')!.panelUrl).toBe('');
  });

  it('covers the admin-named registrars and the India-first majors', () => {
    for (const id of ['godaddy', 'hostinger', 'namecheap', 'bigrock', 'other']) {
      expect(registrarById(id), id).not.toBeNull();
    }
  });

  it('registrarById never crashes a select — unknown ids are null', () => {
    expect(registrarById('nonsense')).toBeNull();
    expect(registrarById(null)).toBeNull();
  });
});

describe('RDAP detection', () => {
  it('matches real RDAP legal names, case-insensitively', () => {
    expect(detectRegistrarId('GoDaddy.com, LLC')).toBe('godaddy');
    expect(detectRegistrarId('HOSTINGER operations, UAB')).toBe('hostinger');
    expect(detectRegistrarId('NAMECHEAP INC')).toBe('namecheap');
    expect(detectRegistrarId('Some Tiny Registrar Pvt Ltd')).toBeNull();
    expect(detectRegistrarId(null)).toBeNull();
  });

  it('pulls the registrar fn out of a real-shaped RDAP response, tolerating junk', () => {
    const rdap = {
      entities: [
        { roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', 'The Owner']]] },
        { roles: ['registrar'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'GoDaddy.com, LLC']]] },
      ],
    };
    expect(registrarNameFromRdap(rdap)).toBe('GoDaddy.com, LLC');
    expect(registrarNameFromRdap({})).toBeNull();
    expect(registrarNameFromRdap(null)).toBeNull();
    expect(registrarNameFromRdap({ entities: [{ roles: ['registrar'] }] })).toBeNull();
  });
});

describe('client wiring', () => {
  const client = readFileSync(join(__dirname, '..', 'src/components/agentv3/NbaiDomainConnect.tsx'), 'utf8');

  it('the picker lives at the nameserver step, detection preselects, and a manual pick always wins', () => {
    expect(client).toContain('Where did you buy this domain?');
    expect(client).toContain('rdap.org/domain/');
    expect(client).toContain('setRegistrarId((prev) => prev || detected)');   // never clobbers the user
  });

  it('the panel opens in a new tab and Other renders steps without a dead button', () => {
    expect(client).toMatch(/registrarById\(registrarId\)\?\.panelUrl && \(/);
    expect(client).toContain('target="_blank"');
  });
});
