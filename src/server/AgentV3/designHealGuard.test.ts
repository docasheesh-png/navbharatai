import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codeOnly, sectionUntil } from '../../../tests/helpers/sourceSlice';
import { designHealDecision, designHealGuardNote } from './designHealGuard';
import { applySnapshotRestore, snapshotRestoreComplete } from './snapshotRestore';

// The design repair writes to an app that has just been built but not yet verified. If it leaves a page
// unparseable, nothing today puts that page back — the break simply surfaces later as a preview that
// will not render. This decides what to undo.

const B = { 'a.tsx': 'ok-a', 'b.tsx': 'ok-b', 'c.tsx': 'ok-c' };

describe('what the guard puts back', () => {
  it('reverts a file the heal made unparseable', () => {
    const d = designHealDecision({
      before: B,
      after: { ...B, 'a.tsx': 'broken' },
      brokenAfter: ['a.tsx'],
    });
    expect(d.revert).toEqual(['a.tsx']);
  });

  it('keeps a rewrite that parses', () => {
    const d = designHealDecision({
      before: B,
      after: { ...B, 'a.tsx': 'restyled', 'b.tsx': 'restyled' },
      brokenAfter: [],
    });
    expect(d.revert).toEqual([]);
    expect(d.keep).toEqual(['a.tsx', 'b.tsx']);
  });

  it('never touches a file the heal did not change', () => {
    // The heal owns only what it rewrote. Reverting an untouched file would undo somebody else's work.
    const d = designHealDecision({ before: B, after: B, brokenAfter: ['a.tsx', 'b.tsx', 'c.tsx'] });
    expect(d.revert).toEqual([]);
    expect(d.keep).toEqual([]);
  });

  it('does NOT revert a file that was already broken before the heal', () => {
    // Restoring it would hand back an equally broken file AND throw away a repair that may have helped.
    // "Leave it no worse" is the promise, not "leave it perfect".
    const d = designHealDecision({
      before: B,
      after: { ...B, 'a.tsx': 'still-broken-but-different' },
      brokenAfter: ['a.tsx'],
      brokenBefore: ['a.tsx'],
    });
    expect(d.revert).toEqual([]);
    expect(d.keep).toEqual(['a.tsx']);
  });

  it('reverts only the broken rewrites, keeping the good ones from the same pass', () => {
    // A partial revert is the point: one bad page must not cost the user the pages that came out right.
    const d = designHealDecision({
      before: B,
      after: { 'a.tsx': 'broken', 'b.tsx': 'restyled', 'c.tsx': 'ok-c' },
      brokenAfter: ['a.tsx'],
    });
    expect(d.revert).toEqual(['a.tsx']);
    expect(d.keep).toEqual(['b.tsx']);
  });

  it('the shared restore lands and persists only the selected pre-heal bytes', async () => {
    const sandbox = { ...B, 'a.tsx': 'broken', 'b.tsx': 'restyled' };
    const decision = designHealDecision({ before: B, after: sandbox, brokenAfter: ['a.tsx'] });
    const plan = { write: Object.fromEntries(decision.revert.map((path) => [path, B[path as keyof typeof B]])), remove: [] };
    const persisted: Record<string, string>[] = [];
    const outcome = await applySnapshotRestore(plan, {
      stopped: () => false,
      write: async (path, content) => { sandbox[path as keyof typeof sandbox] = content; },
      remove: async () => { throw new Error('a design undo must not delete a file'); },
      persist: async (files) => { persisted.push(files); return true; },
    });
    expect(snapshotRestoreComplete(plan, outcome)).toBe(true);
    expect(sandbox).toEqual({ ...B, 'b.tsx': 'restyled' });
    expect(persisted).toEqual([{ 'a.tsx': B['a.tsx'] }]);
  });

  it('ignores a file the heal newly CREATED — there is nothing to restore it to', () => {
    const d = designHealDecision({ before: B, after: { ...B, 'new.tsx': 'x' }, brokenAfter: ['new.tsx'] });
    expect(d.revert).toEqual([]);
  });

  it('survives empty and missing inputs', () => {
    expect(designHealDecision({ before: {}, after: {}, brokenAfter: [] })).toEqual({ revert: [], keep: [] });
    expect(designHealDecision({ before: B, after: B, brokenAfter: [] }).revert).toEqual([]);
  });
});

describe('what the admin is told', () => {
  it('says nothing when the heal broke nothing — the normal case', () => {
    expect(designHealGuardNote({ revert: [], keep: ['a.tsx'] })).toBe('');
  });

  it('names the restored files and the ones that stood', () => {
    const note = designHealGuardNote({ revert: ['a.tsx'], keep: ['b.tsx', 'c.tsx'] });
    expect(note).toContain('a.tsx');
    expect(note).toContain('2 other repaired file(s) parsed and were kept');
  });

  it('states the limit instead of implying a complete net', () => {
    // A runtime break that parses fine is NOT caught here. Saying so is the difference between an
    // honest guard and a half-true guarantee.
    const note = designHealGuardNote({ revert: ['a.tsx'], keep: [] });
    expect(note).toContain('parses but breaks the app at runtime');
    expect(note).toContain('reported, not reverted');
  });
});

describe('the guard is actually wired to the heal', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  it('snapshots BEFORE the repair runs — afterwards is too late', () => {
    const block = sectionUntil(route, 'const beforeHeal =', 'if (healed.ok)');
    expect(block).toContain('findSyntaxErrors(beforeHeal)');
    expect(block.indexOf('const beforeHeal')).toBeLessThan(block.indexOf("finishingGuard.repairOrThrow('design-consistency-heal'"));
  });

  it('really writes the original back, to the sandbox AND the durable store', () => {
    // Reverting only in memory would leave the broken file on disk and in the saved project — the
    // "looks fixed, still broken" state.
    const block = codeOnly(sectionUntil(route, 'const verdict = designHealDecision', 'if (healed.ok)'));
    expect(block).toContain('write: Object.fromEntries(verdict.revert.map((path) => [path, beforeHeal[path]]))');
    expect(block).toContain("applyGreenSnapshotRestore(revertPlan, undefined, undefined, 'design-heal-revert')");
    expect(block).toContain('snapshotRestoreComplete(revertPlan, outcome)');
    expect(block).toContain("code: complete ? 'DESIGN_HEAL_REVERTED' : 'DESIGN_HEAL_RESTORE_INCOMPLETE'");
    expect(block).not.toContain('writtenFiles.set(path, original)');
    const door = codeOnly(sectionUntil(route, 'const applyGreenSnapshotRestore =', 'const revertToGreenSnapshot ='));
    expect(door).toContain('write: (path, content) => actuator.writeFile(workspaceId, path, content)');
    expect(door).toContain("persist: async (files) => (await mergeWorkspaceFiles(workspaceId, files)).status === 'saved'");
  });

  it('identifies itself to Green Freeze', () => {
    // An unnamed pass is refused outright on a latched workspace, so without this the repair would
    // silently do nothing on a resumed-green session.
    expect(route).toContain("runInPass('design-consistency-heal'");
    const freeze = readFileSync(join(process.cwd(), 'src/server/AgentV3/greenFreeze.ts'), 'utf8');
    expect(freeze).toContain("'design-consistency-heal',");
  });

  it('cannot itself break a build', () => {
    const block = sectionUntil(route, 'const verdict = designHealDecision', 'if (healed.ok)');
    expect(block).toContain('catch');
  });
});
