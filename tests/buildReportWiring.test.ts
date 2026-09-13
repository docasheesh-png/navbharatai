/**
 * The wiring, pinned — because dropping either line FAILS NOTHING.
 *
 * Both fixes below are observational: if the call is ever removed during a refactor, no test breaks, no
 * build fails and no error appears. The report simply goes quiet again and the next autopsy re-derives
 * the same wrong conclusion from the same missing numbers. `cachePrefixWiring.test.ts` exists for the
 * same reason and this follows it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

/** Strip comments so a doc block that MENTIONS a call cannot satisfy an assertion about the call. */
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const code = codeOnly(route);

describe('live token totals reach the report while the build is running', () => {
  it('captureTurnUsage snapshots the ledger into the diagnostics report', () => {
    expect(code).toMatch(/buildDiag\.setLiveUsage\(\s*providerLedger\.byProvider\(\)/);
  });

  it('it passes the running cache-hit total too, not just the provider split', () => {
    expect(code).toMatch(/setLiveUsage\(providerLedger\.byProvider\(\),\s*billingCtx\.cacheReadInputTokens\)/);
  });
});

describe('the engine chain is recorded', () => {
  it('buildTurnRunner hands the FINAL guarded chain to its caller', () => {
    // The guarded chain — never the pre-guard one, or a weak build would be reported as containing
    // a Sonnet rung that enforceNoClaude had already stripped.
    expect(code).toMatch(/opts\?\.onChain\?\.\(guardedChain/);
  });

  it('the main build client actually passes onChain through to the report', () => {
    expect(code).toMatch(/onChain:\s*\(chain\)\s*=>\s*\{[\s\S]{0,200}?buildDiag\.setProviderChain\(describeRunnerChain\(chain\),\s*chainProviders\(chain\)\)/);
  });
});

describe('the ETA record states what the user was shown', () => {
  it('ETA_BASIS carries the band, not only the midpoint', () => {
    expect(code).toMatch(/code: 'ETA_BASIS'[\s\S]{0,200}?formatEtaRange\(est\.lowMs, est\.highMs, est\.estimateMs\)/);
  });

  it('the line quoted in the report is the SAME string emitted to the user', () => {
    // One value, used twice — so the report cannot drift from the screen.
    expect(code).toMatch(/const etaShown = firstEtaLine\(est, past\.length\)/);
    expect(code).toMatch(/type: 'narration'[^\n]*text: etaShown/);
  });
});
