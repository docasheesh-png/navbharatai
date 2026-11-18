// THE RELEASE RULE FOR AN EDIT, STATED ONCE — decided on the server, the same for every tier and every
// provider fallback (they all converge on the one turn-end settle in the route).
//
//   promote          the candidate was compared with its verified base (the edit gate), the server's own
//                    browser rendered it, and the project's instructions were recoverable. It becomes the new
//                    verified head and the new last-known-good.
//   hold             the project keeps serving its base. A failed gate, an app observed broken, or a base that
//                    could not be proven complete never replaces it. The candidate is kept under its own key.
//   keep-unverified  the edit is the user's and stays in the editable project, but it is NOT promoted: the
//                    server could not look at it (a paused sandbox is not evidence — admin ruling 2026-08-25,
//                    GreenGuard). The verified head and last-known-good do not move.
//
// PURE.

import { assessEditCandidate, type GateVerdict } from './editPromotionGate';

export type EditGateVerdict = GateVerdict;
import type { BaseVerification } from './projectRevisions';

export type ReleaseAction = 'promote' | 'hold' | 'keep-unverified';

export interface ReleaseInput {
  gate: GateVerdict;
  /** The server's own browser visit rendered the candidate. */
  previewGreen: boolean;
  /** …and saw it broken (as opposed to never managing to look). */
  provenBroken: boolean;
  /** The base the edit started from, verified against the head revision. */
  base: BaseVerification;
  /** The edit was built on the project's instructions (false = they could not be recovered). */
  requirementsOk: boolean;
  /**
   * The build itself finished OK. 🔴 Autopsy 57604006 (build 9ed80cc9): the engine ran out of providers mid-edit, the
   * release gate said RED and the build was recorded as failed — yet the half-finished candidate rendered, and with
   * nothing else to stop it, it would have become the project's VERIFIED version. A build that did not finish never
   * moves the verified head; its files stay saved as the user's editable project.
   */
  buildOk: boolean;
}

export interface ReleaseDecision {
  action: ReleaseAction;
  reasons: string[];
}

export function decideRelease(i: ReleaseInput): ReleaseDecision {
  if (i.gate.verdict === 'reject') {
    return { action: 'hold', reasons: ['edit-gate: the candidate replaces the project instead of editing it', ...i.gate.reasons.map((r) => `${r.rule}: ${r.detail}`)] };
  }
  if (i.provenBroken) return { action: 'hold', reasons: ['preview: the candidate was observed broken'] };
  if (!i.buildOk) return { action: 'keep-unverified', reasons: ['build: the build did not finish OK, so its result is not a verified version'] };
  if (!i.requirementsOk) return { action: 'keep-unverified', reasons: ['requirements: the project\'s saved instructions could not be recovered'] };
  if (!i.previewGreen) return { action: 'keep-unverified', reasons: ['preview: the candidate could not be opened to verify it'] };
  if (i.base.state === 'stale') return { action: 'keep-unverified', reasons: ['base: the workspace differed from the head revision, so this edit is not a verified successor'] };
  return { action: 'promote', reasons: [] };
}

/** The gate's verdict when the candidate REPLACES its base, else null (no base, or it is a real edit). PURE. */
export function candidateReplacesBase(base: Readonly<Record<string, string>> | null, candidate: Readonly<Record<string, string>>, userMessage: string): GateVerdict | null {
  if (!base) return null;
  const v = assessEditCandidate({ base, candidate, userMessage });
  return v.verdict === 'reject' ? v : null;
}

/** `AGENTV3_EDIT_PROMOTION=off` is the kill switch for the edit gate and the stop-without-instructions rule. Default ON. */
export function editPromotionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_EDIT_PROMOTION ?? '').trim().toLowerCase() !== 'off';
}

/**
 * Has the server's own browser seen THIS tree render? Either the turn-end check did, or the in-build proof did and
 * NOTHING was written after it (so the tree that rendered is the tree being saved). 🔴 Autopsy 57604006: the report
 * said "the app rendered in a real browser 686 s in" and, one second later, "I could not open your app to confirm
 * it works" — the turn-end flag was false while the in-build proof was true, and the user was told the second one.
 * PURE.
 */
export function renderEvidence(previewGreen: boolean, inBuildGreenAt: number, writesAfterInBuildProof: number): boolean {
  return previewGreen === true || renderedInBuildUnchanged(inBuildGreenAt, writesAfterInBuildProof);
}
export function renderedInBuildUnchanged(inBuildGreenAt: number, writesAfterInBuildProof: number): boolean {
  return Number.isFinite(inBuildGreenAt) && inBuildGreenAt > 0 && writesAfterInBuildProof === 0;
}
/** `result.ok` of a run that may not have produced a result. */
export function buildOkOf(result: { ok?: unknown } | null | undefined): boolean {
  return result?.ok === true;
}
