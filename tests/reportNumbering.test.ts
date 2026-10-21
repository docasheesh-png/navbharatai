import { describe, it, expect } from 'vitest';
import { numberOldestFirst } from '../src/lib/reportNumbering';

const r = (id: string, at: number) => ({ id, at });
const num = (rows: Array<{ id: string; at: number }>) => numberOldestFirst(rows, (x) => x.id, (x) => x.at);

describe('report numbers: oldest is 1, newest is the highest', () => {
  it('numbers by time whatever order the rows arrive in', () => {
    const m = num([r('c', 300), r('a', 100), r('b', 200)]);
    expect([m.get('a'), m.get('b'), m.get('c')]).toEqual([1, 2, 3]);
  });
  it('a filtered view does not renumber: numbers come from the whole set', () => {
    const all = [r('a', 1), r('b', 2), r('c', 3), r('d', 4)];
    const m = num(all);
    const visible = all.filter((x) => x.id === 'c' || x.id === 'a');
    expect(visible.map((x) => m.get(x.id))).toEqual([1, 3]);
  });
  it('equal times get stable numbers (broken by key)', () => {
    expect([...num([r('y', 5), r('x', 5)])]).toEqual([['x', 1], ['y', 2]]);
    expect([...num([r('x', 5), r('y', 5)])]).toEqual([['x', 1], ['y', 2]]);
  });
  it('a duplicate key is one report; a bad time sorts first instead of throwing', () => {
    const m = num([r('a', 10), r('a', 10), r('b', NaN), r('c', 20)]);
    expect(m.size).toBe(3);
    expect([m.get('b'), m.get('a'), m.get('c')]).toEqual([1, 2, 3]);
  });
  it('empty in, empty out', () => { expect(num([]).size).toBe(0); });
});

import { readFileSync } from 'node:fs';
describe('both report lists show the number', () => {
  it('the Build Reports inbox and the failed-reports page number by age and print it', () => {
    const inbox = readFileSync('src/components/AdminDashboard.tsx', 'utf8');
    expect(inbox).toContain('numberOldestFirst(buildReports');
    expect(inbox).toContain('reportNumbers.get(r.id)');
    const failed = readFileSync('src/components/admin/FailedBuildReportsPage.tsx', 'utf8');
    expect(failed).toContain('numberOldestFirst(known');
    expect(failed).toContain('numbers.get(rowKey(r))');
  });
});
