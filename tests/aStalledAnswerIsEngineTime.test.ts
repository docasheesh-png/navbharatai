/**
 * failedbr #696 (queue Q-3209): a notes app spent 29 minutes in six calls of 255–352 s that each ANSWERED with
 * 24–1360 tokens. The waste ledger counted only calls that failed, so none of that was engine time, and the user
 * was told "I stopped after about 29 min to avoid an endless loop — this build was not converging". There was no
 * loop: our engine was slow. A stalled answer is now engine time, and the ending says so.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyWasteLedger, recordWaste, engineTimeDominated, wasteSummary } from '../src/server/AgentV3/providerWaste';
import { isStalledTurn } from '../src/server/AgentV3/slowRungBench';
import { timedOutSummary } from '../src/server/AgentV3/buildAbortCause';

describe('a stalled answer is engine time', () => {
  it('the #696 calls are stalls by the bench\'s own test', () => {
    expect(isStalledTurn({ outputTokens: 24, observedMs: 255_000 })).toBe(true);
    expect(isStalledTurn({ outputTokens: 120, observedMs: 269_000 })).toBe(true);
  });

  it('six of them dominate a 29-minute build, so the ending blames the engine, not a loop', () => {
    const ledger = emptyWasteLedger();
    for (const ms of [157_000, 269_000, 255_000, 255_000, 258_000, 259_000]) recordWaste(ledger, 'GLM', 'stalled', ms);
    expect(engineTimeDominated(ledger, 1_740_000)).toBe(true);
    expect(wasteSummary(ledger, 1_740_000)).toContain('6 stalled');
    const ending = timedOutSummary(29, { builtSomething: true, providerFault: true });
    expect(ending).not.toMatch(/endless loop|not converging/);
  });

  it('wired: the runner\'s success path reports a stalled answer to the waste ledger', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/providers/MultiProviderTurnRunner.ts'), 'utf8');
    expect(src).toContain("opts.onAttemptWasted?.(reportName, 'stalled', Math.max(0, answeredInMs));");
  });
});
