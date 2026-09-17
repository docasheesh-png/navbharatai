// AgentV3 — ONE LADDER PER POWER TIER, AND A BUILD RUNS ON ITS OWN TIER'S LADDER ALONE.
//
// THE RULE (admin-mandated 2026-09-14, verbatim): "user ne agar teeno mode me se jo select kiya hai,
// aap 100% usi mode me bane." Whatever tier the user selected, the build runs on THAT tier's rungs —
// every one of them, in that order, and NOTHING ELSE. Not a stronger model borrowed when the tier's
// own rungs are busy; not a cheaper one substituted when they are slow.
//
// WHAT THIS REPLACES. Until today the chain a build ran on was ASSEMBLED at the call site from five
// booleans (claudeFirst / allowCheapFloor / cheapOnly / free / noClaude) plus four env flags, and the
// assembly had a fallback the rule forbids by name: when a tier's own rungs were all missing, it
// returned a Claude-only runner — a Weak build could not reach it (enforceNoClaude), but a Normal
// build with the floor switched off silently became a Sonnet build. The chain also carried
// Vertex/Gemini "last resort" rungs into every tier whether the tier's policy named them or not.
//
// NOW the ladder IS the policy. `buildTurnRunner` maps this list to runners one-for-one and refuses
// to add anything the list does not name; a rung whose provider has no key is skipped (the existing
// rule), and a tier whose rungs are ALL missing is reported as unavailable — honestly, never by
// borrowing. `tests/tierChainFidelity.test.ts` asserts the CONSTRUCTED chain's (name, model) sequence
// against this table, so the two cannot drift.
//
// THE THREE LADDERS (admin 2026-09-14, Kimi rungs revised 2026-09-16). Claude rungs carry a SYMBOLIC
// model ('sonnet' / 'opus' / 'haiku') that the route resolves through models.ts, so a Claude id bump
// never touches this file.
//
//   WEAK   (free)      GLM glm-4.7-flashx → KIMI kimi-k2.7-code → GLM glm-5.3 → HAIKU
//   NORMAL (economy)   GLM glm-4.7-flashx → KIMI kimi-k2.7-code-highspeed → GLM glm-5.3 → CLAUDE sonnet
//   STRONG (premium)   GLM glm-5.3 → KIMI kimi-k3 → CLAUDE sonnet → CLAUDE_OPUS opus
//
// 🔴 THE LEAD RUNG CHANGED 2026-09-17: glm-5.3-flash is OFF every ladder, replaced by glm-4.7-flashx
// (admin, verbatim: "glm 5.3 flash ko hata do!" — the per-tier routing confirmation the Model Routing
// Policy requires). This REVERSES part of the 2026-09-14 decision, which chose 5.3-flash on the
// reasoning that "a $0 rung that fails costs more than a $0.15 rung that succeeds". That reasoning was
// right and its PREMISE turned out to be false: 5.3-flash does not succeed. Three autopsies in three
// days measured it —
//   • ee20478d (09-15): 280 hard 400s in ONE build — every call on every tier opened on a rung that
//     could not succeed, because 5.3-flash cannot be told to stop reasoning (see glmThinking.ts).
//   • b3a2c81e (09-16): 68 GLM failures, 52 of them OUTPUT_BUDGET_STARVED — the model's own mandatory
//     thinking spent the whole authorised output ceiling before writing a single character.
//   • dd1f5f60 (09-16): 8.65 tokens/second sustained — 29.5 of a 30-minute build inside one call.
//
// 🔑 WHY FLASHX IS NOT JUST "THE CHEAPER ONE" — it is the one where that entire failure class cannot
// happen. `glmCanDisableThinking` is a NUMERIC family test: 5.3-and-newer always reason, 4.x can be
// told not to. FlashX is 4.7, so the turn sends `thinking: disabled` and the FULL output budget goes
// to code instead of to reasoning nobody reads. The defect is designed out, not tuned around.
//   Price (Z.ai's own page, 2026-09-17): $0.07 in / $0.40 out / $0.01 cached — under HALF of
//   5.3-flash's $0.15 / $0.50 / $0.03. Cheaper AND structurally immune, which is why this is not a
//   trade-off between the two aims.
//
// ⚠️ THE HONEST RISK, stated rather than discovered later: FlashX's CODING quality is unmeasured here.
// Z.ai's "X" suffix denotes the faster, paid variant of a Flash model, and this file's own 09-14 entry
// calls the free glm-4.7-flash "weak at coding" — FlashX may share that brain. What has changed is the
// comparison: a model that reasons well but delivers nothing (three autopsies) is worse than one that
// is plainer but answers. Watch the first real builds for heal COUNT, not for cost.
// 🔒 REVERT WITH NO DEPLOY, both tiers: AGENTV3_LADDER_WEAK / AGENTV3_LADDER_NORMAL, e.g.
//   AGENTV3_LADDER_WEAK=GLM:glm-5.3-flash,KIMI:kimi-k2.7-code,GLM:glm-5.3,HAIKU
//
// 🔴 REVISED 2026-09-16 (admin, verbatim: "free wale me kimi 2.6 ki jagah kimi code 2.7 kar de! normal
// wale me kimi code 2.7 highspeed karo strong me kimi k3 bhi add karo") — this is the explicit
// per-tier routing confirmation the Model Routing Policy requires before a ladder changes:
//   • Weak's Kimi rung moved from k2.6 to k2.7-code, Moonshot's DEDICATED coding model — same price
//     ($0.95/$4.00) as k2.6, so this is a quality upgrade at no extra cost to the builds NavBharatAI
//     itself pays for.
//   • Normal's Kimi rung moved to k2.7-code-highspeed — the SAME model, ~2x tokens/sec, at exactly 2x
//     k2.7-code's price ($1.90/$8.00). No quality difference; the admin was told this before asking for
//     it, and it lands on Normal (a paying tier) rather than Weak, so the extra cost is priced into
//     what the user is billed, not absorbed. Adding this rung is what SURFACED a real defect: the rate
//     matcher had no branch for "highspeed" and would have silently billed it at half price forever —
//     fixed in providerRates.ts in the same change (see 'kimi-k2.7-highspeed').
//   • Strong gains a Kimi rung for the first time — kimi-k3, Moonshot's flagship, priced at exactly
//     Sonnet parity ($3.00/$15.00). Placed as the SECOND rung (after glm-5.3, before Sonnet): a third
//     independent vendor family absorbs a GLM outage without climbing all the way to Claude, and at
//     Sonnet's own price this costs nothing extra over what the ladder already assumed. "Opus sirf
//     zarurat par" is unaffected — Opus is still the last rung, reached only after glm-5.3, k3 AND
//     Sonnet have all failed or the finished build failed its gate.
//
// 🔴 DECIDED UNDER THE ADMIN'S FULL AUTHORITY GRANT (2026-09-14, verbatim: "mera kam se kam kharcha;
// user ko best se best app, ek hi baar me (build fail kam se kam); aapko puri authority hai").
// Two aims, one lever: THE FIRST RUNG MUST BE STRONG ENOUGH THAT HEALS ARE RARE. A heal pass is a
// second model call, more sandbox minutes and a user watching a spinner — a "free" first rung that
// fails costs more than a cheap one that succeeds. With the real prices in hand:
//   • glm-5.3-flash ($0.15 / $0.50) benchmarks beside the flagship on coding and agentic work. It LEADS
//     Weak and Normal. glm-4.7-flash ($0, DeepSWE ~46) is out of every build ladder — it keeps the $0
//     jobs it is good at (intent doubt-reader, chat explainer), not the one it was failing at.
//   • glm-5.3 ($1.40 / $4.40, 95th-percentile coding) is the strong rung under Sonnet ($3 / $15) on
//     every tier and LEADS Strong — Sonnet and Opus are reached only when it fails or the build fails
//     its gate. Same vendor as rung 1, so no new key and no new bill surface.
//   • Kimi stays on every tier as the second-vendor rung, so a Z.ai 429 storm cannot take a tier down —
//     k2.7-code on Weak, k2.7-code-highspeed on Normal, k3 on Strong (added 2026-09-16; see the revision
//     note above for why and at what price).
//   • gpt-5.4 is OUT of every ladder: no key, price unknown, and the admin's own brief says the Nano
//     class is not an app-generation engine. Nothing to buy. Haiku is again Weak's last rung, exactly
//     as the 2026-07-13 amendment described.
//
// 🔒 WEAK NEVER RUNS SONNET OR OPUS — the standing absolute rule (Haiku amendment 2026-07-13) is now
// enforced HERE as well as in enforceNoClaude: `parseLadderOverride` refuses a weak override that
// names either, so an env var cannot become the way that rule is broken.
//
// WHAT IS DELIBERATELY NOT IN ANY LADDER. Grok, Gemini and Vertex (admin 2026-09-14: "Grok ko hatao
// mat" — Grok stays the judge, the free plan model and Engineer AI's primary; Gemini/Vertex stay for
// vision and the free-chat backstop). They are simply not BUILD rungs any more. BEDROCK-GLM likewise:
// it was an env-gated alternative floor and no tier names it.
//
// PURE — no clock, no I/O; env is passed in. The route owns the runners.

