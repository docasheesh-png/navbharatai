// NVIDIA Nemotron 3 — ONLY where it actually pays, and nowhere else.
//
// Admin, 2026-09-19, after reading the full evaluation: *"ok, kaha jahan hame fayda hai. banao."*
// So this module is the boundary of that "kahan": it names the three roles Nemotron is allowed to
// take and makes every other role structurally unreachable, rather than leaving the choice to a
// future call site.
//
// 🔴 THE ONE FACT THAT DECIDED EVERYTHING — AND IT CUTS AGAINST THE STICKER PRICE.
// Nemotron's published rates look cheaper than our cheap lead rung (Super $0.085/$0.40 against
// glm-4.7-flashx $0.07/$0.40). They are not, for US, because **the Nemotron route does not honour
// prompt-cache markers** (the OpenRouter path goes through DeepInfra; its dashboard shows a ~0.2%
// global cache-hit rate). Our builds are the opposite of cache-indifferent — measured, from this
// repo's own autopsies:
//
//   • Gita build b6f88a72 : 1,520,722 input tokens, 1,427,968 of them CACHE-READ  → 93.9%
//   • Build C             :   721,982 input tokens,   654,848 cache-read          → 90.7%
//   • a weak/free build   : 1.08M input for 7,928 output                          → 137 : 1
//   • the system prompt alone is 88,072 characters, re-sent on every turn
//
// FlashX charges $0.01/MTok for that 92%. Nemotron charges full input rate for all of it. On the
// architect slice (480k in, 94% cached) that is $0.0083 against $0.0426 — **Super is 6.2× DEARER**
// than the rung it would have "undercut", and 9× on the Bedrock listing. So:
//
//   ❌ NEVER the architect, the sub-agents, the reviewer or the heal passes. Those are the 40–70-call
//      tool loops where the cache lives, and they are also where tool-calling accuracy is critical —
//      Nemotron would lose on both counts at once.
//   ❌ NEVER vision. Nemotron 3 is text-in / text-out; it cannot read an image at all.
//   ❌ NEVER the guards (lint, typecheck, build, preview, journey, fuzz, CVE, the mutation and
//      duplicate-import guards). Those are deterministic CODE at ₹0 — putting a model there would
//      raise the cost AND lose the determinism.
//   ❌ NEVER the cheap intent classifier. That runs on the free chat router today at ₹0, and nothing
//      is cheaper than nothing. Nemotron 3 Nano ($0.05/$0.20) is on no list here for this reason.
//
// ✅ WHERE IT DOES PAY, and why it is the same reason in all three cases: a SINGLE, input-heavy,
//    reasoning call with NO tools and little repetition to cache.
//
//   • JUDGE — `selectReviewJudge`'s runner sends system + messages and reads back TEXT. No tools, one
//     call. On the measured profile the judge is **78% of a cheap-lead build's entire real cost**
//     ($0.0915 of $0.1176), because it is the one slice the prompt cache does not rescue. Ultra does
//     it for $0.0433. This is the whole opportunity; the builder was never it.
//   • PLAN — one short, input-heavy call whose quality decides whether the build is right first try.
//     `PLAN_RUNG`'s own docblock already says it runs on "the tier's best cheap reasoner", not its
//     cheapest rung. Ultra at $0.50 in is that, under glm-5.3's $1.40.
//   • A LAST-RESORT LADDER RUNG — Super, inserted BEFORE the Claude backstop on Weak and Normal. It
//     is reached only when every rung above it has already failed, so its cache disadvantage costs
//     almost nothing, and it buys a fourth independent vendor between us and a Claude bill.
//
// 🔒 HAIKU AND SONNET STAY LAST. Super goes in FRONT of the Claude backstop, never in place of it: an
// unproven vendor may reduce how often we reach the insurance, but it may not BE the insurance.
//
// ⚠️ QUALITY IS UNMEASURED, and the judge is the worst place for that to bite: a weak judge passes a
// broken app quietly, and no cost table shows that. Hence the flag below defaults to OFF for the judge
// and the plan, and the honest rollout is Weak first — the tier NavBharatAI pays for itself.
//
// PURE — env is passed in, no I/O, no clock.

