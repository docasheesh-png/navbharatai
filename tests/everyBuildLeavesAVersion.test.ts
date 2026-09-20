// EVERY BUILD LEAVES A VERSION YOU CAN GO BACK TO.
//
// WHY (admin 2026-09-20: "versioning kam hi nahi kar raha hai"). NavBharatAI grew two version systems
// and the screen the user opens read the dead one. `build_history` — whole file snapshots, durable,
// restorable for ever — is what the Time Machine lists, and its importers were exactly two: the LEGACY
// `/api/build` route and `workspaceEdit`. The v5 engine that builds every app today wrote nothing, so
// the Time Machine showed "No saved versions yet" for every app, for every user, with nothing failing
// and nothing logged.
//
// 🔒 THE KEY IS THE WHOLE BUG IN MINIATURE: a restore point written under the full workspace id would
// be invisible to the screen it exists for, and would look identical to writing nothing at all.

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  restorePointKey, decideRestorePoint, restorePointMessage, restorePointsEnabled,
  saveRestorePoint, _resetRestorePointMemory, MAX_RESTORE_POINT_BYTES,
} from '../src/server/AgentV3/restorePoint';

beforeEach(() => { _resetRestorePointMemory(); });

describe('the key the Time Machine actually reads', () => {
  it('strips the workspace prefix, exactly as /api/versioning/apps does', () => {
    expect(restorePointKey('agentv3-uid123-sess-abc', 'uid123')).toBe('sess-abc');
  });

  it('leaves an id that does not carry this owner’s prefix alone', () => {
    expect(restorePointKey('imported-project-7', 'uid123')).toBe('imported-project-7');
    expect(restorePointKey('agentv3-someoneelse-sess', 'uid123')).toBe('agentv3-someoneelse-sess');
  });

  it('survives a missing owner rather than producing a broken key', () => {
    expect(restorePointKey('agentv3-uid123-sess', null)).toBe('agentv3-uid123-sess');
    expect(restorePointKey('', 'uid123')).toBe('');
  });
});

describe('which builds leave one', () => {
  const base = { workspaceId: 'agentv3-u-s', fileCount: 3, buildKey: 'b1' };

  it('a successful build with files does', () => {
    expect(decideRestorePoint({ ...base, ok: true }).save).toBe(true);
  });

  it('a FAILED build never does — it must not become the version somebody goes back to', () => {
    expect(decideRestorePoint({ ...base, ok: false })).toEqual({ save: false, reason: 'not-ok' });
  });

  it('a turn that produced no app does not', () => {
    expect(decideRestorePoint({ ...base, ok: true, fileCount: 0 }).reason).toBe('no-files');
    expect(decideRestorePoint({ ...base, ok: true, workspaceId: '  ' }).reason).toBe('no-workspace');
  });

  it('one build leaves exactly ONE, however many times the settle runs', async () => {
    const saved: Array<{ key: string; fileCount: number }> = [];
    const io = {
      loadFiles: async () => ({ 'src/App.tsx': 'x'.repeat(50) }),
      save: async (key: string, v: { fileCount: number }) => { saved.push({ key, fileCount: v.fileCount }); },
    };
    const args = { ok: true, workspaceId: 'agentv3-u-s', uid: 'u', buildKey: 'b-race', io } as const;
    // The normal settle and the Fix-67 deadline finalizer both run for one build.
    await saveRestorePoint({ ...args });
    await saveRestorePoint({ ...args });
    expect(saved).toHaveLength(1);
    expect(saved[0].key).toBe('s');
  });

  it('a DIFFERENT build still leaves its own', async () => {
    const saved: string[] = [];
    const io = { loadFiles: async () => ({ 'a.ts': 'a' }), save: async (k: string) => { saved.push(k); } };
    await saveRestorePoint({ ok: true, workspaceId: 'agentv3-u-s1', uid: 'u', buildKey: 'b1', io });
    await saveRestorePoint({ ok: true, workspaceId: 'agentv3-u-s2', uid: 'u', buildKey: 'b2', io });
    expect(saved).toEqual(['s1', 's2']);
  });
});

