import { describe, it, expect, beforeEach } from 'vitest';
import {
  forYouEnabled, parseSortMode, cleanEvents, decaySignals, engagementScore, freshnessBoost, tagsFor,
  affinityScore, seededUnit, cleanSeed, rankForYou, diversify, pageOf, dayKey, MAX_DWELL_SEC,
  type AppSignals,
} from '../src/lib/appMartForYou';
import { recordEvents, recordLike, _pendingForTests, _resetSignalsForTests } from '../src/server/lib/appMartSignals';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 14);
const Z: AppSignals = { opens: 0, dwellSec: 0, likes: 0, shares: 0, repeats: 0, details: 0 };
const app = (id: string, o: Partial<{ publishedAt: number; creatorId: string; name: string; description: string }> = {}) =>
  ({ id, publishedAt: NOW - 30 * DAY, creatorId: `c-${id}`, name: id, description: '', ...o });

describe('flag + sort mode', () => {
  it('default ON, off is a kill switch', () => {
    expect(forYouEnabled(undefined)).toBe(true);
    expect(forYouEnabled('')).toBe(true);
    expect(forYouEnabled('on')).toBe(true);
    for (const v of ['off', 'OFF', '0', 'false']) expect(forYouEnabled(v)).toBe(false);
  });
  it('sort defaults to foryou', () => {
    expect(parseSortMode(undefined)).toBe('foryou');
    expect(parseSortMode('newest')).toBe('newest');
    expect(parseSortMode('junk')).toBe('foryou');
  });
});

describe('events', () => {
  it('drops bad shapes, caps dwell and batch size', () => {
    const ev = cleanEvents([
      { kind: 'open', appId: 'abcd1', repeat: true },
      { kind: 'dwell', appId: 'abcd1', sec: 99_999 },
      { kind: 'dwell', appId: 'abcd1', sec: 0 },
      { kind: 'hack', appId: 'abcd1' },
      { kind: 'open', appId: '../x' },
      null,
    ]);
    expect(ev).toEqual([{ kind: 'open', appId: 'abcd1', repeat: true }, { kind: 'dwell', appId: 'abcd1', sec: MAX_DWELL_SEC }]);
    expect(cleanEvents(Array.from({ length: 200 }, () => ({ kind: 'open', appId: 'abcd1' }))).length).toBe(50);
    expect(cleanEvents('nope')).toEqual([]);
  });
  it('aggregates in memory; only live apps count; affinity only when signed in', () => {
    _resetSignalsForTests();
    const meta = (id: string) => (id === 'live1' ? { id, name: 'Cricket score', creatorId: 'cr1' } : undefined);
    expect(recordEvents(null, [{ kind: 'open', appId: 'live1' }, { kind: 'open', appId: 'gone1' }], meta)).toBe(1);
    expect(_pendingForTests().affinity.size).toBe(0);
    recordEvents('u1', [{ kind: 'open', appId: 'live1', repeat: true }], meta);
    recordLike('u1', { id: 'live1', name: 'Cricket score', creatorId: 'cr1' });
    const p = _pendingForTests();
    expect(p.apps.get('live1')).toEqual({ opens: 2, repeats: 1, likes: 1 });
    expect(p.affinity.get('u1')!.tags.cricket).toBe(6);
    expect(p.affinity.get('u1')!.creators.cr1).toBe(6);
    _resetSignalsForTests();
  });
});

describe('scoring pieces', () => {
  it('decays with a 7-day half-life and ignores >28 days', () => {
    expect(decaySignals([{ ageDays: 7, s: { opens: 10 } }]).opens).toBeCloseTo(5);
    expect(decaySignals([{ ageDays: 40, s: { opens: 10 } }]).opens).toBe(0);
  });
  it('engagement: more + better engagement scores higher, log-damped', () => {
    const lo = engagementScore({ ...Z, opens: 10 });
    const hi = engagementScore({ ...Z, opens: 10, likes: 5, repeats: 3 });
    expect(hi).toBeGreaterThan(lo);
    expect(engagementScore({ ...Z, opens: 100_000 })).toBeLessThan(20);
  });
  it('freshness fades', () => {
    expect(freshnessBoost(NOW, NOW)).toBeGreaterThan(freshnessBoost(NOW - 3 * DAY, NOW));
    expect(freshnessBoost(NOW - 30 * DAY, NOW)).toBeLessThan(0.01);
  });
  it('tags + affinity', () => {
    expect(tagsFor({ name: 'Best Cricket Quiz app', description: 'cricket ke liye' })).toEqual(['cricket', 'quiz']);
    expect(affinityScore(['cricket'], 'c1', { tags: { cricket: 10 }, creators: { c1: 3 } })).toBeGreaterThan(0.9);
    expect(affinityScore(['cricket'], 'c1', null)).toBe(0);
  });
  it('seeded randomness is deterministic and in [0,1)', () => {
    expect(seededUnit('s1', 'a')).toBe(seededUnit('s1', 'a'));
    expect(seededUnit('s1', 'a')).not.toBe(seededUnit('s2', 'a'));
    for (let i = 0; i < 50; i++) { const u = seededUnit('x', `id${i}`); expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThan(1); }
    expect(cleanSeed('ab_12')).toBe('ab_12');
    expect(cleanSeed('<script>')).toBe('global');
  });
});

