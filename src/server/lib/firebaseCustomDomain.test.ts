import { describe, it, expect, afterEach } from 'vitest';
import {
  siteIdForWorkspace,
  normalizeDomain,
  customDomainRecords,
  customDomainStatus,
  firebaseCustomDomainsEnabled,
  customDomainErrorMessage,
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

// ROOT CAUSE regression (admin 2026-08-02 — "Failed to start domain connection" on mitrify.xyz):
// attachCustomDomain assumed the workspace's dedicated site already existed, but the site is only
// created by the DEPLOY path. Connecting a domain BEFORE a dedicated-site deploy (e.g. the app was
// published via instant /pwa hosting) hit customDomains.create on a NONEXISTENT site → 404 → 500.
// This locks the fix: attach must ENSURE the site first (idempotent), then attach the domain.
import { vi } from 'vitest';
import { attachCustomDomain, siteIdForWorkspace as siteIdFor } from './firebaseCustomDomain';

vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    async getAccessToken() { return 'test-token'; }
  },
}));

describe('attachCustomDomain — ensures the dedicated site exists BEFORE attaching (2026-08-02 fix)', () => {
  it('creates the site first (idempotent), then attaches the domain to it', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      // Site create → ok; first domain GET → 404 (not attached yet); create → ok; final GET → resource.
      if (String(url).includes('/customDomains/')) {
        if (calls.filter((c) => c.url.includes('/customDomains/')).length === 1) {
          return { ok: false, status: 404, json: async () => ({ error: { message: 'HTTP 404 NOT_FOUND' } }) } as any;
        }
        return { ok: true, json: async () => ({ ownershipState: 'OWNERSHIP_PENDING' }) } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    }));
    try {
      const workspaceId = 'agentv3-uid-sessionX';
      const status = await attachCustomDomain(workspaceId, 'myshop.com');
      const siteId = siteIdFor(workspaceId);
      // THE fix: the very first API call must be the idempotent site create — never a domain call
      // against a site that might not exist.
      expect(calls[0].url).toContain(`/sites?siteId=${siteId}`);
      expect(calls[0].method).toBe('POST');
      // …and the domain operations then target that same site.
      const domainCalls = calls.filter((c) => c.url.includes('/customDomains'));
      expect(domainCalls.length).toBeGreaterThan(0);
      for (const c of domainCalls) expect(c.url).toContain(`/sites/${siteId}/`);
      expect(status.domain).toBe('myshop.com');
      expect(status.active).toBe(false); // honest pending state for a fresh attach
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// HONESTY fix (admin 2026-08-02): every domain failure said "Please try again" — even permanent ones,
// which loops the user forever on something a retry can never fix.
describe('customDomainErrorMessage — the right answer per failure class (never a false "try again")', () => {
  it('a PERMISSION failure says it is our side to enable and that retrying will not help', () => {
    for (const raw of [
      'Request had insufficient authentication scopes',
      'PERMISSION_DENIED: caller lacks firebasehosting.customDomains.create',
      'Firebase Hosting API error (HTTP 403)',
    ]) {
      const m = customDomainErrorMessage(new Error(raw));
      expect(m).toMatch(/not switched on|enable/i);
      expect(m).toMatch(/will not help|contact support/i);
      expect(m).not.toMatch(/please try again in a moment/i);
    }
  });

  it('an ALREADY-TAKEN domain tells the user to free it first (a retry cannot fix it)', () => {
    const m = customDomainErrorMessage(new Error('customDomain already exists on another site'));
    expect(m).toMatch(/already connected/i);
    expect(m).toMatch(/remove it there first/i);
  });

  it('a quota/rate failure is the one case where waiting + retrying IS the advice', () => {
    const m = customDomainErrorMessage(new Error('RESOURCE_EXHAUSTED: quota exceeded'));
    expect(m).toMatch(/wait a few minutes/i);
  });

  it('an invalid/not-found failure NEVER accuses the user\'s spelling — the route validated it first', () => {
    // admin 2026-08-06: mitrify.in (a valid domain) was told to "check the spelling" on every attempt,
    // while the real failure was server-side. By the time this classifier runs, the domain's shape
    // has already passed DOMAIN_RE — blaming the input is a false accusation that hides our gap.
    const m = customDomainErrorMessage(new Error('HTTP 400: invalid domain name'));
    expect(m).not.toMatch(/check the spelling/i);
    expect(m).toMatch(/looks valid/i);
    expect(m).toMatch(/on our side/i);
  });

  it('sanitizeDomainErrorDetail names the real cause with infra identifiers neutralized', async () => {
    const { sanitizeDomainErrorDetail } = await import('./firebaseCustomDomain');
    const d = sanitizeDomainErrorDetail(new Error('Firebase Hosting API error (HTTP 404) for project gen-lang-client-0866594388'));
    expect(d).toContain('HTTP 404');
    expect(d).not.toMatch(/firebase/i);
    expect(d).not.toContain('gen-lang-client-0866594388');
    expect(d).toContain('[project]');
    expect(sanitizeDomainErrorDetail(new Error('x'.repeat(500))).length).toBe(240);
  });

  it('an unknown failure keeps the honest transient default', () => {
    expect(customDomainErrorMessage(new Error('socket hang up'))).toMatch(/try again in a moment/i);
    expect(customDomainErrorMessage(undefined)).toMatch(/try again in a moment/i);
  });

  it('never leaks the raw API text to the user (detail belongs in the server log)', () => {
    const m = customDomainErrorMessage(new Error('projects/gen-lang-client-0866594388/sites/nbai-abc123 PERMISSION_DENIED'));
    expect(m).not.toContain('gen-lang-client');
    expect(m).not.toContain('nbai-abc123');
  });
});

describe('isNotFound — the exact live failure of 2026-08-06, encoded', () => {
  it("recognizes Google's real prose: `Custom Domain \"…\" not found.` — lowercase, spaced", async () => {
    const { isNotFound } = await import('./firebaseCustomDomain');
    // The literal message from the admin's screenshot. The old regex (`HTTP 404|NOT_FOUND`) missed
    // it, so the pre-attach existence probe treated the NORMAL "new domain" answer as fatal and
    // customDomains.create never ran — for every domain, every time.
    expect(isNotFound(new Error('Custom Domain "projects/p/sites/s/customDomains/mitrify.in" not found.'))).toBe(true);
  });

  it('judges by STRUCTURED status first — prose spelling can never break it again', async () => {
    const { isNotFound, HostingApiError } = await import('./firebaseCustomDomain');
    expect(isNotFound(new HostingApiError('anything at all', 404))).toBe(true);
    expect(isNotFound(new HostingApiError('anything at all', 400, 'NOT_FOUND'))).toBe(true);
    expect(isNotFound(new HostingApiError('permission denied', 403, 'PERMISSION_DENIED'))).toBe(false);
  });

  it('a real error is never swallowed as a not-found', async () => {
    const { isNotFound } = await import('./firebaseCustomDomain');
    expect(isNotFound(new Error('The caller does not have permission'))).toBe(false);
    expect(isNotFound(new Error('quota exceeded'))).toBe(false);
  });
});
