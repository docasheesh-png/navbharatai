/**
 * Chat-handler Surplus admission + build-report recording.
 *
 * Kept OUT of routes/agentv3.ts so Weak-only gating and SURPLUS_* diagnostics do not
 * spend the chat handler's TS2563 branch budget (Q-979). Owner 2026-10-25: Surplus = Weak only.
 */
import { resolveProBuildSurplusAdmission, safeSurplusAdmissionReason, type SafeSurplusAdmissionReason } from './admitOrFallback';
import type { SurplusBuildSession } from './buildSession';
import { shouldSkipSurplusAdmit, SURPLUS_ADMIT_CIRCUIT_OPEN_REASON } from './surplusAdmitCircuit';

export type SurplusAdmissionDiag = {
  code: 'SURPLUS_ADMITTED' | 'SURPLUS_FALLBACK';
  reason?: SafeSurplusAdmissionReason | string;
  model?: string;
};

type AuditFn = (event: string, data?: Record<string, unknown>, level?: string) => void;

export type WeakSurplusAdmissionGate =
  | { ok: true; session: SurplusBuildSession | undefined; diag: SurplusAdmissionDiag | undefined }
  | { ok: false; session?: undefined; diag: SurplusAdmissionDiag | undefined; afterSurplusFallback: boolean };

/**
 * Prefer Surplus on Weak build/import turns only. Normal/Strong and plain chat skip without I/O.
 * Fail-open to the Weak ladder; hard-fail only when the tier engine is also unavailable after Surplus fallback.
 */
export async function runWeakSurplusAdmissionForChat(options: {
  powerLevel: string;
  intent: string;
  hasImportIntent: boolean;
  prompt: string;
  buildId: string;
  tierEngineAvailable: () => boolean;
  audit: AuditFn;
}): Promise<WeakSurplusAdmissionGate> {
  // Owner 2026-10-25: Surplus is Weak-only; Normal/Strong keep direct provider ladders.
  if (!(options.powerLevel === 'weak' && (options.intent !== 'chat' || options.hasImportIntent))) {
    return { ok: true, session: undefined, diag: undefined };
  }

  // Overload cool-down: recent mid-build Surplus deaths after SURPLUS_ADMITTED → skip admit, Weak ladder.
  if (shouldSkipSurplusAdmit()) {
    const safe = SURPLUS_ADMIT_CIRCUIT_OPEN_REASON;
    const diag: SurplusAdmissionDiag = { code: 'SURPLUS_FALLBACK', reason: safe };
    try {
      options.audit('AGENTV3_SURPLUS_FALLBACK_TO_WEAK', { reason: safe, phase: 'admit_circuit' }, 'warn');
      console.warn(`[AGENT_STEP] Surplus admit circuit open (${safe}); continuing on Weak/CHEAP_FLOOR ladder.`);
    } catch { /* best-effort audit */ }
    if (!options.tierEngineAvailable()) {
      return { ok: false, diag, afterSurplusFallback: true };
    }
    return { ok: true, session: undefined, diag };
  }

  let diag: SurplusAdmissionDiag | undefined;
  const surplusAdmit = await resolveProBuildSurplusAdmission({
    buildId: options.buildId,
    tier: options.powerLevel,
    initialWorkload: {
      input: Buffer.byteLength(options.prompt, 'utf8') + 8192,
      output: 8192,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
    },
    tierEngineAvailable: options.tierEngineAvailable,
    onFallback: (reason) => {
      const safe = safeSurplusAdmissionReason(reason);
      diag = { code: 'SURPLUS_FALLBACK', reason: safe };
      try {
        options.audit('AGENTV3_SURPLUS_FALLBACK_TO_WEAK', { reason: safe }, 'warn');
        console.warn(`[AGENT_STEP] Surplus unavailable (${safe}); continuing on Weak/CHEAP_FLOOR ladder.`);
      } catch { /* best-effort audit */ }
    },
    onAdmitted: (session) => {
      diag = { code: 'SURPLUS_ADMITTED', model: session.model };
      try {
        options.audit('AGENTV3_SURPLUS_ADMITTED', { model: session.model }, 'info');
        console.log(`[AGENT_STEP] Surplus admitted for Weak build (model=${session.model}).`);
      } catch { /* best-effort audit */ }
    },
  });

  if (!surplusAdmit.ok) {
    return { ok: false, diag, afterSurplusFallback: surplusAdmit.afterSurplusFallback };
  }
  return { ok: true, session: surplusAdmit.session, diag };
}

/** Record SURPLUS_ADMITTED / SURPLUS_FALLBACK on the build report. Never throws. */
export function recordSurplusAdmissionDiag(
  buildDiag: {
    record(issue: {
      phase: 'provider';
      severity: 'info' | 'warning';
      code: string;
      autoResolved: boolean;
      message: string;
      detail?: string;
    }): void;
  },
  diag: SurplusAdmissionDiag | undefined,
): void {
  if (!diag) return;
  try {
    if (diag.code === 'SURPLUS_ADMITTED') {
      buildDiag.record({
        phase: 'provider',
        severity: 'info',
        code: 'SURPLUS_ADMITTED',
        autoResolved: true,
        message: `Surplus admitted for Weak build (model=${diag.model ?? 'unknown'}).`,
      });
      return;
    }
    buildDiag.record({
      phase: 'provider',
      severity: 'warning',
      code: 'SURPLUS_FALLBACK',
      autoResolved: true,
      message: `Surplus unavailable — continuing on Weak ladder (reason: ${diag.reason ?? 'other_safe'}).`,
      detail: String(diag.reason ?? 'other_safe'),
    });
  } catch { /* diagnostics are best-effort */ }
}
