import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  applyGroundingBudget, groundingTokenBudget, groundingProvenance, dominantGroundingBlock,
  DEFAULT_GROUNDING_TOKEN_BUDGET, DOMINANT_BLOCK_RATIO,
} from '../src/server/AgentV3/contextBudget';
import { buildGroundedContext, lastGroundingCost } from '../src/server/AgentV3/ContextReranker';
import { estimateTokens } from '../src/server/AgentV3/TokenEstimator';

/**
 * ADMIN 2026-08-11: build the safe upgrades, spending as little of the admin's money as possible.
 *
 * This one does not merely avoid cost — it REMOVES cost, and costs nothing to run.
 *
 * WHY: tokens ARE the bill. An autopsy measured **776k input tokens to change 3 files**, and the
 * biggest single contributor was grounding — a minified React bundle ranked as the #1 "most relevant
 * existing file" and was re-sent in the preamble of ~26 calls (#2260). That culprit is now filtered
 * out, but a FILTER only answers "is this file bad?". A BUDGET answers "have we spent too much?" —
 * and only the second is a defence against the oversized file nobody predicted.
 */

/**
 * Realistic blocks: `estimateTokens` BLENDS chars/4 with words/0.75, so a single 400-char word costs
 * ~51 tokens, not 100. Grounding blocks are code with whitespace, so the tests use whitespace too —
 * an assertion built on the wrong cost model would pass while measuring nothing real.
 */
const block = (path: string, words: number) => ({ path, text: Array(words).fill('token').join(' ') });
const cost = (b: { text: string }) => estimateTokens(b.text);

describe('the budget spends on the most relevant first', () => {
  it('keeps blocks in order until the budget is gone, then drops the rest', () => {
    // Budget deliberately sized to fit exactly two of the three blocks.
    const [a, b, c] = [block('a', 100), block('b', 100), block('c', 100)];
    const r = applyGroundingBudget([a, b, c], cost(a) + cost(b));
    expect(r.kept.map((b) => b.path)).toEqual(['a', 'b']);
    expect(r.dropped.map((b) => b.path)).toEqual(['c']);
    expect(r.keptTokens).toBeLessThanOrEqual(r.budget);
    expect(r.droppedTokens).toBeGreaterThan(0);
  });

  it('ALWAYS keeps one block, even when it alone blows the budget', () => {
    /**
     * Returning an empty preamble because the single most relevant file is large would silently
     * remove the grounding a build most needs — and the model would read that file anyway through a
     * tool call, at the same token cost plus a round trip. Keeping it and REPORTING it is honest.
     */
    const r = applyGroundingBudget([block('huge', 5_000), block('b', 10)], 50);
    expect(r.kept.map((b) => b.path)).toEqual(['huge']);
    expect(r.keptTokens).toBeGreaterThan(r.budget);
  });

  it('never truncates a block mid-file', () => {
    // Half a function is worse than no function — a model will reason about the half it can see.
    const only = block('a', 1_000);
    const r = applyGroundingBudget([only], 50);
    expect(r.kept[0].text).toBe(only.text);
  });

  it('a budget of 0 means NO CAP — the escape hatch, not "ground nothing"', () => {
    const r = applyGroundingBudget([block('a', 1_000), block('b', 1_000)], 0);
    expect(r.kept).toHaveLength(2);
    expect(r.dropped).toEqual([]);
  });

  it('junk never throws', () => {
    expect(applyGroundingBudget([], 100).kept).toEqual([]);
    expect(applyGroundingBudget(undefined as any, 100).kept).toEqual([]);
    expect(applyGroundingBudget([{ path: 'a', text: '' } as any], 100).kept).toEqual([]);
  });
});

