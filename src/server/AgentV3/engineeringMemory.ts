// GA-6 (persistent engineering memory) — the producer that was missing.
//
// The technical-debt register (AppMakerLab/intelligence/TechnicalDebtTracker) is a real, tested, Firestore-
// backed store that dedups + ages + prioritizes unfixed quality findings across builds — but nothing in the
// AgentV3 build path ever WROTE to it, so it stayed permanently empty. This is the adapter that turns a
// build's findings into the store's `IncomingFinding[]`, so a post-build `recordDebt(...)` call finally
// populates the cross-build memory. Pure input→output; unit-tested; never throws.

import type { IncomingFinding, DebtItem, DebtSeverity } from '../AppMakerLab/intelligence/TechnicalDebtTracker';
import type { SecurityFinding } from './SecurityAnalysis';

/** Sources of build findings to fold into the tech-debt register. All optional; only present ones map. */
export interface BuildFindings {
  /** Security findings from the analyzer (WorkspaceMemory.securityFindings()). */
  security?: ReadonlyArray<SecurityFinding>;
  /** Already-normalized findings from any other source (architecture, lint, runtime …). */
  extra?: ReadonlyArray<IncomingFinding>;
}

const VALID_SEVERITY = new Set<DebtSeverity>(['low', 'medium', 'high', 'critical']);

/** Map a security finding's severity ('high'|'medium'|'low') to a debt severity (identity — all valid). */
function toDebtSeverity(s: unknown): DebtSeverity {
  return typeof s === 'string' && VALID_SEVERITY.has(s as DebtSeverity) ? (s as DebtSeverity) : 'medium';
}

/**
 * Convert a build's findings into tech-debt `IncomingFinding[]` for `recordDebt`. Deduped by the store's own
 * key later; here we just normalize + drop empties. Pure; never throws.
 */
export function findingsToDebt(findings: BuildFindings): IncomingFinding[] {
  const out: IncomingFinding[] = [];
  for (const f of findings?.security || []) {
    if (!f || typeof f.message !== 'string' || !f.message.trim()) continue;
    out.push({
      category: 'security',
      severity: toDebtSeverity(f.severity),
      file: typeof f.file === 'string' ? f.file : undefined,
      message: f.rule ? `${f.message} [${f.rule}]` : f.message,
    });
  }
  for (const f of findings?.extra || []) {
    if (!f || typeof f.message !== 'string' || !f.message.trim()) continue;
    out.push({
      category: f.category,
      severity: toDebtSeverity(f.severity),
      file: typeof f.file === 'string' ? f.file : undefined,
      message: f.message,
    });
  }
  return out;
}

/**
 * A compact, prompt-injectable digest of the persistent debt for a project — "what chronic quality debt does
 * this project carry?" — for the agent to see at the start of a follow-up build. Pure; '' when clean.
 * Expects an ALREADY-prioritized list (as `recordDebt`/`prioritizeDebt` return).
 */
export function engineeringMemoryDigest(debt: ReadonlyArray<DebtItem>, limit = 8): string {
  if (!debt || debt.length === 0) return '';
  const shown = debt.slice(0, limit).map((d) => `  • [${d.severity}] ${d.category}: ${d.message}${d.file && d.file !== '-' ? ` (${d.file})` : ''}`);
  return `Engineering memory — ${debt.length} open tech-debt item(s) carried across builds (fix the top ones first):\n${shown.join('\n')}${debt.length > limit ? `\n  …and ${debt.length - limit} more` : ''}`;
}
