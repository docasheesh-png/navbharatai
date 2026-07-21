import { describe, it, expect } from 'vitest';
import { mergeTodoLists } from './todoMerge';
import type { TodoItem } from './types';

const t = (id: string, title: string, status: TodoItem['status'] = 'pending'): TodoItem => ({ id, title, status });

describe('mergeTodoLists — ONE continuous plan (no mid-build reset)', () => {
  it('first list passes through unchanged', () => {
    const incoming = [t('1', 'Scaffold app'), t('2', 'Build UI')];
    expect(mergeTodoLists([], incoming)).toEqual(incoming);
  });

  it('THE RESET BUG: a fresh shorter sub-plan no longer wipes finished work', () => {
    // 3 items all done, then the model starts a new phase with a fresh 2-item list reusing ids 1-2.
    const prev = [t('1', 'Scaffold app', 'done'), t('2', 'Build UI', 'done'), t('3', 'Wire API', 'done')];
    const incoming = [t('1', 'Add auth'), t('2', 'Polish styles')];
    const merged = mergeTodoLists(prev, incoming);
    // Done work is retained, new phase appends → 3/5, never 0/2.
    expect(merged).toHaveLength(5);
    expect(merged.filter((x) => x.status === 'done')).toHaveLength(3);
    expect(merged.map((x) => x.title)).toEqual(['Scaffold app', 'Build UI', 'Wire API', 'Add auth', 'Polish styles']);
  });

  it('reused ids from a fresh sub-plan get unique keys (no React key collisions)', () => {
    const prev = [t('1', 'Scaffold app', 'done')];
    const merged = mergeTodoLists(prev, [t('1', 'Add auth')]);
    const ids = merged.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('same-title items update in place (status progresses, id stays stable)', () => {
    const prev = [t('1', 'Build UI', 'in_progress'), t('2', 'Wire API')];
    const merged = mergeTodoLists(prev, [t('1', 'Build UI', 'done'), t('2', 'Wire API', 'in_progress')]);
    expect(merged).toEqual([t('1', 'Build UI', 'done'), t('2', 'Wire API', 'in_progress')]);
  });

  it('title matching survives whitespace/case drift', () => {
    const prev = [t('1', 'Build  UI', 'in_progress')];
    const merged = mergeTodoLists(prev, [t('9', 'build ui', 'done')]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: '1', status: 'done' });
  });

  it('abandoned pending items are pruned (denominator never inflates forever)', () => {
    const prev = [t('1', 'Scaffold app', 'done'), t('2', 'Old approach', 'pending')];
    const merged = mergeTodoLists(prev, [t('1', 'New approach')]);
    expect(merged.map((x) => x.title)).toEqual(['Scaffold app', 'New approach']);
  });

  it('done-count is monotonic across any sequence of updates', () => {
    let plan: TodoItem[] = [];
    const updates: TodoItem[][] = [
      [t('1', 'A'), t('2', 'B')],
      [t('1', 'A', 'done'), t('2', 'B', 'in_progress')],
      [t('1', 'C'), t('2', 'D')], // fresh sub-plan
      [t('1', 'C', 'done'), t('2', 'D', 'done')],
    ];
    let lastDone = 0;
    for (const u of updates) {
      plan = mergeTodoLists(plan, u);
      const done = plan.filter((x) => x.status === 'done').length;
      expect(done).toBeGreaterThanOrEqual(lastDone);
      lastDone = done;
    }
    // Final: A done + C done + D done, B pruned as stale pending.
    expect(plan.filter((x) => x.status === 'done').map((x) => x.title).sort()).toEqual(['A', 'C', 'D']);
  });

  it('duplicate titles inside one incoming list are deduped', () => {
    const merged = mergeTodoLists([t('1', 'Setup', 'done')], [t('1', 'Polish'), t('2', 'Polish')]);
    expect(merged.filter((x) => normLower(x.title) === 'polish')).toHaveLength(1);
  });
});

const normLower = (s: string) => s.trim().toLowerCase();
