/**
 * ONE WAY TO READ A BOOLEAN ENV FLAG (audit finding #1, 2026-08-09).
 *
 * WHY THIS EXISTS — a real, money-shaped trap, not tidiness. A scan of the server found **six**
 * different ways to read an ON flag and **three** to read an OFF kill switch, in one codebase:
 *
 *     process.env.X === 'true'                     // exact, case-sensitive, no trim
 *     v === 'on' || v === 'true' || v === '1'
 *     v === 'on' || v === 'true'                   // '1' silently fails
 *     v === '1' || v === 'true'                    // 'on' silently fails
 *     /^(on|true|1)$/i.test(raw.trim())            // the lenient one
 *     process.env.X === 'off'                      // 'OFF' / 'false' / ' off' do NOT disable
 *
 * The admin turns features on by writing **`on`** — CLAUDE.md itself records seven flags set that
 * way. Under the strict readers, `AGENTV3_PAID_PUBLIC=on` leaves **billing switched off** and every
 * user builds free, with nothing in any log to say so. The kill-switch side fails the other way and
 * is worse: `AGENTV3_CIRCUIT_BREAKER=OFF` does **not** disable anything, so an operator believes a
 * dangerous path is stopped while it keeps running. Both failures are silent by construction — the
 * value is accepted, it just does not mean what it says.
 *
 * THE FIX IS THE CLASS, NOT THE SITES (fourth absolute rule, step 2): every flag now goes through
 * one parser, so a new flag is read correctly for free and no call site can invent a seventh
 * dialect. A source-level test asserts the old dialects cannot come back.
 *
 * ⚠️ NOT FOR ENUM-VALUED SETTINGS. `AGENTV3_CHEAP_FLOOR` (`off|glm|kimi|on|both`), the power tiers
 * (`off` is a tier NAME there) and `ENGINEER_QUOTA` (`off|0|unlimited|<n>`) carry more than two
 * states; collapsing them to a boolean would destroy real meaning. Those keep their own parsers on
 * purpose, and the sweep deliberately left them alone.
 */

/** Values that mean YES. Case-insensitive, surrounding whitespace ignored. */
const TRUTHY = new Set(['on', 'true', '1', 'yes', 'y', 'enable', 'enabled']);
/** Values that mean NO. A kill switch must fire for every one of these, not just for `off`. */
const FALSY = new Set(['off', 'false', '0', 'no', 'n', 'disable', 'disabled']);

/**
 * Parse one raw env value into a decision.
 *
 * Returns `null` for unset, empty, whitespace-only, or a value we do not recognise — deliberately
 * distinct from `false`, because "the admin did not say" and "the admin said no" are different
 * facts, and only the caller knows which way its own default should fall. An unrecognised value
 * (a typo like `ture`) also lands here, so it takes the documented default rather than silently
 * meaning `false`. Pure.
 */
export function parseEnvFlag(raw: string | undefined | null): boolean | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === '') return null;
  if (TRUTHY.has(v)) return true;
  if (FALSY.has(v)) return false;
  return null;
}

/**
 * Is this flag on?
 *
 * @param name          the env var name
 * @param defaultValue  what an UNSET / unrecognised value means. `false` for an opt-in feature
 *                      (`envFlag('AGENTV3_ENABLED')`); `true` for a default-on feature whose env is
 *                      a kill switch (`envFlag('AGENTV3_CIRCUIT_BREAKER', true)`).
 *
 * Reads `process.env` at CALL time, never at import time, so a test (and a runtime toggle) can
 * change a flag without reloading the module — several existing flags rely on that.
 */
export function envFlag(name: string, defaultValue = false): boolean {
  return parseEnvFlag(process.env[name]) ?? defaultValue;
}

/**
 * Is this kill switch engaged? Sugar for the default-ON case, so the intent reads at the call site:
 * `if (envKillSwitch('AGENTV3_DUP_IMPORT_GUARD')) return content;`
 */
export function envKillSwitch(name: string): boolean {
  return parseEnvFlag(process.env[name]) === false;
}
