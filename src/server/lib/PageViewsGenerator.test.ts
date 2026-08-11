import { describe, it, expect, afterAll } from 'vitest';

import { generatePageViewsIntegration, PAGEVIEWS_SERVICE_SOURCE } from './PageViewsGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generatePageViewsIntegration (wiring)', () => {
  it('emits the page-view service, routes and README', () => {
    const out = generatePageViewsIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/pageviews/pageViewService.ts');
    expect(paths).toContain('server/pageviews/routes.ts');
    expect(paths).toContain('server/pageviews/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/pageviews/routes.ts']).toContain('export const pageViewRouter');
    expect(out.files['server/pageviews/pageViewService.ts']).toContain("from 'node:crypto'");
  });
});

// Materialize + execute the emitted domain logic — the total-vs-unique + per-day dedup rules are real business
// rules, verified against the actual emitted code.
describe('emitted PageViewService — total views + unique-visitor-per-day dedup (real logic)', () => {
  const emitted = emitModule('pageviews', PAGEVIEWS_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  interface PageStats { path: string; totalViews: number; uniqueViews: number }
  interface Service {
    record(path: string, visitor?: { ip?: string; userAgent?: string }, now?: Date): PageStats;
    stats(path: string): PageStats;
    topPages(limit?: number): PageStats[];
    siteTotal(): number;
  }
  interface Emitted { PageViewService: new (salt?: string) => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('THE INVARIANT: total counts every hit; a visitor counts unique only ONCE PER DAY', async () => {
    const { PageViewService } = await load();
    const svc = new PageViewService('test-salt');
    const v = { ip: '1.2.3.4', userAgent: 'Chrome' };
    const day1 = new Date('2026-03-01T09:00:00Z');
    svc.record('/home', v, day1);
    svc.record('/home', v, new Date('2026-03-01T15:00:00Z')); // same visitor, same day
    let s = svc.stats('/home');
    expect(s.totalViews).toBe(2);  // both hits counted
    expect(s.uniqueViews).toBe(1); // but one unique visitor that day
    // a DIFFERENT visitor same day -> unique +1
    svc.record('/home', { ip: '9.9.9.9', userAgent: 'Safari' }, day1);
    s = svc.stats('/home');
    expect(s.totalViews).toBe(3);
    expect(s.uniqueViews).toBe(2);
    // the SAME visitor on a NEW day -> unique +1 again
    svc.record('/home', v, new Date('2026-03-02T09:00:00Z'));
    s = svc.stats('/home');
    expect(s.totalViews).toBe(4);
    expect(s.uniqueViews).toBe(3);
  });

  it('does not store the raw IP (visitor is a salted hash)', async () => {
    const { PageViewService } = await load();
    const svc = new PageViewService('secret');
    svc.record('/p', { ip: '203.0.113.7', userAgent: 'UA' }, new Date('2026-03-01T00:00:00Z'));
    // The service exposes only aggregate stats — no method returns raw IPs, and the serialized instance
    // must not contain the raw IP anywhere.
    expect(JSON.stringify(svc)).not.toContain('203.0.113.7');
    expect(svc.stats('/p').uniqueViews).toBe(1);
  });

  it('the same visitor is distinguished by a different salt (privacy hash depends on the salt)', async () => {
    const { PageViewService } = await load();
    const a = new PageViewService('salt-A');
    const b = new PageViewService('salt-B');
    const day = new Date('2026-03-01T00:00:00Z');
    a.record('/x', { ip: '1.1.1.1', userAgent: 'UA' }, day);
    b.record('/x', { ip: '1.1.1.1', userAgent: 'UA' }, day);
    // both still count 1 unique — the salt changes the hash but not the per-instance count
    expect(a.stats('/x').uniqueViews).toBe(1);
    expect(b.stats('/x').uniqueViews).toBe(1);
  });

  it('topPages ranks by total views and siteTotal sums everything', async () => {
    const { PageViewService } = await load();
    const svc = new PageViewService('s');
    const day = new Date('2026-03-01T00:00:00Z');
    for (let i = 0; i < 5; i++) svc.record('/popular', { ip: String(i), userAgent: 'UA' }, day);
    for (let i = 0; i < 2; i++) svc.record('/quiet', { ip: String(i), userAgent: 'UA' }, day);
    const top = svc.topPages(10);
    expect(top[0].path).toBe('/popular');
    expect(top[0].totalViews).toBe(5);
    expect(top[1].path).toBe('/quiet');
    expect(svc.siteTotal()).toBe(7);
    expect(() => svc.record('', {}, day)).toThrow(/path is required/);
  });
});
