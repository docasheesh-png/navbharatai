import { describe, it, expect } from 'vitest';
import {
  computePromptHash,
  reportMatchesActiveBuild,
  hasActiveBuildExpectation,
  type BuildIdentityFields,
} from './buildIdentity';

describe('computePromptHash — stable, prompt-distinguishing', () => {
  it('is deterministic for the same prompt', () => {
    expect(computePromptHash('build an expense tracker')).toBe(computePromptHash('build an expense tracker'));
  });
  it('differs for a different prompt (expense tracker vs jungle runner)', () => {
    expect(computePromptHash('build an expense tracker')).not.toBe(computePromptHash('build a jungle runner game'));
  });
  it('is stable across whitespace trimming and handles null/empty', () => {
    expect(computePromptHash('  hi  ')).toBe(computePromptHash('hi'));
    expect(computePromptHash(null)).toBe(computePromptHash(''));
    expect(typeof computePromptHash('x')).toBe('string');
  });
});

describe('reportMatchesActiveBuild — the P0 guard (never export a different build\'s report)', () => {
  const expense: BuildIdentityFields = { buildId: 'build-EXPENSE', promptHash: computePromptHash('expense tracker'), workspaceId: 'agentv3-u1-sessA' };
  const jungle: BuildIdentityFields = { buildId: 'build-JUNGLE', promptHash: computePromptHash('jungle runner'), workspaceId: 'agentv3-u1-sessB' };

  it('THE BUG: a previous app\'s report is REJECTED for the active build', () => {
    const r = reportMatchesActiveBuild(jungle, { buildId: 'build-EXPENSE', promptHash: expense.promptHash });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('build-id-mismatch');
  });

  it('the active build\'s OWN report matches', () => {
    expect(reportMatchesActiveBuild(expense, { buildId: 'build-EXPENSE', promptHash: expense.promptHash, workspaceId: 'agentv3-u1-sessA' }).ok).toBe(true);
  });

  it('a report with NO build id is rejected when an active buildId is asserted (legacy/other build)', () => {
    const r = reportMatchesActiveBuild({ promptHash: expense.promptHash }, { buildId: 'build-EXPENSE' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('report-has-no-build-id');
  });

  it('prompt-hash mismatch is caught even when no buildId is asserted', () => {
    const r = reportMatchesActiveBuild(jungle, { promptHash: expense.promptHash });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('prompt-hash-mismatch');
  });

  it('workspace mismatch is caught', () => {
    const r = reportMatchesActiveBuild(jungle, { workspaceId: 'agentv3-u1-sessA' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('workspace-mismatch');
  });

  it('an EMPTY expectation matches anything (legacy client path unchanged)', () => {
    expect(reportMatchesActiveBuild(jungle, {}).ok).toBe(true);
    expect(reportMatchesActiveBuild(expense, {}).ok).toBe(true);
  });

  it('a null/absent report never matches', () => {
    expect(reportMatchesActiveBuild(null, { buildId: 'x' }).ok).toBe(false);
    expect(reportMatchesActiveBuild(undefined, {}).reason).toBe('no-report');
  });

  it('matches on buildId even if the (optional) prompt hash is absent on the report', () => {
    expect(reportMatchesActiveBuild({ buildId: 'build-EXPENSE' }, { buildId: 'build-EXPENSE', promptHash: 'anything' }).ok).toBe(true);
  });
});

describe('hasActiveBuildExpectation — strict path only when identity is asserted', () => {
  it('true when a buildId or promptHash is present', () => {
    expect(hasActiveBuildExpectation({ buildId: 'b' })).toBe(true);
    expect(hasActiveBuildExpectation({ promptHash: 'h' })).toBe(true);
  });
  it('false for an empty / workspace-only expectation (legacy client)', () => {
    expect(hasActiveBuildExpectation({})).toBe(false);
    expect(hasActiveBuildExpectation({ workspaceId: 'w' })).toBe(false);
  });
});
