import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  platformMaxInstances, platformServiceName, platformProjectId, buildInstanceCountQuery,
  peakTimeSeries, readPlatformInstances, PLATFORM_INSTANCE_METRIC, INSTANCE_WINDOW_MS,
} from '../src/server/lib/platformInstances';

/**
 * THE PLATFORM'S OWN CEILING (ROADMAP §12 #2).
 *
 * `--max-instances 10` with `--concurrency 100` is a hard ceiling of ~1,000 concurrent requests, after
 * which Cloud Run sheds. The number is now 100 and tunable in the trigger — and, more importantly, the
 * running server is TOLD the same number, so the admin board reports the real ceiling rather than a
 * constant that drifts away from it.
 */
describe('platformMaxInstances', () => {
  it('reads the deployed ceiling', () => {
    expect(platformMaxInstances({ PLATFORM_MAX_INSTANCES: '100' } as any)).toBe(100);
    expect(platformMaxInstances({ PLATFORM_MAX_INSTANCES: ' 20 ' } as any)).toBe(20);
  });

  it('🔒 an UNSET ceiling is null, never a guessed default', () => {
    // A default here would be the doc-vs-code drift this repo keeps getting bitten by: the admin lowers
    // the trigger substitution, nothing fails, and the board under-reports the ceiling it exists to warn
    // about. Null renders as "unmeasured".
    expect(platformMaxInstances({} as any)).toBeNull();
    expect(platformMaxInstances({ PLATFORM_MAX_INSTANCES: '' } as any)).toBeNull();
    expect(platformMaxInstances({ PLATFORM_MAX_INSTANCES: '   ' } as any)).toBeNull();
  });

  it('🔒 an EMPTY value does not become a ceiling of zero — Number("") is 0, not NaN', () => {
    // The same trap that produced a real bug in hostingCost.ts. A cap of 0 would grade every reading
    // as "full" forever.
    expect(platformMaxInstances({ PLATFORM_MAX_INSTANCES: '' } as any)).toBeNull();
    expect(platformMaxInstances({ PLATFORM_MAX_INSTANCES: '0' } as any)).toBeNull();
    expect(platformMaxInstances({ PLATFORM_MAX_INSTANCES: 'lots' } as any)).toBeNull();
    expect(platformMaxInstances({ PLATFORM_MAX_INSTANCES: '-5' } as any)).toBeNull();
  });
});

describe('identity', () => {
  it('the service names itself from what Cloud Run sets', () => {
    expect(platformServiceName({ K_SERVICE: 'navbharat-ai-prod' } as any)).toBe('navbharat-ai-prod');
  });

  it('off Cloud Run there is no service, and that is null rather than a placeholder', () => {
    expect(platformServiceName({} as any)).toBeNull();
    expect(platformServiceName({ K_SERVICE: '  ' } as any)).toBeNull();
  });

  it('🔒 metrics come from the PLATFORM project, never the apps project', () => {
    // Reading the apps project would answer "how many user apps are warm" — a different question, on a
    // tile whose whole purpose is NavBharatAI's own headroom.
    expect(platformProjectId({ GOOGLE_CLOUD_PROJECT: 'p-1', NAVBHARAT_APPS_PROJECT: 'apps-2' } as any)).toBe('p-1');
    expect(platformProjectId({} as any)).toBe('gen-lang-client-0866594388');
  });
});

describe('buildInstanceCountQuery', () => {
  const q = buildInstanceCountQuery('tok', 'proj-1', 'svc-1', '2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z');

  it('asks Google for the right meter on the right service', () => {
    expect(q.url).toContain('/projects/proj-1/timeSeries?');
    expect(decodeURIComponent(q.url)).toContain(`metric.type="${PLATFORM_INSTANCE_METRIC}"`);
    expect(decodeURIComponent(q.url)).toContain('resource.labels.service_name="svc-1"');
    expect(q.headers.Authorization).toBe('Bearer tok');
    expect(q.method).toBe('GET');
  });

  it('🔒 aligns by MAX, not MEAN — an average hides the spike that hit the ceiling', () => {
    // Reporting a ten-minute mean against a hard cap would make the tile most reassuring exactly when
    // it should be loudest.
    expect(q.url).toContain('ALIGN_MAX');
    expect(q.url).not.toContain('ALIGN_MEAN');
  });

  it('sums across revisions, so a deploy in progress is not counted as half a platform', () => {
    expect(q.url).toContain('REDUCE_SUM');
  });
});