describe('what it snapshots', () => {
  it('copies the DURABLE file set, not one turn’s writes', async () => {
    let savedFiles: Record<string, string> = {};
    await saveRestorePoint({
      ok: true, workspaceId: 'agentv3-u-s', uid: 'u', buildKey: 'b',
      io: {
        loadFiles: async () => ({ 'a.ts': '1', 'b.ts': '2', 'c.ts': '3' }),
        save: async (_k: string, v: { files: Record<string, string> }) => { savedFiles = v.files; },
      },
    });
    expect(Object.keys(savedFiles).sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('stays under the Firestore document limit', async () => {
    let bytes = 0;
    await saveRestorePoint({
      ok: true, workspaceId: 'agentv3-u-s', uid: 'u', buildKey: 'b',
      io: {
        loadFiles: async () => Object.fromEntries(
          Array.from({ length: 40 }, (_, i) => [`f${i}.ts`, 'y'.repeat(50_000)]),
        ),
        save: async (_k: string, v: { files: Record<string, string> }) => {
          for (const [p, c] of Object.entries(v.files)) bytes += p.length + c.length;
        },
      },
    });
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(MAX_RESTORE_POINT_BYTES);
  });

  it('a durable read that throws is an honest no-save, never a crash', async () => {
    let called = false;
    const r = await saveRestorePoint({
      ok: true, workspaceId: 'agentv3-u-s', uid: 'u', buildKey: 'b',
      io: { loadFiles: async () => { throw new Error('firestore down'); }, save: async () => { called = true; } },
    });
    expect(r).toEqual({ save: false, reason: 'no-files' });
    expect(called).toBe(false);
  });

  it('a store that throws never reaches the build', async () => {
    await expect(saveRestorePoint({
      ok: true, workspaceId: 'agentv3-u-s', uid: 'u', buildKey: 'b',
      io: { loadFiles: async () => ({ 'a.ts': 'a' }), save: async () => { throw new Error('nope'); } },
    })).resolves.toEqual({ save: true, reason: '' });
  });
});

describe('what the user reads in the list', () => {
  it('uses their own words, so versions are distinguishable', () => {
    expect(restorePointMessage('add a dark mode toggle', 12)).toBe('add a dark mode toggle — 12 files');
  });

  it('never runs away, and never says "1 files"', () => {
    expect(restorePointMessage('x'.repeat(500), 1)).toHaveLength(64 + ' — 1 file'.length);
    expect(restorePointMessage('', 1)).toBe('App version — 1 file');
    expect(restorePointMessage(null, 4)).toBe('App version — 4 files');
  });
});

describe('the kill switch', () => {
  it('is ON by default and off only when explicitly set', () => {
    expect(restorePointsEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(restorePointsEnabled({ AGENTV3_RESTORE_POINTS: ' OFF ' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(restorePointsEnabled({ AGENTV3_RESTORE_POINTS: 'on' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it('off means no write at all', async () => {
    let called = false;
    const r = await saveRestorePoint({
      ok: true, workspaceId: 'agentv3-u-s', uid: 'u', buildKey: 'b',
      env: { AGENTV3_RESTORE_POINTS: 'off' } as unknown as NodeJS.ProcessEnv,
      io: { loadFiles: async () => ({ 'a.ts': 'a' }), save: async () => { called = true; } },
    });
    expect(r.reason).toBe('disabled');
    expect(called).toBe(false);
  });
});

// A behavioural test cannot see a call site that was deleted, and deleting ONE of the two would
// reproduce exactly the Fix-67 drift this module was written to avoid. So the wiring is asserted
// from the source, comments and all.
describe('BOTH settle paths write one — the reversion guard', () => {
  const route = fs.readFileSync(path.resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

  it('imports the writer', () => {
    expect(route).toMatch(/import \{ saveRestorePoint \} from '\.\.\/AgentV3\/restorePoint'/);
  });

  it('calls it from the normal settle AND the deadline finalizer', () => {
    const calls = route.match(/saveRestorePoint\(\{/g) ?? [];
    expect(calls.length).toBe(2);
  });

  it('keys both by the same id the wallet debit uses, so one build leaves one version', () => {
    const keys = route.match(/buildKey: `\$\{workspaceId\}_\$\{[A-Za-z.]*buildStartedAt\}`/g) ?? [];
    expect(keys.length).toBe(2);
  });
});
