// failedbr #1319, #1263, #1277, #1352 (2026-11-20): TIME_TO_FIRST_CALL said "4.6s is outside every timed step (largest: 4.4s
// after "Personal context loaded")". The project-memory warm-up (capped at 8 s) and the edit-turn ad read ran there, untimed.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

describe('the wait before the first call is named (failedbr #1319)', () => {
  it('a slow step becomes a SETUP_TIMING line; an instant one writes nothing', () => {
    let now = 10_000;
    const d = new BuildDiagnostics({ now: () => now });
    now = 14_400;
    d.recordSetupTimingIfSlow({ startMs: 10_000, message: (ms) => `Project memory restored and indexed in ${ms}ms` });
    d.recordSetupTimingIfSlow({ startMs: 14_390, message: (ms) => `Existing app read for ad facts in ${ms}ms` });
    const lines = d.report().issues.filter((i) => i.code === 'SETUP_TIMING').map((i) => i.message);
    expect(lines).toEqual(['Project memory restored and indexed in 4400ms']);
  });
  it('🔒 the route times both steps', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toMatch(/recordSetupTimingIfSlow\(\{ startMs: memoryT0, message: \(ms\) => `Project memory restored and indexed/);
    expect(route).toMatch(/recordSetupTimingIfSlow\(\{ startMs: adFactsT0, message: \(ms\) => `Existing app read for ad facts/);
  });
});
