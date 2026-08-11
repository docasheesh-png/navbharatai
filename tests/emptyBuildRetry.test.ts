import { describe, it, expect } from 'vitest';
import { shouldRetryEmptyBuild } from '../src/server/routes/agentv3';

/**
 * A BUILD THAT CHANGED NO FILES IS NOT AUTOMATICALLY A FAILED BUILD.
 *
 * The guard exists for deep-test App #7: a build that EXPECTED artifacts produced no files because the
 * sandbox could not be set up, and still reported "✓ Done" over an empty preview. Re-running that on a
 * stronger model is right.
 *
 * It was too wide. Shiv Medical Store (2026-08-10): the user asked to "continue from where you left off
 * and finish/fix the build so the app works end-to-end". The agent diagnosed it, started the dev
 * server, published a WORKING preview and finished — writing no files, because no file needed to
 * change. That correct outcome was classified as an empty build and the whole thing re-ran on a second
 * model, roughly doubling a 15.6-minute, ₹567 build for nothing.
 */
const base = {
  expectsArtifacts: true,
  filesWritten: 0,
  isEditMode: false,
  existingProjectFiles: 0,
  aborted: false,
  withinCostCap: true,
};

describe('the failure it must still catch', () => {
  it('a NEW build that produced nothing is a failure (App #7)', () => {
    expect(shouldRetryEmptyBuild(base)).toBe(true);
  });

  it('an EDIT on an EMPTY workspace is a failure — there was nothing to edit', () => {
    expect(shouldRetryEmptyBuild({ ...base, isEditMode: true, existingProjectFiles: 0 })).toBe(true);
  });

  it('a new build stays a failure however many files the workspace already had', () => {
    // Rebuilding over an existing project must still produce something.
    expect(shouldRetryEmptyBuild({ ...base, isEditMode: false, existingProjectFiles: 78 })).toBe(true);
  });
});

describe('the case that must NOT retry — the reported one', () => {
  it('an edit on an existing project may legitimately change no files', () => {
    // Shiv Medical Store: 78 files present, the fix was to start the dev server.
    expect(shouldRetryEmptyBuild({ ...base, isEditMode: true, existingProjectFiles: 78 })).toBe(false);
  });

  it('even a single pre-existing file is enough to make it a real edit', () => {
    expect(shouldRetryEmptyBuild({ ...base, isEditMode: true, existingProjectFiles: 1 })).toBe(false);
  });
});

describe('the pre-existing conditions are all still required', () => {
  it('never retries when files WERE written', () => {
    expect(shouldRetryEmptyBuild({ ...base, filesWritten: 1 })).toBe(false);
  });

  it('never retries a turn that does not expect artifacts (an import/survey)', () => {
    expect(shouldRetryEmptyBuild({ ...base, expectsArtifacts: false })).toBe(false);
  });

  it('never retries an aborted build — the user stopped it', () => {
    expect(shouldRetryEmptyBuild({ ...base, aborted: true })).toBe(false);
  });

  it('never retries past the session cost cap — that is what the cap is for', () => {
    expect(shouldRetryEmptyBuild({ ...base, withinCostCap: false })).toBe(false);
  });
});

describe('it is wired to the real decision site', () => {
  it('agentv3 calls the helper instead of re-inlining the condition', () => {
    // The old inline condition is what was too wide; if it comes back, so does the double build.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8',
    ) as string;
    expect(src).toContain('shouldRetryEmptyBuild({');
    expect(src).not.toContain('expectsArtifacts && writtenFiles.size === 0 && !abort.signal.aborted');
  });
});
