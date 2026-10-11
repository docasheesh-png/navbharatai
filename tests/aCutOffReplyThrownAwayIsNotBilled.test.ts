// A CUT-OFF REPLY THAT IS THROWN AWAY IS NOT BILLED (admin 2026-10-11, Q-166: "output that is discarded as
// truncated is not billed").
//
// When a reply hits the output limit, the platform sometimes keeps it (a continuation picks it up, a buffered
// write is resumed, a written file is repaired) and sometimes THROWS IT AWAY: a write that arrived with no
// content, a file sent as text the build loop never writes, a fast-lane file still half-written after its
// last continuation, a planner reply too cut off to read. Those files are then asked for again, and the user
// paid for them twice. THE CLASS: output the platform discarded, billed as if it had been used. The output of
// such a call now goes into the ledger's `unbilled` subset — the same place a starved turn's tokens go — with
// its own count, so the report can say which rule left it out. The input stays billed: the prompt was read.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { turnDiscardedTruncatedOutput, lostTruncatedOutput } from '../src/server/AgentV3/TruncationRecovery';
import { createProviderUsageLedger } from '../src/server/AgentV3/ProviderUsageLedger';
import { billableEntries, splitUnbilledCost, absorbedWorkDetail } from '../src/server/AgentV3/unbilledTurns';
import { usageCostUsd, realRateFor } from '../src/server/AgentV3/providerRates';
import { PARTIAL_CONTENT_KEY } from '../src/server/AgentV3/reliability/resumeWrite';

const cut = (toolUses: Array<{ name: string; input: unknown }>, text = '') => ({ text, toolUses, truncated: true, stopReason: 'max_tokens' });
const GLM = 'glm-5.3';
const TURN = { inputTokens: 20_000, outputTokens: 8_000 };

describe('what counts as thrown away — the truncation guard\'s own sorting', () => {
  it('🔒 a write cut off with no content, and a file sent as text, are discarded', () => {
    expect(turnDiscardedTruncatedOutput(cut([{ name: 'write_file', input: { path: 'src/App.tsx' } }]), false)).toBe(true);
    expect(turnDiscardedTruncatedOutput(cut([{ name: 'write_files_batch', input: { files: [{ path: 'a.ts', content: 'x' }, { path: 'b.ts' }] } }]), false)).toBe(true);
    expect(turnDiscardedTruncatedOutput(cut([], '<<<FILE src/App.tsx>>>\nexport default function App() {'), false)).toBe(true);
  });

  it('🔒 a cut-off reply the platform KEEPS is billed as before', () => {
    // written whole (and repaired later if it does not parse)
    expect(turnDiscardedTruncatedOutput(cut([{ name: 'write_file', input: { path: 'a.ts', content: 'export const a = 1' } }]), false)).toBe(false);
    // buffered and resumed with append_file — kept when resuming is on, lost when it is off
    const buffered = cut([{ name: 'write_file', input: { path: 'a.ts', [PARTIAL_CONTENT_KEY]: 'export const' } }]);
    expect(turnDiscardedTruncatedOutput(buffered, true)).toBe(false);
    expect(turnDiscardedTruncatedOutput(buffered, false)).toBe(true);
    // not cut off at all
    expect(turnDiscardedTruncatedOutput({ text: '', toolUses: [{ name: 'write_file', input: { path: 'a.ts' } }], truncated: false, stopReason: 'tool_use' }, false)).toBe(false);
    // a starved turn is the OTHER rule (producedNothing), never both
    expect(turnDiscardedTruncatedOutput(cut([]), false)).toBe(false);
  });

  it('the guard and the bill read one sorting: a path written whole is not lost', () => {
    const lost = lostTruncatedOutput(cut([
      { name: 'write_file', input: { path: 'a.ts', content: 'x' } },
      { name: 'write_file', input: { path: 'b.ts' } },
    ], '<<<FILE a.ts>>>\nx'), false);
    expect(lost.truncatedToolPaths).toEqual(['b.ts']);
    expect(lost.textMarkerPaths).toEqual([]);
    expect(Object.keys(lost.written)).toEqual(['a.ts']);
  });
});

