// A TIMER TICK IS NOT ACTIVITY — and counting it as activity hid a 160-second stall.
//
// 🔴 THE INCIDENT (build 8682b6b1, 2026-09-17). Its TIME_TO_FIRST_CALL warning read:
//
//   "171s of preparation before the build's first model call began … The longest single stretch with
//    NOTHING recorded was 60s, beginning right after: '⏱ minute 1 — still working …' — that is where
//    to look first."
//
// The real answer was twenty lines above it in the SAME report:
//
//   SETUP_TIMING: "Project checked in 161s — nothing needed restoring"
//                 detail: "durable read 294ms (114 file(s)) · sandbox scan 160493ms"
//
// ONE measured step took 160.5s of the 171s. The instrument built to find the biggest cost pointed at
// a 60-second gap and at a heartbeat — because the heartbeat writes "⏱ minute N — still working" once
// a minute, and every tick LOOKED like something happening. A single 161-second stall was chopped into
// 56s / 60s / 45s, so the largest reported gap was 60s. The engine's own "I am alive" ping was
// concealing the thing it was pinging through.
//
// TWO CHANGES, ONE COMMIT, because either alone is worse than neither:
//  • timer chatter no longer counts as activity (the stall becomes visible), AND
//  • the sentence stops saying "with NOTHING recorded" (a heartbeat WAS recorded — fixing a misleading
//    pointer by making an untrue claim is the trade this repo forbids).
// Plus `until`: self-timing steps record at COMPLETION, so the line that ENDS a silence is usually the
// step that FILLED it — the nearest thing to a cause a timeline can honestly offer.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

// The real report's own timestamps, as offsets from its startedAt (1789643802122).
const CONNECTED_AT = 2_708;    // AGENT_STEP  "Connected to your GitHub — …"
const HEARTBEAT_1 = 58_495;    // HEARTBEAT   "⏱ minute 1 — still working …"
const HEARTBEAT_2 = 118_495;   // HEARTBEAT   "⏱ minute 2 — still working …"
const SCAN_DONE_AT = 163_497;  // SETUP_TIMING "Project checked in 161s — nothing needed restoring"
const FIRST_CALL_AT = 183_292; // the first model call returns

const CONNECTED = 'Connected to your GitHub — this build will be saved to vk13198/what-17sep26-0734.';
const SCAN_DONE = 'Project checked in 161s — nothing needed restoring';

const timeline = () => [
  { ts: CONNECTED_AT, message: CONNECTED, code: 'AGENT_STEP' },
  { ts: HEARTBEAT_1, message: '⏱ minute 1 — still working (last: Connected to your GitHub …)', code: 'HEARTBEAT' },
  { ts: HEARTBEAT_2, message: '⏱ minute 2 — still working (last: Connected to your GitHub …)', code: 'HEARTBEAT' },
  { ts: SCAN_DONE_AT, message: SCAN_DONE, code: 'SETUP_TIMING' },
];

