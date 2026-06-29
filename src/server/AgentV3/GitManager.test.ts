import { describe, it, expect } from 'vitest';
import { GitManager, type CommandRunner } from './GitManager';

class FakeShell implements CommandRunner {
  calls: string[] = [];
  head = 'abc1234def5678';
  async runCommand(_w: string, command: string) {
    this.calls.push(command);
    if (command.includes('rev-parse HEAD')) {
      return { exitCode: 0, stdout: `${this.head}\n`, stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  }
}

class NoShell implements CommandRunner {
  async runCommand(): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    throw new Error('runCommand requires a real sandbox');
  }
}

describe('GitManager', () => {
  it('initialises a repo and creates a real checkpoint with the HEAD sha', async () => {
    const shell = new FakeShell();
    const git = new GitManager(shell, 'ws-1');
    expect(await git.ensureRepo()).toBe(true);

    const cp = await git.checkpoint('create src/App.tsx');
    expect(cp).not.toBeNull();
    expect(cp!.sha).toBe('abc1234def5678');
    expect(cp!.message).toBe('create src/App.tsx');
    // It staged + committed before reading HEAD.
    expect(shell.calls.some((c) => c.includes('git add -A') && c.includes('git commit'))).toBe(true);
  });

  it('writes a .gitignore (node_modules etc.) at init so checkpoints never stage deps', async () => {
    const shell = new FakeShell();
    const git = new GitManager(shell, 'ws-1');
    await git.ensureRepo();
    // node_modules must be ignored BEFORE git init, so `git add -A` stays cheap.
    const gitignoreCall = shell.calls.find((c) => c.includes('.gitignore'));
    expect(gitignoreCall).toBeTruthy();
    expect(gitignoreCall).toContain('node_modules/');
    const ignoreIdx = shell.calls.findIndex((c) => c.includes('.gitignore'));
    const initIdx = shell.calls.findIndex((c) => c.includes('git init'));
    expect(ignoreIdx).toBeLessThan(initIdx); // gitignore first, then init
    // It also untracks heavy dirs an older sandbox may have already committed.
    expect(shell.calls.some((c) => c.includes('git rm -r --cached') && c.includes('node_modules'))).toBe(true);
  });

  it('sanitises commit messages (no quotes/newlines/backticks)', async () => {
    const shell = new FakeShell();
    const git = new GitManager(shell, 'ws-1');
    await git.ensureRepo();
    const cp = await git.checkpoint('add "weird" `msg`\nwith newline');
    expect(cp!.message).not.toMatch(/["`\n]/);
  });

  it('degrades to no-op on a sandbox without a shell', async () => {
    const git = new GitManager(new NoShell(), 'ws-1');
    expect(await git.ensureRepo()).toBe(false);
    expect(await git.checkpoint('x')).toBeNull();
    expect(await git.restore('abc1234')).toBe(false);
  });

  it('rejects an invalid restore sha', async () => {
    const git = new GitManager(new FakeShell(), 'ws-1');
    await git.ensureRepo();
    expect(await git.restore('not-a-sha!')).toBe(false);
  });
});
