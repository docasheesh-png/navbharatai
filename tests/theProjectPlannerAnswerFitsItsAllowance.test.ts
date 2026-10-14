import { describe, it, expect } from 'vitest';
import { PLANNER_BUDGET, projectPlanSystemPrompt } from '../src/server/AgentV3/ProjectPlan';
import { PROJECT_PLANNER_MAX_TOKENS } from '../src/server/AgentV3/projectPlannerBudget';

/**
 * THE PLANNER IS NEVER ASKED FOR MORE THAN IT MAY ANSWER (autopsy 398db9f3 — PAWTRACE, 2026-10-14).
 *
 * The project planner's reply came back at 51,077 characters, cut off at its 16,000-token allowance after
 * 113 s, and the plan was thrown away. The prompt had allowed 60 modules x 60 files x 12,000-character
 * contracts. The CLASS: the size the prompt permits must fit the allowance the call has — otherwise a long
 * enough request guarantees the failure, however high the allowance is raised.
 */
const CHARS_PER_TOKEN = 3; // JSON of paths and TypeScript declarations tokenises densely
const AVG_PATH_CHARS = 55; // quoted path + indent + comma
const PER_MODULE_OVERHEAD = 200; // keys, id, name, dependsOn

describe('the worst answer the prompt allows fits the planner call', () => {
  it('stays under 75% of the output allowance', () => {
    const b = PLANNER_BUDGET;
    const worstModule = b.descriptionChars + b.contractChars + b.filesPerModule * AVG_PATH_CHARS + PER_MODULE_OVERHEAD;
    const worstTokens = (worstModule * b.modules) / CHARS_PER_TOKEN;
    expect(worstTokens).toBeLessThanOrEqual(PROJECT_PLANNER_MAX_TOKENS * 0.75);
  });

  it('the prompt states every limit it was budgeted with', () => {
    const p = projectPlanSystemPrompt('vite-react');
    expect(p).toContain(`at most ${PLANNER_BUDGET.modules} modules`);
    expect(p).toContain(`at most ${PLANNER_BUDGET.filesPerModule} files per module`);
    expect(p).toContain(`description under ${PLANNER_BUDGET.descriptionChars} characters`);
    expect(p).toContain(`contracts under ${PLANNER_BUDGET.contractChars} characters`);
  });

  it('the prompt no longer invites the 60-module / 60-file answer that overran the allowance', () => {
    const p = projectPlanSystemPrompt('vite-react');
    expect(p).not.toMatch(/At most 60 modules/);
    expect(p).not.toMatch(/10–60 files/);
  });
});
