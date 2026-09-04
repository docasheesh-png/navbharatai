import { describe, it, expect } from 'vitest';
import {
  buildAddCustomDomainRequest, buildListCustomDomainsRequest, renderServiceHost,
  isApexDomain, planRenderDnsRecords, parseRenderCustomDomain, alreadyAttached,
  attachRenderCustomDomain,
} from '../src/server/AgentV3/renderCustomDomain';

/**
 * POINT THE DOMAIN AT THE HOST THAT ACTUALLY RUNS THE APP (admin 2026-09-04).
 *
 * mitrify.com served Firebase's "Site Not Found" for a month while the connect screen read
 * `ownership: active · host: active · SSL: active`. The DNS was never the problem: a fullstack
 * ship-whole app cannot be served by static hosting, so its Firebase site never received a release —
 * and `renderDeploy.ts` had no custom-domain code at all, so no path could ever move the domain to the
 * host that CAN serve it. This module is that missing half.
 */

const okRes = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('renderServiceHost — read the host, never assemble it', () => {
  it('takes the hostname out of the service URL', () => {
    expect(renderServiceHost('https://mitrify-api.onrender.com')).toBe('mitrify-api.onrender.com');
    expect(renderServiceHost('https://mitrify-api.onrender.com/')).toBe('mitrify-api.onrender.com');
    expect(renderServiceHost('mitrify-api.onrender.com')).toBe('mitrify-api.onrender.com');
  });

  it('🔒 returns "" rather than a guess — and "" is a refusal downstream', () => {
    // Assembling `${service.name}.onrender.com` would be wrong exactly when the host appended a
    // suffix because the name was taken, i.e. silently, for the apps most likely to hit it.
    for (const bad of ['', '   ', null, undefined]) expect(renderServiceHost(bad)).toBe('');
  });
});

describe('isApexDomain', () => {
  it('tells an apex from a subdomain', () => {
    expect(isApexDomain('mitrify.com')).toBe(true);
    expect(isApexDomain('www.mitrify.com')).toBe(false);
    expect(isApexDomain('MITRIFY.COM.')).toBe(true);   // case + trailing dot are not new domains
  });
});

