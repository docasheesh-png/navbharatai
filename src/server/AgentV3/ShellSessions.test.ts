import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  openShell,
  readShell,
  writeShell,
  resizeShell,
  closeShell,
  getShell,
  subscribeShell,
  shellsForWorkspace,
  sweepShells,
  shellCount,
  isPtyHost,
  _clearShells,
  MAX_SCROLLBACK,
  MAX_SHELLS_PER_WORKSPACE,
  MAX_INPUT_CHARS,
  IDLE_TIMEOUT_MS,
  type PtyHost,
} from './ShellSessions';

/**
 * A fake sandbox that behaves like a real PTY: it hands back the onData/onExit callbacks so a test
 * can push output and exit the process exactly when it wants. The point of these tests is the
 * SESSION layer — scrollback, cursors, ownership, limits, reaping — which is where a persistent
 * shell either tells the truth about itself or quietly loses a user's output.
 */
function fakeHost() {
  const opened: {
    pid: number;
    workspaceId: string;
    cols: number;
    rows: number;
    emit: (chunk: string) => void;
    exit: (code?: number) => void;
  }[] = [];
  const writes: { pid: number; data: string }[] = [];
  const resizes: { pid: number; cols: number; rows: number }[] = [];
  const kills: number[] = [];
  let nextPid = 100;
  let failNext = false;

  const host: PtyHost = {
    async openPty(workspaceId, opts) {
      if (failNext) { failNext = false; throw new Error('sandbox refused'); }
      nextPid += 1;
      opened.push({
        pid: nextPid,
        workspaceId,
        cols: opts.cols,
        rows: opts.rows,
        emit: (c) => opts.onData(c),
        exit: (code) => opts.onExit(code),
      });
      return { pid: nextPid };
    },
    async writePty(_w, pid, data) { writes.push({ pid, data }); },
    async resizePty(_w, pid, cols, rows) { resizes.push({ pid, cols, rows }); },
    async killPty(_w, pid) { kills.push(pid); return true; },
  };

  return { host, opened, writes, resizes, kills, failOpen: () => { failNext = true; } };
}

beforeEach(() => { _clearShells(); });

describe('isPtyHost', () => {
  it('accepts a complete PTY host and rejects a plain command runner', () => {
    const { host } = fakeHost();
    expect(isPtyHost(host)).toBe(true);
    // LocalActuator-shaped: runs commands, has no TTY. Must be rejected so the UI says
    // "sandbox not active" instead of showing a shell that swallows every keystroke.
    expect(isPtyHost({ runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }) })).toBe(false);
    expect(isPtyHost(null)).toBe(false);
    expect(isPtyHost(undefined)).toBe(false);
  });

  it('rejects a host that is only PARTIALLY implemented', () => {
    // A half-host is worse than none: open would work and Ctrl+C would silently do nothing.
    expect(isPtyHost({ openPty: () => {}, writePty: () => {} })).toBe(false);
  });
});

