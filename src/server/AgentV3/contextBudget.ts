// A BUDGET FOR THE GROUNDING PREAMBLE — and an honest record of where the tokens went.
//
// ADMIN 2026-08-11, asked for safe upgrades that spend as little of the admin's money as possible.
// This one does not merely avoid cost; it REMOVES cost, and it costs nothing to run (pure arithmetic,
// no model call).
//
// WHY. Tokens ARE the bill. Autopsy 2026-08-10 measured **776k input tokens to change 3 files**, and
// the biggest single contributor was grounding: a minified React bundle ranked as the #1 "most
// relevant existing file" and was re-sent in the preamble of all ~26 calls (#2260). That specific hole
// is now plugged — `isGeneratedArtifact` + `looksMinified` keep build output out — but the SHAPE of
// the bug is still open: **nothing caps how much grounding costs, and nothing reports it.** A
// different oversized file, in a directory nobody thought to exclude, would do the same thing again.
// A filter answers "is this file bad?"; a budget answers "have we spent too much?" — and only the
// second one is a defence against the file nobody predicted.
//
// WHY IT CANNOT BREAK A BUILD. The budget only ever REMOVES blocks from a hint. Grounding is a
// convenience — the model is explicitly told to `read_file` for full content before editing — so the
// worst case of dropping a block is one extra tool call, while the worst case of NOT having a budget
// is what the autopsy measured. Blocks are dropped from the LEAST relevant end, never truncated
// mid-file: half a function is worse than no function, because a model will happily reason about the
// half it can see.
//
// PURE — no model, no clock, no I/O.

import { estimateTokens } from './TokenEstimator';

/**
 * The ceiling for the whole grounding preamble, in tokens.
 *
 * Set from what grounding legitimately needs, not from what the model can hold: at the current
 * `snippetAround` cap (~500 chars ≈ 125 tokens) a healthy preamble of 3–5 files lands well under 1k.
 * 4,000 leaves generous room for a genuinely large, legitimate selection while still cutting off the
 * runaway case by an order of magnitude. Env-tunable so it can be tightened without a deploy; 0 or
 * junk disables the cap, which is the honest escape hatch rather than a hidden minimum.
 */
export const DEFAULT_GROUNDING_TOKEN_BUDGET = 4_000;

export function groundingTokenBudget(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.AGENTV3_GROUNDING_TOKEN_BUDGET);
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_GROUNDING_TOKEN_BUDGET;
  return Math.floor(raw);
}

export interface BudgetedBlock {
  /** The file this block grounds, for the provenance line. */
  path: string;
  text: string;
}

export interface BudgetResult {
  kept: BudgetedBlock[];
  dropped: BudgetedBlock[];
  keptTokens: number;
  droppedTokens: number;
  budget: number;
}

/**
 * Keep blocks in the order given (most relevant first) until the budget is spent.
 *
 * ONE BLOCK IS ALWAYS KEPT, even if it alone exceeds the budget. Returning an empty preamble because
 * the single most relevant file is large would silently remove the grounding a build most needs — and
 * the model would then read the same file anyway, through a tool call, at the same token cost plus a
 * round trip. Keeping it and REPORTING the overrun is the honest outcome.
 *
 * A budget of 0 means "no cap" — the escape hatch, not a way to accidentally ground nothing.
 */
export function applyGroundingBudget(blocks: readonly BudgetedBlock[], budget: number): BudgetResult {
  const list = (blocks ?? []).filter((b) => b && typeof b.text === 'string' && b.text.length > 0);
  const cap = Number.isFinite(budget) && budget > 0 ? Math.floor(budget) : 0;
  if (cap === 0) {
    const all = [...list];
    return { kept: all, dropped: [], keptTokens: totalTokens(all), droppedTokens: 0, budget: 0 };
  }

  const kept: BudgetedBlock[] = [];
  const dropped: BudgetedBlock[] = [];
  let spent = 0;
  for (const b of list) {
    const cost = estimateTokens(b.text);
    // The first block is always affordable — see the note above.
    if (kept.length === 0 || spent + cost <= cap) {
      kept.push(b);
      spent += cost;
    } else {
      dropped.push(b);
    }
  }
  return { kept, dropped, keptTokens: spent, droppedTokens: totalTokens(dropped), budget: cap };
}

function totalTokens(blocks: readonly BudgetedBlock[]): number {
  return blocks.reduce((n, b) => n + estimateTokens(b.text), 0);
}

/**
 * One line saying where the grounding tokens went.
 *
 * Recorded on EVERY build, not only when something is dropped, because the number nobody looks at is
 * the number that grows. "Tokens are the bill" was learned from an autopsy; a standing line in the
 * report is what turns that lesson into something anyone can notice next time.
 */
export function groundingProvenance(r: BudgetResult): string {
  const base = `grounding: ${r.kept.length} file${r.kept.length === 1 ? '' : 's'}, ~${r.keptTokens} tokens`;
  if (r.dropped.length === 0) {
    return r.budget > 0 ? `${base} (budget ${r.budget})` : `${base} (no budget)`;
  }
  const names = r.dropped.slice(0, 3).map((b) => b.path).join(', ');
  const more = r.dropped.length > 3 ? ` +${r.dropped.length - 3} more` : '';
  return `${base}; dropped ${r.dropped.length} over budget ${r.budget} (~${r.droppedTokens} tokens: ${names}${more})`;
}

/**
 * Did one file dominate the preamble? That is the #2260 shape, generalised.
 *
 * A single block taking most of the budget is the signature of an oversized file that slipped every
 * filter — the minified-bundle case, or the next one like it. Reporting it by SHAPE rather than by
 * name is what makes this a defence against the file nobody predicted, instead of one more
 * hand-maintained exclusion list.
 */
export const DOMINANT_BLOCK_RATIO = 0.6;

export function dominantGroundingBlock(r: BudgetResult): string | null {
  if (r.kept.length < 2 || r.keptTokens <= 0) return null;
  for (const b of r.kept) {
    if (estimateTokens(b.text) / r.keptTokens >= DOMINANT_BLOCK_RATIO) return b.path;
  }
  return null;
}
