// AgentV3 — A RED GATE ON RUNTIME EVIDENCE REACHES THE PERSON WHO IS ABOUT TO TRUST THE APP (audit P0-1, 2026-10-16).
//
// 🔴 THE GAP. `releaseGate` calls a build RED when a real browser saw it fail: the preview did not render, a page
// threw errors, a user journey broke. The verdict flip (`routes/agentv3.ts`, "OUTCOME_RELEASE_GATE_RED") then asks for
// an unresolved ERROR-severity finding, and a failed page-render or journey check is recorded at WARNING — so with
// `AGENTV3_RUNTIME_RED_FLIP` off (its default, "D-1 unanswered") the gate is RED, `result.ok` stays true, and the
// user is handed the ordinary success summary. UNKNOWN already has its own honest line (`RELEASE_GATE_UNPROVEN`); RED
// had none. Reproduced with the real `releaseGate`: preview 'failed' + zero error findings → state red, ok true.
//
// 🔒 WHAT THIS DOES NOT TOUCH, and that restraint is the point (autopsy 4efab9d7, the admin's standing ruling: "app
// bani = preview chala … ₹0 charge karoge to mai barbad ho jaunga"). `ok` is NOT changed here. The "working app or
// free" guard keys on `!result.ok`, so flipping it would hand money back; this only makes the SENTENCE true. The bill,
// the wallet, the verdict and every other field of the result are returned exactly as they came in.
//
// When the flip IS enabled it has already set `ok: false` before this runs, so this is a no-op there: the failure
// summary the flip writes is the one source of truth, and nothing is said twice.
//
// PURE helpers + one recorder with its own try (the chat handler sits at TypeScript's control-flow limit, TS2563, and
// every branch added there is one more the checker must walk — the same reason `recordTodoOnlyTurns` lives outside it).

import { runtimeProven, type RuntimeEvidence } from './releaseGate';

/** Admin-report code for "the gate was RED on runtime evidence and the user was told". Info — it is a fact about OUR notice. */
export const GATE_RED_TOLD_CODE = 'RELEASE_GATE_RED_TOLD';

/** What a real browser actually saw fail, in a person's words and without a vendor name. Empty when nothing runtime failed. PURE. */
export function runtimeFailureParts(ev: RuntimeEvidence | null | undefined): string[] {
  if (!ev) return [];
  const parts: string[] = [];
  if (ev.preview === 'failed') parts.push('the live preview did not open or render properly');
  if (ev.pages === 'failed') parts.push('at least one page showed errors when I opened it');
  if (ev.journeys === 'failed') parts.push('a basic step a user would take (such as adding or saving something) did not work');
  return parts;
}

/**
 * The sentence appended to the user's summary, or null when this is not the case it exists for: the gate must be
 * RED *and* the cause must be a runtime failure. A RED built only from static findings is the verdict flip's business,
 * and an app already proven to run must never be told it failed to. PURE.
 */
export function gateRedNoticeLine(gate: { state: string }, ev: RuntimeEvidence | null | undefined): string | null {
  if (gate?.state !== 'red') return null;
  if (runtimeProven(ev as RuntimeEvidence) !== 'failed') return null;
  const parts = runtimeFailureParts(ev);
  if (parts.length === 0) return null;
  return `⚠️ I checked this app in a real browser and it did not pass: ${parts.join('; ')}. I have NOT confirmed that it works. `
    + 'Your files are saved. Please open the preview and tell me what you see, and I will fix it.';
}

/** The recorder's view of the build diagnostics — only what it calls. */
export interface GateRedDiag {
  record(r: { phase: 'readiness'; severity: 'info'; code: string; message: string; autoResolved: boolean }): unknown;
}

/**
 * Append the notice to a result that is STILL ok after the verdict flip had its say. Returns the same object when there
 * is nothing to say. Never changes `ok`, the bill or any field but `summary`. Never throws. PURE apart from the one
 * best-effort diagnostic record.
 */
export function applyGateRedNotice<T extends { ok: boolean; summary: string }>(
  result: T,
  gate: { state: string },
  ev: RuntimeEvidence | null | undefined,
  diag?: GateRedDiag,
): T {
  try {
    if (!result || result.ok !== true) return result; // the flip (or an earlier failure) already says it
    const line = gateRedNoticeLine(gate, ev);
    if (!line) return result;
    try {
      diag?.record({
        phase: 'readiness', severity: 'info', code: GATE_RED_TOLD_CODE, autoResolved: true,
        message: `The release gate was RED on runtime evidence (${runtimeFailureParts(ev).join('; ')}) while the build's verdict stayed ok `
          + '(AGENTV3_RUNTIME_RED_FLIP is off — billing semantics unchanged). The user was told in their summary.',
      });
    } catch { /* an advisory line must never affect a build */ }
    return { ...result, summary: `${result.summary}\n\n${line}` };
  } catch {
    return result;
  }
}
