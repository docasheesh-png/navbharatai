// BR1961 (report cd970693, 2026-11-08) — setup hit E2B's cap of 20 concurrent sandboxes.
// sandboxUnavailableNotice told the user they could not create files and should "try building again
// in a little while". The build then continued for 20 minutes (fast lane wasted, then the full
// builder recovered) and delivered an app. A second Start from that goodbye would have consumed
// another sandbox slot and made the cap worse.
//
// After #4124 the fast lane is skipped (FAST_LANE_SKIPPED_SANDBOX) and the tool-capable builder
// keeps trying. The notice must say we are still trying, and must not invite a retry.
import { describe, it, expect } from 'vitest';
import { sandboxUnavailableNotice } from '../src/server/routes/agentv3';

describe('a busy sandbox is not a goodbye', () => {
  it('says the engine is temporarily unavailable and that we are still trying', () => {
    const n = sandboxUnavailableNotice();
    expect(n).toMatch(/temporarily unavailable/i);
    expect(n).toMatch(/still trying|as soon as I can/i);
    expect(n).toMatch(/don't need to start the build again|do not need to start the build again/i);
  });

  it('does not tell the user to start again, and leaks no infra', () => {
    const n = sandboxUnavailableNotice();
    expect(n).not.toMatch(/try building again|try again later|please retry/i);
    expect(n).not.toMatch(/E2B|payment method|team is blocked|403|sandbox/i);
  });
});
