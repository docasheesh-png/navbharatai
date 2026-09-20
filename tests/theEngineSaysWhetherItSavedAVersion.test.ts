/**
 * "DID THIS BUILD LEAVE A VERSION?" — a question the engine could not answer (admin 2026-09-20).
 *
 * The admin opened the Time Machine, found nothing automatic, and pressed "Save this version" by hand.
 * Asked why, the only honest reply available was *"probably the deploy had not landed yet"* — a guess,
 * because nothing anywhere recorded what the writer had done. `saveRestorePoint` knew six different
 * answers (build failed / no files / already saved / switched off / no workspace / saved) and told
 * NOBODY any of them. The only instrument was a user's screenshot.
 *
 * That is the same shape as the bug it was written to fix: a writer nobody could hear, whose silence
 * looked exactly like success for two months.
 *
 * TWO THINGS WERE WRONG UNDERNEATH, and the report could not have been honest without fixing both:
 *
 *   1. `BuildHistoryStore.save` returned `void` and swallowed every error INCLUDING "Firestore is not
 *      configured". So even a caller that wanted to report could only ever report an INTENTION.
 *   2. The claim that stops the two settle paths double-writing was taken BEFORE the write and never
 *      released on failure — so a failed write left the rescue path refusing with `already-saved`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import {
  saveRestorePoint,
  saveRestorePointForReport,
  describeRestorePoint,
  restorePointSeverity,
  restorePointAlreadySaved,
  _resetRestorePointMemory,
  RESTORE_POINT_CONFIRM_MS,
  type RestorePointDecision,
} from '../src/server/AgentV3/restorePoint';

const FILES = { 'src/App.tsx': 'export default function App() { return null; }' };

function io(save: (...a: any[]) => any) {
  return { loadFiles: async () => FILES, save: save as any };
}

const base = {
  ok: true,
  workspaceId: 'agentv3-alice-s1',
  uid: 'alice',
  prompt: 'a billing app',
  buildKey: 'agentv3-alice-s1_1000',
};

beforeEach(() => _resetRestorePointMemory());

describe('the store now says whether the version really landed', () => {
  it('a store that accepts the write is reported as saved', async () => {
    const d = await saveRestorePoint({ ...base, io: io(async () => true) });
    expect(d).toEqual({ save: true, reason: '' });
  });

  it('🔴 a store that takes the call and writes NOTHING is not a save', async () => {
    // `if (!db) return` — Firestore unconfigured. The old signature made this indistinguishable from
    // success, which is exactly how a build could report a version it did not have.
    const d = await saveRestorePoint({ ...base, io: io(async () => false) });
    expect(d).toEqual({ save: false, reason: 'write-failed' });
  });

  it('a store that throws is not a save either, and never a throw of ours', async () => {
    const d = await saveRestorePoint({ ...base, io: io(async () => { throw new Error('firestore down'); }) });
    expect(d).toEqual({ save: false, reason: 'write-failed' });
  });
});

describe('a failed write leaves the rescue path free', () => {
  it('🔒 the claim is RELEASED when nothing was written', async () => {
    await saveRestorePoint({ ...base, io: io(async () => false) });
    expect(restorePointAlreadySaved(base.buildKey)).toBe(false);
  });

  it('so the other settle path can still save the version', async () => {
    await saveRestorePoint({ ...base, io: io(async () => false) });
    const second = await saveRestorePoint({ ...base, io: io(async () => true) });
    expect(second).toEqual({ save: true, reason: '' });
  });

  it('but a SUCCESSFUL write still claims the build, so the two paths write once', async () => {
    await saveRestorePoint({ ...base, io: io(async () => true) });
    const second = await saveRestorePoint({ ...base, io: io(async () => true) });
    expect(second).toEqual({ save: false, reason: 'already-saved' });
  });
});

describe('a slow store is neither a save nor a failure', () => {
  it('reports `unconfirmed` rather than guessing', async () => {
    const d = await saveRestorePointForReport({
      ...base,
      confirmMs: 5,
      io: io(() => new Promise((resolve) => setTimeout(() => resolve(true), 200))),
    });
    expect(d).toEqual({ save: false, reason: 'unconfirmed' });
  });

  it('and says so in words that do not claim either outcome', () => {
    const text = describeRestorePoint({ save: false, reason: 'unconfirmed' });
    expect(text).toContain('not confirmed');
    expect(text).toContain('may or may not exist');
  });

  it('a fast store is still reported exactly', async () => {
    const d = await saveRestorePointForReport({ ...base, confirmMs: 500, io: io(async () => true) });
    expect(d).toEqual({ save: true, reason: '' });
  });

  it('the confirmation window is bounded and short — a build must not wait on housekeeping', () => {
    expect(RESTORE_POINT_CONFIRM_MS).toBeLessThanOrEqual(10_000);
  });
});

describe('every outcome has a sentence, and the severity matches the fact', () => {
  const reasons: RestorePointDecision['reason'][] =
    ['', 'not-ok', 'no-workspace', 'no-files', 'already-saved', 'disabled', 'write-failed', 'unconfirmed'];

  it('no outcome falls through to a generic line', () => {
    for (const reason of reasons) {
      const text = describeRestorePoint({ save: reason === '', reason });
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toBe('No version was saved.');
    }
  });

  it('a refusal we CHOSE is information; a failure is a warning', () => {
    // "the build failed, so no version" is the system working. "we tried and could not" is not.
    expect(restorePointSeverity({ save: true, reason: '' })).toBe('info');
    expect(restorePointSeverity({ save: false, reason: 'not-ok' })).toBe('info');
    expect(restorePointSeverity({ save: false, reason: 'already-saved' })).toBe('info');
    expect(restorePointSeverity({ save: false, reason: 'disabled' })).toBe('info');
    expect(restorePointSeverity({ save: false, reason: 'write-failed' })).toBe('warning');
    expect(restorePointSeverity({ save: false, reason: 'unconfirmed' })).toBe('warning');
    expect(restorePointSeverity({ save: false, reason: 'no-files' })).toBe('warning');
  });

  it('a failure says plainly what it costs the user', () => {
    expect(describeRestorePoint({ save: false, reason: 'write-failed' })).toContain('no way back');
  });
});

describe('the report really carries it — both settle paths, and it is never the app’s fault', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

  it('BOTH settle paths CALL it and record the outcome, not just one', () => {
    // The whole reason this writer is one function is Fix 67: a rule on one settle path is a rule a
    // long build escapes. The REPORT line inherits that exactly.
    //
    // 🔴 THE FIRST VERSION OF THIS CASE COUNTED ONLY THE RECORDS AND PASSED WHILE ONE CALL WAS GUTTED
    // — proven by reverting one settle path to a hardcoded result and watching all 19 stay green. A
    // record fed by nothing reports a version that was never attempted, which is a worse lie than
    // silence. Both halves are counted now: the CALL and the line it feeds.
    const called = route.split('await saveRestorePointForReport({').length - 1;
    const recorded = route.split("code: 'RESTORE_POINT'").length - 1;
    expect(called).toBe(2);
    expect(recorded).toBe(2);
    expect(route).toContain('path=settle');
    expect(route).toContain('path=deadline-finalizer');
  });

  it('it is awaited — a result that arrives after the report reaches nobody', () => {
    expect(route).not.toContain('void saveRestorePoint(');
  });

  it('the wording comes from ONE place, never restated at the call site', () => {
    expect(route).toContain('message: describeRestorePoint(rp)');
    expect(route).toContain('severity: restorePointSeverity(rp)');
  });

  it('🔒 it can never count against the user’s app', () => {
    // A perfect app whose version write failed is still a perfect app.
    expect(readFileSync('src/server/AgentV3/BuildDiagnostics.ts', 'utf8')).toContain("'RESTORE_POINT'");
    expect(readFileSync('src/server/AgentV3/buildFindingSuggestions.ts', 'utf8')).toContain("'RESTORE_POINT'");
  });
});

describe('the store itself', () => {
  const store = readFileSync('src/server/project/BuildHistoryStore.ts', 'utf8');

  it('returns a boolean rather than void', () => {
    expect(store).toContain('): Promise<boolean> {');
    expect(store).toContain('if (!db) return false;');
  });

  it('🔒 a failed RETENTION trim never reports a saved version as unsaved', () => {
    // Past the `set` the version exists and is restorable; trimming is housekeeping.
    expect(store).toContain('the version is saved; trimming can wait for the next one');
  });
});