import type { PowerLevel } from './powerLevel';
import { toPowerLevel } from './powerLevel';

/** A rung's provider. The names are the bench/telemetry names the chain already uses. */
export type LadderProvider = 'GLM' | 'KIMI' | 'OPENAI' | 'CLAUDE' | 'CLAUDE_HAIKU' | 'CLAUDE_OPUS';

export interface LadderRung {
  provider: LadderProvider;
  /** The exact model id for GLM/KIMI/OPENAI; a SYMBOLIC name ('sonnet'|'opus'|'haiku') for Claude rungs. */
  model: string;
}

export const TIER_LADDERS: Readonly<Record<PowerLevel, readonly LadderRung[]>> = {
  weak: [
    { provider: 'GLM', model: 'glm-4.7-flashx' },
    { provider: 'KIMI', model: 'kimi-k2.7-code' },
    { provider: 'GLM', model: 'glm-5.3' },
    { provider: 'CLAUDE_HAIKU', model: 'haiku' },
  ],
  off: [
    { provider: 'GLM', model: 'glm-4.7-flashx' },
    { provider: 'KIMI', model: 'kimi-k2.7-code-highspeed' },
    { provider: 'GLM', model: 'glm-5.3' },
    { provider: 'CLAUDE', model: 'sonnet' },
  ],
  mini: [
    { provider: 'GLM', model: 'glm-5.3' },
    { provider: 'KIMI', model: 'kimi-k3' },
    { provider: 'CLAUDE', model: 'sonnet' },
    { provider: 'CLAUDE_OPUS', model: 'opus' },
  ],
};

