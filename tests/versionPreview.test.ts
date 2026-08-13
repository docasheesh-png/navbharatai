/**
 * Looking at an old version must not cost the present.
 *
 * Two properties carry this feature, and both are tested here rather than trusted:
 *
 * 1. 🔒 A URL is NEVER returned unless a server really answered on that port. The whole reason
 *    per-version preview is worth building is that today the only way to see an old version is a
 *    destructive restore; a preview that hands back a dead URL would send the user to restore anyway,
 *    having wasted their time and taught them not to trust the button.
 *
 * 2. 🔒 The LIVE workspace is never touched. Every command this module emits either creates a sibling
 *    directory under /home/user/.nbai-versions or reads from git — and a failure cleans up after
 *    itself. A version preview that could damage the working tree would be strictly worse than the
 *    restore it exists to make unnecessary.
 */

import { describe, it, expect } from 'vitest';
import {
  isValidSha,
  versionDir,
  slotPort,
  shaExistsCommand,
  worktreeAddCommand,
  linkModulesCommand,
  startVersionServerCommand,
  healthCommand,
  isHealthy,
  stopVersionCommand,
  stampVersionCommand,
  listLiveVersionsCommand,
  parseLiveVersions,
  shellQuote,
  versionsToRetire,
  freeSlot,
  planVersionSlot,
  versionPreviewMessage,
  startVersionPreview,
  patchViteConfigForHost,
  readSandboxFile,
  WORKSPACE_ROOT,
  VERSIONS_ROOT,
  VERSION_PORT_BASE,
  MAX_LIVE_VERSIONS,
  type VersionPreviewDeps,
} from '../src/server/AgentV3/versionPreview';

const SHA = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

