// P-PIPE.116 — post-deploy liveness probe (advisory).
//
// After a v5.0 deploy publishes to a permanent URL, the deploy message reported success but never
// confirmed the site actually responds. This turns a single bounded GET to the deployed URL into one
// honest line appended to the deploy message — so the user (and the Monitor role) learns whether the
// app is live, without ever faking a result.
//
// Wording discipline (both directions of the "no fake success / no fake failure" rule):
//   • 2xx/3xx        → live and serving
//   • 4xx/5xx        → reachable but returned HTTP N (served — do NOT claim healthy, do NOT claim failed)
//   • transport fail → not reachable YET; a freshly published URL can take a moment to propagate — this
//                      is explicitly NOT reported as a deploy failure (the deploy itself succeeded).
// The pure line builder here is unit-testable; the caller does the single bounded fetch.

export type LivenessProbe = { kind: 'http'; status: number } | { kind: 'unreachable'; reason: string };

/** One honest liveness line for the deploy message. Pure. */
export function livenessLine(probe: LivenessProbe): string {
  if (probe.kind === 'http') {
    if (probe.status >= 200 && probe.status < 400) {
      return `Liveness: the URL responded HTTP ${probe.status} — your site is live.`;
    }
    return `Liveness: the URL is reachable but returned HTTP ${probe.status} — it's served; check the app config if that's unexpected.`;
  }
  return `Liveness: the URL isn't reachable yet (${probe.reason}) — a freshly published URL can take a moment to propagate; this is not a deploy failure.`;
}
