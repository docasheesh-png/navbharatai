import { describe, it, expect, beforeEach } from 'vitest';
import { registerSession, getSession, restoreSession, gitStatusForSession, execInSession, sessionCount, _clearSessions } from './WorkspaceRegistry';
import { GitManager, type CommandRunner } from './GitManager';

class FakeShell implements CommandRunner {
  lastCommand = '';
  async runCommand(_w: string, command: string) {
    this.lastCommand = command;
    if (command.includes('rev-parse HEAD')) return { exitCode: 0, stdout: 'abc1234\n', stderr: '' };
    if (command.includes('bash -lc')) return { exitCode: 0, stdout: 'hello from sandbox\n', stderr: '' };
    return { exitCode: 0, stdout: '', stderr: '' };
  }
}

async function makeGit(): Promise<GitManager> {
  const g = new GitManager(new FakeShell(), 'ws');
  await g.ensureRepo();
  return g;
}

describe('WorkspaceRegistry', () => {
  beforeEach(() => _clearSessions());

  it('registers and retrieves a session', async () => {
    const git = await makeGit();
    registerSession('ws-1', git, 'user-1');
    expect(getSession('ws-1')?.userId).toBe('user-1');
    expect(sessionCount()).toBe(1);
  });

  it('restores a known session for the owning user', async () => {
    registerSession('ws-1', await makeGit(), 'user-1');
    expect(await restoreSession('ws-1', 'abc1234', 'user-1')).toBe(true);
  });

  it('refuses restore for an unknown workspace', async () => {
    expect(await restoreSession('nope', 'abc1234', 'user-1')).toBe(false);
  });

  it('refuses restore when a different user owns the session', async () => {
    registerSession('ws-1', await makeGit(), 'owner');
    expect(await restoreSession('ws-1', 'abc1234', 'attacker')).toBe(false);
  });

  it('rejects an invalid sha through the registry', async () => {
    registerSession('ws-1', await makeGit(), 'user-1');
    expect(await restoreSession('ws-1', 'bad sha!', 'user-1')).toBe(false);
  });

  it('returns git status for the owning user, null for unknown / wrong owner', async () => {
    registerSession('ws-1', await makeGit(), 'owner');
    const st = await gitStatusForSession('ws-1', 'owner');
    expect(st?.clean).toBe(true);
    expect(await gitStatusForSession('nope', 'owner')).toBeNull();
    expect(await gitStatusForSession('ws-1', 'attacker')).toBeNull();
  });

  it('execInSession runs a bounded command for the owner and returns real output', async () => {
    const shell = new FakeShell();
    const git = new GitManager(shell, 'ws');
    await git.ensureRepo();
    registerSession('ws-1', git, 'owner', shell);
    const r = await execInSession('ws-1', 'echo hi', 'owner');
    expect(r.available).toBe(true);
    expect(r.stdout).toContain('hello from sandbox');
    expect(shell.lastCommand).toContain('timeout 30 bash -lc');
  });

  it('execInSession is unavailable for unknown / wrong-owner / no-runner sessions', async () => {
    registerSession('ws-1', await makeGit(), 'owner'); // no runner passed
    expect((await execInSession('ws-1', 'ls', 'owner')).available).toBe(false);
    expect((await execInSession('nope', 'ls', 'owner')).available).toBe(false);
    const shell = new FakeShell();
    const g = new GitManager(shell, 'ws'); await g.ensureRepo();
    registerSession('ws-2', g, 'owner', shell);
    expect((await execInSession('ws-2', 'ls', 'attacker')).available).toBe(false);
  });
});
