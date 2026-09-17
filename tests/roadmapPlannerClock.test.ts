/**
 * THE SIBLING #3020 NEVER HUNTED (autopsy e706e068, School ERP, 2026-09-17).
 *
 * PR #3020 root-caused the Software Project Mode planner: a hard-coded 60 s race that killed the
 * decomposition and recorded nothing. One screen above it, the MEGA-APP ROADMAP planner had the
 * identical shape — a flat 45 s race, `recordLlmCall` only on success, an outer `catch` that ate the
 * failure — and the identical symptom in the same report: `APP_SCOPE` at +8 ms, `ETA_BASIS` at
 * +45,112 ms, nothing in between. The build's first forty-five seconds went to a planner nobody could
 * see, and `APP_SCOPE` still said the roadmap was "not yet active".
 *
 * Both planners now share ONE bound (projectPlannerBudget.ts) and one failure vocabulary.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  plannerFailureKind, roadmapPlannerFailedMessage, ROADMAP_PLANNER_TIMED_OUT, PROJECT_PLANNER_TIMED_OUT,
} from '../src/server/AgentV3/projectPlannerBudget';

describe('the roadmap planner shares the project planner\'s failure vocabulary', () => {
  it('its timeout is a timeout, the project planner\'s is a timeout, anything else threw', () => {
    expect(plannerFailureKind(new Error(ROADMAP_PLANNER_TIMED_OUT))).toBe('timed-out');
    expect(plannerFailureKind(new Error(PROJECT_PLANNER_TIMED_OUT))).toBe('timed-out');
    expect(plannerFailureKind(new Error('ECONNRESET'))).toBe('threw');
  });

  it('a timeout is named with the bound that fired, and says where the seconds went', () => {
    const line = roadmapPlannerFailedMessage('timed-out', 315_000, new Error(ROADMAP_PLANNER_TIMED_OUT));
    expect(line).toContain('315s');
    expect(line).toContain('proceeded directly');
    expect(line).toMatch(/seconds were spent/);
  });

  it('any other failure is named as what it was, truncated', () => {
    const line = roadmapPlannerFailedMessage('threw', 1, new Error('x'.repeat(500)));
    expect(line).toContain('planner call failed');
    expect(line.length).toBeLessThan(320);
  });

  it('🔒 names no vendor (White-Label Law: the line is admin-only, but the words must not leak)', () => {
    const line = roadmapPlannerFailedMessage('timed-out', 60_000, new Error(ROADMAP_PLANNER_TIMED_OUT));
    expect(line).not.toMatch(/\b(GLM|Kimi|Claude|Gemini|Grok)\b/i);
  });
});

describe('the roadmap block in the route', () => {
  const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
  const start = route.indexOf('MEGA-APP ROADMAP (admin 2026-08-14)');
  const end = route.indexOf('// Build start time — used for cost-ladder telemetry', start);
  const block = route.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('exists and is bounded by its real anchors', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('🔴 races on the SHARED bound — the flat 45 s clock is gone', () => {
    expect(block).toContain('const rmTimeoutMs = projectPlannerTimeoutMs();');
    expect(block).toContain('rej(new Error(ROADMAP_PLANNER_TIMED_OUT)), rmTimeoutMs)');
    expect(block).not.toMatch(/45_000/);
    expect(block).not.toContain("new Error('roadmap planner timed out')");
  });

  it('a failed planner call is on the model-call ledger and in the report BEFORE it is swallowed', () => {
    const failedCall = block.indexOf('ok: false, error: err instanceof Error ? err.message : String(err)');
    expect(failedCall).toBeGreaterThan(-1);
    const failedLine = block.indexOf("code: 'MEGA_ROADMAP_FAILED'", failedCall);
    expect(failedLine).toBeGreaterThan(failedCall);
    expect(block.indexOf('throw err;', failedLine)).toBeGreaterThan(failedLine);
    // Our process, never a finding against the app.
    expect(block.slice(failedLine, failedLine + 300)).toContain('autoResolved: true');
  });

  it('the timer is cleared whichever way the race ends — no dangling timeout after a fast answer', () => {
    expect(block).toContain('if (rmTimer) clearTimeout(rmTimer);');
  });

  it('APP_SCOPE no longer calls a default-on planner "not yet active"', () => {
    const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('step-by-step roadmap (not yet active)');
    expect(code).toContain('its outcome is recorded as MEGA_ROADMAP_*');
  });
});