/** A fake sandbox: `answers` maps a substring of the command to its result. */
function fakeSandbox(answers: Array<[RegExp | string, Partial<{ exitCode: number; stdout: string }>]>) {
  const seen: string[] = [];
  const run = async (command: string) => {
    seen.push(command);
    for (const [match, out] of answers) {
      const hit = typeof match === 'string' ? command.includes(match) : match.test(command);
      if (hit) return { exitCode: out.exitCode ?? 0, stdout: out.stdout ?? '', stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  return { run, seen };
}

const deps = (
  answers: Array<[RegExp | string, Partial<{ exitCode: number; stdout: string }>]>,
  over: Partial<VersionPreviewDeps> = {},
): VersionPreviewDeps & { seen: string[] } => {
  const sb = fakeSandbox(answers);
  return {
    run: sb.run,
    portUrl: async (p) => `https://${p}-sandbox.e2b.app`,
    sandboxWarm: async () => true,
    sleep: async () => undefined,
    now: (() => { let t = 0; return () => (t += 1000); })(),
    seen: sb.seen,
    ...over,
  };
};

describe('sha and path safety', () => {
  it('accepts real shas and rejects anything that could reach the shell', () => {
    expect(isValidSha(SHA)).toBe(true);
    expect(isValidSha('a1b2c3d')).toBe(true);
    for (const bad of ['', 'abc', 'main', '../../etc', 'a1b2c3d; rm -rf /', 'a1b2c3d$(whoami)', 'zzzzzzz', null, 42]) {
      expect(isValidSha(bad as never), String(bad)).toBe(false);
    }
  });

  it('🔒 a version directory is always a sibling of the workspace, never inside it', () => {
    // Anything written INTO the workspace would be picked up as the user's own file by the next build.
    expect(versionDir(SHA).startsWith(`${VERSIONS_ROOT}/`)).toBe(true);
    expect(versionDir(SHA).startsWith(WORKSPACE_ROOT)).toBe(false);
    expect(versionDir(SHA)).not.toContain('..');
  });

  it('🔒 version ports sit clear of every framework default', () => {
    // A collision would not merely fail — it would show the user the WRONG version, silently.
    for (const framework of [3000, 4200, 4321, 5000, 5173, 5174, 8000]) {
      for (let s = 0; s < MAX_LIVE_VERSIONS; s += 1) expect(slotPort(s)).not.toBe(framework);
    }
    expect(slotPort(0)).toBe(VERSION_PORT_BASE);
    expect(slotPort(1)).toBe(VERSION_PORT_BASE + 1);
  });

  it('quotes for the shell by closing and reopening the quote', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote('plain')).toBe(`'plain'`);
  });
});

describe('the commands it emits', () => {
  it('checks the commit is really in this sandbox before trying to use it', () => {
    expect(shaExistsCommand(SHA)).toContain('cat-file -e');
    expect(shaExistsCommand(SHA)).toContain('HAVE_IT');
  });

  it('🔒 checks out DETACHED — a preview is a look, never a branch to commit onto', () => {
    expect(worktreeAddCommand(SHA)).toContain('worktree add --detach');
  });

  it('🔒 no command it emits can write into the live workspace', () => {
    const dir = versionDir(SHA);
    for (const cmd of [
      worktreeAddCommand(SHA),
      linkModulesCommand(SHA),
      startVersionServerCommand(SHA, 5310, 'npm run dev'),
      stopVersionCommand(SHA, 5310),
      stampVersionCommand(SHA, 5310),
    ]) {
      // Every destructive verb must be aimed at the version directory, never the workspace root.
      for (const m of cmd.matchAll(/\b(rm -rf|>|ln -sfn)\s+(\S+)/g)) {
        const target = m[2];
        if (target.startsWith(WORKSPACE_ROOT)) {
          expect(target, `${m[1]} aimed at the live workspace in: ${cmd}`).toBe(`${WORKSPACE_ROOT}/node_modules`);
        } else {
          expect(target.startsWith(dir) || target.startsWith(VERSIONS_ROOT), `${m[1]} ${target}`).toBe(true);
        }
      }
    }
  });

  it('🔒 the shared node_modules is the SOURCE of the symlink, never the target', () => {
    // Reversed, this would replace the live app's dependencies with the old version's — the one way
    // this feature could actually break the user's working app.
    expect(linkModulesCommand(SHA)).toBe(`ln -sfn ${WORKSPACE_ROOT}/node_modules ${versionDir(SHA)}/node_modules`);
  });

  it('🔒 detaches the dev server from stdio, or it SIGPIPEs itself dead after "ready"', () => {
    const cmd = startVersionServerCommand(SHA, 5310, 'npm run dev');
    expect(cmd).toContain('setsid');
    expect(cmd).toContain('nohup');
    expect(cmd).toContain('> ');            // output to a file
    expect(cmd).toContain('< /dev/null');   // and no stdin to lose
  });

  it('stopping frees the port AND removes the checkout', () => {
    const cmd = stopVersionCommand(SHA, 5310);
    expect(cmd).toContain('5310/tcp');
    expect(cmd).toContain(`rm -rf ${versionDir(SHA)}`);
    expect(cmd).toContain('worktree prune');
  });
});

describe('health', () => {
  it('any HTTP status proves a server is there — even a 500', () => {
    expect(isHealthy('200')).toBe(true);
    expect(isHealthy('500')).toBe(true);
    expect(isHealthy('403')).toBe(true);
    expect(isHealthy(' 302\n')).toBe(true);
  });

  it('curl’s "nothing answered" is not health', () => {
    expect(isHealthy('000')).toBe(false);
    expect(isHealthy('')).toBe(false);
    expect(isHealthy('curl: (7) Failed to connect')).toBe(false);
  });

  it('probes loopback, not the public host', () => {
    expect(healthCommand(5310)).toContain('127.0.0.1:5310');
  });
});

describe('🔒 live state is read from the sandbox, not from this process', () => {
  it('lists what is really running', () => {
    expect(listLiveVersionsCommand()).toContain(VERSIONS_ROOT);
    expect(listLiveVersionsCommand()).toContain('.nbai-port');
  });

  it('parses the listing and skips anything malformed instead of guessing', () => {
    const out = parseLiveVersions([
      `${SHA.slice(0, 12)} 5310 1700000000000`,
      'notasha 5311 1700000000001',
      `${SHA.slice(0, 12)} notaport 1700000000002`,
      `b1b2c3d4e5f6 5311 1700000000003`,
      '',
    ].join('\n'));
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ sha: SHA.slice(0, 12), port: 5310, startedAt: 1700000000000 });
    expect(out[1].port).toBe(5311);
  });

  it('rejects a port below the version range — that would be the app’s own dev server', () => {
    expect(parseLiveVersions(`${SHA.slice(0, 12)} 5173 1`)).toEqual([]);
  });

  it('a missing start time degrades to 0 rather than NaN', () => {
    expect(parseLiveVersions(`${SHA.slice(0, 12)} 5310`)[0].startedAt).toBe(0);
  });
});

type LiveVersionish = { sha: string; port: number; startedAt: number };