/** Providers that may never appear on the WEAK ladder, whatever an override says. */
const FORBIDDEN_ON_WEAK: ReadonlySet<LadderProvider> = new Set<LadderProvider>(['CLAUDE', 'CLAUDE_OPUS']);

const PROVIDER_ALIASES: Record<string, LadderProvider> = {
  GLM: 'GLM', KIMI: 'KIMI', OPENAI: 'OPENAI', GPT: 'OPENAI',
  CLAUDE: 'CLAUDE', SONNET: 'CLAUDE', HAIKU: 'CLAUDE_HAIKU', CLAUDE_HAIKU: 'CLAUDE_HAIKU',
  OPUS: 'CLAUDE_OPUS', CLAUDE_OPUS: 'CLAUDE_OPUS',
};

/** The env var that may override a tier's ladder. One per tier, so tuning one never touches another. */
export function ladderEnvName(level: PowerLevel): string {
  return level === 'weak' ? 'AGENTV3_LADDER_WEAK' : level === 'off' ? 'AGENTV3_LADDER_NORMAL' : 'AGENTV3_LADDER_STRONG';
}

export interface ParsedLadder {
  rungs: LadderRung[];
  /** 'default' = the code table; 'env' = a valid override was applied. */
  source: 'default' | 'env';
  /** Set when an override was PRESENT and REFUSED — the reason, for the admin report. */
  rejected?: string;
}