describe('openShell', () => {
  it('starts a real PTY and reports it as alive', async () => {
    const { host, opened } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1', cols: 120, rows: 40 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(opened).toHaveLength(1);
    expect(opened[0].workspaceId).toBe('ws1');
    expect(opened[0].cols).toBe(120);
    expect(opened[0].rows).toBe(40);
    expect(getShell(r.shell.shellId, 'u1')?.alive).toBe(true);
  });

  it('answers no_sandbox — never a fake shell — when the workspace has no PTY host', async () => {
    const r = await openShell('ws1', undefined, { userId: 'u1' });
    expect(r).toEqual({ ok: false, reason: 'no_sandbox' });
    expect(shellCount()).toBe(0);
  });

  it('reports failure honestly and leaves NO orphan session when the sandbox refuses', async () => {
    const { host, failOpen } = fakeHost();
    failOpen();
    const r = await openShell('ws1', host, { userId: 'u1' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('failed');
    // The session is registered before the PTY starts (so no output is dropped) — a failed open must
    // therefore un-register it, or the workspace leaks a slot toward MAX_SHELLS_PER_WORKSPACE.
    expect(shellCount()).toBe(0);
    expect(shellsForWorkspace('ws1')).toHaveLength(0);
  });

  it('caps concurrent shells per workspace', async () => {
    const { host } = fakeHost();
    for (let i = 0; i < MAX_SHELLS_PER_WORKSPACE; i += 1) {
      expect((await openShell('ws1', host, { userId: 'u1' })).ok).toBe(true);
    }
    const over = await openShell('ws1', host, { userId: 'u1' });
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.reason).toBe('too_many');
    // The cap is PER WORKSPACE — a different project must not be blocked by this one.
    expect((await openShell('ws2', host, { userId: 'u1' })).ok).toBe(true);
  });

  it('clamps absurd terminal dimensions instead of passing them to the sandbox', async () => {
    const { host, opened } = fakeHost();
    await openShell('ws1', host, { cols: -5, rows: 99999 });
    expect(opened[0].cols).toBeGreaterThanOrEqual(1);
    expect(opened[0].rows).toBeLessThanOrEqual(500);
  });

  it('falls back to a standard 80x24 when the client sends nothing usable', async () => {
    const { host, opened } = fakeHost();
    await openShell('ws1', host, { cols: NaN, rows: undefined });
    expect(opened[0].cols).toBe(80);
    expect(opened[0].rows).toBe(24);
  });
});

describe('scrollback and cursors', () => {
  it('captures output produced before any reader attaches', async () => {
    // THE REGRESSION THIS LOCKS: the session must be registered BEFORE the PTY starts, or a shell's
    // opening banner (the prompt itself) is emitted into a session that does not exist yet.
    const { host, opened } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1' });
    if (!r.ok) throw new Error('open failed');
    opened[0].emit('user@sandbox:/workspace$ ');
    const read = readShell(r.shell.shellId, 0, 'u1');
    expect(read?.data).toBe('user@sandbox:/workspace$ ');
    expect(read?.cursor).toBe(25);
  });

  it('returns only what a reader missed, from its cursor', async () => {
    const { host, opened } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1' });
    if (!r.ok) throw new Error('open failed');
    opened[0].emit('hello ');
    const first = readShell(r.shell.shellId, 0, 'u1')!;
    expect(first.data).toBe('hello ');
    opened[0].emit('world');
    const second = readShell(r.shell.shellId, first.cursor, 'u1')!;
    expect(second.data).toBe('world');       // no duplicate of "hello "
    expect(second.truncated).toBe(false);
  });

  it('trims old scrollback but keeps the cursor monotonic and admits the truncation', async () => {
    const { host, opened } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1' });
    if (!r.ok) throw new Error('open failed');
    opened[0].emit('A'.repeat(MAX_SCROLLBACK));
    opened[0].emit('B'.repeat(1000));

    const all = readShell(r.shell.shellId, 0, 'u1')!;
    expect(all.cursor).toBe(MAX_SCROLLBACK + 1000);      // counts everything ever produced
    expect(all.data.length).toBe(MAX_SCROLLBACK);         // holds only the recent tail
    expect(all.data.endsWith('B'.repeat(10))).toBe(true); // the tail is the NEWEST output
    // A reader from 0 fell behind — saying so is the difference between "output was trimmed" and a
    // scrollback that silently has a hole in the middle.
    expect(all.truncated).toBe(true);

    const caughtUp = readShell(r.shell.shellId, MAX_SCROLLBACK + 500, 'u1')!;
    expect(caughtUp.truncated).toBe(false);
    expect(caughtUp.data).toBe('B'.repeat(500));
  });

  it('handles a cursor from the future without throwing or inventing output', async () => {
    const { host, opened } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1' });
    if (!r.ok) throw new Error('open failed');
    opened[0].emit('abc');
    const read = readShell(r.shell.shellId, 999_999, 'u1')!;
    expect(read.data).toBe('');
    expect(read.cursor).toBe(3);
  });
});

describe('subscribeShell', () => {
  it('pushes live output to every reader and stops after unsubscribe', async () => {
    const { host, opened } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1' });
    if (!r.ok) throw new Error('open failed');
    const a: string[] = [];
    const b: string[] = [];
    const offA = subscribeShell(r.shell.shellId, (c) => a.push(c), 'u1')!;
    subscribeShell(r.shell.shellId, (c) => b.push(c), 'u1');

    opened[0].emit('one');
    offA();
    opened[0].emit('two');

    expect(a).toEqual(['one']);
    expect(b).toEqual(['one', 'two']);   // the second tab keeps streaming
  });

  it('a throwing subscriber never stalls the shell or the other readers', async () => {
    const { host, opened } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1' });
    if (!r.ok) throw new Error('open failed');
    const good: string[] = [];
    subscribeShell(r.shell.shellId, () => { throw new Error('reader exploded'); }, 'u1');
    subscribeShell(r.shell.shellId, (c) => good.push(c), 'u1');

    expect(() => opened[0].emit('still works')).not.toThrow();
    expect(good).toEqual(['still works']);
    // Output still reached the scrollback, so a reconnecting reader loses nothing.
    expect(readShell(r.shell.shellId, 0, 'u1')?.data).toBe('still works');
  });

  it('refuses to subscribe to an unknown shell', () => {
    expect(subscribeShell('sh_nope', () => {}, 'u1')).toBeUndefined();
  });
});

describe('input, resize and interrupt', () => {
  it('sends keystrokes through to the TTY', async () => {
    const { host, writes } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1' });
    if (!r.ok) throw new Error('open failed');
    expect(await writeShell(r.shell.shellId, 'ls -la\r', 'u1')).toBe(true);
    expect(writes).toEqual([{ pid: r.shell.pid, data: 'ls -la\r' }]);
  });

  it('passes Ctrl+C through as the real control byte — no special-cased "interrupt" path', async () => {
    // A shell that only honours the signals we remembered to enumerate is a fake shell. \x03 must
    // reach the TTY untouched so the line discipline turns it into SIGINT, exactly as locally.
    const { host, writes } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1' });
    if (!r.ok) throw new Error('open failed');
    await writeShell(r.shell.shellId, '\x03', 'u1');
    expect(writes[0].data).toBe('\x03');
  });

  it('bounds a single write so a giant paste cannot be used as a firehose', async () => {
    const { host, writes } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1' });
    if (!r.ok) throw new Error('open failed');
    await writeShell(r.shell.shellId, 'x'.repeat(MAX_INPUT_CHARS * 3), 'u1');
    expect(writes[0].data.length).toBe(MAX_INPUT_CHARS);
  });

  it('reports failure instead of throwing when the sandbox write fails', async () => {
    const { host } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1' });
    if (!r.ok) throw new Error('open failed');
    vi.spyOn(host, 'writePty').mockRejectedValueOnce(new Error('sandbox gone'));
    expect(await writeShell(r.shell.shellId, 'ls', 'u1')).toBe(false);
  });

  it('forwards a resize so column-drawn output wraps correctly', async () => {
    const { host, resizes } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1' });
    if (!r.ok) throw new Error('open failed');
    expect(await resizeShell(r.shell.shellId, 200, 50, 'u1')).toBe(true);
    expect(resizes).toEqual([{ pid: r.shell.pid, cols: 200, rows: 50 }]);
  });

  it('ignores input and resize once the process has exited', async () => {
    const { host, opened, writes } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1' });
    if (!r.ok) throw new Error('open failed');
    opened[0].exit(0);
    expect(await writeShell(r.shell.shellId, 'ls', 'u1')).toBe(false);
    expect(await resizeShell(r.shell.shellId, 100, 30, 'u1')).toBe(false);
    expect(writes).toHaveLength(0);
  });
});

describe('exit', () => {
  it('marks the shell dead, records the code, and says so in the scrollback', async () => {
    const { host, opened } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1' });
    if (!r.ok) throw new Error('open failed');
    opened[0].emit('bye\r\n');
    opened[0].exit(1);

    const s = getShell(r.shell.shellId, 'u1')!;
    expect(s.alive).toBe(false);
    expect(s.exitCode).toBe(1);
    // The user must SEE that the process ended, not watch a terminal that just stops responding.
    expect(readShell(r.shell.shellId, 0, 'u1')?.data).toContain('process exited with code 1');
  });

  it('handles an exit with no code without printing "undefined"', async () => {
    const { host, opened } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1' });
    if (!r.ok) throw new Error('open failed');
    opened[0].exit(undefined);
    const out = readShell(r.shell.shellId, 0, 'u1')!.data;
    expect(out).toContain('process exited');
    expect(out).not.toContain('undefined');
  });
});

describe('ownership', () => {
  it('hides another user\'s shell from every operation', async () => {
    const { host, writes, kills } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'owner' });
    if (!r.ok) throw new Error('open failed');
    const id = r.shell.shellId;

    expect(getShell(id, 'intruder')).toBeUndefined();
    expect(readShell(id, 0, 'intruder')).toBeUndefined();
    expect(subscribeShell(id, () => {}, 'intruder')).toBeUndefined();
    expect(await writeShell(id, 'rm -rf /', 'intruder')).toBe(false);
    expect(await resizeShell(id, 10, 10, 'intruder')).toBe(false);
    expect(await closeShell(id, 'intruder')).toBe(false);

    // Nothing reached the sandbox, and the owner's shell is untouched.
    expect(writes).toHaveLength(0);
    expect(kills).toHaveLength(0);
    expect(getShell(id, 'owner')?.alive).toBe(true);
  });
});

