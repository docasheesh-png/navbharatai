// REGRESSION — two sentences the build report stated confidently and falsely (autopsy a38c6fef).
//
// Neither changed a verdict, which is exactly why both survived: nothing failed, nothing logged, and
// a reader acting on either would go and optimise the wrong subsystem. The fourth absolute rule's
// fifth step is explicit that a wrong verdict or a misleading message is part of the bug, not a
// cosmetic afterthought.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const ROUTE = join(process.cwd(), 'src/server/routes/agentv3.ts');

describe('TIME_TO_FIRST_CALL — do not blame setup for time a fast lane burned', () => {
  it('measures the abandoned-lane window from the lanes\' own handoff events', () => {
    // The real build, in its real shape: simple lane handed off at 93s, one-shot at 243s.
    const started = 1_000_000;
    const issues = [
      { ts: started + 400, code: 'SETUP_TIMING' },
      { ts: started + 93_000, code: 'SIMPLE_BUILD_FALLBACK' },
      { ts: started + 243_000, code: 'ONESHOT_FALLBACK' },
    ];
    expect(BuildDiagnostics.abandonedLaneWindow(issues, started)).toEqual({ seconds: 243, lanes: 2 });
  });

  it('returns null when no lane was abandoned, so the ordinary setup sentence still stands', () => {
    const started = 1_000_000;
    expect(BuildDiagnostics.abandonedLaneWindow([{ ts: started + 500, code: 'SETUP_TIMING' }], started)).toBeNull();
    expect(BuildDiagnostics.abandonedLaneWindow([], started)).toBeNull();
  });

  it('THE REAL BUILD: says the 243s window was NOT setup, because two lanes consumed it', () => {
    // Replayed on the real clock of build a38c6fef: setup measured 1.5s, the simple lane handed off at
    // 93s, the one-shot at 243s, and the first model call was recorded at 264s having taken 21s.
    let clock = 0;
    const diag = new BuildDiagnostics({ now: () => clock });
    clock = 1_500;
    diag.record({ phase: 'build', severity: 'info', code: 'SETUP_TIMING', message: 'Workspace ready in 0s', autoResolved: true });
    clock = 93_000;
    diag.record({ phase: 'build', severity: 'info', code: 'SIMPLE_BUILD_FALLBACK', message: 'Simple build could not produce the app', autoResolved: true });
    clock = 243_000;
    diag.record({ phase: 'build', severity: 'info', code: 'ONESHOT_FALLBACK', message: 'One-shot could not generate the app', autoResolved: true });
    clock = 264_000;
    diag.recordLlmCall({
      model: 'kimi-k2.6', provider: 'kimi', promptChars: 10, responseChars: 10,
      finishReason: 'end_turn', toolCalls: 0, inputTokens: 1, outputTokens: 1, latencyMs: 21_000, ok: true,
    });

    const rec = diag.report().issues.find((i) => i.code === 'TIME_TO_FIRST_CALL');
    expect(rec).toBeDefined();
    // The old sentence asserted setup outright. Setup was 1.5 SECONDS; the 243s was two abandoned lanes.
    expect(rec!.message).toContain('NOT SETUP');
    expect(rec!.message).toContain('243s went to 2 fast build lane(s)');
    expect(rec!.message).not.toContain('sandbox setup, project restore and secrets loading all happen in it');
  });

  it('THE SECOND REPORT CAUGHT THIS FIX ITSELF: does not override an ALREADY-CORRECT small number', () => {
    // Build 5abad374, "Can you generate images?". Elapsed to the first recorded call was 120s and the
    // call's own latency was 117s, so preparation was correctly reported as 3s — while a lane had been
    // abandoned at 93s. Those are THE SAME CALL: the lane stopped waiting at 93s, the call returned at
    // 120s. Attributing 93s to "abandoned lanes" here would have replaced an accurate sentence with a
    // misleading one — this fix committing the exact error it exists to prevent.
    let clock = 0;
    const diag = new BuildDiagnostics({ now: () => clock });
    clock = 93_000;
    diag.record({ phase: 'build', severity: 'info', code: 'SIMPLE_BUILD_FALLBACK', message: 'handed off', autoResolved: true });
    clock = 120_000;
    diag.recordLlmCall({
      model: 'kimi-k2.6', provider: 'kimi', promptChars: 10, responseChars: 10,
      finishReason: 'tool_use', toolCalls: 1, inputTokens: 1, outputTokens: 1, latencyMs: 117_000, ok: true,
    });
    const rec = diag.report().issues.find((i) => i.code === 'TIME_TO_FIRST_CALL');
    expect(rec!.message).not.toContain('NOT SETUP');
    expect(rec!.message).toContain('3s of preparation');
    // …and it stays an INFO line, because 3s of setup is not worth warning anyone about.
    expect(rec!.severity).toBe('info');
  });

  it('leaves the ordinary wording alone when no lane was abandoned', () => {
    let clock = 0;
    const diag = new BuildDiagnostics({ now: () => clock });
    clock = 8_000;
    diag.recordLlmCall({
      model: 'kimi-k2.6', provider: 'kimi', promptChars: 10, responseChars: 10,
      finishReason: 'end_turn', toolCalls: 0, inputTokens: 1, outputTokens: 1, latencyMs: 500, ok: true,
    });
    const rec = diag.report().issues.find((i) => i.code === 'TIME_TO_FIRST_CALL');
    expect(rec!.message).not.toContain('NOT SETUP');
    expect(rec!.message).toContain('sandbox setup, project restore and secrets loading');
  });
});