describe('slots and retirement', () => {
  const v = (sha: string, port: number, startedAt: number): LiveVersionish => ({ sha, port, startedAt });

  it('retires nothing while there is room', () => {
    expect(versionsToRetire([], SHA)).toEqual([]);
    expect(versionsToRetire([v('aaaaaaa', 5310, 1)], SHA)).toEqual([]);
  });

  it('retires the OLDEST when the cap is reached', () => {
    const retire = versionsToRetire([v('aaaaaaa', 5310, 100), v('bbbbbbb', 5311, 50)], SHA);
    expect(retire.map((r) => r.sha)).toEqual(['bbbbbbb']);
  });

  it('🔒 re-opening a version already live retires nothing — it is a refresh, not a third preview', () => {
    expect(versionsToRetire([v(SHA, 5310, 1), v('bbbbbbb', 5311, 2)], SHA)).toEqual([]);
  });

  it('is case-insensitive about the sha, as git is', () => {
    expect(versionsToRetire([v(SHA.toUpperCase(), 5310, 1), v('bbbbbbb', 5311, 2)], SHA)).toEqual([]);
  });

  it('🔒 REGRESSION — re-opening a LIVE version stops it first and REUSES its slot', () => {
    // The leak this encodes: retirement correctly returns [] for a refresh, so the slot used to be
    // chosen from a list that still counted the old server. The refresh took a SECOND port while
    // worktreeAddCommand deleted the directory out from under the first, leaving an orphan process
    // bound to the old port with no stamp for any instance to find it by. Only showed up on the
    // second tap of the same button.
    const plan = planVersionSlot([v(SHA.slice(0, 12), 5310, 100)], SHA);
    expect(plan.toStop.map((s) => s.sha)).toEqual([SHA.slice(0, 12)]);
    expect(plan.slot).toBe(0); // its OWN slot back, not a second one
  });

  it('🔒 a refresh at full capacity does not evict the other version', () => {
    const plan = planVersionSlot([v(SHA.slice(0, 12), 5310, 100), v('bbbbbbbbbbbb', 5311, 200)], SHA);
    expect(plan.toStop.map((s) => s.sha)).toEqual([SHA.slice(0, 12)]);
    expect(plan.slot).toBe(0);
  });

  it('a NEW version at full capacity evicts the oldest and takes its slot', () => {
    const plan = planVersionSlot([v('aaaaaaaaaaaa', 5310, 500), v('bbbbbbbbbbbb', 5311, 100)], SHA);
    expect(plan.toStop.map((s) => s.sha)).toEqual(['bbbbbbbbbbbb']);
    expect(plan.slot).toBe(1); // the evicted one's slot
  });

  it('🔒 the chosen slot is NEVER one that stays occupied', () => {
    const cases: LiveVersionish[][] = [
      [],
      [v('aaaaaaaaaaaa', 5310, 1)],
      [v('aaaaaaaaaaaa', 5311, 1)],
      [v('aaaaaaaaaaaa', 5310, 1), v('bbbbbbbbbbbb', 5311, 2)],
      [v(SHA.slice(0, 12), 5310, 1), v('bbbbbbbbbbbb', 5311, 2)],
      [v(SHA.slice(0, 12), 5311, 1), v('bbbbbbbbbbbb', 5310, 2)],
    ];
    for (const live of cases) {
      const { toStop, slot } = planVersionSlot(live, SHA);
      const stopped = new Set(toStop.map((s) => s.sha));
      const stillRunning = live.filter((x) => !stopped.has(x.sha)).map((x) => x.port);
      expect(stillRunning, JSON.stringify(live)).not.toContain(slotPort(slot));
    }
  });

  it('🔒 never stops the same version twice — one stop command per server', () => {
    const plan = planVersionSlot([v(SHA.slice(0, 12), 5310, 1), v('bbbbbbbbbbbb', 5311, 2)], SHA);
    expect(new Set(plan.toStop.map((s) => s.sha)).size).toBe(plan.toStop.length);
  });

  it('picks the lowest free slot so a retired port is reused immediately', () => {
    expect(freeSlot([])).toBe(0);
    expect(freeSlot([{ port: 5310 }])).toBe(1);
    expect(freeSlot([{ port: 5311 }])).toBe(0);
  });
});

