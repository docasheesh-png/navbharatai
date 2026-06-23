import { describe, it, expect, beforeEach } from 'vitest';
import { registerSession, getSession, restoreSession, sessionCount, _clearSessions } from './WorkspaceRegistry';
import { GitManager, type CommandRunner } from './GitManager';

class FakeShell implements CommandRunner {
  async runCommand(_w: string, command: string) {
    if (command.includes('rev-parse HEAD')) return { exitCode: 0, stdout: 'abc1234\n', stderr: '' };
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
});