/**
 * Parse one tier's override: `PROVIDER:model,PROVIDER:model` (Claude rungs may be bare `HAIKU` /
 * `SONNET` / `OPUS`). An override is applied WHOLE or not at all — a partially-applied ladder would
 * quietly change what "this mode" means, which is the exact thing the rule forbids. Unreadable ⇒ the
 * code default, with the reason recorded.
 */
export function parseLadderOverride(level: PowerLevel, raw: string | undefined): ParsedLadder {
  const fallback: ParsedLadder = { rungs: [...TIER_LADDERS[level]], source: 'default' };
  const text = String(raw ?? '').trim();
  if (!text) return fallback;
  const rungs: LadderRung[] = [];
  for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [head, ...rest] = part.split(':');
    const provider = PROVIDER_ALIASES[head.trim().toUpperCase()];
    if (!provider) return { ...fallback, rejected: `${ladderEnvName(level)}: unknown provider "${head.trim()}" — the whole override was ignored and the code default is in use.` };
    const model = rest.join(':').trim() || defaultSymbolicModel(provider);
    if (!model) return { ...fallback, rejected: `${ladderEnvName(level)}: rung "${part}" names no model — the whole override was ignored.` };
    if (level === 'weak' && FORBIDDEN_ON_WEAK.has(provider)) {
      return { ...fallback, rejected: `${ladderEnvName(level)}: "${part}" would put ${provider} on the WEAK ladder — Sonnet/Opus never run on weak (absolute rule). The override was ignored.` };
    }
    rungs.push({ provider, model });
  }
  if (rungs.length === 0) return fallback;
  return { rungs, source: 'env' };
}

function defaultSymbolicModel(provider: LadderProvider): string {
  return provider === 'CLAUDE' ? 'sonnet' : provider === 'CLAUDE_OPUS' ? 'opus' : provider === 'CLAUDE_HAIKU' ? 'haiku' : '';
}

/** The ladder in force for a tier: the env override when valid, else the code table. */
export function tierLadder(level: PowerLevel | string | boolean | null | undefined, env: NodeJS.ProcessEnv = process.env): ParsedLadder {
  const lvl = toPowerLevel(level as PowerLevel | boolean | string | undefined | null);
  return parseLadderOverride(lvl, env[ladderEnvName(lvl)]);
}

/**
 * Is this the 4.7-flash FAMILY — the tier's cheap lead, `glm-4.7-flash` or `glm-4.7-flashx`?
 *
 * Deliberately matches BOTH, because the 2026-08-13 rule is about the ROLE the model plays (the cheap
 * rung that wrote the broken app), not about one id. The `x?` is the whole point of naming this:
 * before 2026-09-17 the same regex matched only the free flash, and FlashX becoming the lead rung
 * would otherwise have changed heal behaviour by ACCIDENT of a pattern written for a different model.
 * A rule this file depends on may not rest on a coincidence.
 */
export function isCheapFlashRung(model: string): boolean {
  return /4[.\-]?7[-.]?flash/i.test(model);
}

/**
 * The ladder with its cheap leading flash rung removed — the ONE way to say "skip the cheap opener".
 *
 * Exported because TWO callers need exactly this and must never drift apart: `healLadder` (a repair
 * may not begin on the model that wrote the broken file) and complexity routing (a big app should not
 * open on the cheapest rung either — admin 2026-09-17: "kimi ko bade aur complex task dedo… starting
 * me bhi"). Both mean the same thing about the same rung, so they share the same function rather than
 * two regexes that agree today.
 *
 * Never returns an empty ladder: a one-rung ladder keeps its only rung, because "start higher" cannot
 * mean "have nowhere to start".
 */
