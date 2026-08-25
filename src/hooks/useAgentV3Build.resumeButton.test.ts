import { describe, it, expect } from 'vitest';
import { serverBuildNeedsAttention } from './useAgentV3Build';

/**
 * The Resume/Stop header buttons, and the bug the admin reported on 2026-08-25:
 * "app ban gayi, phir bhi Resume aur Stop dikh rahe hain" — they only went away once the preview
 * finished loading, long after the build had delivered its result, its cost and its health score.
 */
describe('serverBuildNeedsAttention', () => {
  it('offers nothing when the server says no build is running', () => {
    expect(serverBuildNeedsAttention({ serverSaysRunning: false, sawResult: false })).toBe(false);
    expect(serverBuildNeedsAttention({ serverSaysRunning: false, sawResult: true })).toBe(false);
  });

  it('offers Resume/Stop for a build that is genuinely still working', () => {
    // Nothing has come back yet — this is the case the buttons exist for.
    expect(serverBuildNeedsAttention({ serverSaysRunning: true, sawResult: false })).toBe(true);
  });

  it('THE BUG: stops offering them once this session saw the build finish', () => {
    // The server keeps reporting "running" through the post-result tail (durable saves, reviewer,
    // dev-server boot). Resume is meaningless — the user is already looking at the finished build —
    // and Stop invites them to kill the preview boot they are waiting for.
    expect(serverBuildNeedsAttention({
      serverSaysRunning: true,
      sawResult: true,
      polledWorkspaceId: 'ws-1',
      resultWorkspaceId: 'ws-1',
    })).toBe(false);
  });

  it('does NOT silence a build running in a DIFFERENT session', () => {
    // sawResult belongs to the workspace that was attached when the result arrived. Suppressing on
    // it alone would take the Resume button away from a build genuinely running in another tab.
    expect(serverBuildNeedsAttention({
      serverSaysRunning: true,
      sawResult: true,
      polledWorkspaceId: 'ws-2',
      resultWorkspaceId: 'ws-1',
    })).toBe(true);
  });

  it('never suppresses an account-wide poll, which cannot prove it is the same build', () => {
    expect(serverBuildNeedsAttention({
      serverSaysRunning: true,
      sawResult: true,
      polledWorkspaceId: undefined,
      resultWorkspaceId: 'ws-1',
    })).toBe(true);
    expect(serverBuildNeedsAttention({
      serverSaysRunning: true,
      sawResult: true,
      polledWorkspaceId: 'ws-1',
      resultWorkspaceId: undefined,
    })).toBe(true);
  });

  it('a NEW build gets its buttons back — the suppression cannot stick', () => {
    // start() clears sawResult, so the very next build is treated as running again. Without this the
    // fix would trade a confusing button for a missing one, which is worse.
    expect(serverBuildNeedsAttention({
      serverSaysRunning: true,
      sawResult: false,
      polledWorkspaceId: 'ws-1',
      resultWorkspaceId: undefined,
    })).toBe(true);
  });
});

describe('the fix is wired, not just written (locked)', () => {
  const src = require('node:fs').readFileSync(require('node:path').resolve(__dirname, 'useAgentV3Build.ts'), 'utf8');

  it('the status poll goes through the policy instead of overwriting the flag', () => {
    // A blind `setServerBuildRunning(serverSays)` is exactly what caused the report: the poll threw
    // away the stronger fact this session already held.
    expect(src).toContain('setServerBuildRunning(serverBuildNeedsAttention({');
    expect(src).not.toMatch(/setServerBuildRunning\(opts\?\.workspaceId \? j\?\.buildRunningHere === true/);
  });

  it('records which workspace the terminal result belonged to', () => {
    expect(src).toContain('resultWorkspaceRef.current = workspaceIdRef.current;');
  });

  it('clears that stamp when a fresh build starts', () => {
    expect(src).toContain('resultWorkspaceRef.current = undefined;');
  });
});
