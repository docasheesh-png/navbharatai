// Forensic audit 2026-10-04 (P0) — a GitHub credential used for a clone or push never stays on disk in the
// user's sandbox.
//
// `git clone <url-with-token>` records that URL as `origin` in `.git/config`, and the hydrate overlay
// copied `.git` into the workspace. On the platform-org path the token is a GitHub App INSTALLATION token
// for the whole organisation — readable by any user with `cat .git/config` in the terminal.

import { describe, it, expect } from 'vitest';
import { GitRepoSync, credentialFreeRepoUrl } from '../src/server/AgentV3/GitRepoSync';
import type { CommandRunner } from '../src/server/AgentV3/GitManager';

const AUTHED = 'https://x-access-token:ghs_ORGWIDE@github.com/navbharatai-apps/app-u1-todo.git';
const PUBLIC = 'https://github.com/navbharatai-apps/app-u1-todo.git';

function recorder(stdout = 'NB_HYDRATED'): { runner: CommandRunner; commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    runner: { async runCommand(_ws, command) { commands.push(command); return { exitCode: 0, stdout, stderr: '' }; } },
  };
}

describe('the credential-free URL', () => {
  it('both token shapes are stripped; a plain URL is unchanged', () => {
    expect(credentialFreeRepoUrl(AUTHED)).toBe(PUBLIC);
    expect(credentialFreeRepoUrl('https://ghp_abc@github.com/o/r')).toBe('https://github.com/o/r');
    expect(credentialFreeRepoUrl(PUBLIC)).toBe(PUBLIC);
  });
});

describe('hydrate rewrites origin BEFORE .git reaches the workspace', () => {
  it('set-url to the credential-free URL comes before the copy, and the copy never carries the token', async () => {
    const { runner, commands } = recorder();
    const r = await new GitRepoSync(runner, 'ws').hydrateFromRepo(AUTHED);
    expect(r.hydrated).toBe(true);
    const cmd = commands.join('\n');
    const setUrl = cmd.indexOf(`git -C /tmp/nbhydrate remote set-url origin "${PUBLIC}"`);
    const copy = cmd.indexOf('cp -R --preserve=mode,timestamps /tmp/nbhydrate/. ./');
    expect(setUrl).toBeGreaterThan(-1);
    expect(copy).toBeGreaterThan(setUrl);
  });
});

describe('a push scrubs an origin written before this fix', () => {
  it('the setup step rewrites origin to the credential-free URL', async () => {
    const { runner, commands } = recorder('NB_COMMITTED NB_PUSHED');
    await new GitRepoSync(runner, 'ws').pushAll(AUTHED, 'main', 'sync');
    expect(commands[0]).toContain(`git remote set-url origin "${PUBLIC}"`);
    expect(commands[0]).not.toContain('ghs_ORGWIDE');
  });
});
