import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  managedDnsConfigured, ensureZone, zoneStatus, applyRecords, toCfRecordPayloads,
  sanitizeManagedDnsError, _setCfFetchForTests,
} from '../src/server/lib/cloudflareManagedDns';

/**
 * AUTO-DNS via nameserver delegation (admin 2026-08-06: "DNS hum set kar dein, user kuch na kare —
 * GoDaddy bhi, Hostinger bhi"). The one path that works on EVERY registrar: nameservers change once,
 * NavBharatAI writes the records forever after. The DNS API is unreachable from CI, so the seam
 * (`_setCfFetchForTests`) proves the calls; the invariants below are the safety story.
 */

const j = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });

afterEach(() => {
  _setCfFetchForTests(null);
  delete process.env.AGENTV3_MANAGED_DNS;
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
});

describe('managedDnsConfigured', () => {
  it('requires BOTH credentials, and the kill switch wins over them', () => {
    expect(managedDnsConfigured()).toBe(false);
    process.env.CLOUDFLARE_API_TOKEN = 't';
    expect(managedDnsConfigured()).toBe(false);           // token alone is not enough
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a';
    expect(managedDnsConfigured()).toBe(true);
    process.env.AGENTV3_MANAGED_DNS = 'off';
    expect(managedDnsConfigured()).toBe(false);
  });
});

describe('toCfRecordPayloads', () => {
  it('every record is DNS-only (proxied:false) — proxying would break the cert validation', () => {
    const out = toCfRecordPayloads([{ type: 'A', name: 'shop.in', value: '1.2.3.4' }]);
    expect(out).toEqual([{ type: 'A', name: 'shop.in', content: '1.2.3.4', ttl: 300, proxied: false }]);
  });
  it('drops incomplete records instead of sending broken payloads', () => {
    expect(toCfRecordPayloads([{ type: '', name: 'x', value: 'y' }, { type: 'A', name: '', value: 'y' }])).toEqual([]);
  });
});

