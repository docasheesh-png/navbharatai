import { describe, it, expect, afterEach } from 'vitest';
import {
  siteIdForWorkspace,
  normalizeDomain,
  customDomainRecords,
  customDomainStatus,
  firebaseCustomDomainsEnabled,
} from './firebaseCustomDomain';

describe('firebaseCustomDomain — pure helpers', () => {
  describe('siteIdForWorkspace', () => {
    it('produces a valid Firebase site id (lowercase, [a-z0-9-], <=30, no edge hyphen)', () => {
      const id = siteIdForWorkspace('agentv3-USER123-sessionABC');
      expect(id).toMatch(/^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])$/);
      expect(id.length).toBeLessThanOrEqual(30);
      expect(id.startsWith('nbai-')).toBe(true);
    });

    it('is stable for the same workspace and unique across workspaces', () => {
      const a1 = siteIdForWorkspace('agentv3-uid-sessionA');
      const a2 = siteIdForWorkspace('agentv3-uid-sessionA');
      const b = siteIdForWorkspace('agentv3-uid-sessionB'); // differs only in the suffix
      expect(a1).toBe(a2);            // same workspace → same site (idempotent redeploy)
      expect(a1).not.toBe(b);        // different workspace → different site (no collision)
    });
  });

  describe('normalizeDomain', () => {
    it('strips scheme, path, trailing dot and lowercases', () => {
      expect(normalizeDomain('https://MyShop.com/path')).toBe('myshop.com');
      expect(normalizeDomain('  shop.example.CO.  ')).toBe('shop.example.co');
    });
  });

  describe('customDomainRecords', () => {
    it('surfaces only ADD records when requiredAction is present', () => {
      const recs = customDomainRecords({
        customDomainId: 'myshop.com',
        requiredDnsUpdates: {
          desiredDnsState: [
            {
              domainName: 'myshop.com',
              records: [
                { domainName: 'myshop.com', type: 'A', rrdata: ['151.101.1.195'], requiredAction: 'ADD' },
                { domainName: 'myshop.com', type: 'A', rrdata: ['151.101.65.195'], requiredAction: 'ADD' },
                { domainName: 'myshop.com', type: 'AAAA', rrdata: ['2a04::1'], requiredAction: 'NONE' }, // already set → skip
                { domainName: 'old.myshop.com', type: 'A', rrdata: ['1.2.3.4'], requiredAction: 'REMOVE' }, // skip
              ],
            },
            {
              domainName: '_acme-challenge.myshop.com',
              records: [
                { domainName: '_acme-challenge.myshop.com', type: 'TXT', rrdata: ['token-abc'], requiredAction: 'ADD' },
              ],
            },
          ],
        },
      });
      const kinds = recs.map((r) => `${r.type} ${r.value}`);
      expect(kinds).toContain('A 151.101.1.195');
      expect(kinds).toContain('A 151.101.65.195');
      expect(kinds).toContain('TXT token-abc');
      expect(kinds).not.toContain('AAAA 2a04::1'); // NONE (already present)
      expect(kinds).not.toContain('A 1.2.3.4');     // REMOVE
      // TXT record carries its own challenge subdomain as the name
      expect(recs.find((r) => r.type === 'TXT')?.name).toBe('_acme-challenge.myshop.com');
    });

    it('surfaces every desired record when requiredAction is omitted (never leaves the user short)', () => {
      const recs = customDomainRecords({
        customDomainId: 'x.com',
        requiredDnsUpdates: {
          desiredDnsState: [
            { domainName: 'x.com', records: [{ domainName: 'x.com', type: 'A', rrdata: ['1.1.1.1'] }] },
          ],
        },
      });
      expect(recs).toHaveLength(1);
      expect(recs[0]).toMatchObject({ type: 'A', name: 'x.com', value: '1.1.1.1' });
    });

    it('returns [] when there are no required updates', () => {
      expect(customDomainRecords({ customDomainId: 'x.com' })).toEqual([]);
    });
  });

  describe('firebaseCustomDomainsEnabled', () => {
    const prev = process.env.AGENTV3_FIREBASE_CUSTOM_DOMAINS;
    afterEach(() => {
      if (prev === undefined) delete process.env.AGENTV3_FIREBASE_CUSTOM_DOMAINS;
      else process.env.AGENTV3_FIREBASE_CUSTOM_DOMAINS = prev;
    });
    it('is OFF by default and for falsy values', () => {
      delete process.env.AGENTV3_FIREBASE_CUSTOM_DOMAINS;
      expect(firebaseCustomDomainsEnabled()).toBe(false);
      process.env.AGENTV3_FIREBASE_CUSTOM_DOMAINS = 'off';
      expect(firebaseCustomDomainsEnabled()).toBe(false);
    });
    it('is ON only for on/true/1', () => {
      for (const v of ['on', 'true', '1', 'ON', 'True']) {
        process.env.AGENTV3_FIREBASE_CUSTOM_DOMAINS = v;
        expect(firebaseCustomDomainsEnabled()).toBe(true);
      }
    });
  });

  describe('customDomainStatus', () => {
    it('is active ONLY when ownership + host + cert are all ACTIVE', () => {
      const live = customDomainStatus('myshop.com', {
        ownershipState: 'OWNERSHIP_ACTIVE',
        hostState: 'HOST_ACTIVE',
        cert: { state: 'CERT_ACTIVE' },
      });
      expect(live.active).toBe(true);
    });

    it('is NOT active while any of the three is still pending (honest pending state)', () => {
      const pendingCert = customDomainStatus('myshop.com', {
        ownershipState: 'OWNERSHIP_ACTIVE',
        hostState: 'HOST_ACTIVE',
        cert: { state: 'CERT_PENDING' },
      });
      expect(pendingCert.active).toBe(false);
      expect(pendingCert.sslState).toBe('CERT_PENDING');

      const fresh = customDomainStatus('myshop.com', {}); // brand new → all pending defaults
      expect(fresh.active).toBe(false);
      expect(fresh.ownershipState).toBe('OWNERSHIP_PENDING');
      expect(fresh.hostState).toBe('HOST_PENDING');
      expect(fresh.sslState).toBe('CERT_PENDING');
    });
  });
});

// slice 1 — Firebase-native custom-domain primitive (see firebaseCustomDomain.ts)
