import { describe, it, expect } from 'vitest';
import { TaskScheduler } from '../src/server/AppMakerLab/generator/TaskScheduler';
import { TaskStatus } from '../src/server/AppMakerLab/generator/ExecutionTypes';
import type { GenerationTask } from '../src/server/AppMakerLab/generator/PlannerTypes';

function makeTask(id: string, deps: string[] = []): GenerationTask {
  return { id, type: 'FRONTEND', name: id, path: `src/${id}.ts`, dependencies: deps, contentDescription: '', priority: 1, engine: 'default', status: 'PENDING' };
}

describe('TaskScheduler', () => {
  it('returns the single task when it has no dependencies', () => {
    const s = new TaskScheduler([makeTask('A')]);
    expect(s.getNextBatch().map(t => t.id)).toEqual(['A']);
  });

  it('only returns tasks whose dependencies are COMPLETED', () => {
    const s = new TaskScheduler([makeTask('A'), makeTask('B', ['A'])]);
    expect(s.getNextBatch().map(t => t.id)).toEqual(['A']); // B blocked
    s.updateTaskStatus('A', TaskStatus.COMPLETED);
    expect(s.getNextBatch().map(t => t.id)).toEqual(['B']); // B unblocked
  });

  it('isComplete() returns false while tasks are still pending', () => {
    const s = new TaskScheduler([makeTask('A'), makeTask('B')]);
    expect(s.isComplete()).toBe(false);
  });

  it('isComplete() returns true once all tasks reach a terminal state', () => {
    const s = new TaskScheduler([makeTask('A'), makeTask('B', ['A'])]);
    s.updateTaskStatus('A', TaskStatus.COMPLETED);
    s.updateTaskStatus('B', TaskStatus.COMPLETED);
    expect(s.isComplete()).toBe(true);
  });

  it('cancelDownstream cancels dependent tasks when a task fails', () => {
    const s = new TaskScheduler([makeTask('A'), makeTask('B', ['A']), makeTask('C', ['B'])]);
    s.updateTaskStatus('A', TaskStatus.FAILED);
    const state = s.getState();
    expect(state['B']).toBe(TaskStatus.CANCELLED);
    expect(state['C']).toBe(TaskStatus.CANCELLED);
  });

  it('does not cancel tasks that are already RUNNING when upstream fails', () => {
    const s = new TaskScheduler([makeTask('A'), makeTask('B')]);
    s.updateTaskStatus('B', TaskStatus.RUNNING);
    s.updateTaskStatus('A', TaskStatus.FAILED);
    expect(s.getState()['B']).toBe(TaskStatus.RUNNING); // not cancelled — no dep on A
  });

  it('handles cycles gracefully — constructor does not throw', () => {
    expect(() => new TaskScheduler([makeTask('A', ['B']), makeTask('B', ['A'])])).not.toThrow();
  });

  it('returns [] from getNextBatch() when all tasks are already COMPLETED', () => {
    const s = new TaskScheduler([makeTask('A')]);
    s.updateTaskStatus('A', TaskStatus.COMPLETED);
    expect(s.getNextBatch()).toHaveLength(0);
  });
});
