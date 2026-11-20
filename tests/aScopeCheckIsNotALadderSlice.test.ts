/**
 * Q-2751 (autopsy 05eb30ba, build 7f11628a): LADDER_DEPTH counted the pre-build scope classification as a
 * "delivered slice" — "Finished on rung 1" — on a build that did nothing. Scope calls are now tagged PHASE_SCOPE
 * where they enter the provider ledger (billed exactly as before) and the ladder measure skips them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ladderDepthUsed, describeLadderDepth } from '../src/server/AgentV3/ladderDepth';
import { tierLadder } from '../src/server/AgentV3/tierLadder';
import { createProviderUsageLedger, UNATTRIBUTED_PROVIDER } from '../src/server/AgentV3/ProviderUsageLedger';
import { PHASE_SCOPE } from '../src/server/AgentV3/billingPhase';

const rungs = tierLadder('weak' as never).rungs;
const lead = rungs[0];

describe('a scope check is not a slice of the build', () => {
  it('the reported case: only the scope call delivered output → no rung used, said plainly', () => {
    const ledger = createProviderUsageLedger();
    ledger.add(lead.provider, { inputTokens: 900, outputTokens: 40 }, lead.model, { phase: PHASE_SCOPE });
    const d = ladderDepthUsed(ledger.entries(), rungs);
    expect(d.depth).toBeNull();
    expect(d.matched).toBe(0);
    expect(describeLadderDepth(d)).toBe('No call of this build delivered output, so no rung of the ladder was used.');
  });

  it('a real build turn still counts, beside a scope call', () => {
    const ledger = createProviderUsageLedger();
    ledger.add(lead.provider, { inputTokens: 900, outputTokens: 40 }, lead.model, { phase: PHASE_SCOPE });
    ledger.add(lead.provider, { inputTokens: 5000, outputTokens: 800 }, lead.model);
    const d = ladderDepthUsed(ledger.entries(), rungs);
    expect(d.depth).toBe(1);
    expect(d.matched).toBe(1);
  });

  it('the tag changes no bill: the ledger total is the same with or without it', () => {
    const a = createProviderUsageLedger(); const b = createProviderUsageLedger();
    a.add(lead.provider, { inputTokens: 900, outputTokens: 40 }, lead.model, { phase: PHASE_SCOPE });
    b.add(lead.provider, { inputTokens: 900, outputTokens: 40 }, lead.model);
    const sum = (l: ReturnType<typeof createProviderUsageLedger>) => l.entries().reduce((n, e) => n + e.usage.inputTokens + e.usage.outputTokens, 0);
    expect(sum(a)).toBe(sum(b));
  });

  it('both places a scope call enters the ledger carry the tag (census)', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain("providerLedger.add('GLM', usage, WEAK_SCOPE_MODEL, { phase: PHASE_SCOPE })");
    const r1 = readFileSync('src/server/AI/RouterOne/catalogueAccounting.ts', 'utf8');
    expect(r1).toMatch(/recordRouterOneScopeUsage[\s\S]{0,400}\{ phase: PHASE_SCOPE \}/);
  });
});

describe('known versus unknown', () => {
  it('output with no provider on record is still "unknown"; no output at all is said plainly', () => {
    const rows = [{ provider: UNATTRIBUTED_PROVIDER, usage: { outputTokens: 50 } }];
    const d = ladderDepthUsed(rows as never, rungs);
    expect(d.unattributedOutput).toBe(1);
    expect(describeLadderDepth(d)).toContain('unknown');
    expect(describeLadderDepth(ladderDepthUsed([], rungs))).toBe('No call of this build delivered output, so no rung of the ladder was used.');
  });
});
