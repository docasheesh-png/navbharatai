/**
 * ONE WAY TO READ A NUMERIC ENV VALUE — the numeric sibling of `envFlag.ts`.
 *
 * WHY THIS EXISTS — `Number('')` is **0**, not `NaN`. That one fact turns a present-but-EMPTY Cloud
 * Run field into a deliberate zero at every reader shaped like this:
 *
 *     const n = Number(process.env.X);
 *     return Number.isFinite(n) && n >= 0 ? n : DEFAULT;   // blank ⇒ 0, never DEFAULT
 *
 * An UNSET key is safe (`Number(undefined)` is `NaN`), so the bug only appears once the key EXISTS
 * and is blank — which is precisely the state the console shows as *configured*. Twelve readers
 * across nine files had it, and each one failed silently in the direction that matters most:
 *
 *   · `CAPTCHA_MIN_SCORE`  ⇒ min 0 ⇒ `score >= 0` is always true ⇒ **every reCAPTCHA v3 score
 *     passes, a certain-bot 0 included** — inside a function whose own `catch` says "fail CLOSED".
 *   · `WELCOME_BONUS_TOKENS` ⇒ the welcome gift becomes ₹0 for every new account, and with
 *     `AGENTV3_PAID_PUBLIC` on a ₹0 wallet is REFUSED new builds — so a new user can do nothing.
 *   · `WEEKLY_TOPUP_TOKENS` ⇒ the weekly gift stops. `AI_*_DAILY_LIMIT` /
 *     `PROFESSIONAL_FREE_DAILY_LIMIT` ⇒ the free allowance becomes none.
 *   · `AGENTV3_DEPLOY_MAX_MB` ⇒ the per-deploy size ceiling is DISABLED (0 means off there).
 *   · `STORE_FEE_PCT` ⇒ the fee split shown on a pack card stops adding up.
 *     `MONITOR_SANDBOX_SPIKE_MIN_USD` ⇒ every trivial spend is alert-worthy.
 *     `SEMANTIC_MEMORY_MIN_SCORE` ⇒ the relevance floor is gone and noise is injected.
 *
 * ⚠️ BLANK IS NOT A DECISION, AND THAT IS THE WHOLE RULE. An explicit `0` is honoured everywhere it
 * is in range — nobody types a zero by accident, and several of these keys document `0` as a real
 * setting. A CLEARED field is the opposite: a dropped paste, an emptied box, or — in this
 * deployment specifically — one of the six keys that are set TWICE, where the last row wins and an
 * empty last row wins silently. CLAUDE.md records both conditions as real, not hypothetical.
 *
 * THE FIX IS THE CLASS, NOT THE SITES (fourth absolute rule, step 2), and this returns `number |
 * null` for exactly the reason `parseEnvFlag` returns `boolean | null`: only the caller knows which
 * way its own default falls, and what range and rounding its number has. Each site keeps its own
 * bounds; none of them keeps its own idea of what an empty string means.
 *
 * ⚠️ THE EIGHT PARSERS THAT STRIP PUNCTUATION WERE DELIBERATELY LEFT ALONE — `buildCostCeiling`,
 * `walletFloor`, `webRiskBudget`, `appAiGateway`, `referralRewards`, `escalationRollout`,
 * `slowRungBench` and `streamWatchdog` each guard blank correctly already (they take `₹`, `$`, `%`,
 * `_` or thousands separators, which this primitive deliberately does not). They are recorded here
 * as CHECKED AND SAFE so nobody re-audits them, and rewriting correct code to share a helper would
 * risk weakening a guard for no defect.
 */

/**
 * Parse one raw env value into a number, or `null` when it does not state one. PURE.
 *
 * `null` means unset, empty, whitespace-only, or unparseable — all four are "the admin did not say",
 * which is deliberately distinct from `0` ("the admin said none"). An explicit `0`, a negative and a
 * fractional value all come back as themselves; judging whether they are in range is the caller's
 * job, because the range differs at every call site.
 *
 * `Infinity` is refused: it parses, it is not finite, and it would defeat every `n <= max` bound it
 * ever met.
 */
export function parseEnvNumber(raw: string | number | undefined | null): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = String(raw ?? '').trim();
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}