describe('the release gate must be TOLD when a real browser rendered the app', () => {
  // `previewVerifiedRendered` used to be declared BELOW the render-rescue block, so the one piece of
  // code that proves an app renders could not record it — the variable did not exist yet at that
  // point in the function. The verify block below the rescue is skipped for a rescued build
  // (`!renderRescued`), so nothing else set it either, and the gate printed "never confirmed to
  // render" 1.4 seconds after watching it render.
  const src = readFileSync(ROUTE, 'utf8');

  it('declares the flag ABOVE the render rescue that proves it', () => {
    const declaredAt = src.indexOf('let previewVerifiedRendered = false;');
    const rescueAt = src.indexOf("code: 'RENDER_RESCUE',");
    expect(declaredAt).toBeGreaterThan(-1);
    expect(rescueAt).toBeGreaterThan(-1);
    expect(declaredAt).toBeLessThan(rescueAt);
  });

  // ⚠️ UPDATED 2026-09-18, INTENT UNCHANGED AND STRENGTHENED. This case asserted the hand-assignment
  // `previewVerifiedRendered = true;` beside the rescue. That assignment is gone because it was the
  // defect: three copies of one fact, assigned by hand, and the rescue set two of them (see
  // renderProof.ts). The rescue still proves the render in exactly this place — it now does it through
  // the ONE writer, which sets every copy and files the ledger fact, so a producer can no longer set
  // some and not others.
  it('proves it where the browser render is actually proven — through the one writer', () => {
    const rescueAt = src.indexOf("code: 'RENDER_RESCUE',");
    const window = src.slice(Math.max(0, rescueAt - 1200), rescueAt);
    expect(window).toContain("markAppRendered(shot.source, 'render rescue')");
    const writer = src.slice(src.indexOf('const markAppRendered = ('));
    expect(writer.slice(0, 600)).toContain('previewVerifiedRendered = true');
  });

  it('still feeds the gate from that one flag', () => {
    expect(src).toContain("gateEvidence.preview = previewVerifiedRendered ? 'passed'");
  });
});

describe('the write fence is wired into the real build, not just unit-tested', () => {
  const src = readFileSync(ROUTE, 'utf8');

  it('hands each fast lane its own fenced writer', () => {
    expect(src).toContain("writeFiles: laneFence.open('simple-build')");
    expect(src).toContain("writeFiles: laneFence.open('one-shot')");
  });

  it('hands the workspace off to the full builder when no fast lane succeeded', () => {
    expect(src).toContain('if (!result) laneFence.handoff();');
  });

  it('records a refused zombie write in the build report', () => {
    expect(src).toContain("code: 'ZOMBIE_WRITE_REFUSED'");
  });
});
