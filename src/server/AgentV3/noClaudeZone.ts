// AgentV3 — the UNBREAKABLE weak-module no-Claude chokepoint (admin absolute rule, 2026-07-13).
//
// THE RULE (admin, verbatim intent): "weak module me claude ko call nahi honi chahiye … absolute rule
// banao / guard bitha — agar user ne weak module select kiya hai, to claude nahi chalega." When a build
// runs on the WEAK / free-cheap tier, Claude (Sonnet/Opus/Haiku) must NEVER be called — not the builder,
// not ANY post-build heal/judge/plan gate — no matter what flag any single call site passes.
//
// ROOT CAUSE this closes (admin deep-test Pomodoro report d055c7ec, 2026-07-13): the guarantee was
// enforced only inside the provider CHAIN (`enforceNoClaude` strips the Claude runners from a
// `buildTurnRunner` chain). But a build can create a *raw* `ClaudeClient` OUTSIDE any such chain — a
// judge fallback, a plan fallback, or a heal gate that forgot to thread the flag. That report showed
// `billing.noClaude: true` while 9 real `claude-sonnet-4-6` tool calls ran (provider=None → a raw
// ClaudeClient, not a chain runner). Threading a boolean through N call sites is fragile by design: one
// missed site = one silent leak. Rule 2 (fix the class, not the instance): enforce the invariant at the
// ONE place Claude is actually invoked — `ClaudeClient.runTurn` — so no present or future call site can
// ever leak, whether or not it remembered the flag.
//
// Mechanism: an AsyncLocalStorage "zone" scoped to a single build request. The route enters it (with the
// weak-tier flag) right after it resolves the tier; every awaited descendant — every gate, sub-agent,
// judge — inherits it. `ClaudeClient.runTurn` checks the zone at its very first line and REFUSES (throws
// `NoClaudeInWeakBuildError`) before spending a single token. The refusal is a normal provider-style
// error: a chain falls through to the next (non-Claude) provider; a best-effort heal gate simply skips.
// Either way NavBharatAI never spends its Claude budget on a weak build. Pure Node built-in; no deps.

import { AsyncLocalStorage } from 'node:async_hooks';

/** State carried inside a no-Claude zone for one build request. */
export interface NoClaudeZoneState {
  /** True → Claude is forbidden for the remainder of this async context. */
  active: boolean;
  /**
   * Observer invoked (best-effort) each time a Claude call is REFUSED by the zone, with the model id
   * that was attempted. Lets the route record an honest, loud diagnostic (which gate tried to leak)
   * without spending anything. Never throws out of the guard.
   */
  onBlocked?: (model: string | undefined) => void;
}

const storage = new AsyncLocalStorage<NoClaudeZoneState>();

/**
 * HAIKU AMENDMENT (admin-mandated 2026-07-13, verbatim: "weak module me claude haiku add kar de? to
 * last me. par sart yeh hai, weak module me claude ka haiku ke alawa kuch aur nahi chalna chahiye,
 * matlab sonnet ya opus never never!!!"): inside a weak build's no-Claude zone, a Claude call is
 * allowed if and ONLY if the requested model is a HAIKU id — the cheap, admin-authorized last resort.
 * Sonnet/Opus (and any other Claude id) remain refused at this chokepoint, by construction. The chain's
 * CLAUDE_HAIKU backstop is forceModelRunner-pinned to haikuModel(), which rewrites params.model BEFORE
 * ClaudeClient.runTurn — so a legitimate Haiku backstop turn always presents a haiku id here, while any
 * raw/forgotten Sonnet path presents a sonnet/opus id and is refused. Pure.
 */
export function isHaikuModelId(model: string | undefined | null): boolean {
  return typeof model === 'string' && /haiku/i.test(model);
}

/**
 * Thrown by `ClaudeClient.runTurn` when a NON-HAIKU Claude call is attempted inside an active no-Claude
 * zone. Carries the attempted model id. A distinct class so callers/tests can identify the refusal
 * precisely and a provider chain can treat it as a normal fall-through error.
 */
export class NoClaudeInWeakBuildError extends Error {
  readonly attemptedModel: string | undefined;
  constructor(model: string | undefined) {
    super(
      `Weak-module no-Claude guard: refused a Claude call (${model ?? 'claude'}) — a weak/free build may only use the Haiku last resort; Sonnet/Opus never run on weak (admin absolute rule, Haiku amendment 2026-07-13).`,
    );
    this.name = 'NoClaudeInWeakBuildError';
    this.attemptedModel = model;
  }
}

/**
 * Run `fn` with a no-Claude zone bound to the current async context and all its descendants. Prefer
 * `enterNoClaudeZone` inside a long Express handler where wrapping the whole body is impractical; use
 * this when you can wrap a self-contained async unit (and in tests).
 */
export function runInNoClaudeZone<T>(state: NoClaudeZoneState, fn: () => T): T {
  return storage.run(state, fn);
}

/**
 * Bind a no-Claude zone to the CURRENT async execution (and every async descendant) without wrapping a
 * callback — for a big request handler that computes the weak-tier flag partway through and then awaits
 * many gates. Only meaningful when `state.active` is true; a false/inactive state is a harmless no-op
 * write. Idempotent per request (each Express request runs on its own async context, so this never
 * bleeds across requests).
 */
export function enterNoClaudeZone(state: NoClaudeZoneState): void {
  if (!state.active) return; // nothing to enforce — leave the ambient context untouched
  storage.enterWith(state);
}

/** True when a no-Claude zone is currently active on this async context. */
export function noClaudeZoneActive(): boolean {
  return storage.getStore()?.active === true;
}

/**
 * The guard `ClaudeClient.runTurn` calls at its first line. When a no-Claude zone is active AND the
 * requested model is NOT a Haiku id, it notifies the observer (best-effort) and returns true — the
 * caller MUST then refuse the Claude call. A HAIKU model id is allowed through (the admin-authorized
 * weak-tier last resort — see isHaikuModelId). Returns false (call is allowed) when no zone is active.
 * Never throws.
 */
export function claudeBlockedInZone(model: string | undefined): boolean {
  const s = storage.getStore();
  if (s?.active) {
    if (isHaikuModelId(model)) return false; // Haiku amendment: the ONE authorized Claude on weak
    try {
      s.onBlocked?.(model);
    } catch {
      /* observer is best-effort — never let it break the guard */
    }
    return true;
  }
  return false;
}
