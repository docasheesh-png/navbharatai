import { describe, it, expect } from 'vitest';
import { GitRepoSync } from './GitRepoSync';
import type { CommandRunner } from './GitManager';

/** A fake CommandRunner that records every command and replies from a scripted matcher. */
function fakeRunner(
  reply: (command: string) => { exitCode?: number; stdout?: string; stderr?: string },
): { runner: CommandRunner; commands: string[] } {
  const commands: string[] = [];
  const runner: CommandRunner = {
    async runCommand(_workspaceId, command) {
      commands.push(command);
      const r = reply(command);
      return { exitCode: r.exitCode ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    },
  };
  return { runner, commands };
}

const URL = 'https://x-access-token:ghs_tok@github.com/navbharatai-apps/app-u1-todo.git';

describe('GitRepoSync.hydrateFromRepo', () => {
  it('overlays the repo onto the sandbox when the repo has real content (resume restore)', async () => {
    const { runner, commands } = fakeRunner(() => ({ stdout: 'NB_HYDRATED' }));
    const res = await new GitRepoSync(runner, 'ws1').hydrateFromRepo(URL);
    expect(res).toEqual({ hydrated: true, hadFiles: false, skipped: false });
    expect(commands[0]).toContain('git clone');
    expect(commands[0]).toContain(URL); // the authed URL is handed to git
    expect(commands[0]).toContain('package.json'); // only overlays when the REPO has a built project
  });

  it('keeps the scaffold (no restore) when the repo is new/empty (first build)', async () => {
    const { runner } = fakeRunner(() => ({ stdout: 'NB_EMPTY_REPO' }));
    const res = await new GitRepoSync(runner, 'ws1').hydrateFromRepo(URL);
    expect(res).toEqual({ hydrated: false, hadFiles: false, skipped: false });
  });

  it('degrades to skipped on a clone failure (no network / no git)', async () => {
    const { runner } = fakeRunner(() => ({ stdout: 'NB_CLONE_FAIL' }));
    const res = await new GitRepoSync(runner, 'ws1').hydrateFromRepo(URL);
    expect(res.skipped).toBe(true);
    expect(res.hydrated).toBe(false);
  });

  it('skips with no url, and never throws when the runner rejects', async () => {
    const noUrl = await new GitRepoSync(fakeRunner(() => ({})).runner, 'ws1').hydrateFromRepo('');
    expect(noUrl).toEqual({ hydrated: false, hadFiles: false, skipped: true });

    const throwing: CommandRunner = { async runCommand() { throw new Error('no shell'); } };
    const res = await new GitRepoSync(throwing, 'ws1').hydrateFromRepo(URL);
    expect(res.skipped).toBe(true);
  });
});

describe('GitRepoSync.pushAll', () => {
  it('commits and force-pushes HEAD to the branch', async () => {
    const { runner, commands } = fakeRunner((c) => {
      if (c.includes('git commit')) return { stdout: 'NB_COMMITTED' };
      if (c.includes('git push')) return { stdout: 'NB_PUSHED' };
      return {};
    });
    const res = await new GitRepoSync(runner, 'ws1').pushAll(URL, 'main', 'build: todo app');
    expect(res).toEqual({ pushed: true, noChange: false, skipped: false });
    const push = commands.find((c) => c.includes('git push'));
    expect(push).toContain('HEAD:main');
    expect(push).toContain('--force');
  });

  it('reports noChange when there was nothing to commit (still pushes the existing HEAD)', async () => {
    const { runner } = fakeRunner((c) => {
      if (c.includes('git commit')) return { stdout: 'NB_NOCHANGE' };
      if (c.includes('git push')) return { stdout: 'NB_PUSHED' };
      return {};
    });
    const res = await new GitRepoSync(runner, 'ws1').pushAll(URL, 'main', 'noop');
    expect(res).toEqual({ pushed: true, noChange: true, skipped: false });
  });

  it('degrades to skipped when the push fails', async () => {
    const { runner } = fakeRunner((c) => {
      if (c.includes('git commit')) return { stdout: 'NB_COMMITTED' };
      if (c.includes('git push')) return { stdout: 'NB_PUSHFAIL' };
      return {};
    });
    const res = await new GitRepoSync(runner, 'ws1').pushAll(URL, 'main', 'x');
    expect(res.pushed).toBe(false);
    expect(res.skipped).toBe(true);
  });

  it('sanitizes the branch name and commit message against shell injection', async () => {
    const { runner, commands } = fakeRunner((c) => {
      if (c.includes('git commit')) return { stdout: 'NB_COMMITTED' };
      if (c.includes('git push')) return { stdout: 'NB_PUSHED' };
      return {};
    });
    await new GitRepoSync(runner, 'ws1').pushAll(URL, 'feat/$(rm -rf)`evil`', 'msg "with" $danger `cmd`');
    const commit = commands.find((c) => c.includes('git commit'))!;
    const push = commands.find((c) => c.includes('git push'))!;
    expect(commit).not.toContain('`');
    expect(commit).not.toContain('$danger');
    expect(push).toContain('HEAD:feat/'); // branch prefix kept
    expect(push).not.toContain('$('); // shell metachars stripped from the ref
    expect(push).not.toContain('`');
  });

  it('skips with no url and never throws when the runner rejects', async () => {
    const noUrl = await new GitRepoSync(fakeRunner(() => ({})).runner, 'ws1').pushAll('', 'main', 'x');
    expect(noUrl.skipped).toBe(true);

    const throwing: CommandRunner = { async runCommand() { throw new Error('no shell'); } };
    const res = await new GitRepoSync(throwing, 'ws1').pushAll(URL, 'main', 'x');
    expect(res.skipped).toBe(true);
  });
});
