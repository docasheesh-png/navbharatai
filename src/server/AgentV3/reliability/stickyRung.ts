/**
 * P4 — STICKY RUNG WITH UPWARD-ONLY ESCALATION (fix/build-reliability).
 *
 * Before: `MultiProviderTurnRunner` opened EVERY turn at rung 0 and fell back only on an ERROR. A
 * build whose turn 3 was answered by rung 2 (because rung 0/1 timed out) started turn 4 at rung 0
 * again — so the model writing the app changed mid-build, and the next model inherited a transcript
 * it had not reasoned about. Quality failures (a truncated write, an edit that cannot find its text,
 * a compile that never gets better) never moved the build at all, because they are not errors.
 *
 * Now (only when the caller asks — AGENTV3_STICKY_RUNG / AGENTV3_QUALITY_ESCALATE):
 *   • after a success on rung i, later turns of the SAME chain start at the first key of rung i's
 *     model (a key pool stays a pool — we stick to the MODEL, not the key);
 *   • `escalateSticky` moves the start to the next DISTINCT model above the one last used, never down;
 *   • a target the caller forbids (the weak tier's no-Claude rule) is never chosen — if every higher
 *     rung is forbidden, the escalation is refused and the build stays where it is.
 *
 * The state lives on the BUILD's bench registry (one per build, never a singleton), so the fast lane,
 * the architect and the heals of one build agree, and nothing can leak to another build. PURE helpers.
 */

export interface StickyRungDescriptor {
  name: string;
  reportAs?: string;
  modelId?: string;
}

export interface StickyState {
  /** chain key → index the next turn starts at (only ever increases). */
  from: Map<string, number>;
  /** chain key → index of the rung that answered last. */
  lastUsed: Map<string, number>;
  /** chain key → the chain itself, so an escalation can find the next distinct model. */
  chains: Map<string, readonly StickyRungDescriptor[]>;
  /** How many escalations this build has made (report + tests). */
  escalations: number;
}

export function createStickyState(): StickyState {
  return { from: new Map(), lastUsed: new Map(), chains: new Map(), escalations: 0 };
}

/** The identity of a rung's MODEL — every key of a pool shares it. */
export function rungModelKey(r: StickyRungDescriptor): string {
  return `${r.reportAs ?? r.name.replace(/#\d+$/, '')}::${r.modelId ?? ''}`;
}

/** A stable key for a chain: the ordered list of its distinct models. */
export function stickyChainKey(chain: readonly StickyRungDescriptor[]): string {
  const out: string[] = [];
  for (const r of chain) {
    const k = rungModelKey(r);
    if (out[out.length - 1] !== k) out.push(k);
  }
  return out.join('>');
}

/** First index of the model group that index `i` belongs to (so a pool is not skipped key-by-key). */
export function groupStart(chain: readonly StickyRungDescriptor[], i: number): number {
  if (i <= 0 || i >= chain.length) return Math.max(0, Math.min(i, chain.length - 1));
  const k = rungModelKey(chain[i]);
  let j = i;
  while (j > 0 && rungModelKey(chain[j - 1]) === k) j -= 1;
  return j;
}

/** Where this turn should start. Never past the last rung (the backstop is always reachable). */
export function stickyStartIndex(state: StickyState, chain: readonly StickyRungDescriptor[]): number {
  if (chain.length === 0) return 0;
  const key = stickyChainKey(chain);
  if (!state.chains.has(key)) state.chains.set(key, chain);
  const from = state.from.get(key) ?? 0;
  return Math.max(0, Math.min(from, chain.length - 1));
}

/**
 * Record that rung `i` answered. With `remember` the start moves UP to that rung's model group;
 * it never moves down (a recovered lower rung does not pull the build back).
 */
export function recordStickySuccess(state: StickyState, chain: readonly StickyRungDescriptor[], i: number, remember: boolean): void {
  if (chain.length === 0 || i < 0 || i >= chain.length) return;
  const key = stickyChainKey(chain);
  state.chains.set(key, chain);
  state.lastUsed.set(key, i);
  if (!remember) return;
  const g = groupStart(chain, i);
  if (g > (state.from.get(key) ?? 0)) state.from.set(key, g);
}

/** Index of the next DISTINCT, allowed model above `i`, or -1. */
export function nextDistinctModel(chain: readonly StickyRungDescriptor[], i: number, allow: (r: StickyRungDescriptor) => boolean = () => true): number {
  if (i < 0 || i >= chain.length) return -1;
  const cur = rungModelKey(chain[i]);
  for (let j = i + 1; j < chain.length; j++) {
    if (rungModelKey(chain[j]) === cur) continue;
    if (allow(chain[j])) return j;
  }
  return -1;
}

/** A Claude rung (Sonnet / Opus / Haiku) — what the weak tier must never be escalated onto. */
export function isClaudeRung(r: StickyRungDescriptor): boolean {
  const s = `${r.name} ${r.reportAs ?? ''} ${r.modelId ?? ''}`.toLowerCase();
  return /claude|sonnet|opus|haiku|anthropic/.test(s);
}

export interface EscalationOutcome {
  escalated: boolean;
  /** Model the build moves to (first escalated chain), for the handoff note. */
  toModel?: string;
  fromModel?: string;
  reason?: string;
}

/**
 * Move every chain this build has used UP one distinct model. UPWARD ONLY: the new start is always
 * strictly above the rung that answered last. `noClaude` forbids Claude targets outright (weak tier).
 */
export function escalateSticky(state: StickyState, opts: { noClaude?: boolean } = {}): EscalationOutcome {
  const allow = (r: StickyRungDescriptor) => !(opts.noClaude && isClaudeRung(r));
  let outcome: EscalationOutcome = { escalated: false, reason: 'no rung has answered yet' };
  for (const [key, last] of state.lastUsed) {
    const chain = state.chains.get(key);
    if (!chain) continue;
    const j = nextDistinctModel(chain, last, allow);
    if (j < 0) {
      if (!outcome.escalated) outcome = { escalated: false, reason: 'already on the highest allowed model' };
      continue;
    }
    if (j > (state.from.get(key) ?? 0)) state.from.set(key, j);
    state.lastUsed.set(key, j);
    if (!outcome.escalated) {
      outcome = { escalated: true, fromModel: chain[last].modelId ?? chain[last].name, toModel: chain[j].modelId ?? chain[j].name };
    }
  }
  if (outcome.escalated) state.escalations += 1;
  return outcome;
}
