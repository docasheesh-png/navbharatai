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
