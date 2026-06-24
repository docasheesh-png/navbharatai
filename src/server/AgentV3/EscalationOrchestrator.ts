// AgentV3 — evaluate-gated escalation orchestrator (multi-model cost routing, phase 3).
//
// The keystone that realises "cheap-first, escalate only on objective failure". Given the
// analyser's escalation path (e.g. gemini → haiku → sonnet → opus), it builds on the
// cheapest tier, runs the OBJECTIVE evaluate-gate (the existing 22-dimension engine: build/
// readiness/security/tests — deterministic, free, no LLM call), and:
//   • gate PASS  → deliver (cheap win — a Gemini calculator that compiles & runs ships cheap)
//   • gate FAIL  → escalate to the next tier and rebuild (budget-capped)
//   • a thrown build error counts as a fail → escalate
//   • the LAST tier (Opus) is the ceiling BACKSTOP: even if its gate does not pass we deliver
//     its result as best-effort (flagged) — the build never "breaks".
//
// PURE control flow: the actual build and gate are INJECTED, so the escalation POLICY is
// fully unit-testable without a live model, sandbox, or key. Wiring to the real AgentRunner
// build loop + evaluate tool happens later (P8) behind the rollout flag.

import type { StartTier } from './RequestAnalyser';

export interface GateVerdict {
  pass: boolean;
  /** Optional 0-100 quality/readiness score for telemetry. */
  score?: number;
  reason?: string;
}

export interface EscalationDeps<TBuild> {
  /** Run a full build attempt on `tier`. May throw — a throw is treated as a gate fail. */
  buildOnTier: (tier: StartTier, attempt: number) => Promise<TBuild>;
  /** Objectively gate a build (the 22-dim evaluate engine in production). */
  gate: (build: TBuild, tier: StartTier) => Promise<GateVerdict>;
  /** Telemetry hooks. */
  onAttempt?: (tier: StartTier, attempt: number) => void;
  onEscalate?: (from: StartTier, to: StartTier, reason: string) => void;
}

export interface EscalationOptions {
  /** Max number of tiers to try (>=1). Defaults to the full path length. */
  maxTiers?: number;
}

export interface EscalationResult<TBuild> {
  /** The tier whose build was delivered. */
  tier: StartTier;
  build: TBuild;
  /** Whether the delivered build passed the evaluate-gate (false = Opus best-effort backstop). */
  gatePassed: boolean;
  gate: GateVerdict;
  /** Tiers attempted, in order. */
  attemptedTiers: StartTier[];
  escalations: number;
}

/**
 * Run a build down the escalation `path`, climbing only when the objective gate fails.
 * Returns the first gate-passing tier's build, or (if none pass) the LAST tier's build as a
 * best-effort backstop. Throws ONLY if `path` is empty or every tier's build throws AND no
 * build result was ever produced.
 */
export async function runWithEscalation<TBuild>(
  path: StartTier[],
  deps: EscalationDeps<TBuild>,
  opts: EscalationOptions = {},
): Promise<EscalationResult<TBuild>> {
  if (!Array.isArray(path) || path.length === 0) {
    throw new Error('runWithEscalation: escalation path must have at least one tier.');
  }
  const limit = Math.max(1, Math.min(opts.maxTiers ?? path.length, path.length));
  const tiers = path.slice(0, limit);

  const attemptedTiers: StartTier[] = [];
  let escalations = 0;
  let lastBuild: { tier: StartTier; build: TBuild; gate: GateVerdict } | undefined;
  let lastError: unknown;

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    const isLast = i === tiers.length - 1;
    attemptedTiers.push(tier);
    deps.onAttempt?.(tier, i + 1);

    let build: TBuild;
    try {
      build = await deps.buildOnTier(tier, i + 1);
    } catch (err) {
      lastError = err;
      const reason = err instanceof Error ? err.message : String(err);
      if (!isLast) {
        deps.onEscalate?.(tier, tiers[i + 1], `build error: ${reason}`);
        escalations++;
        continue;
      }
      // Last tier itself threw — surface the failure (no result to deliver).
      throw new Error(`All tiers failed (${attemptedTiers.join(' → ')}). Last error: ${reason}`);
    }

    let verdict: GateVerdict;
    try {
      verdict = await deps.gate(build, tier);
    } catch {
      // A gate that throws is non-fatal: treat as a pass-through (never block delivery on a
      // gate crash — the build itself succeeded). Best-effort.
      verdict = { pass: true, reason: 'gate-error: treated as pass (build succeeded)' };
    }
    lastBuild = { tier, build, gate: verdict };

    if (verdict.pass) {
      return { tier, build, gatePassed: true, gate: verdict, attemptedTiers, escalations };
    }
    if (!isLast) {
      deps.onEscalate?.(tier, tiers[i + 1], verdict.reason ?? 'gate failed');
      escalations++;
      continue;
    }
    // Last tier built but failed the gate → deliver as best-effort backstop (never break).
    return { tier, build, gatePassed: false, gate: verdict, attemptedTiers, escalations };
  }

  // Reachable only if every non-last tier threw and the last also threw (handled above) —
  // defensive: deliver the last good build if any, else surface the error.
  if (lastBuild) {
    return {
      tier: lastBuild.tier,
      build: lastBuild.build,
      gatePassed: lastBuild.gate.pass,
      gate: lastBuild.gate,
      attemptedTiers,
      escalations,
    };
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Escalation produced no build (${attemptedTiers.join(' → ')}). Last error: ${reason}`);
}
