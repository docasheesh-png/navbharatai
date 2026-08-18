// P-PE.4 — Pre-call token estimator (dependency-free).
//
// Token spend was only tracked post-hoc. This gives a fast, zero-dependency PRE-call estimate so the
// build can warn when the assembled prompt is near the model's context window (and decide whether to
// compress before calling). We deliberately do NOT add `tiktoken` (a heavy native dep, against the
// dependency-free policy) — a calibrated char/word heuristic is accurate enough for a near-limit guard
// and runs in well under 1ms. Pure → unit-tested.

/** Approx model context windows (input tokens). Claude family ≈ 200k; conservative default. */
const MODEL_LIMITS: Array<{ re: RegExp; limit: number }> = [
  { re: /opus|sonnet|haiku|claude/i, limit: 200_000 },
  { re: /gpt-4o|gpt-4-turbo/i, limit: 128_000 },
  { re: /gemini.*1\.5|gemini.*pro/i, limit: 1_000_000 },
  { re: /grok/i, limit: 131_072 },
  // B5.2/K2 lead most builds now (Model Routing Policy), so leaving them on the 200k DEFAULT would
  // OVER-state how much room a build has and warn too late — the one direction that actually hurts.
  // Kimi's 256k is documented in CLAUDE.md; GLM's is not verifiable here, so it takes the conservative
  // 128k. Under-stating a window warns early (harmless); over-stating warns after the failure.
  { re: /kimi/i, limit: 256_000 },
  { re: /glm/i, limit: 128_000 },
];
const DEFAULT_LIMIT = 200_000;

/** Context-window limit (tokens) for a model name. Pure. */
export function modelContextLimit(model: string | null | undefined): number {
  const m = String(model || '');
  for (const { re, limit } of MODEL_LIMITS) if (re.test(m)) return limit;
  return DEFAULT_LIMIT;
}

/**
 * Estimate token count for a text blob. Blends the two standard rough rules — ~4 chars/token and
 * ~0.75 words/token — which together track real BPE tokenization well for mixed prose+code, then
 * rounds up. Pure; never throws.
 */
export function estimateTokens(text: string | null | undefined): number {
  const s = String(text || '');
  if (s.length === 0) return 0;
  const byChars = s.length / 4;
  const words = s.split(/\s+/).filter(Boolean).length;
  const byWords = words / 0.75;
  // Average the two estimates (each alone is biased; the blend is steadier across prose vs code).
  return Math.ceil((byChars + byWords) / 2);
}

export interface MessageLike {
  role?: string;
  content?: unknown;
}

/** Estimate tokens across a message array (+ a small per-message structural overhead). Pure. */
export function estimateMessagesTokens(messages: MessageLike[] | null | undefined): number {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const m of messages) {
    const c = m?.content;
    if (typeof c === 'string') total += estimateTokens(c);
    else if (Array.isArray(c)) {
      for (const part of c) {
        if (typeof part === 'string') total += estimateTokens(part);
        else if (part && typeof part === 'object' && typeof (part as any).text === 'string') {
          total += estimateTokens((part as any).text);
        }
      }
    }
    total += 4; // per-message role/framing overhead
  }
  return total;
}

export interface ContextUsage {
  tokens: number;
  limit: number;
  /** Fraction of the window used (0..1+). */
  ratio: number;
  /** True once usage crosses the warn threshold (default 80%). */
  nearLimit: boolean;
  /** True once usage is at/over the window. */
  overLimit: boolean;
}

/** Compute context-window usage for an estimated token count against a model. Pure. */
export function contextUsage(tokens: number, model: string | null | undefined, warnRatio = 0.8): ContextUsage {
  const limit = modelContextLimit(model);
  const ratio = limit > 0 ? tokens / limit : 0;
  return {
    tokens,
    limit,
    ratio: Math.round(ratio * 1000) / 1000,
    nearLimit: ratio >= warnRatio,
    overLimit: ratio >= 1,
  };
}