describe('the ledger leaves the OUTPUT out of the bill, and keeps paying for it', () => {
  it('🔒 a discarded turn: real cost unchanged, bill loses exactly its output', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('GLM', TURN, GLM, { discardedOutput: true });
    const [e] = ledger.entries();
    expect(e.usage).toEqual(TURN); // we paid it
    expect(e.unbilled).toEqual({ inputTokens: 0, outputTokens: 8_000, discardedOutputTokens: 8_000 });
    expect(billableEntries(ledger.entries())[0].usage).toEqual({ inputTokens: 20_000, outputTokens: 0 });
    const rate = realRateFor('GLM', GLM);
    const split = splitUnbilledCost(ledger.entries());
    expect(split.realCostUsd).toBeCloseTo(usageCostUsd(TURN, rate), 12);
    expect(split.absorbedCostUsd).toBeCloseTo(usageCostUsd({ inputTokens: 0, outputTokens: 8_000 }, rate), 12);
  });

  it('🔒 a lane can say it afterwards — into the same slice, and only where tokens were added', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('KIMI', TURN, 'kimi-k3', { phase: 'build' });
    ledger.discardOutput('KIMI', 'kimi-k3', 8_000, { phase: 'build' });
    ledger.discardOutput('KIMI', 'kimi-k3', 8_000); // no slice outside the phase — nothing to leave out
    ledger.discardOutput('GLM', GLM, 8_000);        // never added — nothing to leave out
    expect(ledger.entries()).toEqual([
      { provider: 'KIMI', model: 'kimi-k3', phase: 'build', usage: TURN, unbilled: { inputTokens: 0, outputTokens: 8_000, discardedOutputTokens: 8_000 } },
    ]);
  });

  it('a turn that is not discarded is billed byte-for-byte as before', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('GLM', TURN, GLM);
    expect(ledger.entries()[0].unbilled).toBeUndefined();
  });

  it('the report names the rule that fired, and not the starved-turn rule', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('GLM', TURN, GLM, { discardedOutput: true });
    const why = absorbedWorkDetail(ledger.entries());
    expect(why).toMatch(/cut off at the output limit and thrown away/);
    expect(why).not.toMatch(/starved/);
    ledger.add('GLM', { inputTokens: 5, outputTokens: 5 }, GLM, { producedNothing: true });
    expect(absorbedWorkDetail(ledger.entries())).toMatch(/starved[\s\S]*thrown away/);
  });
});

describe('🔒 every place that throws a cut-off reply away tells the ledger', () => {
  const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const route = code('src/server/routes/agentv3.ts');

  it('the build loop: the provider chain marks the turn with the guard\'s own predicate', () => {
    const chain = code('src/server/AgentV3/providers/MultiProviderTurnRunner.ts');
    expect(chain).toContain('...(turnDiscardedTruncatedOutput(result) ? { discardedOutput: true as const } : {}),');
    expect(route).toContain("...(usage.discardedOutput === true ? { discardedOutput: true } : {})");
    // and the guard keeps no private copy of the sorting
    const runner = code('src/server/AgentV3/AgentRunner.ts');
    expect(runner).toContain('lostTruncatedOutput(turn, resumeTruncatedEnabled())');
    expect(runner).not.toContain('PARTIAL_CONTENT_KEY');
  });

  it('every cut-off detector in the route is followed by a discard', () => {
    // The three ways the route recognises a reply it is about to throw away. A NEW use of one without a
    // discard right behind it fails here.
    for (const detector of ['unterminatedTailPath(text)', 'roadmapUnparseableDetail(', 'unusablePlanCause(']) {
      let at = route.indexOf(detector);
      expect(at, detector).toBeGreaterThan(-1);
      while (at > -1) {
        expect(route.slice(at, at + 700), detector).toContain('discardTurnOutput(');
        at = route.indexOf(detector, at + 1);
      }
    }
  });
});
