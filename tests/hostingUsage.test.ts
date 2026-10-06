import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildUsageQuery, sumTimeSeries, readHostingUsage, usageGapNote, RUN_METRICS, MONITORING_API,
} from '../src/server/AgentV3/hostingUsage';

/**
 * What a hosted app actually used (ROADMAP §11 slice 2), measured from Google rather than estimated.
 *
 * The bug this module is shaped to avoid: a measurement gap quietly becoming a zero. A zero looks
 * exactly like an app nobody visited, so a renamed metric or a failed query would present as a free
 * app — and nobody would find out until Google's invoice arrived.
 */
const okRes = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body,
  text: async () => JSON.stringify(body ?? ''),
});
const series = (...values: number[]) => ({
  timeSeries: [{ points: values.map((v) => ({ value: { doubleValue: v } })) }],
});
const WINDOW = { startIso: '2026-09-07T00:00:00Z', endIso: '2026-09-08T00:00:00Z' };

describe('buildUsageQuery', () => {
  it('asks for ONE service\'s metric over an explicit window', () => {
    const q = buildUsageQuery('tok', 'apps-prod', 'mitrify-ab12', RUN_METRICS.requests, WINDOW.startIso, WINDOW.endIso);
    expect(q.url.startsWith(`${MONITORING_API}/projects/apps-prod/timeSeries?`)).toBe(true);
    const params = new URLSearchParams(q.url.split('?')[1]);
    expect(params.get('filter')).toContain('resource.labels.service_name="mitrify-ab12"');
    expect(params.get('filter')).toContain(RUN_METRICS.requests);
    expect(params.get('interval.startTime')).toBe(WINDOW.startIso);
    expect(q.headers.Authorization).toBe('Bearer tok');
  });

  it('🔒 the window is the CALLER\'S, so two runs cannot double-count or skip a stretch', () => {
    const a = buildUsageQuery('t', 'p', 's', 'm', '2026-09-07T00:00:00Z', '2026-09-07T01:00:00Z');
    const b = buildUsageQuery('t', 'p', 's', 'm', '2026-09-07T01:00:00Z', '2026-09-07T02:00:00Z');
    expect(a.url).not.toBe(b.url);
    // One bucket spanning the window, so the response is a single total per series.
    expect(new URLSearchParams(a.url.split('?')[1]).get('aggregation.perSeriesAligner')).toBe('ALIGN_SUM');
  });
});

describe('🔒 sumTimeSeries — null and zero are DIFFERENT answers', () => {
  it('sums every point across every series', () => {
    expect(sumTimeSeries(series(1, 2, 3))).toBe(6);
    expect(sumTimeSeries({ timeSeries: [{ points: [{ value: { int64Value: '5' } }] }, { points: [{ value: { doubleValue: 2 } }] }] })).toBe(7);
  });

  it('🔒 no readable data is NULL — never zero, because zero would bill as "used nothing"', () => {
    // A renamed metric and an app nobody visited look identical here; only null keeps them apart.
    expect(sumTimeSeries({})).toBeNull();
    expect(sumTimeSeries({ timeSeries: [] })).toBeNull();
    expect(sumTimeSeries({ timeSeries: [{ points: [] }] })).toBeNull();
    expect(sumTimeSeries(null)).toBeNull();
    expect(sumTimeSeries('nope')).toBeNull();
  });

  it('a genuine measured zero IS zero', () => {
    expect(sumTimeSeries(series(0))).toBe(0);
  });
});

describe('readHostingUsage — every gap is named, and gaps under-bill', () => {
  const base = { token: 't', projectId: 'apps-prod', serviceName: 'svc', ...WINDOW };

  it('reads all four Cloud Run meters and converts egress bytes to GiB', () => {
    return readHostingUsage({ ...base, buildMinutes: 3 }, (async (url: any) => {
      const u = String(url);
      if (u.includes(encodeURIComponent(RUN_METRICS.cpuSeconds))) return okRes(series(1000));
      if (u.includes(encodeURIComponent(RUN_METRICS.memoryGibSeconds))) return okRes(series(2000));
      if (u.includes(encodeURIComponent(RUN_METRICS.requests))) return okRes(series(5000));
      return okRes(series(1024 ** 3 * 2));                       // 2 GiB out
    }) as any).then((m) => {
      expect(m.usage.cpuSeconds).toBe(1000);
      expect(m.usage.memoryGibSeconds).toBe(2000);
      expect(m.usage.requests).toBe(5000);
      expect(m.usage.egressGib).toBeCloseTo(2, 9);
      expect(m.usage.buildMinutes).toBe(3);
    });
  });

  it('🔒 a metric that cannot be read is UNMEASURED, not zero', async () => {
    const m = await readHostingUsage(base, (async (url: any) => (
      String(url).includes(encodeURIComponent(RUN_METRICS.egressBytes)) ? okRes({}, 500) : okRes(series(10))
    )) as any);
    expect(m.usage.egressGib).toBeUndefined();
    expect(m.unmeasured).toContain('egressBytes');
  });

  it('🔒 storage is ALWAYS reported as a gap — an invented figure is what the billing law forbids', () => {
    return readHostingUsage({ ...base, buildMinutes: 1 }, (async () => okRes(series(1))) as any)
      .then((m) => expect(m.unmeasured).toContain('storageGibMonths'));
  });

  it('build minutes come from the build records, and their absence is a named gap', async () => {
    const withB = await readHostingUsage({ ...base, buildMinutes: 4 }, (async () => okRes(series(1))) as any);
    expect(withB.usage.buildMinutes).toBe(4);
    expect(withB.unmeasured).not.toContain('buildMinutes');
    const without = await readHostingUsage(base, (async () => okRes(series(1))) as any);
    expect(without.unmeasured).toContain('buildMinutes');
  });

  it('never throws — a network failure becomes gaps, not an exception', async () => {
    const m = await readHostingUsage(base, (async () => { throw new Error('offline'); }) as any);
    expect(m.usage).toEqual({});
    expect(m.unmeasured).toContain('cpuSeconds');
    expect(m.unmeasured).toContain('egressBytes');
  });

  it('the gap note names them, and says nothing when there is nothing to say', async () => {
    const m = await readHostingUsage(base, (async () => okRes({}, 500)) as any);
    expect(usageGapNote(m)).toMatch(/Not measured \(so not billed\)/);
    expect(usageGapNote({ usage: {}, unmeasured: [] })).toBe('');
  });
});

/**
 * 🔒 `/api/agentv3/host-usage` was DELETED on 2026-10-06: nothing in the app called it, it re-derived the
 * service name from the app's CURRENT name (the rename bug `DeploymentRecord.service` exists to prevent),
 * and the daily `hosting-daily-bill` sweep already measures every hosted app. The measurement rules it
 * carried are pinned on the sweep, the one place that measures now.
 */
describe('🔒 measurement lives in the daily sweep — the duplicate admin route is gone', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  const sweep = readFileSync(join(__dirname, '..', 'src/server/AgentV3/hostingBillingSweep.ts'), 'utf8');

  it('the route no longer exists', () => {
    expect(route).not.toContain("app.post('/api/agentv3/host-usage'");
  });

  it('the sweep measures the RECORDED service, never one re-derived from a renamed app', () => {
    expect(sweep).toContain("const serviceName = String(app.service ?? '').trim() || serviceNameFor(app.workspaceId, null);");
  });

  it('both kinds of gap reach the report — unmeasured usage AND unbilled rates', () => {
    expect(sweep).toContain('usageGapNote(measured)');
    expect(sweep).toContain('hostingCostNote');
  });
});
