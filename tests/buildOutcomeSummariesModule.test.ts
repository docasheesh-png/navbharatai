import { describe, it, expect } from 'vitest';
import * as moved from '../src/server/AgentV3/buildOutcomeSummaries';
import * as route from '../src/server/routes/agentv3';

describe('build-outcome summaries live in their own module (agentv3.ts split, item 5)', () => {
  it('the route re-exports the very same functions', () => {
    for (const k of ['emptyBuildFailureSummary', 'emptyBuildOutcomeIssue', 'verifiedNoChangeSummary', 'finalSyntaxErrorSummary'] as const) {
      expect((route as Record<string, unknown>)[k]).toBe(moved[k]);
    }
  });
  it('wording is unchanged', () => {
    expect(moved.finalSyntaxErrorSummary(2)).toContain("2 files in the final build don't compile yet");
  });
});