describe('ensureZone', () => {
  it('creates the zone and returns the nameservers the user must set', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 't'; process.env.CLOUDFLARE_ACCOUNT_ID = 'acc';
    const calls: string[] = [];
    _setCfFetchForTests(async (url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url}`);
      return j({ success: true, result: { id: 'z1', name: 'mitrify.in', status: 'pending', name_servers: ['a.ns.net', 'b.ns.net'] } });
    });
    const z = await ensureZone('mitrify.in');
    expect(z.nameServers).toEqual(['a.ns.net', 'b.ns.net']);
    expect(z.status).toBe('pending');
    expect(calls[0]).toContain('POST');
    expect(calls[0]).toContain('/zones');
  });

  it('an already-existing zone (code 1061) is fetched, not a failure — Try again must work', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 't'; process.env.CLOUDFLARE_ACCOUNT_ID = 'acc';
    let call = 0;
    _setCfFetchForTests(async () => {
      call++;
      if (call === 1) return j({ success: false, errors: [{ code: 1061, message: 'zone already exists' }] }, false, 400);
      return j({ success: true, result: [{ id: 'z1', name: 'mitrify.in', status: 'active', name_servers: ['a.ns.net', 'b.ns.net'] }] });
    });
    const z = await ensureZone('mitrify.in');
    expect(z.status).toBe('active');
  });
});

describe('applyRecords', () => {
  it('identical records are left alone; a changed A record is REPLACED; new TXT is ADDED alongside', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 't';
    const writes: Array<{ method: string; url: string }> = [];
    _setCfFetchForTests(async (url, init) => {
      const method = init.method ?? 'GET';
      if (method === 'GET' && url.includes('type=A')) {
        return j({ success: true, result: [{ id: 'r1', type: 'A', name: 'mitrify.in', content: '9.9.9.9' }] });
      }
      if (method === 'GET' && url.includes('type=TXT')) {
        return j({ success: true, result: [{ id: 'r2', type: 'TXT', name: 'mitrify.in', content: '"other-unrelated"' }] });
      }
      writes.push({ method, url });
      return j({ success: true, result: {} });
    });
    const changed = await applyRecords('z1', [
      { type: 'A', name: 'mitrify.in', value: '1.2.3.4' },      // differs → PUT replace
      { type: 'TXT', name: 'mitrify.in', value: 'fb-challenge' }, // new value → POST alongside
    ]);
    expect(changed).toBe(2);
    expect(writes[0].method).toBe('PUT');                        // single-value type replaced in place
    expect(writes[0].url).toContain('/dns_records/r1');
    expect(writes[1].method).toBe('POST');                       // TXT added, unrelated TXT untouched
  });

  it('a PROXIED record with the right content is re-written DNS-only (the 2026-08-06 auto-import trap)', async () => {
    // When the zone activated, Cloudflare AUTO-IMPORTED the old records as PROXIED ("your traffic is
    // proxying through Cloudflare" — the admin's live dashboard). A proxied record hides the real
    // value behind proxy IPs, so hosting validation can never pass — "identical content" is NOT
    // enough; the record must also be un-proxied.
    process.env.CLOUDFLARE_API_TOKEN = 't';
    const writes: Array<{ method: string; url: string; body?: string }> = [];
    _setCfFetchForTests(async (url, init) => {
      const method = init.method ?? 'GET';
      if (method === 'GET') {
        return j({ success: true, result: [{ id: 'r1', type: 'A', name: 'mitrify.in', content: '199.36.158.100', proxied: true }] });
      }
      writes.push({ method, url, body: init.body });
      return j({ success: true, result: {} });
    });
    const changed = await applyRecords('z1', [{ type: 'A', name: 'mitrify.in', value: '199.36.158.100' }]);
    expect(changed).toBe(1);
    expect(writes[0].method).toBe('PUT');
    expect(writes[0].url).toContain('/dns_records/r1');
    expect(writes[0].body).toContain('"proxied":false');
  });

  it('a multi-value A set converges without thrash: replace one stale, add the other, delete extras', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 't';
    const writes: Array<{ method: string; url: string }> = [];
    _setCfFetchForTests(async (url, init) => {
      const method = init.method ?? 'GET';
      if (method === 'GET') {
        return j({ success: true, result: [
          { id: 'old1', type: 'A', name: 'mitrify.in', content: '84.32.84.32', proxied: true },  // old host's parking IP
          { id: 'old2', type: 'A', name: 'mitrify.in', content: '84.32.84.33', proxied: true },
          { id: 'old3', type: 'A', name: 'mitrify.in', content: '84.32.84.34' },
        ] });
      }
      writes.push({ method, url });
      return j({ success: true, result: {} });
    });
    const changed = await applyRecords('z1', [
      { type: 'A', name: 'mitrify.in', value: '151.101.1.195' },
      { type: 'A', name: 'mitrify.in', value: '151.101.65.195' },
    ]);
    // 2 replacements + 1 delete — the set ends EXACTLY at the two desired values, nothing thrashes.
    expect(changed).toBe(3);
    expect(writes.map((w) => w.method)).toEqual(['PUT', 'PUT', 'DELETE']);
  });

  it('an already-correct zone reports 0 changes — an honest, verifiable no-op', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 't';
    _setCfFetchForTests(async (url, init) => {
      if ((init.method ?? 'GET') === 'GET') {
        return j({ success: true, result: [{ id: 'r1', type: 'A', name: 'mitrify.in', content: '1.2.3.4' }] });
      }
      throw new Error('no write should happen');
    });
    expect(await applyRecords('z1', [{ type: 'A', name: 'mitrify.in', value: '1.2.3.4' }])).toBe(0);
  });
});

describe('sanitizeManagedDnsError', () => {
  it('neutralizes vendor branding and bounds the message', () => {
    expect(sanitizeManagedDnsError(new Error('Cloudflare zone limit reached on Cloudflare'))).toBe('DNS service zone limit reached on DNS service');
    expect(sanitizeManagedDnsError(new Error('x'.repeat(500))).length).toBe(240);
  });
});

// ---------- route + client invariants ----------

const route = readFileSync(join(__dirname, '..', 'src/server/routes/nbaiDomains.ts'), 'utf8');
const client = readFileSync(join(__dirname, '..', 'src/components/agentv3/NbaiDomainConnect.tsx'), 'utf8');

describe('auto-DNS surface honesty', () => {
  it('both routes are ownership-checked and creds-gated, with the sanitized detail on failure', () => {
    for (const ep of ['auto-dns/start', 'auto-dns/sync']) {
      const seg = route.slice(route.indexOf(ep), route.indexOf(ep) + 2600);
      expect(seg).toContain('ownsWorkspace');
      expect(seg).toContain('managedDnsConfigured()');
      expect(seg).toContain('sanitizeManagedDnsError(err)');
    }
  });

  it('sync refuses to pretend: a pending zone applies nothing, and attach must precede apply', () => {
    const seg = route.slice(route.indexOf('auto-dns/sync'));
    expect(seg).toMatch(/zone\.status !== 'active'/);
    expect(seg).toContain('Connect the domain first');
  });

  it('the client warns that delegation replaces ALL DNS before the user commits', () => {
    expect(client).toContain('moves ALL DNS');
    expect(client).toContain('manual records above if that worries you');
  });

  it('the option appears only when the server can actually deliver it', () => {
    expect(client).toContain('result.autoDns &&');
    expect(route).toContain('autoDns: managedDnsConfigured()');
  });

  it('zone status is told straight: waiting vs live-with-applied-count', () => {
    expect(client).toContain('Waiting for the nameserver change');
    expect(client).toContain('applied automatically');
  });
});
