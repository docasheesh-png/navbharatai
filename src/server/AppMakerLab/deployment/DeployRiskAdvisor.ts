// P-DEPLOY.3 — AI Deployment Ops (AIOps): pre-deploy risk assessment + incident/RCA analysis.
//
// Two pure, testable reasoning engines that make deploys safer:
//   • assessDeployRisk(signals) — turns real change signals (files changed, lines added/removed, whether
//     high-criticality paths were touched, whether tests came with the change) into a 0–100 risk score,
//     a band (low/medium/high), and concrete advice. Deterministic — an operator can trust the number.
//   • analyzeIncident(events)   — correlates deploy + error events into a likely cause + rollback advice
//     (e.g. "errors spiked right after deploy <sha>; the previous healthy revision is <prev> — roll back").
//
// HONESTY: every output is derived from the signals given; nothing is invented. No model call — this is
// explicit, reproducible reasoning (the LLM can consume it, but the score itself is deterministic).

export type RiskBand = 'low' | 'medium' | 'high';

export interface DeployChangeSignals {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  /** Files touched that live on a high-criticality path (auth, billing, deploy, db, server entry, …). */
  criticalFilesTouched: number;
  /** Test files added/changed in this change. */
  testFilesChanged: number;
  /** CI status if known — a red CI is an automatic high risk. */
  ciGreen?: boolean;
}

export interface DeployRiskReport {
  score: number; // 0 (safe) … 100 (very risky)
  band: RiskBand;
  reasons: string[];
  advice: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Score the risk of shipping a change. Deterministic + pure. */
export function assessDeployRisk(s: DeployChangeSignals): DeployRiskReport {
  const reasons: string[] = [];
  const advice: string[] = [];
  let score = 0;

  const churn = Math.max(0, s.linesAdded) + Math.max(0, s.linesRemoved);
  // Size of the change.
  if (s.filesChanged >= 40 || churn >= 1500) { score += 45; reasons.push(`Large change: ${s.filesChanged} files, ${churn} lines`); advice.push('Split into smaller PRs or deploy behind a flag.'); }
  else if (s.filesChanged >= 15 || churn >= 500) { score += 20; reasons.push(`Sizeable change: ${s.filesChanged} files, ${churn} lines`); }
  else if (s.filesChanged > 0) { score += 5; }

  // Criticality of what was touched.
  if (s.criticalFilesTouched > 0) {
    score += clamp(s.criticalFilesTouched * 12, 12, 40);
    reasons.push(`${s.criticalFilesTouched} high-criticality file(s) touched (auth/billing/deploy/db/server)`);
    advice.push('Extra review + a smoke test on the critical path before promoting.');
  }

  // Tests accompanying the change lower risk; their absence on a big change raises it.
  if (s.testFilesChanged > 0) { score = Math.max(0, score - 10); reasons.push(`${s.testFilesChanged} test file(s) included`); }
  else if (s.filesChanged >= 10) { score += 15; reasons.push('No tests accompany a sizeable change'); advice.push('Add at least one regression test for the riskiest path.'); }

  // CI status is decisive.
  if (s.ciGreen === false) { score = Math.max(score, 85); reasons.push('CI is not green'); advice.push('Do NOT deploy until CI passes.'); }

  score = clamp(Math.round(score), 0, 100);
  const band: RiskBand = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  if (band === 'low' && advice.length === 0) advice.push('Low risk — safe to deploy on merge.');
  return { score, band, reasons, advice };
}

export interface DeployEvent { kind: 'deploy'; at: number; ref: string }
export interface ErrorEvent { kind: 'error'; at: number; message?: string }
export type IncidentEvent = DeployEvent | ErrorEvent;

export interface IncidentReport {
  correlated: boolean;
  likelyCause: string;
  rollbackTo: string | null;
  advice: string;
  errorsAfterDeploy: number;
}

/**
 * Correlate deploy + error events into a likely cause + rollback advice. Pure.
 * If a burst of errors starts within `windowMs` after a deploy, that deploy is the prime suspect and the
 * PREVIOUS deploy's ref is the rollback target.
 */
export function analyzeIncident(events: IncidentEvent[], windowMs = 10 * 60 * 1000): IncidentReport {
  const deploys = events.filter((e): e is DeployEvent => e.kind === 'deploy').sort((a, b) => a.at - b.at);
  const errors = events.filter((e): e is ErrorEvent => e.kind === 'error');
  if (deploys.length === 0) {
    return { correlated: false, likelyCause: 'No deploy events to correlate.', rollbackTo: null, advice: 'Investigate application/runtime logs directly.', errorsAfterDeploy: 0 };
  }
  const last = deploys[deploys.length - 1];
  const prev = deploys.length >= 2 ? deploys[deploys.length - 2] : null;
  const errorsAfter = errors.filter((e) => e.at >= last.at && e.at <= last.at + windowMs).length;

  if (errorsAfter > 0) {
    return {
      correlated: true,
      likelyCause: `${errorsAfter} error(s) started within ${Math.round(windowMs / 60000)} min after deploy ${last.ref} — that deploy is the prime suspect.`,
      rollbackTo: prev ? prev.ref : null,
      advice: prev
        ? `Roll back to the previous healthy revision ${prev.ref}, then reproduce the failure off the hot path.`
        : `No earlier deploy recorded to roll back to — mitigate forward (hotfix) and add a known-good baseline.`,
      errorsAfterDeploy: errorsAfter,
    };
  }
  return { correlated: false, likelyCause: `No error burst tied to the latest deploy ${last.ref}.`, rollbackTo: null, advice: 'Errors are not deploy-correlated — look at data/traffic/dependency causes.', errorsAfterDeploy: 0 };
}
