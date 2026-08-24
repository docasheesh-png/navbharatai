import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { dormancyReason, reportableFileCount } from '../src/server/AgentV3/workspaceDormancy';
import { runtimeLogEmptyMessage } from '../src/lib/runtimeLogBuffer';

/**
 * ⚠️ THE SENTENCE THIS STOPS (found 2026-08-24, sweeping for one repeated pattern). Five call sites did:
 *
 *     const fileCount = await countWorkspaceFiles(workspaceId).catch(() => 0);
 *     res.json({ reason: fileCount > 0 ? 'dormant' : 'not_started', savedFileCount: fileCount });
 *
 * A count that FAILED became the number ZERO; zero meant `not_started`; and the client renders that as
 * "Nothing has been built yet — build an app and its logs appear here." A store hiccup therefore told a
 * user their project did not exist, on a workspace they had built. It is the most alarming sentence
 * this product can show, produced by an error nobody saw.
 *
 * The same substitution found five other times this month — an artifact standing in for the thing it
 * was meant to prove. Here the artifact is a fallback value INDISTINGUISHABLE from a real measurement:
 * 0 is a perfectly good count, which is exactly what makes it dangerous as a failure value.
 */
const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

describe('a count that could not be taken is not a count of zero', () => {
  it('reports the three states as three different facts', () => {
    expect(dormancyReason(12)).toBe('dormant');
    expect(dormancyReason(0)).toBe('not_started');
    expect(dormancyReason(null)).toBe('unknown');
  });

  it('treats every un-countable shape as unknown, never as empty', () => {
    for (const v of [undefined, NaN, Infinity, null]) {
      expect(dormancyReason(v as number | null | undefined)).toBe('unknown');
    }
  });

  it('does not report a number it does not have', () => {
    // "your 0 saved files are safe" is the same lie in numeric form, and the terminal renders it.
    expect(reportableFileCount(12)).toBe(12);
    expect(reportableFileCount(0)).toBe(0);
    expect(reportableFileCount(null)).toBeNull();
    expect(reportableFileCount(NaN)).toBeNull();
  });
});

describe('every call site was fixed, not just the one that was noticed', () => {
  it('no site still turns a failed count into zero', () => {
    expect(route).not.toContain('countWorkspaceFiles(workspaceId).catch(() => 0)');
  });

  it('and no site still derives the reason inline', () => {
    // Five copies of one decision is how they drift. The route asks the shared function instead.
    expect(route).not.toContain("fileCount > 0 ? 'dormant' : 'not_started'");
    expect(route.split('dormancyReason(fileCount)').length - 1).toBe(4);
  });

  it('the terminal wake still fails CLOSED on an unknown — a guess must not spend money', () => {
    // Deliberately NOT changed to wake optimistically: a wake creates a real billed sandbox. What
    // changed is what the user is told afterwards, which costs nothing and invites the retry that works.
    expect(route).toContain('if ((savedFiles ?? 0) > 0 && canWake) {');
  });
});

describe('the user reads the honest sentence', () => {
  it('unknown invites a retry instead of denying their project exists', () => {
    expect(runtimeLogEmptyMessage('unknown', false)).toMatch(/try again/i);
    expect(runtimeLogEmptyMessage('unknown', false)).not.toMatch(/nothing has been built/i);
  });

  it('the other four messages are untouched', () => {
    expect(runtimeLogEmptyMessage('not_started', false)).toMatch(/build an app/i);
    expect(runtimeLogEmptyMessage('dormant', false)).toMatch(/not running right now/i);
    expect(runtimeLogEmptyMessage('live', false)).toMatch(/has not printed anything/i);
    expect(runtimeLogEmptyMessage('live', true)).toMatch(/No output yet/i);
    expect(runtimeLogEmptyMessage('idle', false)).toMatch(/Connecting/i);
  });

  it('the terminal pane distinguishes it too — the same fix, the other surface', () => {
    const shell = readFileSync(join(__dirname, '..', 'src/components/ide/ShellTerminal.tsx'), 'utf8');
    expect(shell).toContain("j.reason === 'unknown'");
  });
});