import type { PowerLevel } from './powerLevel';
import { parseEnvFlag } from '../lib/envFlag';

/**
 * The model ids, env-overridable with code defaults.
 *
 * ⚠️ THIS IS A DELIBERATE EXCEPTION TO DECISION "A" (model ids live in code, not env — see
 * `cheapBuildFloorRunners`). The reason is specific and temporary: a Nemotron id is spelled
 * DIFFERENTLY by each host that serves it (OpenRouter and Together use the `nvidia/…` form, Bedrock
 * and NVIDIA's own endpoint do not), and nobody has bought a plan yet. Pinning one spelling in code
 * would mean a redeploy the moment the admin picks a different host. The defaults below are the
 * OpenRouter/Together form because that is the likeliest purchase; `NEMOTRON_BASE_URL` and these two
 * ids must be set to match whichever host is actually bought.
 */
export const NEMOTRON_ULTRA_DEFAULT = 'nvidia/nemotron-3-ultra-550b-a55b';
export const NEMOTRON_SUPER_DEFAULT = 'nvidia/nemotron-3-super-120b-a12b';

/** OpenRouter, because it is the one host that serves both sizes behind a single key. */
export const NEMOTRON_BASE_URL_DEFAULT = 'https://openrouter.ai/api/v1';

/**
 * The key. Trimmed, and whitespace-only counts as unset — the `BRAVE_API_KEY` lesson: a stray
 * newline in a console field is otherwise a configured-looking key that every call silently rejects.
 */
export function nemotronKey(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NEMOTRON_API_KEY || '').trim();
}

export function nemotronBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NEMOTRON_BASE_URL || '').trim() || NEMOTRON_BASE_URL_DEFAULT;
}

export function nemotronUltraModel(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NEMOTRON_ULTRA_MODEL || '').trim() || NEMOTRON_ULTRA_DEFAULT;
}

export function nemotronSuperModel(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NEMOTRON_SUPER_MODEL || '').trim() || NEMOTRON_SUPER_DEFAULT;
}

/** Is a key present at all? Nothing Nemotron can run without one. */
export function nemotronConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return nemotronKey(env).length > 0;
}

/**
 * `AGENTV3_NEMOTRON=off` — the hard kill switch. It stops the LADDER RUNG as well as the judge and
 * the plan, so there is one value that makes Nemotron vanish completely without a deploy, even with a
 * key configured.
 */
export function nemotronHardOff(env: NodeJS.ProcessEnv = process.env): boolean {
  // Through the SHARED parser, never a hand-written spelling list: `parseEnvFlag` is the one place
  // allowed to know what "off" is spelled as (`off`/`false`/`0`/…), and `tests/envFlag.test.ts`
  // fails CI on any module that rebuilds that list — which is exactly what the first draft of this
  // file did, and what that guard caught.
  return parseEnvFlag(env.AGENTV3_NEMOTRON) === false;
}

/** The tier names the flag accepts, mapped to the internal PowerLevel vocabulary. */
const TIER_WORDS: Record<string, PowerLevel> = {
  weak: 'weak', free: 'weak',
  normal: 'off', economy: 'off', off: 'off',
  strong: 'mini', mini: 'mini', premium: 'mini',
};

/**
 * Which tiers may spend on a Nemotron JUDGE or PLAN call.
 *
 * 🔑 THE FLAG IS AN ALLOWLIST, NOT A BOOLEAN, and that is what makes the admin's own rollout order
 * possible with no deploy: `AGENTV3_NEMOTRON=weak` tries it only on the tier NavBharatAI pays for
 * itself, so a bad judge verdict costs us and never a paying user. `on` means every tier.
 *
 * ⚠️ UNSET MEANS OFF for these two roles, even with a key present — deliberately. A provider KEY must
 * not be a feature switch: that is exactly the `AGENTV3_FILE_EMBEDDINGS` defect this repo has already
 * paid for once, where the presence of `OPENAI_API_KEY` alone would have started an unmetered spend on
 * every build. The ladder rung is different and is keyed rather than flagged — see `nemotronRungOk`.
 *
 * ⚠️ An UNRECOGNISED value means OFF, never ON. Somebody who wanted every tier would type `on`, so a
 * value that is present and unreadable can never have meant "everywhere".
 */