export function withoutCheapFlashLead(rungs: readonly LadderRung[]): LadderRung[] {
  if (rungs.length > 1 && isCheapFlashRung(rungs[0].model)) return rungs.slice(1);
  return [...rungs];
}

/**
 * The ladder a HEAL pass runs on — the tier ladder minus its cheap leading flash rung.
 *
 * The 2026-08-13 rule, admin-mandated: "a repair must not begin on the model that produced the
 * failing app". Between 2026-09-14 and 2026-09-17 this was effectively DORMANT — glm-5.3-flash led,
 * the pattern did not match it, and every heal restarted on the very rung whose output needed
 * repairing. With glm-4.7-flashx leading (2026-09-17) the rule applies again by design: a weak-tier
 * heal opens on KIMI kimi-k2.7-code, a genuinely different vendor holding the error.
 *
 * 💸 It costs more per heal ($0.95/$4.00 against FlashX's $0.07/$0.40) and that is the intended trade:
 * heals are meant to be RARE, and a cheap repair that fails buys a second heal, which is dearer than
 * one that works. If heal COUNT rises after the lead-rung change, that is the signal to look at — not
 * this line.
 */
export function healLadder(rungs: readonly LadderRung[]): LadderRung[] {
  return withoutCheapFlashLead(rungs);
}

/**
 * The same ladder starting at a given provider — how ESCALATION works now. "Bring in a stronger
 * engine" means "start this tier's own ladder higher up", never "borrow another tier's model".
 * Empty when the provider is not on the ladder, which the caller treats as "cannot escalate".
 */
export function ladderFrom(rungs: readonly LadderRung[], provider: LadderProvider): LadderRung[] {
  const at = rungs.findIndex((r) => r.provider === provider);
  return at < 0 ? [] : rungs.slice(at);
}

/**
 * Where a tier escalates to when its build does not complete: the strongest Claude rung it owns.
 * Weak has none (it never escalates — NavBharatAI pays for every weak build), Normal → Sonnet,
 * Strong → Opus. "Opus sirf zarurat par": Opus is the LAST rung of Strong, reached only when the
 * rungs before it failed or the finished build failed its gate.
 */
export function escalationProvider(rungs: readonly LadderRung[]): LadderProvider | null {
  if (rungs.some((r) => r.provider === 'CLAUDE_OPUS')) return 'CLAUDE_OPUS';
  if (rungs.some((r) => r.provider === 'CLAUDE')) return 'CLAUDE';
  return null;
}

/**
 * The ESCALATION PATH a build may walk, derived from its tier — the analyser's path is a Claude-tier
 * list ('gemini'|'haiku'|'sonnet'|'opus') keyed to the START tier; this keeps it inside the ladder:
 *   • weak  → never escalates: NavBharatAI pays for every weak build, and its ladder owns no Sonnet/Opus.
 *   • off   → capped at 'sonnet' (Normal's top rung); an 'opus' entry is dropped.
 *   • mini  → ends at 'opus' (Strong's last rung); appended when the analyser's path stopped at Sonnet,
 *             because a pinned analysis returns a one-tier path and the tier — not the analyser — is
 *             what decides how far "a stronger engine" may go.
 * Attempt 1 is always the tier's normal ladder; later attempts start the SAME ladder at 'CLAUDE' or
 * 'CLAUDE_OPUS' (see ladderFrom). Pure.
 */
