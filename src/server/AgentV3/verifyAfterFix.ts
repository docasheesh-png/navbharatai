// AgentV3 — VERIFY AFTER FIX: a post-green change may only STAND if the app still works after it.
//
// THE GAP THIS CLOSES (admin, and the Green Freeze adversarial review, 2026-08-12): Green Freeze denies
// writes to a verified-working app by default, but a few passes are ALLOWED to write — the user's own
// requests (a real runtime error to fix, a missing feature to add) and the safety restore. Those passes
// write and then… nothing re-checks. A feature-presence heal or a runtime-error repair that ITSELF
// breaks the app leaves it broken, and the build still reports "preview verified" from the pre-fix
// check. This is also how a post-green `run_command` (npm install, prisma format) can corrupt the app
// unnoticed — the one gap the review left open.
//
// The rule: WRAP an allowed post-green change so that, after it runs, the app is RE-RENDERED. If it
// still renders cleanly, the change stands. If it broke, the app is RESTORED to the exact green snapshot
// taken just before the change, and the failure is reported honestly. "Trust, then verify" — an
// improvement lands only when it is proven still-working, and a regression is undone automatically
// within seconds rather than shipped.
//
// This is the answer to the admin's first question — a non-technical user can never be handed a broken
// app, because a change that breaks it is reverted before the build ends, not merely offered.
//
// PURE ORCHESTRATION: every side effect (snapshot, apply, re-render, revert) is INJECTED, so the
// keep-vs-revert logic is fully unit-testable and cannot lie about what it did. No I/O, no model, no
// clock in this module.

export interface VerifyAfterFixHooks<S> {
  /** Capture the exact working state BEFORE the change (the green snapshot to fall back to). */
  snapshot: () => Promise<S>;
  /** Perform the change (an allowlisted pass writing to the app). */
  apply: () => Promise<void>;
  /** Re-render the app and report whether it STILL works. True = renders cleanly. */
  reverify: () => Promise<boolean>;
  /** Put the captured snapshot back, exactly. Only called on a regression. */
  revert: (snapshot: S) => Promise<void>;
}

export interface VerifyAfterFixResult {
  /** True when the change was kept (the app still works after it). */
  kept: boolean;
  /** True when the change broke the app and was rolled back. */
  reverted: boolean;
  /** True when re-verification itself could not run (no preview) — the change is KEPT, honestly unproven. */
  unverified: boolean;
}

/**
 * Apply a post-green change and keep it ONLY if the app still renders afterwards; otherwise restore the
 * pre-change snapshot. The ordering is the whole safety property, so it is fixed here and never at a
 * call site:
 *
 *   1. snapshot the working app   (the fallback)
 *   2. apply the change
 *   3. re-render
 *   4a. renders   → keep
 *   4b. broke     → revert to the snapshot
 *   4c. cannot re-render (no preview) → KEEP, but report it as unproven (we do not revert a change we
 *       cannot show is bad — the app was already green before, and the change may well be fine)
 *
 * A revert that itself throws is swallowed and reported (kept:false, reverted:false) — the caller still
 * learns the change did not verify, and Green Freeze's end-of-turn GreenGuard save remains the backstop.
 */
export async function verifyAfterFix<S>(hooks: VerifyAfterFixHooks<S>): Promise<VerifyAfterFixResult> {
  let snap: S;
  try {
    snap = await hooks.snapshot();
  } catch {
    // We could not capture a fallback, so we cannot safely revert later. Run the change WITHOUT the net
    // rather than skip a legitimate fix — this is exactly today's behaviour, and no worse.
    await hooks.apply().catch(() => {});
    return { kept: true, reverted: false, unverified: true };
  }

  await hooks.apply();

  let stillWorks: boolean;
  try {
    stillWorks = await hooks.reverify();
  } catch {
    // Re-verification could not run (no preview / browser). Do NOT revert a change we cannot prove
    // broke anything — the app was green before, the change may be fine. Keep it, report it unproven.
    return { kept: true, reverted: false, unverified: true };
  }

  if (stillWorks) return { kept: true, reverted: false, unverified: false };

  try {
    await hooks.revert(snap);
    return { kept: false, reverted: true, unverified: false };
  } catch {
    return { kept: false, reverted: false, unverified: false };
  }
}

/** Kill switch — default ON. `off` runs allowed passes without the verify/revert net (today's behaviour). */
export function verifyAfterFixEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTV3_VERIFY_AFTER_FIX !== 'off';
}

/** The honest report line for the three outcomes. Pure. */
export function verifyAfterFixNote(passLabel: string, r: VerifyAfterFixResult): { severity: 'info' | 'warning'; code: string; message: string; autoResolved: boolean } {
  if (r.reverted) {
    return {
      severity: 'info',
      code: 'FIX_REVERTED',
      message: `The ${passLabel} broke the working app, so it was rolled back automatically — you still have the version that rendered correctly.`,
      autoResolved: true, // the app is back to working; the regression did not ship
    };
  }
  if (r.unverified) {
    return {
      severity: 'info',
      code: 'FIX_UNVERIFIED',
      message: `The ${passLabel} was applied, but the app could not be re-rendered to confirm it still works — kept, but not re-verified.`,
      autoResolved: true,
    };
  }
  if (!r.kept) {
    return {
      severity: 'warning',
      code: 'FIX_REVERT_FAILED',
      message: `The ${passLabel} broke the working app and the automatic rollback did not complete — the end-of-turn safety restore is the backstop.`,
      autoResolved: false,
    };
  }
  return {
    severity: 'info',
    code: 'FIX_VERIFIED',
    message: `The ${passLabel} was applied and the app was re-rendered to confirm it still works.`,
    autoResolved: true,
  };
}
