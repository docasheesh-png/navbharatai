/**
 * Q-154: `trust proxy: true` keys anonymous rate-limit buckets on a header the caller writes. The fix is a hop
 * count, and a wrong count is worse than today — so it is measured. `hopReport` shows, for the admin's own
 * request, what `req.ip` would be under each count; it mirrors Express's own rule (the entry `hops` from the
 * right of the forwarded chain plus the socket peer).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import express from 'express';
import { hopReport } from '../src/server/lib/proxyHops';

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

  it('is admin-only and logs nothing', () => {
    const admin = readFileSync('src/server/routes/admin.ts', 'utf8');
    expect(admin).toContain("app.get('/api/admin/proxy-hops', verifyAdminToken,");
    expect(readFileSync('src/server/lib/proxyHops.ts', 'utf8')).not.toMatch(/console\./);
  });
});