export function escalationPathForTier<T extends string>(level: PowerLevel | string | boolean | null | undefined, analyserPath: readonly T[] | undefined): T[] {
  const lvl = toPowerLevel(level as PowerLevel | boolean | string | undefined | null);
  const path = Array.isArray(analyserPath) ? [...analyserPath] : [];
  if (path.length === 0) return [];
  if (lvl === 'weak') return [path[0]];
  if (lvl === 'off') {
    const capped = path.filter((t) => t !== 'opus');
    return capped.length > 0 ? capped : [path[0]];
  }
  // Strong: keep the analyser's climb, make sure Sonnet precedes Opus, and end at Opus.
  const noOpus = path.filter((t) => t !== 'opus');
  const withSonnet = noOpus.includes('sonnet' as T) ? noOpus : [...noOpus, 'sonnet' as T];
  return [...withSonnet, 'opus' as T];
}

/**
 * THE PLAN PHASE'S FIRST RUNG, PER TIER (admin-approved table, 2026-09-14). A plan is one short,
 * input-heavy call whose quality decides whether the build is right in ONE try — so it runs on the
 * tier's best cheap reasoner, not on its cheapest rung, and never on Opus ("Opus sirf zarurat par").
 * Grok no longer plans: it is the JUDGE on every tier, which needs a model OUTSIDE the build ladders.
 *   weak → glm-5.3-flash · normal → glm-5.3-flash · strong → glm-5.3
 * (Under the 2026-09-14 authority grant: the plan is input-heavy, so it runs on the cheapest rung that
 * reasons well — 5.3-flash at $0.15 in, and the $1.40 glm-5.3 for Strong instead of Sonnet at $3.)
 * The rest of the plan chain is the tier's own ladder (minus the plan rung), so a plan can never fall
 * back to another tier's model either.
 */
export const PLAN_RUNG: Readonly<Record<PowerLevel, LadderRung>> = {
  weak: { provider: 'GLM', model: 'glm-4.7-flashx' },
  off: { provider: 'GLM', model: 'glm-4.7-flashx' },
  mini: { provider: 'GLM', model: 'glm-5.3' },
};

/** The plan chain: the tier's plan rung first, then its ladder as the fallback — nothing else. */
export function planLadder(level: PowerLevel | string | boolean | null | undefined, env: NodeJS.ProcessEnv = process.env): LadderRung[] {
  const lvl = toPowerLevel(level as PowerLevel | boolean | string | undefined | null);
  const first = PLAN_RUNG[lvl];
  const rest = tierLadder(lvl, env).rungs.filter((r) => !(r.provider === first.provider && r.model === first.model));
  return [first, ...rest];
}

/** The env key whose presence lets a rung run. A keyless rung is skipped, never substituted. */
export function keyEnvFor(provider: LadderProvider): string {
  switch (provider) {
    case 'GLM': return 'GLM_API_KEY';
    case 'KIMI': return 'KIMI_API_KEY';
    case 'OPENAI': return 'OPENAI_API_KEY';
    default: return 'ANTHROPIC_API_KEY';
  }
}

export function rungHasKey(rung: LadderRung, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env[keyEnvFor(rung.provider)];
  return typeof v === 'string' && v.trim().length > 0;
}

/** The rungs that can actually run in this environment, in ladder order. */
export function availableRungs(rungs: readonly LadderRung[], env: NodeJS.ProcessEnv = process.env): LadderRung[] {
  return rungs.filter((r) => rungHasKey(r, env));
}

/**
 * Can this tier build at all here? False means every rung is keyless — the honest answer is a
 * refusal naming the tier, never a build on some other tier's model.
 */
export function tierEngineAvailable(level: PowerLevel | string | boolean | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return availableRungs(tierLadder(level, env).rungs, env).length > 0;
}

/** `GLM(glm-4.7-flash) → KIMI(kimi-k2.6) → CLAUDE_HAIKU` — for the admin report. */
export function describeLadder(rungs: readonly LadderRung[]): string {
  return rungs.map((r) => (r.provider.startsWith('CLAUDE') ? r.provider : `${r.provider}(${r.model})`)).join(' → ');
}

/** The user-facing tier name, for the honest "this engine is unavailable" refusal. */
export function tierDisplayName(level: PowerLevel): 'Weak' | 'Normal' | 'Strong' {
  return level === 'weak' ? 'Weak' : level === 'off' ? 'Normal' : 'Strong';
}

