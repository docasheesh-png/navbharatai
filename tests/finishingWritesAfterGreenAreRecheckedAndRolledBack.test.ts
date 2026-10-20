import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { recheckAfterFinishingWrites, finishingRollbackPlan, postGreenRecheckEnabled, type FinishingRecheckDeps, type RecheckNote, type FinishingRollbackPlan } from '../src/server/AgentV3/finishingRecheck';

function deps(over: Partial<FinishingRecheckDeps>, looks: Array<{ rendered: boolean; conclusive: boolean }>) {
  const notes: RecheckNote[] = [];
  const restored: FinishingRollbackPlan[] = [];
  const d: FinishingRecheckDeps = {
    enabled: true, greenAt: 1, paths: ['public/sw.js', 'index.html'], aborted: () => false,
    look: async () => looks.shift() ?? { rendered: false, conclusive: false },
    loadSnapshot: async () => ({ 'index.html': '<good/>', 'src/App.tsx': 'x' }),
    restore: async (p) => { restored.push(p); return { restored: Object.keys(p.write), removed: p.remove, failed: [], stopped: false }; },
    record: (n) => notes.push(n),
    ...over,
  };
  return { d, notes, restored };
}

describe('finishing writes after green are re-checked and rolled back (owner item 2)', () => {
  it('plan: snapshot files go back, files the snapshot never had are removed', () => {
    expect(finishingRollbackPlan(['index.html', 'public/sw.js', 'index.html'], { 'index.html': 'g' })).toEqual({ write: { 'index.html': 'g' }, remove: ['public/sw.js'] });
  });

  it('still renders → OK note, nothing restored', async () => {
    const { d, notes, restored } = deps({}, [{ rendered: true, conclusive: true }]);
    expect((await recheckAfterFinishingWrites(d)).action).toBe('ok');
    expect(restored).toEqual([]);
    expect(notes.map((n) => n.code)).toEqual(['POST_GREEN_RECHECK_OK']);
  });

  it('could not look → keeps the files (ignorance is not evidence)', async () => {
    const { d, notes, restored } = deps({}, [{ rendered: false, conclusive: false }]);
    expect((await recheckAfterFinishingWrites(d)).action).toBe('inconclusive');
    expect(restored).toEqual([]);
    expect(notes[0].code).toBe('POST_GREEN_RECHECK_INCONCLUSIVE');
  });

  it('conclusively broken → rolls back only the finishing files and re-checks', async () => {
    const { d, notes, restored } = deps({}, [{ rendered: false, conclusive: true }, { rendered: true, conclusive: true }]);
    const r = await recheckAfterFinishingWrites(d);
    expect(r).toMatchObject({ action: 'rolled-back', recovered: true });
    expect(restored).toEqual([{ write: { 'index.html': '<good/>' }, remove: ['public/sw.js'] }]);
    expect(notes[0]).toMatchObject({ code: 'POST_GREEN_ROLLBACK', autoResolved: true });
  });

  it('broken but no snapshot → says so, touches nothing', async () => {
    const { d, notes, restored } = deps({ loadSnapshot: async () => ({}) }, [{ rendered: false, conclusive: true }]);
    expect((await recheckAfterFinishingWrites(d)).action).toBe('no-snapshot');
    expect(restored).toEqual([]);
    expect(notes[0].code).toBe('POST_GREEN_ROLLBACK_SKIPPED');
  });

  for (const waitingFor of ['preview', 'snapshot'] as const) {
    it(`does not restore if Stop arrives while awaiting the ${waitingFor}`, async () => {
      let stopped = false;
      let release!: () => void;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      const pending = new Promise<void>((resolve) => { release = resolve; });
      const { d, notes, restored } = deps({
        aborted: () => stopped,
        ...(waitingFor === 'preview'
          ? { look: async () => { entered(); await pending; return { rendered: false, conclusive: true }; } }
          : { loadSnapshot: async () => { entered(); await pending; return { 'index.html': '<good/>' }; } }),
      }, [{ rendered: false, conclusive: true }]);
      const running = recheckAfterFinishingWrites(d);
      await started;
      stopped = true;
      release();
      expect((await running).action).toBe('skipped');
      expect(restored).toEqual([]);
      expect(notes).toEqual([]);
    });
  }

  it('does not claim the planned deletion happened when the restore reports a failed remove', async () => {
    const { d, notes } = deps({
      restore: async () => ({ restored: ['index.html'], removed: [], failed: ['public/sw.js'], stopped: false }),
    }, [{ rendered: false, conclusive: true }, { rendered: true, conclusive: true }]);
    expect((await recheckAfterFinishingWrites(d)).action).toBe('partial');
    expect(notes[0]).toMatchObject({ code: 'POST_GREEN_ROLLBACK_INCOMPLETE', autoResolved: false });
    expect(notes[0].detail).toContain('failed: public/sw.js');
    expect(notes[0].detail).toContain('removed: —');
  });

  it('skips when off, never green, nothing written, or stopped', async () => {
    for (const over of [{ enabled: false }, { greenAt: 0 }, { paths: [] }, { aborted: () => true }]) {
      const { d, notes } = deps(over, [{ rendered: false, conclusive: true }]);
      expect((await recheckAfterFinishingWrites(d)).action).toBe('skipped');
      expect(notes).toEqual([]);
    }
    expect(postGreenRecheckEnabled({ AGENTV3_POST_GREEN_RECHECK: 'off' })).toBe(false);
    expect(postGreenRecheckEnabled({})).toBe(true);
  });

  it('the route runs it right after the finishing passes, restoring through the safety pass', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const defaults = src.indexOf("runInPass('production-defaults'");
    const recheck = src.indexOf('await recheckAfterFinishingWrites({');
    expect(defaults).toBeGreaterThan(0);
    expect(recheck).toBeGreaterThan(defaults);
    expect(src.slice(recheck, recheck + 2500)).toContain('restore: (plan) => applyGreenSnapshotRestore(plan, () => abort.signal.aborted, noteFinishingWrite)');
    const restoreDoor = src.slice(src.indexOf('const applyGreenSnapshotRestore'), src.indexOf('const revertToGreenSnapshot'));
    expect(restoreDoor).toContain("pass = 'green-guard-restore'");
    expect(restoreDoor).toContain('runInPass(pass, () => applySnapshotRestore(plan,');
  });
});
