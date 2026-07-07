import { describe, it, expect } from 'vitest';
import { stallWatchdogAction } from './useAgentV3Build';

describe('stallWatchdogAction — never show "stopped responding" on a build that already finished', () => {
  it('build still alive server-side → reconnect (reattach the quiet stream)', () => {
    expect(stallWatchdogAction({ alive: true, sawResult: false })).toBe('reconnect');
    // Alive wins even if a prior result was seen (a follow-up build could be running).
    expect(stallWatchdogAction({ alive: true, sawResult: true })).toBe('reconnect');
  });

  it('build gone BUT terminal result already seen → finish cleanly, NO error (the 10m/98-step bug)', () => {
    // The exact regression: a successful landing page ("Done · 98 steps") whose silent post-build
    // reviewer went quiet past the stall window must NOT be reported as "stopped responding".
    expect(stallWatchdogAction({ alive: false, sawResult: true })).toBe('finish');
  });

  it('build gone AND no terminal result → the honest "stopped responding" error', () => {
    expect(stallWatchdogAction({ alive: false, sawResult: false })).toBe('error');
  });
});

describe('shouldAutoContinue (VAJRA V4-1a) — an interrupted build resumes itself, exactly once', () => {
  it('the network-cut/deploy-kill case: gone + no result + a prompt to continue → auto-continue', async () => {
    const { shouldAutoContinue } = await import('./useAgentV3Build');
    expect(shouldAutoContinue({ sawResult: false, alreadyContinued: false, hasLastPrompt: true })).toBe(true);
  });
  it('never loops: a second death of the same turn falls back to the honest error', async () => {
    const { shouldAutoContinue } = await import('./useAgentV3Build');
    expect(shouldAutoContinue({ sawResult: false, alreadyContinued: true, hasLastPrompt: true })).toBe(false);
  });
  it('never fires after a finished build or with nothing to continue', async () => {
    const { shouldAutoContinue } = await import('./useAgentV3Build');
    expect(shouldAutoContinue({ sawResult: true, alreadyContinued: false, hasLastPrompt: true })).toBe(false);
    expect(shouldAutoContinue({ sawResult: false, alreadyContinued: false, hasLastPrompt: false })).toBe(false);
  });
});
