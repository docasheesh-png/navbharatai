// AgentV3 — WHAT IS TRUE OF THE DESIGN AFTER THE DESIGN REPAIR (autopsy 9c612cdb, 2026-10-12, Q-993).
//
// 🔴 THE REPAIR WRITES CSS AFTER THE ONLY SNAP. The kit restore had its 'after-repair' run; the snap had none, so
// an off-grid value the repair wrote shipped, and the DESIGN_CONSISTENCY line recorded before the repair still
// described the app as it was. The route now snaps again after the repair and then asks this module to say what
// is true now, whenever it differs from what was recorded.
//
// ⚠️ A HEAL ONLY WHEN THE SAME CHECK NOW FINDS NOTHING (`resolveOnRecheck`'s own obligation). A repair that changed
// the violations but left some (or made them worse) healed nothing: the earlier sentence is no longer true, so it
// is WITHDRAWN (out of the heal tally and the problem count), and the "After the design repair" line is the one
// that stands.
//
// It lives here, not in the route, because the chat handler sits at TypeScript's control-flow limit (TS2563):
// this block's conditions were part of what crossed it.
import { lintBuiltApp, designLintSummary, type BuildQualityLint } from './buildQualityLint';
import { projectHasUserCode } from './platformAuthored';

/** The two report doors this needs — `BuildDiagnostics` has both. */
export interface DesignRestatementDiag {
  resolveOnRecheck(code: string): unknown;
  retract(code: string, messageIncludes: string, why: string): unknown;
  record(r: { phase: 'build'; severity: 'info' | 'warning'; code: string; message: string; autoResolved: boolean }): unknown;
}

/** One comparable fingerprint of a design verdict: the score and every message. PURE. */
function designOf(r: BuildQualityLint): string {
  return `${r.design.score}|${r.design.violations.map((v) => v.message).join('|')}`;
}

/**
 * Re-lint the app after the design repair and the snap that follows it. When the verdict differs from `shipped`,
 * record the "After the design repair" line (a heal only if the re-check is clean, otherwise the stale line is
 * withdrawn) and return the new verdict; otherwise return `shipped` unchanged. Never throws: the earlier line
 * stands on any failure.
 */
export function restateDesignAfterRepair(
  nowFiles: Record<string, string>,
  shipped: BuildQualityLint | null,
  diag: DesignRestatementDiag,
): BuildQualityLint | null {
  try {
    if (!shipped || !projectHasUserCode(nowFiles)) return shipped;
    const afterRepair = lintBuiltApp(nowFiles);
    if (!afterRepair || designOf(afterRepair) === designOf(shipped)) return shipped;
    const left = afterRepair.design.violations.length;
    if (left === 0) diag.resolveOnRecheck('DESIGN_CONSISTENCY');
    else diag.retract('DESIGN_CONSISTENCY', 'Design consistency', 'the design repair changed the app; the "After the design repair" line says what is true now');
    diag.record({ phase: 'build', severity: left > 0 ? 'warning' : 'info', code: 'DESIGN_CONSISTENCY',
      message: `After the design repair: ${designLintSummary(afterRepair)}`, autoResolved: left === 0 });
    return afterRepair;
  } catch {
    return shipped; // the earlier line stands
  }
}
