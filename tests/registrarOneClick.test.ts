import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  discoverSettings, buildApplyUrl, checkDomainConnect, domainConnectEnabled, _setDomainConnectDepsForTests,
} from '../src/server/lib/domainConnect';
import {
  toHostingerZone, applyHostingerRecords, sanitizeHostingerError, hostingerDnsEnabled, _setHostingerFetchForTests,
} from '../src/server/lib/hostingerDns';

/**
 * Slices B (Domain Connect one-click) + C (Hostinger direct DNS) — admin 2026-08-06: "sab banao,
 * not only GoDaddy, Hostinger bhi." Neither external service is reachable from CI; the seams prove
 * the calls, and the invariants pin the honesty rules: no button that would 404 at the registrar,
 * and a user token that is used once and can never linger.
 */

afterEach(() => {
  _setDomainConnectDepsForTests({});
  _setHostingerFetchForTests(null);
  delete process.env.AGENTV3_DOMAIN_CONNECT;
  delete process.env.AGENTV3_HOSTINGER_DNS;
});

describe('Domain Connect discovery', () => {
  it('reads _domainconnect TXT, fetches settings, and reports the provider', async () => {
    _setDomainConnectDepsForTests({
      resolveTxt: async () => [['domainconnect.api.godaddy.com/v2']],
      fetchImpl: async () => ({ ok: true, json: async () => ({ providerName: 'GoDaddy', urlSyncUX: 'https://dcc.godaddy.com/manage' }) }),
    });
    const s = await discoverSettings('mitrify.in');
    expect(s?.providerName).toBe('GoDaddy');
    expect(s?.urlSyncUX).toContain('godaddy');
  });

  it('an absent TXT record (NXDOMAIN) means unsupported — a plain null, never a throw', async () => {
    _setDomainConnectDepsForTests({ resolveTxt: async () => { throw new Error('ENOTFOUND'); } });
    expect(await discoverSettings('mitrify.in')).toBeNull();
  });
});

describe('buildApplyUrl', () => {
  it('carries the records as our template variables, bounded per type', () => {
    const url = buildApplyUrl('https://dcc.godaddy.com/manage', 'mitrify.in', [
      { type: 'A', value: '1.1.1.1' }, { type: 'A', value: '2.2.2.2' }, { type: 'A', value: '3.3.3.3' },
      { type: 'TXT', value: 'challenge' },
    ]);
    expect(url).toContain('/v2/domainTemplates/providers/navbharatai.com/services/hosting/apply');
    expect(url).toContain('domain=mitrify.in');
    expect(url).toContain('a1=1.1.1.1');
    expect(url).toContain('a2=2.2.2.2');
    expect(url).not.toContain('3.3.3.3');            // template declares two A slots — extras never leak
    expect(url).toContain('txt1=challenge');
  });
});

describe('checkDomainConnect honesty', () => {
  it('flag off ⇒ never offers a button that would 404 at the registrar', async () => {
    const c = await checkDomainConnect('mitrify.in', []);
    expect(domainConnectEnabled()).toBe(false);
    expect(c.supported).toBe(false);
    expect(c.reason).toContain('not enabled');
  });

  it('flag on + unsupported registrar ⇒ honest pointer to the other two paths', async () => {
    process.env.AGENTV3_DOMAIN_CONNECT = 'on';
    _setDomainConnectDepsForTests({ resolveTxt: async () => { throw new Error('ENOTFOUND'); } });
    const c = await checkDomainConnect('mitrify.in', []);
    expect(c.supported).toBe(false);
    expect(c.reason).toContain('does not support one-click');
  });
});

