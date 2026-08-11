/**
 * Restoring a checkpoint — and the instance-affinity bug that made it fail on a healthy workspace.
 *
 * WHAT WAS WRONG. `restoreSession` read ONLY an in-memory `sessions` map and returned `false` when it
 * missed. That map lives on ONE Cloud Run instance, and Cloud Run runs several — so a user whose
 * request happened to land on a different instance was told their checkpoint was "not active in this
 * session", with a live sandbox sitting right there. The checkpoint LIST is durable (Firestore), so
 * the UI was offering restores it could not perform, and the failure read like the user's fault.
 *
 * A bare boolean also collapsed four different situations into one sentence — and only some of them
 * are something a user can act on.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { restoreSessionDetailed, type RestoreReason } from '../src/server/AgentV3/WorkspaceRegistry';

/** A fake sandbox: `files` decides whether git exists and which commit it knows. */
function fakeRunner(opts: { hasGit?: boolean; knownSha?: string; restoreFails?: boolean } = {}) {
  const { hasGit = true, knownSha = 'abc1234', restoreFails = false } = opts;
  const seen: string[] = [];
  return {
    seen,
    runner: {
      async runCommand(_ws: string, command: string) {
        seen.push(command);
        if (!hasGit) return { exitCode: 127, stdout: '', stderr: 'git: not found' }; // no HASREPO ⇒ history gone
        if (command.includes('rev-parse --git-dir')) return { exitCode: 0, stdout: 'HASREPO\n', stderr: '' };
        if (command.includes('cat-file')) {
          return command.includes(knownSha)
            ? { exitCode: 0, stdout: 'FOUND\n', stderr: '' }
            : { exitCode: 1, stdout: '', stderr: '' };
        }
        if (command.startsWith('git checkout')) {
          return restoreFails ? { exitCode: 1, stdout: '', stderr: 'error' } : { exitCode: 0, stdout: '', stderr: '' };
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    },
  };
}

const restore = (sha: string, opts?: Parameters<typeof fakeRunner>[0], userId?: string) =>
  restoreSessionDetailed('agentv3-alice-s1', sha, userId, () => fakeRunner(opts).runner);

describe('a restore no longer depends on WHICH instance served the request', () => {
  it('restores from a cold instance when the sandbox still has the commit', async () => {
    // The exact case that used to return false: no session object on this instance, healthy sandbox.
    expect(await restore('abc1234')).toEqual({ ok: true, reason: 'restored' as RestoreReason });
  });

  it('says the HISTORY is gone when the sandbox has no git repo', async () => {
    // A recycled sandbox genuinely cannot bring old commits back — a different fact from "wrong
    // instance", and the only one of the two the user can act on.
    expect(await restore('abc1234', { hasGit: false })).toEqual({ ok: false, reason: 'no-history' });
  });

  it('says the COMMIT is unknown when git is there but the checkpoint is not', async () => {
    expect(await restore('deadbee', { knownSha: 'abc1234' })).toEqual({ ok: false, reason: 'unknown-sha' });
  });

  it('says it FAILED when git ran and refused — the one case worth retrying', async () => {
    expect(await restore('abc1234', { restoreFails: true })).toEqual({ ok: false, reason: 'failed' });
  });

  it('refuses a malformed sha without touching the sandbox', async () => {
    const f = fakeRunner();
    const r = await restoreSessionDetailed('agentv3-alice-s1', 'not-a-sha; rm -rf /', undefined, () => f.runner);
    expect(r.ok).toBe(false);
    expect(f.seen.some((c) => c.includes('rm -rf'))).toBe(false);
  });

  it('reports no-sandbox rather than throwing when the workspace cannot be addressed', async () => {
    const r = await restoreSessionDetailed('agentv3-alice-s1', 'abc1234', undefined, () => {
      throw new Error('no sandbox');
    });
    expect(r).toEqual({ ok: false, reason: 'no-sandbox' });
  });
});

describe('the user is told which of those it was', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

  it('the route returns the reason AND a sentence, from one place', () => {
    expect(route).toContain('restoreSessionDetailed(workspaceId, sha, userId ?? undefined, () => buildActuator())');
    expect(route).toContain('reason: result.reason');
    expect(route).toContain('const restoreMessage = (reason: string): string =>');
  });

  it('the "history is gone" message points at the thing that DOES work', () => {
    // Restore-all-files from the durable store still works after a recycle; saying so is the
    // difference between a dead end and a next step.
    expect(route).toContain('Restore all files');
  });

  it('the old guess is gone from the UI', () => {
    const panel = readFileSync('src/components/agentv3/AgentV3Panel.tsx', 'utf8');
    expect(panel).not.toContain("isn't active in this session yet");
    expect(panel).toContain('const { ok, message } = await restore(sha)');
  });

  it('a failed restore never claims the files changed', () => {
    expect(route).toContain('Your current files were not changed');
  });
});
