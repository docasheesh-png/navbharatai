// HOW MANY SERVERS ARE WE ACTUALLY RUNNING, AND WHAT IS THE CEILING? (ROADMAP §12 #2.)
//
// The admin load board has a "Server load" tile whose whole job is to show the platform approaching its
// own instance ceiling before users start being shed. It could not do that, because nothing supplied
// either number — so the tile rendered `unknown` forever, which is honest and useless.
//
// Two numbers, from two deliberately different places:
//
// 1. THE CEILING comes from the environment, not from a constant in this file. `cloudbuild.yaml` passes
//    the SAME `_MAX_INSTANCES` substitution to both `--max-instances` and `PLATFORM_MAX_INSTANCES`, so
//    the number the board reports and the number Cloud Run enforces cannot disagree. A code default
//    here would be exactly the doc-vs-code drift this repo keeps getting bitten by: the admin lowers the
//    trigger substitution, nothing fails, and the board quietly under-reports the very ceiling it exists
//    to warn about. When the env is absent (an older revision), the answer is NULL — unknown, never a
//    guess.
//
// 2. THE COUNT comes from Cloud Monitoring, because no process can count its own siblings. Instances do
//    not share memory, and `metricsTimeline` deliberately sums with `FieldValue.increment` rather than
//    recording who wrote what, so there is no instance identity anywhere in our own data to count.
//    Google is the only party that knows.
//
// PURE decision + query building here; the single fetch is the thin part, in the same shape as
// `AgentV3/hostingUsage.ts`.

import { MONITORING_API } from '../AgentV3/hostingUsage';
import { PLATFORM_PROJECT } from '../AgentV3/cloudRunHosting';

/** Google's meter for live container instances of a Cloud Run service. One place, one edit on a rename. */
export const PLATFORM_INSTANCE_METRIC = 'run.googleapis.com/container/instance_count';

/** How far back the peak is taken from. Short enough to be "now", long enough to catch a real spike. */
export const INSTANCE_WINDOW_MS = 10 * 60_000;

export interface MonitoringRequest {
  url: string;
  method: 'GET';
  headers: Record<string, string>;
}

/**
 * The instance ceiling this revision was actually deployed with, or null when it was not told.
 *
 * 🔒 NULL RATHER THAN A DEFAULT. A number invented here would look identical to a measured one on the
 * board while being wrong the moment the admin retunes the trigger. PURE.
 */
export function platformMaxInstances(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = String(env.PLATFORM_MAX_INSTANCES ?? '').trim();
  // Number('') is 0, not NaN — an empty env must not become a ceiling of zero.
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * The GCP project whose metrics describe the PLATFORM.
 *
 * ⚠️ Deliberately NOT the apps project (`NAVBHARAT_APPS_PROJECT`). User apps are hosted in a separate
 * project on purpose, so reading instance counts there would answer a different question entirely —
 * "how many user apps are warm", not "is NavBharatAI itself near its ceiling". `GOOGLE_CLOUD_PROJECT`
 * is what Cloud Run sets for this service; the constant is the same value this repo already records.
 */
export function platformProjectId(env: NodeJS.ProcessEnv = process.env): string {
  const raw = String(env.GOOGLE_CLOUD_PROJECT ?? '').trim();
  return raw === '' ? PLATFORM_PROJECT : raw;
}

/**
 * The name of the Cloud Run service this process IS. Cloud Run sets `K_SERVICE` on every instance, so
 * the platform identifies itself rather than being configured to — one less thing to keep in sync.
 * Null off Cloud Run (local, CI), where there are no instances to count. PURE.
 */
export function platformServiceName(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = String(env.K_SERVICE ?? '').trim();
  return raw === '' ? null : raw;
}

/**
 * A time-series query for the instance count.
 *
 * 🔒 MAX, NOT MEAN, on both aligners. The question this answers is "did we come close to the ceiling",
 * and an average over ten minutes hides precisely the spike that hit it. Reporting a mean against a hard
 * cap would make the tile most reassuring exactly when it should be loudest. PURE.
 */
export function buildInstanceCountQuery(
  token: string,
  projectId: string,
  serviceName: string,
  startIso: string,
  endIso: string,
): MonitoringRequest {
  const filter = `metric.type="${PLATFORM_INSTANCE_METRIC}" AND resource.labels.service_name="${serviceName}"`;
  const params = new URLSearchParams({
    filter,
    'interval.startTime': startIso,
    'interval.endTime': endIso,
    'aggregation.alignmentPeriod': '60s',
    'aggregation.perSeriesAligner': 'ALIGN_MAX',
    'aggregation.crossSeriesReducer': 'REDUCE_SUM',
  });
  return {
    url: `${MONITORING_API}/projects/${projectId}/timeSeries?${params.toString()}`,
    method: 'GET',
    headers: { Authorization: `Bearer ${token.trim()}` },
  };
}

/**
 * The PEAK value in a time-series response, or null when there is nothing readable in it.
 *
 * 🔒 NULL AND ZERO ARE DIFFERENT ANSWERS — the same law `sumTimeSeries` is built on. Zero instances is
 * not a state a serving platform can be in, so a zero here would be a measurement failure wearing a
 * number's clothes. It is summed ACROSS series (each revision reports its own) and maxed across time.
 * PURE.
 */
export function peakTimeSeries(raw: unknown): number | null {
  const r = raw && typeof raw === 'object' ? raw as Record<string, any> : null;
  if (!r) return null;
  const series = Array.isArray(r.timeSeries) ? r.timeSeries : null;
  if (!series) return null;
  // Points from different series at the same instant are already summed by REDUCE_SUM, so the peak is
  // the largest single point across everything returned.
  let peak = -1;
  for (const s of series) {
    for (const p of Array.isArray(s?.points) ? s.points : []) {
      const v = p?.value ?? {};
      const n = Number(v.int64Value ?? v.doubleValue ?? v.distributionValue?.mean ?? NaN);
      if (Number.isFinite(n) && n > peak) peak = n;
    }
  }
  return peak < 0 ? null : peak;
}

export interface PlatformInstances {
  /** Peak live instances over the window, or null when it could not be measured. */
  peak: number | null;
  /** The deployed ceiling, or null when this revision was not told what it is. */
  cap: number | null;
}

/**
 * Read the platform's own instance count and ceiling.
 *
 * Best-effort by design: this feeds a dashboard tile, so every failure degrades to null (rendered as
 * "unmeasured") rather than throwing into an admin route.
 */
export async function readPlatformInstances(opts: {
  token: string | null;
  projectId: string;
  serviceName?: string | null;
  nowMs?: number;
  windowMs?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<PlatformInstances> {
  const env = opts.env ?? process.env;
  const cap = platformMaxInstances(env);
  const service = opts.serviceName ?? platformServiceName(env);
  if (!opts.token || !opts.projectId || !service) return { peak: null, cap };
  const now = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  const window = Number.isFinite(opts.windowMs) && Number(opts.windowMs) > 0
    ? Number(opts.windowMs)
    : INSTANCE_WINDOW_MS;
  try {
    const q = buildInstanceCountQuery(
      opts.token, opts.projectId, service,
      new Date(now - window).toISOString(), new Date(now).toISOString(),
    );
    const doFetch = opts.fetchImpl ?? fetch;
    const r = await doFetch(q.url, { method: q.method, headers: q.headers });
    if (!r.ok) return { peak: null, cap };
    return { peak: peakTimeSeries(await r.json().catch(() => null)), cap };
  } catch {
    return { peak: null, cap };
  }
}
