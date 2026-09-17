// ONE CODE, ONE MEANING — telling "the app was built" apart from "the build never converged".
//
// 🔴 THE DEFECT (admin build report `af3a3f7f`, user rajeshkumar00077890@, 2026-09-17). A build that
// SUCCEEDED — `ok: true`, app rendered in a real browser, `vitest 6/6 PASS`, `PROD_BUILD_OK`,
// `GREEN_GUARD_SAVE` — carried this as its recorded root cause:
//
//     "Build outcome: STOPPED — the app was built; the post-build advisory pass was cut short by
//      its 2-minute cap."
//
// Nothing about that build stopped. `ADVISORY_CAP_MS = 120_000` is a DESIGNED ceiling on the optional
// post-build extras (CLAUDE.md records it as the intended hard cap on ALL post-build work), so hitting
// it is the system working, not failing.
//
// WHY IT READ THAT WAY, and the author of the emitting code knew the two cases differ — its own
// comment says they "mean opposite things to the person waiting". The distinction was encoded in the
// MESSAGE and the SEVERITY, while BOTH cases were recorded under the single code `OUTCOME_STOPPED`.
// Every reader that keys on the code therefore sees one meaning where there are two:
//
//   • `deriveRootCause` takes the last `OUTCOME_*` message before any other rule, so a successful
//     build was handed "STOPPED" as its root cause.
//   • `OUTCOME_TO_CATEGORY` maps `OUTCOME_STOPPED` → `incomplete`, "The run ended before it finished
//     — cancelled, out of budget, or stopped by a gate". For a built app that is simply false.
//   • The admin's Failure Category panel classifies the message as `other`, because no keyword in its
//     list appears in it — verified by running the real string through it.
//
// 🔒 SO THE FIX IS A SEPARATE CODE, not a cleverer reading of the prose. A code is a machine fact; a
// sentence is something every reader has to re-interpret, and three of them interpreted it differently.
//
// ⚠️ THE LEGACY SHAPE MUST STAY RECOGNISED. Every build already recorded carries `OUTCOME_STOPPED`
// with the advisory wording, and those reports are what the admin's panels read. A fix that only
// understood the new code would leave every past build still mislabelled, which is most of them.

/** The code a NEW advisory-cap outcome is recorded under. One code, one meaning. */
export const ADVISORY_CAP_CODE = 'OUTCOME_ADVISORY_CAPPED';

/**
 * The distinguishing clause of the legacy message, chosen because it states the fact that matters:
 * the app EXISTS. The watchdog variant says "the wall-clock cap … was reached before the build
 * converged" and shares no wording with it.
 */
const LEGACY_ADVISORY_TEXT = /the app was built;\s*the post-build advisory pass was cut short/i;

/**
 * Is this issue the advisory cap — i.e. the app was built and only the optional post-build extras ran
 * out of their 2-minute window? PURE.
 *
 * Accepts the new code, or the legacy `OUTCOME_STOPPED` carrying the advisory wording. A record that
 * is neither is NOT an advisory cap, so an unrecognised shape keeps today's behaviour exactly — the
 * safe direction, because mistaking a real stop for an advisory cap would hide a genuine failure.
 */
export function isAdvisoryCapOutcome(issue: { code?: string | null; message?: string | null } | null | undefined): boolean {
  const code = String(issue?.code ?? '');
  if (code === ADVISORY_CAP_CODE) return true;
  if (code !== 'OUTCOME_STOPPED') return false;
  return LEGACY_ADVISORY_TEXT.test(String(issue?.message ?? ''));
}

/**
 * The same question asked of a bare string, for readers that kept only the prose.
 *
 * `listAllDiagnostics` projects `rootCause` text and drops the issue codes, so the admin's Failure
 * Category panel has nothing BUT the sentence. Until it carries the code too, this is the only way
 * that panel can tell a built app from a build that never converged.
 */
export function textIsAdvisoryCap(text: string | null | undefined): boolean {
  return LEGACY_ADVISORY_TEXT.test(String(text ?? ''));
}