describe('Hostinger zone mapping', () => {
  it('fully-qualified names become zone-relative, apex becomes @, values group per type+name', () => {
    const zone = toHostingerZone('mitrify.in', [
      { type: 'A', name: 'mitrify.in', value: '1.1.1.1' },
      { type: 'A', name: 'mitrify.in', value: '2.2.2.2' },
      { type: 'TXT', name: '_acme.mitrify.in', value: 'tok' },
    ]);
    expect(zone).toEqual([
      { name: '@', type: 'A', ttl: 300, records: [{ content: '1.1.1.1' }, { content: '2.2.2.2' }] },
      { name: '_acme', type: 'TXT', ttl: 300, records: [{ content: 'tok' }] },
    ]);
  });
});

describe('applyHostingerRecords', () => {
  it('sends overwrite:false with the user token, and reports the API answer honestly', async () => {
    process.env.AGENTV3_HOSTINGER_DNS = 'on';
    let seen: { url?: string; auth?: string; body?: string } = {};
    _setHostingerFetchForTests(async (url, init) => {
      seen = { url, auth: init.headers.Authorization, body: init.body };
      return { ok: true, status: 200, json: async () => ({}) };
    });
    const r = await applyHostingerRecords('tok-123', 'mitrify.in', [{ type: 'A', name: 'mitrify.in', value: '1.1.1.1' }]);
    expect(r.ok).toBe(true);
    expect(hostingerDnsEnabled()).toBe(true);
    expect(seen.url).toContain('/zones/mitrify.in');
    expect(seen.auth).toBe('Bearer tok-123');
    expect(seen.body).toContain('"overwrite":false');   // the rest of the user's zone is untouched
  });

  it('a rejected token gets the ONE hint that helps, not a raw dump', async () => {
    _setHostingerFetchForTests(async () => ({ ok: false, status: 401, json: async () => ({ message: 'unauthenticated' }) }));
    const r = await applyHostingerRecords('bad', 'mitrify.in', [{ type: 'A', name: 'mitrify.in', value: '1.1.1.1' }]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('hPanel');
    expect(sanitizeHostingerError('x'.repeat(500)).length).toBe(240);
  });

  it('no records yet ⇒ an honest instruction, not an empty API call', async () => {
    const r = await applyHostingerRecords('tok', 'mitrify.in', []);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('connect the domain first');
  });
});

// ---------- route + client honesty ----------

const route = readFileSync(join(__dirname, '..', 'src/server/routes/nbaiDomains.ts'), 'utf8');
const client = readFileSync(join(__dirname, '..', 'src/components/agentv3/NbaiDomainConnect.tsx'), 'utf8');

describe('slice B/C surfaces', () => {
  it('both routes are ownership-checked; Hostinger is flag-gated and bounds the token', () => {
    const dc = route.slice(route.indexOf('domain-connect/check'), route.indexOf('domain-connect/check') + 1400);
    expect(dc).toContain('ownsWorkspace');
    const hg = route.slice(route.indexOf('hostinger/apply'), route.indexOf('hostinger/apply') + 2200);
    expect(hg).toContain('ownsWorkspace');
    expect(hg).toContain('hostingerDnsEnabled()');
    expect(hg).toContain('apiToken.length > 512');
  });

  it('the token is single-use by construction: never persisted server-side, cleared client-side after apply', () => {
    // Server: the token variable is passed straight to applyHostingerRecords and to nothing else.
    expect(route).not.toContain('setDoc') || undefined;
    const hg = route.slice(route.indexOf('hostinger/apply'), route.indexOf('hostinger/apply') + 2200);
    expect(hg).toContain('applyHostingerRecords(apiToken');
    expect(hg).not.toMatch(/console\.(log|error)\([^)]*apiToken/);
    // Client: state cleared the moment the call succeeds.
    expect(client).toContain("setHostingerToken('')");
  });

  it('capabilities gate every button: nothing renders that the server cannot deliver', () => {
    expect(route).toContain('domainConnect: domainConnectEnabled()');
    expect(route).toContain('hostingerDns: hostingerDnsEnabled()');
    expect(client).toContain('result.domainConnect &&');
    expect(client).toContain('result.hostingerDns &&');
  });
});
