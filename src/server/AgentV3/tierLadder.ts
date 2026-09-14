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
// THE THREE LADDERS (admin 2026-09-14). Claude rungs carry a SYMBOLIC model ('sonnet' / 'opus' /
// 'haiku') that the route resolves through models.ts, so a Claude id bump never touches this file.
//
//   WEAK   (free)      GLM glm-5.3-flash → KIMI kimi-k2.6 → GLM glm-5.3 → HAIKU
//   NORMAL (economy)   GLM glm-5.3-flash → KIMI kimi-k2.7-code → GLM glm-5.3 → CLAUDE sonnet
//   STRONG (premium)   GLM glm-5.3 → CLAUDE sonnet → CLAUDE_OPUS opus
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
//   • Kimi stays on Weak (k2.6) and Normal (k2.7-code) as the second-vendor rung, so a Z.ai 429 storm
//     cannot take a tier down. kimi-k3 is OUT: its id is unverified on this account and its price is
//     unknown (the rate card still carries it at the k2.7 placeholder).
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
    { provider: 'GLM', model: 'glm-5.3-flash' },
    { provider: 'KIMI', model: 'kimi-k2.6' },
    { provider: 'GLM', model: 'glm-5.3' },
    { provider: 'CLAUDE_HAIKU', model: 'haiku' },
  ],
  off: [
    { provider: 'GLM', model: 'glm-5.3-flash' },
    { provider: 'KIMI', model: 'kimi-k2.7-code' },
    { provider: 'GLM', model: 'glm-5.3' },
    { provider: 'CLAUDE', model: 'sonnet' },
  ],
  mini: [
    { provider: 'GLM', model: 'glm-5.3' },
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
 * The ladder a HEAL pass runs on. The 2026-08-13 rule ("a repair must not begin on the model that
 * produced the failing app") was written when the leading rung was glm-4.7-flash — a model too weak
 * to repair what it broke. That rung is on no ladder now; glm-5.3-flash leads, and repairing on the
 * same strong model WITH the error in hand is the ordinary, cheapest path. So a heal drops the
 * leading rung only when it is that known-weak 4.7-flash (an env override could still put it there);
 * otherwise the heal ladder IS the tier ladder.
 */
export function healLadder(rungs: readonly LadderRung[]): LadderRung[] {
  if (rungs.length > 1 && /4[.\-]?7[-.]?flash/i.test(rungs[0].model)) return rungs.slice(1);
  return [...rungs];
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
  weak: { provider: 'GLM', model: 'glm-5.3-flash' },
  off: { provider: 'GLM', model: 'glm-5.3-flash' },
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
