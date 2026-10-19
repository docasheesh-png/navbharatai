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
    restore: async (p) => { restored.push(p); },
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
    expect(src.slice(recheck, recheck + 2500)).toContain("runInPass('green-guard-restore'");
  });
});
