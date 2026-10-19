/**
 * A TIME CAP ON OUR OWN STYLE-FLOOR PASS (r6–r10 autopsy, 2026-10-18).
 *
 * The style hand-back (`STYLE_RULES_RESUMED`) only fires once the gate already judged the app READY. The pass
 * it starts is polish the user never asked for, and it had no bound of its own: it ran until the model stopped
 * or the whole-build watchdog fired. This bounds it. Checked BETWEEN model turns, so one in-flight call can
 * overrun it by that call's length. On expiry the build finishes as the READY build it already was, with the
 * model's own pre-hand-back summary. PURE.
 *
 * AGENTV3_STYLE_PASS_CAP_MS: default 180000 (3 min). `0` or `off` = no cap (the old behaviour).
 */
export const STYLE_PASS_CAP_MS_DEFAULT = 180_000;

export function stylePassCapMs(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = String(env.AGENTV3_STYLE_PASS_CAP_MS ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === '0') return null;
  if (!raw) return STYLE_PASS_CAP_MS_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : STYLE_PASS_CAP_MS_DEFAULT;
}

/** True when the style pass started at `startedAt` has run past its cap at `now`. */
export function stylePassCapHit(startedAt: number | null, now: number, env: NodeJS.ProcessEnv = process.env): boolean {
  if (startedAt === null || !Number.isFinite(startedAt)) return false;
  const cap = stylePassCapMs(env);
  return cap !== null && now - startedAt >= cap;
}