/**
 * Does the RETRY ladder actually begin on a different engine from the one that just failed? PURE.
 *
 * 🔴 WHY THIS IS A FUNCTION AND NOT A SENTENCE IN A TEMPLATE (autopsy f5351721, 2026-09-17). The
 * empty-build retry told the user it was "rebuilding with a stronger model", told the admin report it
 * had "retried the whole build on a stronger model (Sonnet in normal mode; Opus only in power mode)",
 * and recorded the delivery as `sonnet`. In the build that produced this, **all 30 calls were
 * `glm-5.3` and no Claude rung ever ran.** Three claims, one template, zero evidence.
 *
 * 🔑 THE CAUSE IS ARCHITECTURAL DRIFT, NOT A TYPO. Those sentences were written when a tier PINNED one
 * model, so `resolveModel(tier)` really did decide what ran. Since the three-tier ladders (2026-09-14)
 * the CHAIN decides, and the retry ran `healLadder`, which drops only a leading cheap-flash rung. On
 * Weak and Normal that genuinely started a rung higher (KIMI instead of FlashX) and the claim was
 * true; **Strong has no flash rung, so its retry restarted on the identical engine** and the claim was
 * false. One template, two different truths, and nothing checked which.
 *
 * ✅ SINCE 2026-09-17 THE RETRY ITSELF WAS FIXED (admin: *"app 100% band, failed likh kar na aye"*) —
 * it now runs `ladderAfterLeadRung`, so it never restarts on the rung that produced nothing, on any
 * tier. This predicate is therefore normally true; it stays because it is what the message is DERIVED
 * from, and it still answers `false` for the one case that remains real: a single-rung ladder (an env
 * override with one rung), which has nowhere higher to go. A caller that cannot honestly say
 * "stronger" must not say it — see the narration at the call site.
 */
/**
 * The ladder a RETRY runs after the first attempt produced NOTHING. PURE.
 *
 * 🔴 THE RULE, and it is the one this file already lives by, applied where it was missing: **a retry
 * must never begin on the rung that just produced nothing.** The 2026-08-13 heal rule says the same
 * thing about repairs ("a heal must not begin on the model that produced the failing app"), but it is
 * implemented as `withoutCheapFlashLead` — it drops the lead only when the lead is a cheap FLASH rung.
 * Weak and Normal have one, so they were already covered by accident of shape. **Strong has no flash
 * rung, so its empty-build retry re-ran the identical engine** — a retry loop around a deterministic
 * failure, which the fourth absolute rule forbids by name. Autopsy f5351721 is that loop: 30 calls,
 * every one `glm-5.3`, zero files.
 *
 * Dropping by POSITION rather than by rung NAME is deliberate. `ladderFrom(rungs, provider)` finds the
 * FIRST rung of a provider, which is correct only while no provider appears twice — and Weak's ladder
 * already carries GLM at two positions. A rule this file depends on may not rest on a coincidence.
 *
 * 🔒 IT NEVER EMPTIES THE LADDER. A one-rung tier keeps its rung: a slow app beats no app, and the
 * same reasoning `canBenchAnother` uses for the last engine applies here. It also cannot reach a model
 * the tier does not own — the rungs are this tier's own, so Weak still ends at Haiku and Sonnet/Opus
 * remain impossible there (`enforceNoClaude` is still the final net).
 */
export function ladderAfterLeadRung(rungs: readonly LadderRung[]): LadderRung[] {
  return rungs.length > 1 ? rungs.slice(1) : [...rungs];
}

export function retryLeadsHigher(
  level: PowerLevel | string | boolean | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const build = tierLadder(level, env).rungs;
  const retry = ladderAfterLeadRung(build);
  if (build.length === 0 || retry.length === 0) return false;
  return retry[0].provider !== build[0].provider || retry[0].model !== build[0].model;
}