describe('🔒 startVersionPreview never returns a URL it cannot prove', () => {
  const b64 = (s: string) => Buffer.from(s).toString('base64');
  // Matched by PATH, not just by "base64" — the module reads two different files through the same
  // round-trip, and a fixture that cannot tell them apart proves nothing about either.
  const happy: Array<[RegExp | string, Partial<{ exitCode: number; stdout: string }>]> = [
    ['cat-file', { stdout: 'HAVE_IT' }],
    [/base64 -w0 \S*vite\.config\.ts/, { stdout: b64('export default { plugins: [] }') }],
    [/base64 -w0 \S*package\.json/, { stdout: b64('{"scripts":{"dev":"vite"},"devDependencies":{"vite":"^5"}}') }],
    ['curl', { stdout: '200' }],
  ];

  it('returns the URL when a server really answers', async () => {
    const d = deps(happy);
    const res = await startVersionPreview(SHA, 0, d);
    expect(res.ok).toBe(true);
    expect(res.reason).toBe('ok');
    expect(res.url).toBe('https://5310-sandbox.e2b.app');
    expect(res.port).toBe(5310);
  });

  it('a cold sandbox is its own answer, not a failure to open the version', async () => {
    const res = await startVersionPreview(SHA, 0, deps(happy, { sandboxWarm: async () => false }));
    expect(res.reason).toBe('sandbox-cold');
    expect(res.url).toBeUndefined();
  });

  it('🔒 a commit git does not have says so — the user cannot restore it either', async () => {
    const res = await startVersionPreview(SHA, 0, deps([['cat-file', { stdout: '' }]]));
    expect(res.reason).toBe('version-not-in-sandbox');
    expect(res.message).toContain('cannot be previewed or restored');
  });

  it('an invalid sha never reaches the shell', async () => {
    const d = deps(happy);
    const res = await startVersionPreview('; rm -rf /', 0, d);
    expect(res.ok).toBe(false);
    expect(d.seen).toEqual([]);
  });

  it('🔒 a version that never comes up returns NO url and CLEANS UP after itself', async () => {
    const d = deps([['cat-file', { stdout: 'HAVE_IT' }], ['curl', { stdout: '000' }]]);
    const res = await startVersionPreview(SHA, 0, d);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('server-did-not-start');
    expect(res.url).toBeUndefined();
    // A dead checkout left behind would accumulate across a long session and cost real memory.
    expect(d.seen.some((c) => c.includes('rm -rf') && c.includes(versionDir(SHA)))).toBe(true);
  });

  it('says WHY it did not come up, since the cause is usually the old dependencies', async () => {
    const res = await startVersionPreview(SHA, 0, deps([['cat-file', { stdout: 'HAVE_IT' }], ['curl', { stdout: '000' }]]));
    expect(res.message).toContain('different dependencies');
    expect(res.message).toContain('current files were not touched');
  });

  it('a failed worktree stops there and reports honestly', async () => {
    const res = await startVersionPreview(SHA, 0, deps([
      ['cat-file', { stdout: 'HAVE_IT' }],
      ['worktree add', { exitCode: 1 }],
    ]));
    expect(res.reason).toBe('worktree-failed');
  });

  it('🔒 stamps the port BEFORE starting, so no server can be left invisible to other instances', async () => {
    const d = deps(happy);
    await startVersionPreview(SHA, 0, d);
    const stamp = d.seen.findIndex((c) => c.includes('.nbai-port'));
    const start = d.seen.findIndex((c) => c.includes('setsid'));
    expect(stamp).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(stamp);
  });

  it('🔒 patches the OLD vite config, or the version answers 403 "Blocked request"', async () => {
    const d = deps(happy);
    await startVersionPreview(SHA, 0, d);
    expect(d.seen.some((c) => c.includes('base64 -d'))).toBe(true);
  });

  it('a portUrl that fails is a failure, not a blank URL', async () => {
    const res = await startVersionPreview(SHA, 0, deps(happy, { portUrl: async () => { throw new Error('no host'); } }));
    expect(res.ok).toBe(false);
    expect(res.url).toBeUndefined();
  });

  it('every reason has a message, and none of them names a vendor', async () => {
    for (const r of ['ok', 'sandbox-cold', 'version-not-in-sandbox', 'worktree-failed', 'server-did-not-start'] as const) {
      const m = versionPreviewMessage(r);
      expect(m.length).toBeGreaterThan(10);
      expect(m).not.toMatch(/e2b|git |vite|npm|worktree/i);
    }
  });
});

describe('vite config patching', () => {
  it('writes back only when the guard actually changed something', async () => {
    const unpatched = 'export default { server: { allowedHosts: true } }';
    const d = deps([['base64 -w0', { stdout: Buffer.from(unpatched).toString('base64') }]]);
    expect(await patchViteConfigForHost('/tmp/x', d)).toBe(false);
    expect(d.seen.some((c) => c.includes('base64 -d'))).toBe(false);
  });

  it('does nothing at all when the version has no vite config', async () => {
    const d = deps([['base64 -w0', { stdout: '' }]]);
    expect(await patchViteConfigForHost('/tmp/x', d)).toBe(false);
  });
});

describe('readSandboxFile', () => {
  it('round-trips through base64 so no file content can break the command carrying it', async () => {
    const nasty = `a'b"c$(whoami)\n\`x\``;
    const d = deps([['base64 -w0', { stdout: Buffer.from(nasty).toString('base64') }]]);
    expect(await readSandboxFile('/tmp/f', d)).toBe(nasty);
  });

  it('an absent file is empty, not an error', async () => {
    expect(await readSandboxFile('/tmp/f', deps([['base64 -w0', { stdout: '' }]]))).toBe('');
  });
});
