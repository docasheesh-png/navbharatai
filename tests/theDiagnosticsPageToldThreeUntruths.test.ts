import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseKeyPool, firstPoolKey, nextPoolKey, _resetKeyPoolCursors } from '../src/server/lib/keyPool';
import { GlmProvider } from '../src/server/AI/Router/providers/GlmProvider';
import {
  foldCostTelemetry, buildUsageReport, summarizeLosses, matchedMarginSlice,
  type CostTelemetryEntry, type DailyCostTelemetryDoc,
} from '../src/server/AgentV3/AgentV3CostTelemetry';
import { sonnetEquivalentUsd } from '../src/server/AgentV3/pricing';
import { latestDay } from '../src/components/admin/EngineReportsPanel';

/**
 * The admin Diagnostics page, 2026-09-27, read against the code. Three numbers on it were false.
 *
 *   1. PROVIDER STATUS "GLM 8 requests · 8 errors" and ASSISTANT SPEND "0% free". `GLM_API_KEY` is a
 *      comma-separated POOL (51 Z.ai keys). The build engine parses it; the free CHAT provider and
 *      the free VISION rung sent the whole string as ONE bearer token, so every free turn was refused
 *      and fell through to a paid rung. The fallback worked, so nothing looked broken.
 *   2. ABSORBED LOSSES "Real cost absorbed $570.09" while the usage card said the same 208 builds cost
 *      $1.30. The $570 is the top-engine BASELINE; and ENGINE USAGE printed a "$294.99 margin" as the
 *      bill of all 508 builds minus the spend of the 28 that recorded one.
 *   3. DAILY METRICS "Latest day 2026-08-28" on 2026-09-27 — the store returns newest first and the
 *      card took the last element.
 */

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('1 · a pooled key is a pool everywhere it is read', () => {
  const saved = process.env.GLM_API_KEY;
  beforeEach(() => _resetKeyPoolCursors());
  afterEach(() => { if (saved === undefined) delete process.env.GLM_API_KEY; else process.env.GLM_API_KEY = saved; });

  it('parses commas, whitespace and newlines, drops blanks, de-dupes in first-seen order', () => {
    expect(parseKeyPool('k1,k2 k3\nk2,, ')).toEqual(['k1', 'k2', 'k3']);
    expect(parseKeyPool(undefined)).toEqual([]);
    expect(parseKeyPool('  single  ')).toEqual(['single']);
  });

  it('firstPoolKey never returns the comma string itself', () => {
    expect(firstPoolKey('a,b,c')).toBe('a');
    expect(firstPoolKey(' a b')).toBe('a');
    expect(firstPoolKey('')).toBe('');
  });

  it('nextPoolKey rotates round-robin across the pool', () => {
    const env = 'a,b,c';
    expect([nextPoolKey(env), nextPoolKey(env), nextPoolKey(env), nextPoolKey(env)]).toEqual(['a', 'b', 'c', 'a']);
    expect(nextPoolKey('')).toBe('');
  });

  it('the free chat provider sends ONE key per call — never the comma string — and rotates', () => {
    process.env.GLM_API_KEY = 'zk-one,zk-two';
    const p = new GlmProvider() as any;
    const first = p.client.apiKey;
    const second = p.client.apiKey;
    expect([first, second]).toEqual(['zk-one', 'zk-two']);
    expect(first).not.toContain(',');
  });

  it('a pool counts as configured; a blank value does not', async () => {
    process.env.GLM_API_KEY = 'a, b';
    expect(await new GlmProvider().healthCheck()).toBe(true);
    process.env.GLM_API_KEY = ' , ';
    expect(await new GlmProvider().healthCheck()).toBe(false);
  });

  it('no reader of the GLM key hands the raw env to a client (source guard)', () => {
    // tsc and vitest cannot see that a string is a list — that is exactly how this shipped.
    for (const file of [
      'src/server/AI/Router/providers/GlmProvider.ts',
      'src/server/lib/visionChain.ts',
      'src/server/lib/mobileBuildAiRepair.ts',
    ]) {
      const code = stripComments(read(file));
      expect(code, `${file} must read the pool through lib/keyPool.ts`).toMatch(/from '[^']*keyPool'/);
      expect(code, `${file} must not pass process.env.GLM_API_KEY straight to a client`).not.toMatch(/apiKey:\s*process\.env\.GLM_API_KEY/);
    }
    expect(stripComments(read('src/server/lib/mobileBuildAiRepair.ts'))).not.toMatch(/split\(',\'\)\[0\]/);
  });
});

const BASE: CostTelemetryEntry = {
  taskType: 'app', startTier: 'weak', billedUsd: 1, inputTokens: 1000, outputTokens: 100,
  ok: true, powerMode: false, durationMs: 1000,
};
function fold(entries: CostTelemetryEntry[], date = '2026-09-27'): DailyCostTelemetryDoc {
  let doc: DailyCostTelemetryDoc | null = null;
  for (const e of entries) doc = foldCostTelemetry(doc, date, e, 1);
  return doc as DailyCostTelemetryDoc;
}

describe('2 · the margin and the losses describe ONE set of builds', () => {
  it('margin = bill of the measured builds − their spend, never bill-of-all − spend-of-some', () => {
    // The admin's shape in miniature: many builds billed, few costed.
    const doc = fold([
      { ...BASE, billedUsd: 0.5, realCostUsd: 0.1, sandboxUsd: 0 },
      { ...BASE, billedUsd: 10 },
      { ...BASE, billedUsd: 10 },
    ]);
    const r = buildUsageReport([doc], sonnetEquivalentUsd);
    expect(r.totalBilledUsd).toBeCloseTo(20.5, 6);
    expect(r.marginBuilds).toBe(1);
    expect(r.marginBilledUsd).toBeCloseTo(0.5, 6);
    expect(r.realMarginUsd).toBeCloseTo(0.4, 6);
  });

  it('an OLD day (no measuredBilledUsd) is matched only when every build on it was measured', () => {
    const full: DailyCostTelemetryDoc = { ...fold([{ ...BASE, billedUsd: 3, realCostUsd: 1 }]) };
    delete (full as any).measuredBilledUsd;
    expect(matchedMarginSlice(full)).toEqual({ builds: 1, billedUsd: 3, spendUsd: 1 });

    const partial: DailyCostTelemetryDoc = { ...fold([{ ...BASE, billedUsd: 3, realCostUsd: 1 }, { ...BASE, billedUsd: 5 }]) };
    delete (partial as any).measuredBilledUsd;
    expect(matchedMarginSlice(partial)).toBeNull();
    // …and a window of only such days shows NO margin, rather than an invented one.
    expect(buildUsageReport([partial], sonnetEquivalentUsd).realMarginUsd).toBeNull();
  });

  it('"Real cost absorbed" is what the zeroed builds really cost — the baseline is kept, labelled', () => {
    const doc = fold([
      { ...BASE, billedUsd: 0, wasLoss: true, lossRealCostUsd: 3.0, realCostUsd: 0.006, sandboxUsd: 0.004 },
      { ...BASE, billedUsd: 0, wasLoss: true, lossRealCostUsd: 2.5 },
    ]);
    const s = summarizeLosses([doc]);
    expect(s.totalLossBuilds).toBe(2);
    expect(s.lossMeasuredBuilds).toBe(1);
    expect(s.totalLossSpendUsd).toBeCloseTo(0.01, 6);
    expect(s.totalLossBaselineUsd).toBeCloseTo(5.5, 6);
    expect(s.totalLossSpendUsd!).toBeLessThan(s.totalLossBaselineUsd);
  });

  it('a window with no measured loss build says null, never $0', () => {
    const s = summarizeLosses([fold([{ ...BASE, billedUsd: 0, wasLoss: true, lossRealCostUsd: 2 }])]);
    expect(s.totalLossSpendUsd).toBeNull();
    expect(s.lossMeasuredBuilds).toBe(0);
  });

  it('the losses route and card read the measured figure (source guard)', () => {
    expect(stripComments(read('src/server/routes/admin.ts'))).toMatch(/res\.json\(summarizeLosses\(history\)\)/);
    const card = stripComments(read('src/components/admin/EngineReportsPanel.tsx'));
    expect(card).toMatch(/label="Real cost absorbed" value=\{usd\(d\?\.totalLossSpendUsd\)\}/);
    expect(card).not.toMatch(/label="Real cost absorbed" value=\{usd\(d\.totalLossRealCostUsd\)\}/);
  });
});

describe('3 · "Latest day" is the newest day, whatever order the store returns', () => {
  it('picks the maximum date from a newest-first list', () => {
    const hist = [{ date: '2026-09-27' }, { date: '2026-09-10' }, { date: '2026-08-28' }];
    expect(latestDay(hist)?.date).toBe('2026-09-27');
  });
  it('and from an oldest-first list, and skips rows with no date', () => {
    expect(latestDay([{ date: '2026-08-28' }, {}, { date: '2026-09-27' }])?.date).toBe('2026-09-27');
    expect(latestDay([])).toBeNull();
  });
});
