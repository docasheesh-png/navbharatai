import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { registerSession, getSession, restoreSession, gitStatusForSession, execInSession, ptyHostForSession, sessionCount, _clearSessions, bindSessionReconnectForTests } from './WorkspaceRegistry';
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
  afterEach(() => {
    vi.useRealTimers();
    bindSessionReconnectForTests(null);
    _clearSessions();
  });

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

  it('slides the TTL: used at 1h50m, still alive at 2h10m; idle for more than 2h expires', async () => {
    const used = await makeGit();
    const idle = await makeGit();
    const exact = await makeGit();
    vi.useFakeTimers();
    const t0 = new Date('2026-01-01T00:00:00.000Z').getTime();
    vi.setSystemTime(t0);
    registerSession('ws-ttl', used, 'owner');
    registerSession('ws-idle', idle, 'owner');
    // Last use of ws-ttl at t = 1h50m. Created-at expiry would already be close; sliding must not care.
    vi.setSystemTime(t0 + (1 * 60 + 50) * 60 * 1000);
    expect(getSession('ws-ttl')?.userId).toBe('owner');
    // t = 2h10m is only 20 minutes after that use — still inside the 2h window.
    vi.setSystemTime(t0 + (2 * 60 + 10) * 60 * 1000);
    expect(getSession('ws-ttl')?.workspaceId).toBe('ws-ttl');
    // ws-idle was never touched after register, so it has been idle for 2h10m.
    expect(getSession('ws-idle')).toBeUndefined();

    // Exactly 2h of idle is still alive (`now - lastUsedAt > TTL`, not `>=`). One more millisecond is not.
    vi.setSystemTime(t0);
    registerSession('ws-exact', exact, 'owner');
    vi.setSystemTime(t0 + 2 * 60 * 60 * 1000);
    expect(getSession('ws-exact')?.workspaceId).toBe('ws-exact');
    _clearSessions();
    vi.setSystemTime(t0);
    registerSession('ws-over', exact, 'owner');
    vi.setSystemTime(t0 + 2 * 60 * 60 * 1000 + 1);
    expect(getSession('ws-over')).toBeUndefined();
  });

  it('exec on a miss uses the reconnect runner; a null reconnect stays offline', async () => {
    const shell = new FakeShell();
    bindSessionReconnectForTests(async (workspaceId, userId) => {
      expect(workspaceId).toBe('ws-cold');
      expect(userId).toBe('owner');
      return shell;
    });
    const r = await execInSession('ws-cold', 'echo hi', 'owner');
    expect(r.available).toBe(true);
    expect(r.stdout).toContain('hello from sandbox');
    expect(getSession('ws-cold')?.userId).toBe('owner');

    bindSessionReconnectForTests(async () => null);
    expect((await execInSession('ws-nobody', 'ls', 'owner')).available).toBe(false);
  });

  it('does not rehydrate a session the caller does not own, and a PTY miss does not reconnect', async () => {
    let calls = 0;
    bindSessionReconnectForTests(async () => { calls += 1; return new FakeShell(); });
    registerSession('ws-owned', await makeGit(), 'owner', new FakeShell());
    expect((await execInSession('ws-owned', 'ls', 'attacker')).available).toBe(false);
    expect(ptyHostForSession('ws-missing', 'owner')).toBeUndefined();
    expect(calls).toBe(0);
  });

  it('production /exec wires the reconnect hook to the durable sandbox record', () => {
    const routes = readFileSync(new URL('../routes/agentv3.ts', import.meta.url), 'utf8');
    expect(routes).toContain('bindSessionReconnectForTests');
    expect(routes).toContain('sandboxStore.getRecord(workspaceId)');
    expect(routes).toContain('rec.userId !== userId');
    // The PTY path stays a memory lookup — the 409 lives on stream/input/resize, not on /shell/open.
    const open = routes.slice(routes.indexOf("app.post('/api/agentv3/shell/open'"), routes.indexOf("app.get('/api/agentv3/shell/stream'"));
    expect(open).not.toContain('SHELL_NOT_ON_THIS_INSTANCE');
    expect(routes).toContain("code: 'SHELL_NOT_ON_THIS_INSTANCE'");
  });
});