describe('rankForYou', () => {
  const apps = Array.from({ length: 12 }, (_, i) => app(`app${i}`));
  it('same seed → same order (stable pages); different seed → feed changes', () => {
    const o = { signals: new Map(), affinity: null, now: NOW };
    const a = rankForYou(apps, { ...o, seed: 's1' }).map((x) => x.id);
    expect(rankForYou(apps, { ...o, seed: 's1' }).map((x) => x.id)).toEqual(a);
    const seeds = ['s2', 's3', 's4', 's5'].map((seed) => rankForYou(apps, { ...o, seed }).map((x) => x.id).join());
    expect(seeds.some((s) => s !== a.join())).toBe(true);
  });
  it('a strongly engaged app beats an idle one (global trending for signed-out)', () => {
    const signals = new Map([['app5', { ...Z, opens: 200, likes: 40, repeats: 30, dwellSec: 20_000 }]]);
    expect(rankForYou(apps, { signals, affinity: null, seed: 'x', now: NOW })[0].id).toBe('app5');
  });
  it('a brand-new app gets exposure near the top', () => {
    const fresh = [...apps, app('newbie', { publishedAt: NOW - 3600_000 })];
    const idx = rankForYou(fresh, { signals: new Map(), affinity: null, seed: 'x', now: NOW }).findIndex((a) => a.id === 'newbie');
    expect(idx).toBeLessThan(2);
  });
  it('personalisation lifts the viewer’s topics', () => {
    const mix = [...apps, app('cricketapp', { name: 'Cricket live' })];
    const r = rankForYou(mix, { signals: new Map(), affinity: { tags: { cricket: 50, live: 20 }, creators: {} }, seed: 'x', now: NOW });
    expect(r.findIndex((a) => a.id === 'cricketapp')).toBeLessThan(3);
  });
  it('diversity: no more than 2 in a row from one creator when others exist', () => {
    const many = [
      ...Array.from({ length: 6 }, (_, i) => app(`same${i}`, { creatorId: 'one' })),
      ...Array.from({ length: 3 }, (_, i) => app(`other${i}`)),
    ];
    const signals = new Map(many.filter((a) => a.creatorId === 'one').map((a) => [a.id, { ...Z, opens: 500, likes: 100 }]));
    const r = rankForYou(many, { signals, affinity: null, seed: 'x', now: NOW });
    expect(r.slice(0, 3).map((a) => a.creatorId)).not.toEqual(['one', 'one', 'one']);
    expect(r).toHaveLength(9);
  });
  it('diversify falls back gracefully when only one creator exists', () => {
    const d = diversify([{ creator: 'a', topic: '' }, { creator: 'a', topic: '' }, { creator: 'a', topic: '' }], 2);
    expect(d).toHaveLength(3);
  });
});

describe('paging + day keys', () => {
  it('pages without overlap', () => {
    const l = Array.from({ length: 25 }, (_, i) => i);
    const p1 = pageOf(l, 0, 10); const p3 = pageOf(l, 20, 10);
    expect(p1.items).toEqual(l.slice(0, 10)); expect(p1.nextOffset).toBe(10);
    expect(p3.items).toEqual(l.slice(20)); expect(p3.nextOffset).toBeNull();
    expect(pageOf(l, -5, 'x').items).toHaveLength(25);
  });
  it('dayKey is UTC yyyymmdd', () => { expect(dayKey(NOW)).toBe('20261014'); });
});

describe('wiring', () => {
  beforeEach(() => _resetSignalsForTests());
  it('the store route keeps Newest exactly and serves For You behind the flag', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/server/routes/navStore.ts', 'utf8');
    expect(src).toContain("req.query.sort === 'foryou' && forYouEnabled(process.env.APPMART_FOR_YOU)");
    expect(src).toContain("app.post('/api/app-mart/events'");
  });
});
