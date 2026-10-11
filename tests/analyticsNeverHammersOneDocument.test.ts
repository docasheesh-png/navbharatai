/**
 * ONE DAILY ANALYTICS DOCUMENT IS WRITTEN ONCE PER FLUSH, NOT ONCE PER EVENT (performance audit 2026-10-11, D8).
 *
 * Every page view used to `set` the same `analytics_daily/{date}` document and `add` a raw row — two writes per
 * event, on an unauthenticated route with no limiter. Firestore sustains about one write a second on a single
 * document, so the busiest day was the day the rollup lost counts. These tests hold the buffered shape:
 *   1. many events fold into ONE delta per day, with the exact counts;
 *   2. raw rows are bounded per flush (under the 500-write batch limit) and the overflow is COUNTED, not hidden;
 *   3. a wild client clock cannot open a rollup document for another year;
 *   4. the route is limited and its log line is bounded; shutdown writes what the buffer holds.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  AnalyticsBuffer, analyticsRowFor, dailyUpdateFor, MAX_RAW_PER_FLUSH,
} from '../src/server/lib/AnalyticsPipeline';
import { analyticsLogLine, ANALYTICS_LOG_MAX } from '../src/server/routes/telemetry';

const root = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);

function fold(events: Array<{ event: string; ts?: number }>): AnalyticsBuffer {
  const b = new AnalyticsBuffer();
  for (const e of events) {
    const r = analyticsRowFor(e, NOW)!;
    b.add(r.row, r.date);
  }
  return b;
}

describe('the analytics buffer', () => {
  it('folds a thousand events into ONE delta for the day, with exact counts', () => {
    const events = [
      ...Array.from({ length: 700 }, () => ({ event: 'page_view' })),
      ...Array.from({ length: 200 }, () => ({ event: 'build_start' })),
      ...Array.from({ length: 100 }, () => ({ event: 'signup' })),
    ];
    const { dailies } = fold(events).drain();
    expect(dailies).toHaveLength(1);
    const d = dailies[0];
    expect(d.date).toBe('2026-10-11');
    expect(d.totalEvents).toBe(1000);
    expect(d.events).toEqual({ page_view: 700, build_start: 200, signup: 100 });
    expect(d.funnel).toEqual({ build: 200, signup: 100 });
  });

  it('🔒 the update is atomic increments by the folded amounts — two instances never overwrite each other', () => {
    const { dailies } = fold([{ event: 'deploy' }, { event: 'deploy' }, { event: 'x.y' }]).drain();
    const update = dailyUpdateFor(dailies[0], (n) => ({ inc: n }), NOW);
    expect(update.totalEvents).toEqual({ inc: 3 });
    expect(update['events.deploy']).toEqual({ inc: 2 });
    expect(update['events.x_y']).toEqual({ inc: 1 });
    expect(update['funnel.deploy']).toEqual({ inc: 2 });
    expect(update.rawDropped).toBeUndefined();
  });

  it('🔒 raw rows are bounded per flush, and the overflow is counted rather than hidden', () => {
    const n = MAX_RAW_PER_FLUSH + 37;
    const { dailies, raw } = fold(Array.from({ length: n }, () => ({ event: 'page_view' }))).drain();
    expect(raw).toHaveLength(MAX_RAW_PER_FLUSH);
    expect(MAX_RAW_PER_FLUSH + dailies.length, 'one batch must stay under Firestore\'s 500 writes').toBeLessThanOrEqual(500);
    expect(dailies[0].totalEvents).toBe(n);
    expect(dailies[0].rawDropped).toBe(37);
    expect(dailyUpdateFor(dailies[0], (x) => x, NOW).rawDropped).toBe(37);
  });

  it('drain empties the buffer', () => {
    const b = fold([{ event: 'a' }]);
    b.drain();
    expect(b.pending).toBe(0);
    expect(b.drain().dailies).toHaveLength(0);
  });

  it('🔒 a client clock more than a day off cannot open a rollup document for another year', () => {
    expect(analyticsRowFor({ event: 'a', ts: 0 }, NOW)!.date).toBe('2026-10-11');
    expect(analyticsRowFor({ event: 'a', ts: Date.UTC(2999, 0, 1) }, NOW)!.date).toBe('2026-10-11');
    expect(analyticsRowFor({ event: 'a', ts: NOW - 3_600_000 }, NOW)!.row.ts).toBe(NOW - 3_600_000);
    expect(analyticsRowFor({ event: '' }, NOW)).toBeNull();
    expect(analyticsRowFor({ event: 'a', userId: '' }, NOW)!.row.userId).toBe('anon');
  });
});

describe('the store and the route', () => {
  it('🔒 recording an event writes nothing to Firestore itself — only the flush does', () => {
    const src = read('src/server/lib/AnalyticsPipeline.ts');
    const body = src.slice(src.indexOf('export async function recordAnalyticsEvent'), src.indexOf('function scheduleFlush'));
    expect(body).not.toMatch(/db\.|collection\(|\.commit\(/);
    expect(body).toMatch(/buffer\.add\(/);
  });

  it('🔒 the route is limited per address and answers a quiet 204 over it', () => {
    const src = read('src/server/routes/telemetry.ts');
    expect(src).toMatch(/app\.post\('\/api\/analytics\/event', analyticsLimiter,/);
    expect(src).toMatch(/const analyticsLimiter = rateLimit\(\{[\s\S]*?status\(204\)/);
  });

  it('🔒 the log line is bounded whatever the body holds', () => {
    const line = analyticsLogLine({ event: 'web_vital', props: { blob: 'x'.repeat(100_000) } });
    expect(line.length).toBeLessThanOrEqual(ANALYTICS_LOG_MAX + 20);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => analyticsLogLine({ event: 'a', props: cyclic })).not.toThrow();
    expect(analyticsLogLine({ event: 'cold_start', props: { ms: 812 } })).toContain('"ms":812');
  });

  it('🔒 shutdown writes what the buffer holds, inside the bounded telemetry window', () => {
    expect(read('server.ts')).toMatch(/import\('\.\/src\/server\/lib\/AnalyticsPipeline'\)\.then\(\(\{ flushAnalytics \}\)/);
  });
});

describe('the funnel is the business\'s own numbers (Q-162 decision, 2026-10-11)', () => {
  it('🔒 only an admin can read it, and a failure is never a 200 of zeros', () => {
    const src = read('src/server/routes/telemetry.ts');
    expect(src).toMatch(/app\.get\('\/api\/analytics\/funnel', requireAdmin,/);
    const route = src.slice(src.indexOf("app.get('/api/analytics/funnel'"));
    expect(route).not.toMatch(/status\(200\)\.json\(\{ stages/);
  });
});
