import { describe, it, expect } from 'vitest';
import {
  mergeRestoreSources, restoreFailed, summarizeRestore, type SandboxRestoreOutcome,
} from './sandboxRestore';

const outcome = (o: Partial<SandboxRestoreOutcome>): SandboxRestoreOutcome => ({
  durable: 0, warm: 0, attempted: 0, restored: 0, assets: 0, skipped: 0, ...o,
});

describe('mergeRestoreSources', () => {
  it('restores the whole app from the durable store when the warm cache is gone', () => {
    // THE REPORTED CASE: days later, another Cloud Run instance, nothing warm anywhere.
    const durable = { 'package.json': '{}', 'src/App.tsx': 'app', 'src/main.tsx': 'main' };
    expect(mergeRestoreSources(durable, null)).toEqual(durable);
  });

  it('never truncates the app to what the bounded warm cache happened to hold', () => {
    // The cache is capped at 500 files and skips anything over 256KB, so using it as the BASELINE
    // would ship a partial app that looks complete. Durable decides the set.
    const durable = { a: '1', b: '2', c: '3' };
    const warm = new Map([['b', '2-newer']]);
    expect(mergeRestoreSources(durable, warm)).toEqual({ a: '1', b: '2-newer', c: '3' });
  });

  it('lets a warm write win per path — an edit not yet saved durably is not undone', () => {
    const merged = mergeRestoreSources({ 'src/App.tsx': 'old' }, new Map([['src/App.tsx', 'new']]));
    expect(merged['src/App.tsx']).toBe('new');
  });

  it('keeps a warm-only file that the durable store has never seen', () => {
    const merged = mergeRestoreSources({ 'package.json': '{}' }, new Map([['src/New.tsx', 'x']]));
    expect(merged).toEqual({ 'package.json': '{}', 'src/New.tsx': 'x' });
  });

  it('an empty durable store and an empty cache ask for no writes at all', () => {
    expect(mergeRestoreSources({}, new Map())).toEqual({});
  });

  it('does not mutate either source', () => {
    const durable = { a: '1' };
    const warm = new Map([['a', '2']]);
    mergeRestoreSources(durable, warm);
    expect(durable).toEqual({ a: '1' });
    expect(warm.get('a')).toBe('2');
  });
});

describe('restoreFailed', () => {
  it('a brand-new workspace with nothing saved is NOT a failure', () => {
    // Its first build is supposed to scaffold; calling this a failure would block every new app.
    expect(restoreFailed(outcome({ attempted: 0, restored: 0 }))).toBe(false);
  });

  it('files to put back and none landed IS a failure, and must be visible', () => {
    expect(restoreFailed(outcome({ attempted: 24, restored: 0 }))).toBe(true);
  });

  it('a partial restore is not called a failure — a partial app builds far more often than none', () => {
    expect(restoreFailed(outcome({ attempted: 24, restored: 23 }))).toBe(false);
  });

  it('a set the landing path refused ENTIRELY is not a failure — nothing was writable', () => {
    // One durable file and it is a live `.env`: excluded on purpose, so there is no bug to report.
    expect(restoreFailed(outcome({ attempted: 1, skipped: 1, restored: 0 }))).toBe(false);
  });

  it('but a writable file that did not land still fails, even beside a legitimate refusal', () => {
    expect(restoreFailed(outcome({ attempted: 24, skipped: 1, restored: 0 }))).toBe(true);
  });
});

describe('summarizeRestore', () => {
  it('reports the real ratio, never "restored" about files that did not land', () => {
    const line = summarizeRestore(outcome({ durable: 24, warm: 0, attempted: 24, restored: 24 }));
    expect(line).toContain('restored 24/24 files');
    expect(line).toContain('durable 24');
    expect(line).not.toContain('RESTORE FAILED');
  });

  it('says so out loud when the machine is still empty', () => {
    expect(summarizeRestore(outcome({ durable: 24, attempted: 24, restored: 0 })))
      .toContain('RESTORE FAILED — the machine is empty');
  });

  it('mentions assets only when some were really written', () => {
    expect(summarizeRestore(outcome({ attempted: 2, restored: 2, assets: 3 }))).toContain('assets 3');
    expect(summarizeRestore(outcome({ attempted: 2, restored: 2, assets: 0 }))).not.toContain('assets');
  });

  it('names a deliberate refusal as a refusal, not as a missing file', () => {
    const line = summarizeRestore(outcome({ durable: 24, attempted: 24, restored: 23, skipped: 1 }));
    expect(line).toContain('restored 23/24 files');
    expect(line).toContain('skipped 1 (secret/oversized/unsafe path)');
    expect(line).not.toContain('RESTORE FAILED');
  });

  it('a fresh workspace reads as nothing to restore, not as a problem', () => {
    expect(summarizeRestore(outcome({}))).toBe('nothing saved yet — nothing to restore');
  });
});
