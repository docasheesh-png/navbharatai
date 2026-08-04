import { describe, it, expect } from 'vitest';
import { planFileGuardian } from './FileGuardian';

describe('planFileGuardian (auto-recover lost files from history)', () => {
  it('does nothing when there is no saved history', () => {
    expect(planFileGuardian({}, { 'a.ts': 'x' })).toEqual({ restore: {}, mode: 'none', count: 0 });
  });

  it('does nothing when every saved file is already present', () => {
    const saved = { 'a.ts': '1', 'b.ts': '2' };
    const existing = { 'a.ts': '1', 'b.ts': 'edited', 'c.ts': 'new' };
    const plan = planFileGuardian(saved, existing);
    expect(plan.mode).toBe('none');
    expect(plan.count).toBe(0);
  });

  it('re-adds ONLY the individually-missing files (never clobbers present ones)', () => {
    const saved = { 'a.ts': '1', 'b.ts': '2', 'c.ts': '3', 'd.ts': '4' };
    const existing = { 'a.ts': 'EDITED', 'b.ts': '2', 'c.ts': '3' }; // only d.ts missing (1 of 4)
    const plan = planFileGuardian(saved, existing);
    expect(plan.mode).toBe('missing');
    expect(plan.restore).toEqual({ 'd.ts': '4' });
    expect(plan.count).toBe(1);
    // a.ts edit is preserved (not in the restore set).
    expect(plan.restore['a.ts']).toBeUndefined();
  });

  it('restores the WHOLE project when most of it is missing (sandbox recycled)', () => {
    const saved = { 'a.ts': '1', 'b.ts': '2', 'c.ts': '3', 'd.ts': '4' };
    const existing = { 'package.json': 'scaffold', 'a.ts': '1' }; // 3 of 4 saved files missing
    const plan = planFileGuardian(saved, existing);
    expect(plan.mode).toBe('full');
    expect(plan.restore).toEqual(saved);
    expect(plan.count).toBe(4);
  });

  it('treats an empty sandbox as a full restore', () => {
    const saved = { 'a.ts': '1', 'b.ts': '2' };
    const plan = planFileGuardian(saved, {});
    expect(plan.mode).toBe('full');
    expect(plan.restore).toEqual(saved);
  });

  it('is robust to null-ish inputs', () => {
    expect(planFileGuardian(undefined as never, undefined as never)).toEqual({ restore: {}, mode: 'none', count: 0 });
  });
});

// MITRIFY AUTOPSY 2026-08-04. The report said "durable store holds 608 file(s); the live sandbox
// listed 599 but was missing 9" — exactly the scan's own skip gap. `collectWorkspaceFiles` returns
// { files, skipped }, and the caller passed only `files`, so every path the scan SAW but declined to
// read (excluded / too large / binary / unreadable / past a cap) looked MISSING. Two harms:
//   1. a data-loss event that never happened, in the user's report;
//   2. the guardian OVERWROTE those files with an older durable snapshot — the loss-prevention system
//      destroying newer work, which is the exact opposite of its job.
describe('planFileGuardian — a file the scan REFUSED TO READ is present, not missing', () => {
  const saved = { 'a.ts': 'A', 'big.ts': 'NEW-AND-BIGGER', 'logo.png': 'BINARY' };

  it('does nothing when the only "gap" is what the scan skipped', () => {
    const plan = planFileGuardian(saved, { 'a.ts': 'A' }, ['big.ts', 'logo.png']);
    expect(plan.mode).toBe('none');
    expect(plan.count).toBe(0);
  });

  it('NEVER overwrites a skipped file — that is how newer content gets destroyed', () => {
    const plan = planFileGuardian(saved, { 'a.ts': 'A' }, ['big.ts']);
    expect(plan.restore['big.ts']).toBeUndefined();
  });

  it('a genuinely absent file is still restored (the guardian must keep working)', () => {
    const plan = planFileGuardian(saved, { 'a.ts': 'A' }, ['logo.png']);
    expect(plan.mode).toBe('missing');
    expect(Object.keys(plan.restore)).toEqual(['big.ts']);
  });

  it('skipped files no longer push a healthy sandbox over the "recycled" threshold', () => {
    // 4 of 6 unread — but all of them merely skipped, so this is NOT a recycled sandbox.
    const big = { a: '1', b: '2', c: '3', d: '4', e: '5', f: '6' };
    const plan = planFileGuardian(big, { a: '1', b: '2' }, ['c', 'd', 'e', 'f']);
    expect(plan.mode).toBe('none');
  });

  it('a REALLY recycled sandbox is still restored whole', () => {
    const big = { a: '1', b: '2', c: '3', d: '4', e: '5', f: '6' };
    const plan = planFileGuardian(big, {}, []);
    expect(plan.mode).toBe('full');
    expect(plan.count).toBe(6);
  });

  it('back-compatible: omitting skipped behaves exactly as before', () => {
    expect(planFileGuardian(saved, { 'a.ts': 'A' })).toEqual(planFileGuardian(saved, { 'a.ts': 'A' }, []));
  });

  it('junk in the skipped list never throws', () => {
    expect(() => planFileGuardian(saved, { 'a.ts': 'A' }, [undefined as unknown as string, 'big.ts'])).not.toThrow();
    expect(() => planFileGuardian(saved, { 'a.ts': 'A' }, null as unknown as string[])).not.toThrow();
  });
});