describe('planRenderDnsRecords — a CNAME, never a hardcoded IP', () => {
  it('🔒 the apex gets a CNAME too, so no third-party IP is ever baked into our source', () => {
    // Render documents an A record to their anycast address for an apex. Writing that would mean every
    // domain we ever wrote goes dark together the day they renumber, with nothing failing on our side
    // to reveal it. We only reach here for zones WE manage in Cloudflare, which flattens an apex CNAME
    // on every lookup — so there is no address to go stale.
    const recs = planRenderDnsRecords('mitrify.com', 'https://mitrify-api.onrender.com');
    expect(recs).toEqual([{ type: 'CNAME', name: 'mitrify.com', value: 'mitrify-api.onrender.com' }]);
    expect(JSON.stringify(recs)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it('a subdomain gets the same shape', () => {
    expect(planRenderDnsRecords('www.mitrify.com', 'https://x.onrender.com'))
      .toEqual([{ type: 'CNAME', name: 'www.mitrify.com', value: 'x.onrender.com' }]);
  });

  it('🔒 no host ⇒ NO records — never a record pointing at a guess', () => {
    expect(planRenderDnsRecords('mitrify.com', '')).toEqual([]);
    expect(planRenderDnsRecords('mitrify.com', null)).toEqual([]);
    expect(planRenderDnsRecords('', 'https://x.onrender.com')).toEqual([]);
  });
});

describe('request builders', () => {
  it('add + list hit the service\'s custom-domains resource, authorised', () => {
    const add = buildAddCustomDomainRequest('rnd_key', 'srv-1', 'MITRIFY.com');
    expect(add.url).toBe('https://api.render.com/v1/services/srv-1/custom-domains');
    expect(add.method).toBe('POST');
    expect(add.headers.Authorization).toBe('Bearer rnd_key');
    expect(JSON.parse(add.body!)).toEqual({ name: 'mitrify.com' }); // normalised before it leaves
    const list = buildListCustomDomainsRequest('rnd_key', 'srv-1');
    expect(list.method).toBe('GET');
    expect(list.url).toContain('/services/srv-1/custom-domains');
  });

  it('a service id with a slash cannot escape its path', () => {
    expect(buildAddCustomDomainRequest('k', 'a/b', 'x.com').url).toContain('a%2Fb');
  });
});

describe('parseRenderCustomDomain + alreadyAttached', () => {
  it('accepts both wrapper shapes and drops junk', () => {
    expect(parseRenderCustomDomain({ customDomain: { id: '1', name: 'A.com', verificationStatus: 'verified' } }))
      .toEqual({ id: '1', name: 'a.com', verificationStatus: 'verified' });
    expect(parseRenderCustomDomain({ id: '2', name: 'b.com' })).toEqual({ id: '2', name: 'b.com', verificationStatus: '' });
    for (const junk of [null, undefined, {}, { name: '  ' }, 5]) expect(parseRenderCustomDomain(junk)).toBeNull();
  });

  it('matches case-insensitively and ignores a trailing dot', () => {
    const list = [{ id: '1', name: 'mitrify.com', verificationStatus: '' }];
    expect(alreadyAttached(list, 'MITRIFY.com')).toBe(true);
    expect(alreadyAttached(list, 'mitrify.com.')).toBe(true);
    expect(alreadyAttached(list, 'other.com')).toBe(false);
    expect(alreadyAttached(list, '')).toBe(false);
  });
});

describe('attachRenderCustomDomain — honest at every branch', () => {
  const base = { apiKey: 'k', serviceId: 'srv-1', serviceUrl: 'https://api.onrender.com', domain: 'mitrify.com' };

  it('attaches a new domain and returns the records that make it resolve', async () => {
    const calls: string[] = [];
    const res = await attachRenderCustomDomain(base, (async (url: any, init: any) => {
      calls.push(`${init?.method} ${url}`);
      if (init?.method === 'GET') return okRes([]);
      return okRes({ id: 'cd1', name: 'mitrify.com' }, 201);
    }) as any);
    expect(res.ok).toBe(true);
    expect(res.ok && res.alreadyThere).toBe(false);
    expect(res.ok && res.records[0].value).toBe('api.onrender.com');
    expect(calls.some((c) => c.startsWith('GET'))).toBe(true);
  });

  it('🔒 IDEMPOTENT — a domain already attached is success, not an error', async () => {
    // Pressing Connect twice must never turn a working setup into a failure.
    const res = await attachRenderCustomDomain(base, (async (_u: any, init: any) => (
      init?.method === 'GET' ? okRes([{ id: '1', name: 'mitrify.com' }]) : okRes({}, 500)
    )) as any);
    expect(res.ok).toBe(true);
    expect(res.ok && res.alreadyThere).toBe(true);
  });

  it('a 409 from the host is also "already there", never a failure', async () => {
    const res = await attachRenderCustomDomain(base, (async (_u: any, init: any) => (
      init?.method === 'GET' ? okRes([]) : okRes({ message: 'exists' }, 409)
    )) as any);
    expect(res.ok).toBe(true);
    expect(res.ok && res.alreadyThere).toBe(true);
  });

  it('🔒 no deployed service ⇒ refuses with the real next step, and writes nothing', async () => {
    const res = await attachRenderCustomDomain({ ...base, serviceId: '' }, (async () => { throw new Error('must not be called'); }) as any);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('no-service');
    expect(!res.ok && res.message).toContain('Deploy the backend first');
  });

  it('🔒 an unreadable backend address changes NOTHING — checked before the write', async () => {
    // Attaching a domain to a service we cannot address would leave a Render-side domain with no DNS:
    // it looks connected and serves nothing, which is the failure this whole area exists to end.
    let called = false;
    const res = await attachRenderCustomDomain({ ...base, serviceUrl: '' }, (async () => { called = true; return okRes({}); }) as any);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('no-host');
    expect(called).toBe(false);
  });

  it('no key refuses without calling anything', async () => {
    const res = await attachRenderCustomDomain({ ...base, apiKey: '' }, (async () => { throw new Error('nope'); }) as any);
    expect(!res.ok && res.reason).toBe('not-configured');
  });

  it('never throws — a network failure is a reported reason', async () => {
    const res = await attachRenderCustomDomain(base, (async () => { throw new Error('offline'); }) as any);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('api-error');
    expect(!res.ok && res.message).toContain('Nothing was changed');
  });

  it('a real refusal from the host is reported with its status, not swallowed', async () => {
    const res = await attachRenderCustomDomain(base, (async (_u: any, init: any) => (
      init?.method === 'GET' ? okRes([]) : okRes({ message: 'bad' }, 422)
    )) as any);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toContain('422');
  });
});

// ---------- the wiring: deploying the backend takes the domain with it ----------

import { readFileSync } from 'fs';
import { join } from 'path';

const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
const handler = (() => {
  const at = route.indexOf("app.post('/api/agentv3/deploy-backend'");
  return route.slice(at, route.indexOf('app.post(', at + 40));
})();

describe('🔒 deploy-backend points a connected domain at the new service', () => {
  it('attaches the domain and writes the DNS, right where a service first exists', () => {
    // It belongs HERE, not on the connect screen: a domain can only point at a service that exists,
    // and this is the exact moment one starts to. No new button, no new step for the user.
    expect(handler).toContain('attachRenderCustomDomain({');
    expect(handler).toContain('applyRecords(zone.id, attach.records)');
  });

  it('🔒 only after a SUCCESSFUL deploy — there is nothing to point at otherwise', () => {
    expect(handler).toContain('if (result.ok) {');
    expect(handler.indexOf('if (result.ok) {')).toBeLessThan(handler.indexOf('attachRenderCustomDomain'));
  });

  it('🔒 a DNS failure can NEVER fail the deploy the user actually asked for', () => {
    // The deploy already happened. Reporting it as failed because a domain write did would be a lie
    // about the thing they requested — and would send them to redo a deploy that succeeded.
    expect(handler).toContain('res.status(result.ok ? 200 : 409)');
    expect(handler).toContain('domainNote');
    // The whole domain block is inside a try/catch that only ever sets a note.
    const blockAt = handler.indexOf('let domainPointed');
    const block = handler.slice(blockAt, handler.indexOf('res.status(result.ok', blockAt));
    expect(block).toContain('catch (e) {');
    expect(block).not.toContain('res.status(5');
  });

  it('🔒 "could not ask" is not "no domain" — a lookup failure is said out loud', () => {
    // firebaseDomainsForWorkspaceStrict returns null for an unreachable store. Treating that as "no
    // domain" would silently skip pointing a domain the user really has.
    expect(handler).toContain('firebaseDomainsForWorkspaceStrict(workspaceId)');
    expect(handler).toContain('if (domains === null)');
  });

  it('without a managed zone it tells the user the record instead of implying it is done', () => {
    expect(handler).toContain('managedDnsConfigured()');
    expect(handler).toContain('by adding a CNAME to');
  });
});
