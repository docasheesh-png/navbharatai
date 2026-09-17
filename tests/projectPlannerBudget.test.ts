/**
 * THE PROJECT PLANNER'S CLOCK, AND WHAT IS SAID WHEN IT RUNS OUT (autopsy e706e068, 2026-09-17).
 *
 * The School ERP build announced a module decomposition at 10:18:30 and never mentioned it again:
 * a hard-coded 60 s race killed the planner call, the outer catch swallowed it, and no failed call
 * was recorded. The key the admin had set that morning was working — the report could not say so.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  projectPlannerTimeoutMs,
  PROJECT_PLANNER_SLACK_MS,
  PROJECT_PLANNER_TIMEOUT_MIN_MS,
  PROJECT_PLANNER_TIMEOUT_MAX_MS,
  PROJECT_PLANNER_TIMED_OUT,
  plannerFailureKind,
  projectModeFailedMessage,
  PROJECT_MODE_FALLBACK_NARRATION,
} from '../src/server/AgentV3/projectPlannerBudget';
import { STREAM_HARD_CAP_MS_DEFAULT } from '../src/server/AgentV3/providers/openAiStream';
import { FLOOR_TIMEOUT_CAP_MS } from '../src/server/AgentV3/floorBudget';
import { isAppFinding } from '../src/server/AgentV3/BuildDiagnostics';

describe('projectPlannerTimeoutMs — the inner call\'s own bound plus slack, never a tighter clock', () => {
  it('with streamed build calls ON, it is the stream hard cap plus slack', () => {
    expect(projectPlannerTimeoutMs({ AGENTV3_STREAM_BUILD_CALLS: 'on' })).toBe(STREAM_HARD_CAP_MS_DEFAULT + PROJECT_PLANNER_SLACK_MS);
  });

  it('with streaming OFF, it is the floor ceiling plus slack', () => {
    expect(projectPlannerTimeoutMs({})).toBe(FLOOR_TIMEOUT_CAP_MS + PROJECT_PLANNER_SLACK_MS);
  });

  it('follows a raised stream cap, so the outer race can never fire before the inner clock', () => {
    expect(projectPlannerTimeoutMs({ AGENTV3_STREAM_BUILD_CALLS: 'on', AGENTV3_STREAM_HARD_CAP_MS: '420000' })).toBe(420_000 + PROJECT_PLANNER_SLACK_MS);
  });

  it('is never the 60 s that killed the School ERP plan', () => {
    for (const env of [{}, { AGENTV3_STREAM_BUILD_CALLS: 'on' }]) expect(projectPlannerTimeoutMs(env)).toBeGreaterThan(60_000);
  });

  it('an explicit override is honoured and clamped; a malformed one is ignored, never read as zero', () => {
    expect(projectPlannerTimeoutMs({ AGENTV3_PROJECT_PLANNER_TIMEOUT_MS: '200000' })).toBe(200_000);
    expect(projectPlannerTimeoutMs({ AGENTV3_PROJECT_PLANNER_TIMEOUT_MS: '5' })).toBe(PROJECT_PLANNER_TIMEOUT_MIN_MS);
    expect(projectPlannerTimeoutMs({ AGENTV3_PROJECT_PLANNER_TIMEOUT_MS: '9999999' })).toBe(PROJECT_PLANNER_TIMEOUT_MAX_MS);
    expect(projectPlannerTimeoutMs({ AGENTV3_PROJECT_PLANNER_TIMEOUT_MS: 'abc' })).toBe(FLOOR_TIMEOUT_CAP_MS + PROJECT_PLANNER_SLACK_MS);
    expect(projectPlannerTimeoutMs({ AGENTV3_PROJECT_PLANNER_TIMEOUT_MS: '0' })).toBe(FLOOR_TIMEOUT_CAP_MS + PROJECT_PLANNER_SLACK_MS);
  });
});

describe('what is said when the plan cannot be made', () => {
  it('a timeout is named as a timeout, with the bound that fired', () => {
    const err = new Error(PROJECT_PLANNER_TIMED_OUT);
    expect(plannerFailureKind(err)).toBe('timed-out');
    expect(projectModeFailedMessage('timed-out', 315_000, err)).toContain('315s');
    expect(projectModeFailedMessage('timed-out', 315_000, err)).toMatch(/ordinary path/);
  });

  it('any other failure is named as what it was', () => {
    const err = new Error('parsePlannedModules: not an array');
    expect(plannerFailureKind(err)).toBe('threw');
    expect(projectModeFailedMessage('threw', 315_000, err)).toContain('not an array');
  });

  it('the user is told the promise is withdrawn — branded, no provider, no clock', () => {
    expect(PROJECT_MODE_FALLBACK_NARRATION).toMatch(/building this in one go/);
    expect(PROJECT_MODE_FALLBACK_NARRATION).not.toMatch(/glm|kimi|claude|gemini|grok|timeout|\d+\s*s\b/i);
  });

  it('PROJECT_MODE_FAILED is about our process, never a finding against the app', () => {
    expect(isAppFinding({ phase: 'plan', code: 'PROJECT_MODE_FAILED' })).toBe(false);
  });
});

describe('the route wiring — asserted on the CODE of the project-mode block, comments stripped', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  const start = route.indexOf('const ppTimeoutMs = projectPlannerTimeoutMs();');
  const end = route.indexOf('// Cost-ladder escalation (P3)', start);
  const block = route.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the block exists and is bounded by its real anchors', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('the planner race uses the shared bound — no hard-coded 60 s clock remains', () => {
    expect(block).toContain('rej(new Error(PROJECT_PLANNER_TIMED_OUT)), ppTimeoutMs)');
    expect(block).not.toMatch(/60_000/);
  });

  it('a failed planner call is recorded on the model-call ledger before it is rethrown', () => {
    const failedCall = block.indexOf('ok: false, error: err instanceof Error ? err.message : String(err)');
    expect(failedCall).toBeGreaterThan(-1);
    expect(block.indexOf('throw err;', failedCall)).toBeGreaterThan(failedCall);
  });

  it('the outer catch records PROJECT_MODE_FAILED and withdraws the promise only if one was made', () => {
    expect(block).toContain("code: 'PROJECT_MODE_FAILED'");
    expect(block).toContain('if (ppDecompositionAnnounced) {');
    expect(block).toContain('text: PROJECT_MODE_FALLBACK_NARRATION');
    // The flag is raised exactly where the user is told the decomposition is happening.
    const announce = block.indexOf('ppDecompositionAnnounced = true;');
    expect(announce).toBeGreaterThan(-1);
    expect(block.slice(announce, announce + 300)).toContain('decomposing it into independently-buildable modules');
  });
});
