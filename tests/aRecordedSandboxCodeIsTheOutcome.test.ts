// 🔴 failedbr #2449 (dcb9175e, 2026-11-18): E2B's 20-concurrent-sandbox cap refused setup; the run recorded
// SANDBOX_UNAVAILABLE and SANDBOX_ADMISSION_EXHAUSTED, stopped — and was stamped OUTCOME_UNEXPLAINED ("the engine did
// not record why"). Both terminal-outcome callers now hand the recorded codes over. Reversion: drop the `codes` check
// in terminalOutcomeCode, or the `codes:` argument at either call site, and this fails.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { terminalOutcomeCode } from '../src/server/AgentV3/buildOutcomeSummaries';

const SUMMARY = 'Workspace admission is still unavailable after a recovery attempt. Stopping this attempt without completing the app; no capacity, quota or machine was changed. Existing files are kept. Try again when workspace capacity is available.';
const NOTE = "Note: the build engine is temporarily unavailable — I'm still trying to start it and will write your files as soon as I can. You don't need to start the build again.";

describe('a recorded sandbox code is the outcome', () => {
  it('the #2449 run: SANDBOX_UNAVAILABLE + SANDBOX_ADMISSION_EXHAUSTED ⇒ OUTCOME_SANDBOX_UNAVAILABLE', () => {
    expect(terminalOutcomeCode({ messages: [SUMMARY, NOTE], codes: ['BUILD_STARTED', 'SANDBOX_UNAVAILABLE', 'AGENT_NOTE', 'SANDBOX_ADMISSION_EXHAUSTED', 'RELEASE_GATE'] }))
      .toBe('OUTCOME_SANDBOX_UNAVAILABLE');
    expect(terminalOutcomeCode({ codes: ['SANDBOX_ADMISSION_EXHAUSTED'] })).toBe('OUTCOME_SANDBOX_UNAVAILABLE');
  });

  it('a provider ending still wins, and a run with no reason is still unexplained', () => {
    expect(terminalOutcomeCode({ messages: ['The build step timed out'], codes: ['SANDBOX_UNAVAILABLE'] })).toBe('OUTCOME_ENGINE_TIMEOUT');
    expect(terminalOutcomeCode({ messages: [SUMMARY], codes: ['BUILD_STARTED', 'RELEASE_GATE'] })).toBe('OUTCOME_UNEXPLAINED');
  });

  it('both callers in the route pass the recorded codes', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    const calls = src.match(/terminalOutcomeCode\(\{[\s\S]{0,400}?\}\)/g) ?? [];
    expect(calls.length).toBe(2);
    for (const c of calls) expect(c).toMatch(/codes:/);
  });
});
