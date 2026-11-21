// BUILD PHASE: the route smoke check — moved out of the build route's handler, unchanged in behaviour (Q-3237, admin
// decision 2026-11-21, option A: the ~17,000-line handler in routes/agentv3.ts sits at TypeScript's control-flow limit, so
// it is split one phase per PR). The route keeps WHEN it runs (its gate needs the handler's own state); this file is WHAT
// it does, through small ports, so it can be tested without the route.
//
// ROUTE SMOKE CHECK (ROADMAP #1 Phase 4.2). "The build succeeded" and "the app works" are different claims, and only the
// first one was ever tested: the preview verifier proves a PAGE renders, while nothing proved the API behind it answers.
// Calls the app's OWN declared routes and reports what actually came back. Two safety rules live in RouteSmokeCheck: GET
// only and no path parameters. Never changes the verdict: this is EVIDENCE for the report, never a gate.
import { classifySmokeStatus, parseFrontendShell, summarizeSmoke, smokeCurlCommand, parseCurlStatus, type SmokePlan, type SmokeResult } from '../RouteSmokeCheck';
import { withTimeout } from '../asyncUtils';
import type { BuildDiagnostics } from '../BuildDiagnostics';

export async function runRouteSmokeCheck(io: {
  plan: SmokePlan | null;
  previewUrl: string;
  run: (command: string) => Promise<{ stdout: string }>;
  aborted: () => boolean;
  record: BuildDiagnostics['record'];
}): Promise<void> {
  try {
    const plan = io.plan;
    if (!plan || plan.targets.length === 0) return;
    const results: SmokeResult[] = [];
    for (const target of plan.targets) {
      if (io.aborted()) break;
      let status: number | null = null;
      let frontendShell = false;
      try {
        const out = await withTimeout(io.run(smokeCurlCommand(io.previewUrl, target)), 15_000, 'route-smoke');
        status = parseCurlStatus(out.stdout);
        frontendShell = parseFrontendShell(out.stdout);
      } catch { status = null; }
      results.push(classifySmokeStatus(target, status, { frontendShell }));
    }
    const summary = summarizeSmoke(results, plan.skipped.length);
    io.record({
      phase: 'preview',
      // A failure here is a real finding; a clean run is worth recording too, because "we checked and it worked" is the
      // evidence this phase exists to produce.
      severity: summary.hasFailures ? 'warning' : 'info',
      code: summary.hasFailures ? 'ROUTE_SMOKE_FAILED' : 'ROUTE_SMOKE_PASSED',
      message: summary.headline,
      autoResolved: !summary.hasFailures,
      detail: [
        ...results.map((r) => `${r.verdict.toUpperCase()} ${r.path}${r.status === null ? '' : ` (${r.status})`}`),
        ...plan.skipped.map((s) => `SKIPPED ${s.method} ${s.path} — ${s.why}`),
      ].join('\n'),
    });
  } catch { /* the smoke check is evidence, never a gate — a failure here changes nothing */ }
}
