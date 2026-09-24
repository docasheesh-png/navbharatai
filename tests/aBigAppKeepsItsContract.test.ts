/**
 * AUTOPSY 3ab93068 (2026-09-23), follow-up the admin approved on 2026-09-24.
 *
 * A complexity-68 app took the 240-second fast lane on a reasoning rung. The plan took 40 s, and the
 * shared contract (the one step that makes separately-written files agree on names and shapes) was cut
 * at 56 s by its share of that budget. The files then disagreed (`lat` vs `latitude`, an unexported
 * context), and three repair rounds spent 419 s, 63% of the lane, putting back what the contract would
 * have agreed. The report called the cut "build budget reached", 100 s into a 58-minute build.
 *
 * Locked here: (1) a COMPLEX lane gets a budget its contract fits in and is never talked out of the
 * contract; (2) an ordinary lane is unchanged; (3) the report names the contract's own clock.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fastLaneBudgetMs, FAST_LANE_BUDGET_MS, FAST_LANE_COMPLEX_BUDGET_MS, runSimpleBuild } from '../src/server/AgentV3/SimpleBuilder';
import { fastLanePhaseSummary } from '../src/server/AgentV3/fastLanePhases';

describe('the lane budget follows the request', () => {
  it('an ordinary request keeps the 240 s it has always had', () => {
    expect(FAST_LANE_BUDGET_MS).toBe(240_000);
    expect(fastLaneBudgetMs(false, { AGENTV3_FASTLANE_COMPLEX_SECONDS: '900' })).toBe(240_000);
  });

  it('a complex request gets room for its contract; the env tunes it, clamped, never unlimited', () => {
    expect(fastLaneBudgetMs(true, {})).toBe(FAST_LANE_COMPLEX_BUDGET_MS);
    expect(FAST_LANE_COMPLEX_BUDGET_MS).toBe(480_000);
    expect(fastLaneBudgetMs(true, { AGENTV3_FASTLANE_COMPLEX_SECONDS: '600' })).toBe(600_000);
    expect(fastLaneBudgetMs(true, { AGENTV3_FASTLANE_COMPLEX_SECONDS: '99999' })).toBe(900_000);
    expect(fastLaneBudgetMs(true, { AGENTV3_FASTLANE_COMPLEX_SECONDS: '10' })).toBe(240_000);
    expect(fastLaneBudgetMs(true, { AGENTV3_FASTLANE_COMPLEX_SECONDS: 'lots' })).toBe(480_000);
    expect(fastLaneBudgetMs(true, { AGENTV3_FASTLANE_COMPLEX_SECONDS: '   ' })).toBe(480_000);
  });
});

describe('a complex lane is never talked out of its contract', () => {
  const pathOf = (user: string) => (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'x';
  // A slow plan call: on a 2 s budget with three tiers the projection says a contract cannot be afforded.
  const run = (complex: boolean, contractMs = 0) => {
    let contractAsked = false;
    return runSimpleBuild({
      prompt: 'vendor app', framework: 'vite-react', scaffoldPaths: [], overallTimeoutMs: 2_000, complex,
      generate: async (system, user) => {
        if (user.includes('Plan the file list')) {
          await new Promise((r) => setTimeout(r, 500));
          return 'src/types.ts :: types\nsrc/Widget.tsx :: widget\nsrc/App.tsx :: root';
        }
        if (system.includes('SHARED CONTRACT')) {
          contractAsked = true;
          if (contractMs > 0) await new Promise((r) => setTimeout(r, contractMs));
          return 'export interface Vendor { id: string }';
        }
        const p = pathOf(user);
        return `<<<FILE ${p}>>>\nexport default function X(){return null}\n<<<ENDFILE>>>`;
      },
      writeFiles: async () => {},
    }).then((r) => ({ r, contractAsked }));
  };

  it('ordinary: the projection may skip the contract (today\'s behaviour, unchanged)', async () => {
    const { r, contractAsked } = await run(false);
    expect(contractAsked).toBe(false);
    expect(r.phases?.contractOutcome).toBe('skipped');
  });

  it('complex: the contract is asked for, even when the projection would have skipped it', async () => {
    const { contractAsked } = await run(true);
    expect(contractAsked).toBe(true);
  });

  it('a contract that runs to its own cap is reported as CUT at that cap — never as "the build budget"', async () => {
    const { r } = await run(true, 5_000); // hangs well past its ~300 ms share of a 2 s lane
    expect(r.phases?.contractOutcome).toBe('cut');
    expect(r.phases?.contractCapMs).toBeGreaterThan(0);
    const line = fastLanePhaseSummary(r.phases);
    expect(line).toMatch(/contract .* — stopped at its own .* cap, so the files were written without a shared contract/);
    expect(line).not.toMatch(/build budget/);
  });
});

describe('the report names the clock that ended the call', () => {
  const base = { planMs: 40_000, contractMs: 56_300, generateMs: 100_000, verifyMs: 6_000, repairMs: 419_000, verifyRuns: 4, repairRuns: 3, totalMs: 668_000 };
  it('says cut / failed / skipped in words, and stays silent when the contract was written', () => {
    expect(fastLanePhaseSummary({ ...base, contractOutcome: 'cut', contractCapMs: 56_300 })).toContain('stopped at its own 56.3s cap');
    expect(fastLanePhaseSummary({ ...base, contractOutcome: 'failed' })).toContain('came back with nothing usable');
    expect(fastLanePhaseSummary({ ...base, contractMs: 0, contractOutcome: 'skipped' })).toContain('contract skipped');
    expect(fastLanePhaseSummary({ ...base, contractOutcome: 'written' })).not.toMatch(/stopped|skipped|nothing usable/);
    expect(fastLanePhaseSummary(base)).not.toMatch(/stopped|skipped/); // an older ledger prints as before
  });

  it('the route hands the lane its complexity, and the clock line no longer claims a next engine was tried (source guard)', () => {
    const src = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(src).toMatch(/runSimpleBuild\(\{[^)]*complex: buildIsComplex/);
    expect(src).not.toContain('not by anything the engine did — moving to the next one');
  });
});
