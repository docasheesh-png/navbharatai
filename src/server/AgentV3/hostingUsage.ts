// WHAT ONE HOSTED APP ACTUALLY USED — measured from Google, never estimated (ROADMAP §11, slice 2).
//
// hostingCost.ts prices units; this is where the units come from. The separation matters: pricing is
// pure arithmetic that can be tested exactly, and measurement is I/O that can fail — and the failure
// mode that must never happen is a measurement gap quietly becoming a zero, because a zero looks
// exactly like an app that used nothing.
//
// 🔒 SO EVERY GAP IS NAMED. `unmeasured` travels with the numbers, and it feeds the same honesty
// hostingCost's `unbilled` does: an under-bill nobody knows about is indistinguishable from a healthy
// margin right up until Google's invoice arrives.
//
// 🔒 AND WE UNDER-MEASURE RATHER THAN OVER-MEASURE. Where a meter cannot be read the usage counts as
// zero AND is listed — so the user is charged less than the truth, never more. The billing law allows
// absorbing our own cost; it never allows charging for something we did not observe.
//
// ⚠️ THE METRIC NAMES BELOW ARE GOOGLE'S, and this codebase has been burned by stale third-party
// identifiers before (retired model ids in five files). They are constants precisely so a rename is one
// edit, and `readHostingUsage` reports a metric that returned nothing as UNMEASURED rather than as
// zero — so a renamed metric shows up as a visible gap in the admin report instead of a free app.
//
// Pure builders + parsers, plus an orchestration with injectable fetch, in the shape of its siblings.

import type { HostingUsage } from './hostingCost';

export const MONITORING_API = 'https://monitoring.googleapis.com/v3';

/** The Cloud Run meters we read. One place, so a Google rename is one edit. */
export const RUN_METRICS = {
  cpuSeconds: 'run.googleapis.com/container/cpu/allocation_time',
  memoryGibSeconds: 'run.googleapis.com/container/memory/allocation_time',
  requests: 'run.googleapis.com/request_count',
  egressBytes: 'run.googleapis.com/container/network/sent_bytes_count',
} as const;

export type UsageMeter = keyof typeof RUN_METRICS | 'buildMinutes' | 'storageGibMonths';

export interface MonitoringRequest {
  url: string;
  method: 'GET';
  headers: Record<string, string>;
}

/**
 * A time-series query for ONE metric on ONE service.
 *
 * The window is explicit rather than "the last N hours" so the caller owns the billing period and two
 * runs can never double-count or skip a stretch. PURE.
 */
export function buildUsageQuery(
  token: string,
  projectId: string,
  serviceName: string,
  metric: string,
  startIso: string,
  endIso: string,
): MonitoringRequest {
  const filter = `metric.type="${metric}" AND resource.labels.service_name="${serviceName}"`;
  const params = new URLSearchParams({
    filter,
    'interval.startTime': startIso,
    'interval.endTime': endIso,
    // One bucket spanning the window, summed across every revision and location of this service.
    'aggregation.alignmentPeriod': `${Math.max(60, Math.round((Date.parse(endIso) - Date.parse(startIso)) / 1000))}s`,
    'aggregation.perSeriesAligner': 'ALIGN_SUM',
    'aggregation.crossSeriesReducer': 'REDUCE_SUM',
  });
  return {
    url: `${MONITORING_API}/projects/${projectId}/timeSeries?${params.toString()}`,
    method: 'GET',
    headers: { Authorization: `Bearer ${token.trim()}` },
  };
}

/**
 * Total a time-series response, or null when there is nothing readable in it.
 *
 * 🔒 NULL AND ZERO ARE DIFFERENT ANSWERS, and conflating them is the bug this module exists to avoid:
 * null means "we could not measure", zero means "we measured, and it was nothing". Only the second may
 * be billed as nothing with confidence; the first must be reported as a gap. PURE.
 */
export function sumTimeSeries(raw: unknown): number | null {
  const r = raw && typeof raw === 'object' ? raw as Record<string, any> : null;
  if (!r) return null;
  const series = Array.isArray(r.timeSeries) ? r.timeSeries : null;
  // A metric with no data at all comes back WITHOUT a timeSeries array. That is a real, common answer
  // for an app nobody visited — but it is indistinguishable from a renamed metric, so it is null.
  if (!series) return null;
  let total = 0;
  let sawPoint = false;
  for (const s of series) {
    for (const p of Array.isArray(s?.points) ? s.points : []) {
      const v = p?.value ?? {};
      const n = Number(v.doubleValue ?? v.int64Value ?? v.distributionValue?.mean ?? NaN);
      if (Number.isFinite(n)) { total += n; sawPoint = true; }
    }
  }
  return sawPoint ? total : null;
}

export interface MeasuredUsage {
  usage: Partial<HostingUsage>;
  /** Meters we could NOT read. Never silent — see the header. */
  unmeasured: UsageMeter[];
}

const GIB = 1024 ** 3;

/**
 * Read one app's usage over a window. NEVER throws.
 *
 * `buildMinutes` is passed in rather than queried: it comes from the build records the deploy path
 * already holds (start and finish times), which is a more direct measurement than any metric — and one
 * we do not have to trust a metric name for.
 *
 * `storageGibMonths` is deliberately NOT measured yet and is always reported as a gap. Per-app image
 * and object storage needs its own accounting, and inventing a figure for it would be exactly the
 * fabricated number the billing law forbids. It under-bills, which is the safe direction.
 */
export async function readHostingUsage(
  opts: {
    token: string;
    projectId: string;
    serviceName: string;
    startIso: string;
    endIso: string;
    /** Measured from the build records, not from a metric. */
    buildMinutes?: number;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<MeasuredUsage> {
  const usage: Partial<HostingUsage> = {};
  const unmeasured: UsageMeter[] = [];

  const readOne = async (key: keyof typeof RUN_METRICS): Promise<number | null> => {
    try {
      const q = buildUsageQuery(opts.token, opts.projectId, opts.serviceName, RUN_METRICS[key], opts.startIso, opts.endIso);
      const res = await fetchImpl(q.url, { method: q.method, headers: q.headers });
      if (!res.ok) return null;
      return sumTimeSeries(await res.json().catch(() => null));
    } catch {
      return null;
    }
  };

  const [cpu, mem, req, egress] = await Promise.all([
    readOne('cpuSeconds'), readOne('memoryGibSeconds'), readOne('requests'), readOne('egressBytes'),
  ]);

  if (cpu === null) unmeasured.push('cpuSeconds'); else usage.cpuSeconds = cpu;
  if (mem === null) unmeasured.push('memoryGibSeconds'); else usage.memoryGibSeconds = mem;
  if (req === null) unmeasured.push('requests'); else usage.requests = req;
  // The metric is BYTES; the rate is per GiB. Converting here keeps the unit mismatch in one place
  // rather than in whichever call site remembers.
  if (egress === null) unmeasured.push('egressBytes'); else usage.egressGib = egress / GIB;

  const mins = Number(opts.buildMinutes);
  if (Number.isFinite(mins) && mins >= 0) usage.buildMinutes = mins; else unmeasured.push('buildMinutes');

  // Always a gap today — see the doc comment. Listed rather than assumed to be zero.
  unmeasured.push('storageGibMonths');

  return { usage, unmeasured };
}

/** One line for the ADMIN report about what could not be measured. '' when everything was. PURE. */
export function usageGapNote(measured: MeasuredUsage | null | undefined): string {
  const gaps = measured?.unmeasured ?? [];
  if (gaps.length === 0) return '';
  return `Not measured (so not billed): ${gaps.join(', ')}.`;
}
