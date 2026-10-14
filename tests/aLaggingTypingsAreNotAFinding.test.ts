import { describe, it, expect } from 'vitest';
import { detectTypesMajorMismatch } from '../src/server/AgentV3/DependencyAnalysis';
import { TYPINGS_LAG_RUNTIME, typingsMajorMayLag } from '../src/server/lib/selfTypedPackages';
import { todoOnlyTurnsNote } from '../src/server/AgentV3/todoOnlyTurn';

/**
 * Autopsy 398db9f3. Q-1066: "@types/better-sqlite3 is v9 but better-sqlite3 is v13" advised a major that the
 * registry does not publish. Q-1068: the todo-only-turns line now says how many turns were first-in-run.
 */
describe('typings that lag their runtime by design are not a finding', () => {
  it('the report case: better-sqlite3 with older typings raises nothing', () => {
    const pkg = JSON.stringify({ dependencies: { 'better-sqlite3': '^13.0.0' }, devDependencies: { '@types/better-sqlite3': '^9.0.0' } });
    expect(detectTypesMajorMismatch(pkg)).toEqual([]);
  });
  it('a package NOT on the list is still checked (express 4 under v5 typings)', () => {
    const pkg = JSON.stringify({ dependencies: { express: '^4' }, devDependencies: { '@types/express': '^5' } });
    expect(detectTypesMajorMismatch(pkg)).toHaveLength(1);
  });
  it('the list is small, explicit and lookup-safe', () => {
    expect([...TYPINGS_LAG_RUNTIME]).toEqual(['better-sqlite3']);
    expect(typingsMajorMayLag('constructor')).toBe(false);
  });
});

describe('the todo-only-turns line says whether the once-per-run rule held', () => {
  it('splits first-in-run from repeats', () => {
    expect(todoOnlyTurnsNote(5, 30300, 2)).toContain('2 of them were the first in a run (handed back); 3 came after a hand-back in the same run.');
  });
  it('without the split the line is what it was', () => {
    expect(todoOnlyTurnsNote(5, 30300)).not.toContain('first in a run');
  });
});
