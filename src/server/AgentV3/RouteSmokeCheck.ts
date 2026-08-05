// AgentV3 — hitting the app's own routes after a build (ROADMAP #1 Phase 4.2).
//
// "The build succeeded" and "the app works" are different claims, and until now only the first one
// was ever tested. The preview verifier proves a PAGE renders; nothing proved the API behind it
// answers. So an app could ship with every screen drawn and every button dead, and the report would
// say it passed.
//
// This chooses which of the app's own declared routes are SAFE to call, and decides honestly what
// each answer means. The endpoint list comes from `extractEndpoints` (apiGraph) — already written
// and already tested — rather than a second extractor that would drift from it.
//
// TWO RULES DECIDE WHAT WE CALL, AND BOTH ARE SAFETY, NOT TASTE:
//
//   1. GET AND HEAD ONLY. A smoke check that POSTs, PUTs or DELETEs is running the user's own
//      mutations against their own database. There is no amount of diagnostic value that justifies a
//      test suite creating or deleting someone's records, so those methods are not skipped by policy
//      — they are never reachable from here at all.
//
//   2. NO PATH PARAMETERS. `/api/users/:id` cannot be called without inventing an id, and an invented
//      id returns 404 — which we would then report as a broken route. That is a false alarm about
//      working code, and false alarms are what teach people to ignore the report.
//
// The status reading matters just as much: a 401 on a protected route means the route EXISTS and is
// GUARDED, which is the app working correctly. Calling that a failure would fail every app that has
// authentication — i.e. every serious one.

import { extractEndpoints, type Endpoint } from './apiGraph';

/** How many routes to actually call. A 200-route API must not add minutes to every build. */
export const MAX_SMOKE_ROUTES = 12;

export type SmokeVerdict = 'pass' | 'protected' | 'fail' | 'unreachable';

export interface SmokeResult {
  path: string;
  status: number | null;
  verdict: SmokeVerdict;
  /** Plain-language reason, for the report. Never a raw status code alone. */
  reason: string;
}

export interface SmokePlan {
  /** The routes that will actually be called. */
  targets: string[];
  /** Declared routes deliberately not called, and why — so the report can say so out loud. */
  skipped: Array<{ path: string; method: string; why: string }>;
}

/**
 * Decide what to call.
 *
 * Deduplicated by path, ordered as declared, and capped. Everything left out is RECORDED with its
 * reason rather than silently dropped: a check that quietly tests 3 of 40 routes and reports "all
 * passed" is a more convincing lie than no check at all.
 */
export function planSmokeChecks(files: { path: string; content: string }[], max = MAX_SMOKE_ROUTES): SmokePlan {
  const endpoints: Endpoint[] = extractEndpoints(files ?? []);
  const targets: string[] = [];
  const skipped: SmokePlan['skipped'] = [];
  const seen = new Set<string>();

  for (const ep of endpoints) {
    const method = (ep.method || 'GET').toUpperCase();
    const path = ep.path || '';
    if (!path.startsWith('/')) continue;

    if (method !== 'GET' && method !== 'HEAD' && method !== 'ALL') {
      skipped.push({ path, method, why: 'only GET routes are called — a check must never create or delete your data' });
      continue;
    }
    if (/:[A-Za-z_]/.test(path) || path.includes('*')) {
      skipped.push({ path, method, why: 'needs a real id, and a made-up one would look like a broken route' });
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    if (targets.length >= Math.max(0, max)) {
      skipped.push({ path, method, why: `only the first ${max} routes are checked, to keep builds fast` });
      continue;
    }
    targets.push(path);
  }
  return { targets, skipped };
}

/**
 * What one answer means.
 *
 * `null` status = nothing came back at all, which is a different failure from a route that answered
 * 404: one says the server is not there, the other says the server is there and does not know this
 * path. Reporting both as "failed" would hide which of the two the user has to fix.
 */
export function classifySmokeStatus(path: string, status: number | null): SmokeResult {
  if (status === null || !Number.isFinite(status)) {
    return { path, status: null, verdict: 'unreachable', reason: `${path} did not answer at all — the server may not be running.` };
  }
  if (status >= 200 && status < 400) {
    return { path, status, verdict: 'pass', reason: `${path} answered (${status}).` };
  }
  if (status === 401 || status === 403) {
    // The route exists and is guarded. That is the app working, not failing.
    return { path, status, verdict: 'protected', reason: `${path} is protected (${status}) — it exists and requires sign-in, which is correct.` };
  }
  if (status === 404) {
    return { path, status, verdict: 'fail', reason: `${path} is in your code but the server returned 404 — it is not actually being served.` };
  }
  if (status >= 500) {
    return { path, status, verdict: 'fail', reason: `${path} crashed with a server error (${status}).` };
  }
  // 4xx that is neither auth nor missing: usually a required query/body the smoke call cannot supply.
  return { path, status, verdict: 'pass', reason: `${path} answered (${status}) — it is being served; it expects different input than a plain GET.` };
}

export interface SmokeSummary {
  checked: number;
  passed: number;
  protectedCount: number;
  failed: number;
  /** True only when something genuinely went wrong — drives whether this is a warning at all. */
  hasFailures: boolean;
  headline: string;
}

/**
 * The one line the report shows.
 *
 * Counts what happened and nothing else. "All routes working" is never printed unless every checked
 * route actually answered — the whole point of this phase is that "it built" stops being evidence
 * for "it works".
 */
export function summarizeSmoke(results: SmokeResult[], skippedCount = 0): SmokeSummary {
  const list = Array.isArray(results) ? results : [];
  const passed = list.filter((r) => r.verdict === 'pass').length;
  const protectedCount = list.filter((r) => r.verdict === 'protected').length;
  const failed = list.filter((r) => r.verdict === 'fail' || r.verdict === 'unreachable').length;
  const skippedNote = skippedCount > 0 ? `, ${skippedCount} not checked` : '';
  const headline = list.length === 0
    ? 'No routes could be checked automatically.'
    : failed > 0
      ? `${failed} of ${list.length} checked routes did not work${skippedNote}.`
      : `${list.length} route${list.length === 1 ? '' : 's'} checked and working${protectedCount > 0 ? ` (${protectedCount} correctly require sign-in)` : ''}${skippedNote}.`;
  return { checked: list.length, passed, protectedCount, failed, hasFailures: failed > 0, headline };
}

/**
 * The shell command that fetches one route's status code and nothing else.
 *
 * `-o /dev/null` on purpose: the body could be the user's own data, and this runs inside a build
 * whose output is logged. A status code answers the question; the body would only add a place for
 * their data to leak into a log.
 */
export function smokeCurlCommand(baseUrl: string, path: string, timeoutSeconds = 8): string {
  const url = `${String(baseUrl).replace(/\/$/, '')}${path}`;
  // Single-quoted and quote-stripped: the URL is built from the app's own declared route, but this
  // string becomes a shell command, so it is not left to trust.
  const safeUrl = url.replace(/'/g, '');
  return `curl -s -o /dev/null -w '%{http_code}' --max-time ${Math.max(1, Math.floor(timeoutSeconds))} '${safeUrl}'`;
}

/** Read a status code out of the curl output. Anything unparseable is `null`, never a guess. */
export function parseCurlStatus(stdout: string): number | null {
  const m = /(\d{3})\s*$/.exec(String(stdout ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  // curl writes 000 when it could not connect at all.
  return n === 0 || !Number.isFinite(n) ? null : n;
}