describe('closeShell', () => {
  it('kills the PTY and forgets the session', async () => {
    const { host, kills } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1' });
    if (!r.ok) throw new Error('open failed');
    expect(await closeShell(r.shell.shellId, 'u1')).toBe(true);
    expect(kills).toEqual([r.shell.pid]);
    expect(getShell(r.shell.shellId, 'u1')).toBeUndefined();
    expect(shellCount()).toBe(0);
  });

  it('frees the per-workspace slot so a new terminal can be opened', async () => {
    const { host } = fakeHost();
    const ids: string[] = [];
    for (let i = 0; i < MAX_SHELLS_PER_WORKSPACE; i += 1) {
      const r = await openShell('ws1', host, { userId: 'u1' });
      if (r.ok) ids.push(r.shell.shellId);
    }
    expect((await openShell('ws1', host, { userId: 'u1' })).ok).toBe(false);
    await closeShell(ids[0], 'u1');
    expect((await openShell('ws1', host, { userId: 'u1' })).ok).toBe(true);
  });

  it('still forgets the session when the sandbox kill throws', async () => {
    const { host } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1' });
    if (!r.ok) throw new Error('open failed');
    vi.spyOn(host, 'killPty').mockRejectedValueOnce(new Error('sandbox already gone'));
    expect(await closeShell(r.shell.shellId, 'u1')).toBe(true);
    expect(shellCount()).toBe(0); // "already gone" is still closed — never a stuck ghost session
  });
});