describe('the budget value', () => {
  it('defaults to a ceiling set by what grounding really needs', () => {
    // A healthy preamble of 3-5 snippets (~125 tokens each) lands well under 1k; 4,000 leaves room
    // for a genuinely large legitimate selection while cutting the runaway case by ~an order.
    expect(DEFAULT_GROUNDING_TOKEN_BUDGET).toBe(4_000);
    expect(groundingTokenBudget({})).toBe(4_000);
  });

  it('is tunable without a deploy, and junk falls back to the default', () => {
    expect(groundingTokenBudget({ AGENTV3_GROUNDING_TOKEN_BUDGET: '1200' })).toBe(1200);
    expect(groundingTokenBudget({ AGENTV3_GROUNDING_TOKEN_BUDGET: '0' })).toBe(0); // explicit "no cap"
    expect(groundingTokenBudget({ AGENTV3_GROUNDING_TOKEN_BUDGET: 'lots' })).toBe(4_000);
    expect(groundingTokenBudget({ AGENTV3_GROUNDING_TOKEN_BUDGET: '-5' })).toBe(4_000);
  });
});

describe('saying where the tokens went', () => {
  it('reports the cost even when NOTHING was dropped', () => {
    // The number nobody looks at is the number that grows.
    const r = applyGroundingBudget([block('a', 50)], 4_000);
    expect(groundingProvenance(r)).toMatch(/grounding: 1 file, ~\d+ tokens \(budget 4000\)/);
  });

  it('names what was dropped, bounded', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => block(n, 200));
    const p = groundingProvenance(applyGroundingBudget(many, 300));
    expect(p).toMatch(/dropped \d+ over budget 300/);
    expect(p).toMatch(/\+\d+ more/); // never an unbounded list of names
  });
});

describe('the #2260 shape, generalised', () => {
  it('flags ONE file dominating the preamble — by shape, not by name', () => {
    /**
     * A hand-maintained exclusion list only catches the files someone already thought of. Reporting
     * "one block is most of the preamble" catches the next minified bundle, in a directory nobody
     * predicted, without anyone editing a list.
     */
    const r = applyGroundingBudget([block('vendor.js', 2_000), block('App.tsx', 20)], 0);
    expect(dominantGroundingBlock(r)).toBe('vendor.js');
  });

  it('a healthy, balanced preamble is NOT flagged', () => {
    const r = applyGroundingBudget([block('a', 100), block('b', 100), block('c', 100)], 0);
    expect(dominantGroundingBlock(r)).toBeNull();
  });

  it('a single-file preamble is never "dominant" — there is nothing to dominate', () => {
    expect(dominantGroundingBlock(applyGroundingBudget([block('a', 1_000)], 0))).toBeNull();
    expect(DOMINANT_BLOCK_RATIO).toBeGreaterThan(0.5); // must mean "most of it", not "a lot of it"
  });
});

describe('WIRING — the real preamble is budgeted and its cost is recorded', () => {
  it('buildGroundedContext applies the budget and exposes what it cost', () => {
    const files: Record<string, string> = {
      'src/App.tsx': 'export function App() { return <Login /> }\n'.repeat(20),
      'src/Login.tsx': 'export function Login() { return null }\n'.repeat(20),
    };
    const out = buildGroundedContext(files, 'login');
    expect(out).toContain('RELEVANT EXISTING FILES');
    const cost = lastGroundingCost();
    expect(cost).not.toBeNull();
    expect(cost!.keptTokens).toBeGreaterThan(0);
    expect(cost!.budget).toBe(DEFAULT_GROUNDING_TOKEN_BUDGET);
  });

  it('the build records the cost on every build, and warns when it is lopsided', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain("code: 'GROUNDING_COST'");
    expect(route).toContain('groundingProvenance(cost)');
    expect(route).toContain('dominantGroundingBlock(cost)');
    // A dropped block or a dominant file is a warning; a clean preamble is just info.
    expect(route).toContain("severity: dominant || cost.dropped.length > 0 ? 'warning' : 'info'");
  });

  it('it can only ever SHRINK the hint — never fail a build', () => {
    // Grounding is a convenience the model is told to verify with read_file, so the worst case of
    // dropping a block is one extra tool call.
    const reranker = readFileSync(join(process.cwd(), 'src/server/AgentV3/ContextReranker.ts'), 'utf8');
    expect(reranker).toContain('budgeted.kept.map((b) => b.text)');
    expect(reranker).toContain('if (budgeted.kept.length === 0) return \'\';');
  });
});
