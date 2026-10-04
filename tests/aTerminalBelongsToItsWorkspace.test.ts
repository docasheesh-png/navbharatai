// Forensic audit 2026-10-04 (P1) — a terminal is reachable only through the workspace it was opened in.
//
// The shell routes verified that the caller owns the workspaceId THEY sent, but the shell lookup checked
// only the CLAIMED body userId — and skipped the check entirely when no userId was sent. With shell ids of
// the form `sh_<time>_<counter>`, a caller could present their own workspace (passing the check) plus a
// victim's shell id and no userId, then read the victim's terminal and type commands into it.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  openShell, getShell, readShell, subscribeShell, writeShell, resizeShell, closeShell, _clearShells, type PtyHost,
} from '../src/server/AgentV3/ShellSessions';

function host(): { host: PtyHost; writes: string[] } {
  const writes: string[] = [];
  let pid = 1;
  return {
    writes,
    host: {
      async openPty() { pid += 1; return { pid }; },
      async writePty(_w, _p, data) { writes.push(data); },
      async resizePty() {},
      async killPty() { return true; },
      noteActivity() {},
    },
  };
}

beforeEach(() => { _clearShells(); });

describe('another workspace — even one the caller really owns — reaches nothing', () => {
  it('every operation refuses a shell id presented with a different workspace', async () => {
    const { host: h, writes } = host();
    const r = await openShell('agentv3-victim-s1', h, { userId: 'victim' });
    if (!r.ok) throw new Error('open failed');
    const id = r.shell.shellId;
    const attacker = 'agentv3-attacker-s9';
    expect(getShell(id, attacker)).toBeUndefined();
    expect(readShell(id, 0, attacker)).toBeUndefined();
    expect(subscribeShell(id, () => {}, attacker)).toBeUndefined();
    expect(await writeShell(id, 'cat .env\r', attacker)).toBe(false);
    expect(await resizeShell(id, 10, 10, attacker)).toBe(false);
    expect(await closeShell(id, attacker)).toBe(false);
    expect(await writeShell(id, 'cat .env\r', '')).toBe(false);
    expect(writes).toEqual([]);
    expect(getShell(id, 'agentv3-victim-s1')?.alive).toBe(true);
  });
});

describe('shell ids cannot be predicted', () => {
  it('two shells opened back to back share no guessable counter', async () => {
    const { host: h } = host();
    const a = await openShell('ws', h, {});
    const b = await openShell('ws', h, {});
    if (!a.ok || !b.ok) throw new Error('open failed');
    expect(a.shell.shellId).toMatch(/^sh_[0-9a-f]{32}$/);
    expect(b.shell.shellId).toMatch(/^sh_[0-9a-f]{32}$/);
    expect(a.shell.shellId).not.toBe(b.shell.shellId);
  });
});

describe('the routes hand the VERIFIED workspace to every lookup, never a body userId', () => {
  it('no shell call in agentv3.ts passes a userId', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(src).not.toMatch(/(?:readShell|getShell|writeShell|resizeShell|closeShell)\([^)]*userId/);
    expect(src).not.toMatch(/subscribeShell\([\s\S]{0,200}?userId \?\? undefined/);
  });
});
