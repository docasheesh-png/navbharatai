// 🔴 A PLANNER CANCELLED BY A STOP DID NOT "FAIL", AND THE BUILD DID NOT "PROCEED" (failedbr #2417, dae2cbea, 2026-11-17).
//
// The build was stopped 73 s in (the lease could not be confirmed) while the mega-app roadmap planner ran. The report
// said: "Mega-app roadmap: the planner call failed (Stopped — the build was asked to stop. No provider failed.) — the
// build proceeded directly." A stop was filed as a planner failure, and the build was described as carrying on. The
// project-mode planner had the identical sentence.
// Reversion: drop the `isBuildStoppedError` line from plannerFailureKind and the first block fails.

import { describe, it, expect } from 'vitest';
import { plannerFailureKind, roadmapPlannerFailedMessage, projectModeFailedMessage, ROADMAP_PLANNER_TIMED_OUT } from '../src/server/AgentV3/projectPlannerBudget';
import { BuildStoppedError, BUILD_STOPPED_MESSAGE } from '../src/server/AgentV3/stopSignal';

describe('a stop is its own kind', () => {
  it('the #2417 error (the stop sentence) and a BuildStoppedError read as stopped', () => {
    expect(plannerFailureKind(new Error(BUILD_STOPPED_MESSAGE))).toBe('stopped');
    expect(plannerFailureKind(new BuildStoppedError())).toBe('stopped');
  });
  it('neither planner line says it failed or that the build proceeded', () => {
    for (const line of [roadmapPlannerFailedMessage('stopped', 45_000, new Error(BUILD_STOPPED_MESSAGE)), projectModeFailedMessage('stopped', 45_000, new Error(BUILD_STOPPED_MESSAGE))]) {
      expect(line).toMatch(/cancelled because the build was stopped/);
      expect(line).toMatch(/did not proceed/);
      expect(line).not.toMatch(/failed \(|proceeded directly|proceeded on the ordinary path/);
    }
  });
  it('a timeout and a real failure keep their own lines', () => {
    expect(plannerFailureKind(new Error(ROADMAP_PLANNER_TIMED_OUT))).toBe('timed-out');
    expect(plannerFailureKind(new Error('500 upstream'))).toBe('threw');
    expect(roadmapPlannerFailedMessage('threw', 45_000, new Error('500 upstream'))).toMatch(/failed \(500 upstream\) — the build proceeded directly/);
  });
});