export function nemotronTierAllowed(
  tier: PowerLevel,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (nemotronHardOff(env)) return false;
  if (!nemotronConfigured(env)) return false;
  // An unreadable value is still OFF (see the docblock) — but it is no longer SILENT. See
  // `nemotronConfigNote`.
  warnIfUnreadable(env);
  // THREE-WAY, and the shared parser gives exactly that shape: `true` (every tier), `false` (handled
  // above as the hard kill), `null` for anything it does not recognise — which is where a tier name
  // like `weak` lands, and where an actual typo lands too. So an unreadable value falls through to the
  // tier list, matches nothing, and means OFF. Never "everywhere": somebody who wanted every tier
  // would type `on`, so a value that is present and unreadable cannot have meant that.
  if (parseEnvFlag(env.AGENTV3_NEMOTRON) === true) return true;
  const raw = (env.AGENTV3_NEMOTRON || '').trim().toLowerCase();
  if (!raw) return false;
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (TIER_WORDS[part] === tier) return true;
  }
  return false;
}

/**
 * May the Nemotron SUPER rung run at all?
 *
 * Keyed, not flagged — exactly like every other ladder rung in `ladderRunners` (a rung whose provider
 * has no key is skipped, never substituted). A rung is reached only after everything above it failed,
 * so it is insurance rather than new spend, and gating insurance behind a second switch is how the
 * insurance comes to be missing on the day it is needed. `AGENTV3_NEMOTRON=off` still removes it.
 */
export function nemotronRungOk(env: NodeJS.ProcessEnv = process.env): boolean {
  return !nemotronHardOff(env) && nemotronConfigured(env);
}

/**
 * The roles Nemotron is allowed to take. Total by construction, so a fourth role cannot be added by
 * accident: a new role has to be named here, which is the point where somebody has to think about
 * whether it is a cached tool loop (never) or a single reasoning call (maybe).
 */
export type NemotronRole = 'judge' | 'plan' | 'rung';

/**
 * 🔴 THE PLAN IS NEVER TAKEN ON STRONG — admin decision, 2026-09-19, and it corrects a real mismatch
 * between what the evaluation promised and what the first draft of this file did.
 *
 * That draft gated the plan on the tier allowlist alone, so `AGENTV3_NEMOTRON=on` moved Strong's plan
 * rung to Ultra as well — while the plan I had put to the admin said, in writing, "Plan (Weak and
 * Normal)". Nothing failed; the code was simply broader than the sentence describing it, which is the
 * drift this repo has paid for repeatedly (a comment cannot be typechecked).
 *
 * WHY STRONG IS THE ONE TO PROTECT, and why the JUDGE is not treated the same way: a judge delivers a
 * VERDICT on a finished app — if it is wrong, the gate is wrong and the build is still the build. A
 * PLAN decides the app's whole shape before a line is written. Strong is the tier a user paid premium
 * for, so an unmeasured vendor may report on that build but may not design it.
 *
 * ⚠️ This is a FLOOR, not a default: it cannot be lifted by `AGENTV3_NEMOTRON=on`, because "on" is how
 * somebody enables a feature broadly and is exactly the value that would otherwise reach through.
 * Changing it is a code change with an admin decision behind it, which is the point.
 */
const PLAN_FORBIDDEN_TIERS: ReadonlySet<PowerLevel> = new Set<PowerLevel>(['mini']);

