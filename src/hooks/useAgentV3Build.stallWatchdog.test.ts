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
