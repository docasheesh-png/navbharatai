// Autopsy 2f46a4d8 (2026-10-18): GREEN at 231 s, then the build sat open on an unanswered bug-hunt offer. Owner: cut it.
import { describe, it, expect, afterEach } from 'vitest';
import { BUG_HUNT_WAIT_MS, bugHuntWaitMs } from '../src/server/AgentV3/optionalBugHunt';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe('a finished build is not held open long for the bug-hunt offer', () => {
  it('default wait is 30 s (was 90 s)', () => {
    expect(BUG_HUNT_WAIT_MS).toBe(30_000);
    expect(bugHuntWaitMs({})).toBe(30_000);
  });
  it('env override, clamped 5–120 s; junk falls back', () => {
    expect(bugHuntWaitMs({ AGENTV3_BUG_HUNT_WAIT_MS: '45000' })).toBe(45_000);
    expect(bugHuntWaitMs({ AGENTV3_BUG_HUNT_WAIT_MS: '10' })).toBe(5_000);
    expect(bugHuntWaitMs({ AGENTV3_BUG_HUNT_WAIT_MS: '999999' })).toBe(120_000);
    expect(bugHuntWaitMs({ AGENTV3_BUG_HUNT_WAIT_MS: 'x' })).toBe(30_000);
  });
});