describe('sweepShells', () => {
  it('reaps exited shells', async () => {
    const { host, opened } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1' });
    if (!r.ok) throw new Error('open failed');
    opened[0].exit(0);
    expect(await sweepShells()).toBe(1);
    expect(shellCount()).toBe(0);
  });

  it('kills an idle shell nobody is watching', async () => {
    const { host, kills } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1' });
    if (!r.ok) throw new Error('open failed');
    expect(await sweepShells(Date.now() + IDLE_TIMEOUT_MS + 1)).toBe(1);
    expect(kills).toEqual([r.shell.pid]);
    expect(shellCount()).toBe(0);
  });

  it('NEVER reaps a shell someone is streaming, however long it has been quiet', async () => {
    // The exact case this protects: a 40-minute `npm install` or a running dev server that prints
    // nothing for ages. Reaping that because it looked "idle" would kill the user's work.
    const { host, kills } = fakeHost();
    const r = await openShell('ws1', host, { userId: 'u1' });
    if (!r.ok) throw new Error('open failed');
    subscribeShell(r.shell.shellId, () => {}, 'u1');
    expect(await sweepShells(Date.now() + IDLE_TIMEOUT_MS * 10)).toBe(0);
    expect(kills).toHaveLength(0);
    expect(getShell(r.shell.shellId, 'u1')?.alive).toBe(true);
  });

  it('leaves a recently-used shell alone', async () => {
    const { host } = fakeHost();
    await openShell('ws1', host, { userId: 'u1' });
    expect(await sweepShells()).toBe(0);
    expect(shellCount()).toBe(1);
  });
});

describe('shellsForWorkspace', () => {
  it('lists only that workspace, oldest first', async () => {
    const { host } = fakeHost();
    const a = await openShell('ws1', host, { userId: 'u1' });
    const b = await openShell('ws1', host, { userId: 'u1' });
    await openShell('ws2', host, { userId: 'u1' });
    const list = shellsForWorkspace('ws1');
    expect(list).toHaveLength(2);
    if (a.ok && b.ok) expect(list.map((s) => s.shellId)).toEqual([a.shell.shellId, b.shell.shellId]);
  });
});
