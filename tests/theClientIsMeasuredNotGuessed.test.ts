/**
 * Q-154: `trust proxy: true` keys anonymous rate-limit buckets on a header the caller writes. The fix is a hop
 * count, and a wrong count is worse than today — so it is measured. `hopReport` shows, for the admin's own
 * request, what `req.ip` would be under each count; it mirrors Express's own rule (the entry `hops` from the
 * right of the forwarded chain plus the socket peer).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import express from 'express';
import { hopVerdictText, isHopReport } from '../src/components/admin/ProxyHopsCard';
import { hopReport, hopReportFor } from '../src/server/lib/proxyHops';
import { TRUSTED_PROXY_HOPS } from '../src/server/lib/clientAddress';

describe('the proxy hop count is measured, not guessed', () => {
  it('lists what req.ip would be under every hop count', () => {
    const r = hopReport('203.0.113.7, 151.101.1.1, 35.191.2.2', '169.254.1.1');
    expect(r.forwardedFor).toEqual(['203.0.113.7', '151.101.1.1', '35.191.2.2']);
    expect(r.ipByHopCount).toEqual([
      { hops: 1, ip: '35.191.2.2' },
      { hops: 2, ip: '151.101.1.1' },
      { hops: 3, ip: '203.0.113.7' },
    ]);
  });

  it('agrees with Express itself for every count', () => {
    const xff = '203.0.113.7, 151.101.1.1, 35.191.2.2';
    for (const { hops, ip } of hopReport(xff, '169.254.1.1').ipByHopCount) {
      const app = express();
      app.set('trust proxy', hops);
      const req = Object.create(app.request, {
        headers: { value: { 'x-forwarded-for': xff } },
        socket: { value: { remoteAddress: '169.254.1.1' } },
        connection: { value: { remoteAddress: '169.254.1.1' } },
      });
      req.app = app;
      expect(req.ip, `hops ${hops}`).toBe(ip);
    }
  });

  it('names the count the server runs with, so the admin can confirm it rather than compute it', () => {
    const r = hopReportFor({ headers: { 'x-forwarded-for': '203.0.113.7, 35.191.2.2' }, socket: { remoteAddress: '169.254.1.1' } });
    expect(r.trustedHops).toBe(TRUSTED_PROXY_HOPS);
    expect(r.ipByHopCount.find((x) => x.hops === TRUSTED_PROXY_HOPS)?.ip).toBe('35.191.2.2');
    expect(r.howToRead).toContain(`trust proxy = ${TRUSTED_PROXY_HOPS}`);
  });

  it('the route hands the request to the module; admin.ts itself reads no forwarding header', () => {
    const admin = readFileSync('src/server/routes/admin.ts', 'utf8');
    expect(admin).toContain('hopReportFor(req)');
    expect(admin).not.toMatch(/headers\s*\[\s*['"`]x-forwarded-for/i);
  });

  it('is admin-only and logs nothing', () => {
    const admin = readFileSync('src/server/routes/admin.ts', 'utf8');
    expect(admin).toContain("app.get('/api/admin/proxy-hops', verifyAdminToken,");
    expect(readFileSync('src/server/lib/proxyHops.ts', 'utf8')).not.toMatch(/console\./);
  });
});

/**
 * 2026-10-05 (admin: "proxy-hops open hi nahi ho raha hai"): the route needs the admin token HEADER, which an
 * address bar cannot send, and the reading asked the admin to look up their own IP. The class: a check only a
 * command-line user could run. The report now carries its own verdict, and an admin card sends the token.
 */
describe('the admin can run the check from the panel, and is told the answer', () => {
  it('the verdict is computed from the admin\'s own request — no IP lookup needed', () => {
    const one = hopReport('203.0.113.7', '169.254.1.1');
    expect(one).toMatchObject({ yourAddress: '203.0.113.7', measuredHops: 1, verdict: TRUSTED_PROXY_HOPS === 1 ? 'correct' : 'mismatch' });
    const two = hopReport('203.0.113.7, 151.101.1.1', '169.254.1.1');
    expect(two).toMatchObject({ measuredHops: 2 });
    // measuredHops is exactly the count under which Express hands back the admin's own address.
    expect(two.ipByHopCount.find((x) => x.hops === two.measuredHops)?.ip).toBe('203.0.113.7');
    expect(hopReport(undefined, '127.0.0.1')).toMatchObject({ yourAddress: null, measuredHops: null, verdict: 'no-proxy' });
  });

  it('the card says correct, mismatch (naming the number to set) or not-measurable — never a guess', () => {
    expect(hopVerdictText({ yourAddress: 'a', measuredHops: 1, trustedHops: 1, verdict: 'correct' })).toMatch(/^Correct\. .*1 proxy,/);
    expect(hopVerdictText({ yourAddress: 'a', measuredHops: 2, trustedHops: 1, verdict: 'mismatch' })).toMatch(/2 proxies.*TRUSTED_PROXY_HOPS .* must be changed to 2/);
    expect(hopVerdictText({ yourAddress: null, measuredHops: null, trustedHops: 1, verdict: 'no-proxy' })).toMatch(/cannot measure/);
    expect(isHopReport({ trustedHops: 1, verdict: 'correct' })).toBe(true);
    expect(isHopReport({ error: 'Admin token required.' })).toBe(false);
  });

  it('the card is on the Safety page and sends the admin token', () => {
    const card = readFileSync('src/components/admin/ProxyHopsCard.tsx', 'utf8');
    expect(card).toContain("fetch('/api/admin/proxy-hops', { headers: { 'x-admin-token': adminToken }");
    const dash = readFileSync('src/components/AdminDashboard.tsx', 'utf8');
    const safety = dash.indexOf("{activeTab === 'security' && (");
    expect(safety).toBeGreaterThan(-1);
    expect(dash.indexOf('<ProxyHopsCard adminToken={adminToken} />', safety)).toBeGreaterThan(safety);
  });
});