describe('peakTimeSeries', () => {
  const series = (...vals: number[]) => ({
    timeSeries: [{ points: vals.map((v) => ({ value: { int64Value: String(v) } })) }],
  });

  it('returns the PEAK across the window', () => {
    expect(peakTimeSeries(series(2, 9, 3))).toBe(9);
  });

  it('takes the largest point across several series', () => {
    expect(peakTimeSeries({
      timeSeries: [{ points: [{ value: { int64Value: '3' } }] }, { points: [{ value: { doubleValue: 7 } }] }],
    })).toBe(7);
  });

  it('🔒 NOTHING READABLE IS NULL, NOT ZERO — a serving platform cannot be running zero instances', () => {
    // Zero here would be a measurement failure wearing a number's clothes, and the board would render
    // it as a perfectly healthy reading.
    expect(peakTimeSeries(null)).toBeNull();
    expect(peakTimeSeries({})).toBeNull();
    expect(peakTimeSeries({ timeSeries: [] })).toBeNull();
    expect(peakTimeSeries({ timeSeries: [{ points: [] }] })).toBeNull();
    expect(peakTimeSeries({ timeSeries: [{ points: [{ value: { int64Value: 'many' } }] }] })).toBeNull();
  });

  it('a genuine zero point is still a measurement', () => {
    expect(peakTimeSeries(series(0))).toBe(0);
  });
});

describe('readPlatformInstances', () => {
  const env = { PLATFORM_MAX_INSTANCES: '100', K_SERVICE: 'svc' } as any;

  it('measures the peak against the deployed cap', async () => {
    const fetchImpl = (async () => ({
      ok: true, json: async () => ({ timeSeries: [{ points: [{ value: { int64Value: '4' } }] }] }),
    })) as unknown as typeof fetch;
    expect(await readPlatformInstances({ token: 't', projectId: 'p', env, fetchImpl }))
      .toEqual({ peak: 4, cap: 100 });
  });

  it('🔒 THE CAP SURVIVES A FAILED MEASUREMENT — the admin can still see the ceiling', async () => {
    const dead = (async () => ({ ok: false, json: async () => null })) as unknown as typeof fetch;
    expect(await readPlatformInstances({ token: 't', projectId: 'p', env, fetchImpl: dead }))
      .toEqual({ peak: null, cap: 100 });
    const throwing = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect(await readPlatformInstances({ token: 't', projectId: 'p', env, fetchImpl: throwing }))
      .toEqual({ peak: null, cap: 100 });
  });

  it('no token, no project or no service ⇒ unmeasured, and it never calls out', async () => {
    let called = 0;
    const counting = (async () => { called++; return { ok: true, json: async () => ({}) }; }) as unknown as typeof fetch;
    expect(await readPlatformInstances({ token: null, projectId: 'p', env, fetchImpl: counting })).toEqual({ peak: null, cap: 100 });
    expect(await readPlatformInstances({ token: 't', projectId: '', env, fetchImpl: counting })).toEqual({ peak: null, cap: 100 });
    expect(await readPlatformInstances({ token: 't', projectId: 'p', env: {} as any, fetchImpl: counting })).toEqual({ peak: null, cap: null });
    expect(called).toBe(0);
  });

  it('the window is a real recent slice, not the whole day', async () => {
    let url = '';
    const spy = (async (u: string) => { url = u; return { ok: true, json: async () => ({}) }; }) as unknown as typeof fetch;
    await readPlatformInstances({ token: 't', projectId: 'p', env, fetchImpl: spy, nowMs: Date.parse('2026-01-01T01:00:00Z') });
    const d = decodeURIComponent(url);
    expect(d).toContain('2026-01-01T01:00:00.000Z');
    expect(d).toContain(new Date(Date.parse('2026-01-01T01:00:00Z') - INSTANCE_WINDOW_MS).toISOString());
    expect(INSTANCE_WINDOW_MS).toBeGreaterThanOrEqual(60_000);
    expect(INSTANCE_WINDOW_MS).toBeLessThanOrEqual(60 * 60_000);
  });
});

describe('🔒 the deploy config — one number, two consumers', () => {
  const yaml = readFileSync(join(__dirname, '..', 'cloudbuild.yaml'), 'utf8');

  it('the ceiling is a substitution, tunable in the trigger without a code change', () => {
    expect(yaml).toContain("- '--max-instances'\n      - '${_MAX_INSTANCES}'");
    expect(yaml).toMatch(/_MAX_INSTANCES: '(\d+)'/);
  });

  it('🔒 THE RUNNING SERVER IS TOLD THE SAME NUMBER — the drift is unrepresentable', () => {
    // Without this the board would report a constant while Cloud Run enforced something else, and
    // nothing would fail to reveal it.
    expect(yaml).toContain('PLATFORM_MAX_INSTANCES=${_MAX_INSTANCES}');
  });

  it('🔒 env vars are UPDATED, not replaced — every other Cloud Run key must survive a deploy', () => {
    expect(yaml).toContain("- '--update-env-vars'");
    expect(yaml).not.toContain("- '--set-env-vars'");
  });

  it('the ceiling is raised but still BOUNDED, and idle still costs nothing', () => {
    const cap = Number(/_MAX_INSTANCES: '(\d+)'/.exec(yaml)?.[1]);
    expect(cap).toBeGreaterThan(10);
    expect(cap).toBeLessThanOrEqual(1000);
    // min-instances 0 is what keeps a higher ceiling free while nobody is using it.
    expect(yaml).toContain("- '--min-instances'\n      - '0'");
  });
});
