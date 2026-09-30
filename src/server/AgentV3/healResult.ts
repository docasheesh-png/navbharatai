/**
 * WHAT A REPAIR PASS HANDS BACK IS NOT THE BUILD'S ANSWER (autopsy 8e124182, 2026-09-30).
 *
 * Five post-build repair passes ended the same way: `if (healed.ok) result = healed`. `result` is the
 * build's own result, and its `summary` is the reply the user reads — so whichever repair ran LAST
 * wrote the build's answer. In that report a user asked for a stock-inventory app and was told, as the
 * whole reply: *"The source bug that was crashing the test suite is fixed … install Playwright with
 * `npm install -D @playwright/test`"* — the private report of a test repair they never asked for, about
 * a test file NavBharatAI itself had added. The feature heal's reply had replaced the build's a minute
 * earlier; the vaccine's then replaced that.
 *
 * The rule: a repair on a build that already SUCCEEDED keeps the build's answer, and takes the repair's
 * outcome for everything else. A repair on a build that had NOT succeeded is what made it work, so its
 * reply is the right one to show. PURE.
 */
export function adoptHealResult<T extends { ok: boolean; summary: string }>(build: T, healed: T): T {
  if (!build.ok) return healed;
  return { ...healed, summary: build.summary };
}