export function nemotronAllowedFor(
  role: NemotronRole,
  tier: PowerLevel,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (role === 'rung') return nemotronRungOk(env);
  if (role === 'plan' && PLAN_FORBIDDEN_TIERS.has(tier)) return false;
  return nemotronTierAllowed(tier, env);
}


/**
 * 🔴 "OFF" AND "I COULD NOT READ WHAT YOU TYPED" ARE DIFFERENT FACTS, AND ONLY ONE OF THEM IS A
 * DECISION (2026-09-20).
 *
 * `nemotronTierAllowed` correctly treats an unrecognised value as OFF — a person who wanted every
 * tier would type `on`, so a value that is present and unreadable cannot have meant that. What it did
 * NOT do was say so. The console showed the key configured, the code showed it disabled, and nothing
 * anywhere connected the two.
 *
 * ⚠️ CORRECTED 2026-09-20, THE SAME DAY, FROM THE CONSOLE ITSELF. This docblock used to state as
 * fact that "the admin reported setting `AGENTV3_NEMOTRON=week`". The admin then sent a screenshot of
 * the live Cloud Run variable list: it reads **`weak`**, and `NEMOTRON_BASE_URL` is the NVIDIA host —
 * so the judge and the plan are ON for that tier and always may have been. What the earlier note
 * recorded was a report about the config, not the config; nobody had opened the console.
 *
 * 🔴 THE LESSON IS THIS FILE'S OWN, TURNED ON ITSELF: a claim about a value that lives in a console no
 * session can read is only ever as good as the last person who looked. Two sessions then repeated it —
 * one into this comment, one to the admin as live advice. **Do not restate a config value here. Say
 * what the code DOES with it, and leave the value to the console.**
 *
 * The GUARD below is unaffected and stays, because it was never about one typo: this repo has paid for
 * this exact shape three times for certain — a trailing space in `BRAVE_API_KEY`, an `=` in
 * `ALERT_EMAIL_FROM`, `20%` in `AGENTV3_FEATURE_HEAL_PCT`. The fix is the same one `parseRolloutPercent`
 * already applies: keep the safe verdict, and make the misreading LOUD. A protection built for a class
 * is not retired because one suspected instance of it turned out not to have happened.
 *
 * ⚠️ An unreadable value is NOT corrected toward the nearest word. Guessing that (say) `week` meant
 * `weak` would make the config mean whatever we think it resembles — and the next typo would be a tier
 * the admin never chose. It stays off; it just stops being quiet about it.
 */
export function nemotronConfigNote(env: NodeJS.ProcessEnv = process.env): string | null {
  if (nemotronHardOff(env)) return null;              // an explicit off is a decision, not a mistake
  const raw = (env.AGENTV3_NEMOTRON || '').trim();
  if (!raw) return null;                              // unset is the documented default, not an error
  if (parseEnvFlag(raw) === true) return null;        // `on` — recognised
  const parts = raw.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = parts.filter((p) => !(p in TIER_WORDS));
  if (unknown.length === 0) return null;              // every part named a real tier
  return (
    `AGENTV3_NEMOTRON contains ${unknown.map((u) => JSON.stringify(u)).join(', ')}, which names no tier — ` +
    `that part is IGNORED and Nemotron's judge/plan stay OFF for it. ` +
    // ⚠️ "off" is deliberately NOT offered here even though TIER_WORDS contains it. `nemotronHardOff`
    // is checked first, so a bare `off` disables everything — suggesting it as a tier name would be
    // advice that does the opposite of what it says.
    `Accepted: ${Object.keys(TIER_WORDS).filter((w) => w !== 'off').join(', ')}, or "on" for every tier.`
  );
}

/** Log the note at most once per distinct value — this is called on every build. */
const WARNED = new Set<string>();
function warnIfUnreadable(env: NodeJS.ProcessEnv): void {
  const note = nemotronConfigNote(env);
  if (!note) return;
  const key = (env.AGENTV3_NEMOTRON || '').trim();
  if (WARNED.has(key)) return;
  WARNED.add(key);
  console.error(`[NEMOTRON] ${note}`);
}