describe('longestSilentGap — the real 8682b6b1 timeline', () => {
  it('finds the WHOLE 161s stall, not the 60s the heartbeats chopped it into', () => {
    const gap = BuildDiagnostics.longestSilentGap(timeline(), 0, FIRST_CALL_AT);
    expect(gap).not.toBeNull();
    // 163497 - 2708 = 160789ms. The old code reported 60s — the interval between two heartbeats.
    expect(gap?.seconds).toBe(161);
    expect(gap?.seconds).not.toBe(60);
  });

  it('names the step that ENDED the silence — the one that explains it', () => {
    const gap = BuildDiagnostics.longestSilentGap(timeline(), 0, FIRST_CALL_AT);
    expect(gap?.until).toContain('Project checked in 161s');
    // …and still names what preceded it, which is a fact rather than a cause.
    expect(gap?.after).toContain('Connected to your GitHub');
  });

  it('never points the reader at a heartbeat', () => {
    const gap = BuildDiagnostics.longestSilentGap(timeline(), 0, FIRST_CALL_AT);
    expect(gap?.after).not.toContain('⏱');
    expect(gap?.until).not.toContain('⏱');
    expect(gap?.after).not.toContain('still working');
  });

  it('a ⏱-prefixed AGENT_STEP is chatter too — the code is not the only tell', () => {
    // The route also emits "⏱️ Still building… N min in …" as an AGENT_STEP, not a HEARTBEAT.
    const withStepTick = [
      { ts: CONNECTED_AT, message: CONNECTED, code: 'AGENT_STEP' },
      { ts: 90_000, message: '⏱️ Still building… 2 min in · up to 56 min left for this one', code: 'AGENT_STEP' },
      { ts: SCAN_DONE_AT, message: SCAN_DONE, code: 'SETUP_TIMING' },
    ];
    expect(BuildDiagnostics.longestSilentGap(withStepTick, 0, FIRST_CALL_AT)?.seconds).toBe(161);
  });

  it('real work still breaks a silence — the filter is narrow, not a blanket', () => {
    const withRealWork = [
      { ts: CONNECTED_AT, message: CONNECTED, code: 'AGENT_STEP' },
      { ts: 80_000, message: 'Personal context loaded in 78ms', code: 'SETUP_TIMING' },
      { ts: SCAN_DONE_AT, message: SCAN_DONE, code: 'SETUP_TIMING' },
    ];
    const gap = BuildDiagnostics.longestSilentGap(withRealWork, 0, FIRST_CALL_AT);
    expect(gap?.seconds).toBe(83); // 163497 - 80000 = 83497ms, not the whole 161
    expect(gap?.until).toContain('Project checked in 161s');
  });

  it('is unchanged where it already worked: silence before the first entry, and short gaps', () => {
    const lateStart = [{ ts: 120_000, message: 'first thing that happened', code: 'AGENT_STEP' }];
    expect(BuildDiagnostics.longestSilentGap(lateStart, 0, FIRST_CALL_AT)?.after).toBe('the build started');
    // Below minSeconds ⇒ nothing worth reporting.
    expect(BuildDiagnostics.longestSilentGap(
      [{ ts: 1_000, message: 'a', code: 'AGENT_STEP' }, { ts: 3_000, message: 'b', code: 'AGENT_STEP' }],
      0, 4_000,
    )).toBeNull();
  });

  it('never throws on junk', () => {
    for (const junk of [[], null, undefined]) {
      expect(() => BuildDiagnostics.longestSilentGap(junk as never, 0, 1_000)).not.toThrow();
    }
  });
});

describe('the sentence must not claim NOTHING was recorded', () => {
  // ⚠️ REVERSION GUARD, and it is the honesty half. With heartbeats filtered, "with NOTHING recorded"
  // is literally false — a heartbeat WAS recorded in that stretch. A report that fixes a misleading
  // pointer by making an untrue claim has traded one problem for another.
  //
  // ⚠️ THIS ASSERTS THE SOURCE, because the first draft asserted `String(constructor)` — which never
  // contains a method body, so it passed no matter what the sentence said. A guard that cannot fail
  // is not a guard; that lesson was learned twice in this session and is written down rather than
  // repeated a third time.
  // Comments are STRIPPED before matching — the module's own comment legitimately quotes the old
  // phrase while explaining why it had to go, and the first draft of this guard flagged that comment
  // as the bug. A guard that cannot tell code from prose gets deleted the next time someone explains
  // a fix; this repo has already paid for that once today.
  const source = readFileSync(join(__dirname, '../src/server/AgentV3/BuildDiagnostics.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('the old absolute claim is gone from the source', () => {
    expect(source).not.toContain('with NOTHING recorded');
  });

  it('the new wording admits what it is ignoring', () => {
    expect(source).toContain('no work recorded (heartbeats aside)');
  });

  it('the filter and the wording are BOTH present — neither ships alone', () => {
    // Shipping the filter without the re-wording makes the report untrue; shipping the re-wording
    // without the filter leaves the 160s stall invisible. They are one change.
    expect(source).toContain('isTimerChatter');
    expect(source).toContain('no work recorded (heartbeats aside)');
  });
});
