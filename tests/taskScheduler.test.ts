import { describe, it, expect } from 'vitest';
import { TaskScheduler } from '../src/server/AppMakerLab/generator/TaskScheduler';
import { TaskStatus } from '../src/server/AppMakerLab/generator/ExecutionTypes';
import type { GenerationTask } from '../src/server/AppMakerLab/generator/PlannerTypes';

function task(id: string, deps: string[] = []): GenerationTask {
  return {
    id,
    type: 'FRONTEND',
    name: id,
    path: `src/${id}.ts`,
    dependencies: deps,
    contentDescription: 'test',
    priority: 1,
    engine: 'test',
    status: 'PENDING',
  };
}

describe('TaskScheduler', () => {
  it('getNextBatch() returns tasks with no dependencies first', () => {
    const scheduler = new TaskScheduler([task('a'), task('b', ['a'])]);
    const batch = scheduler.getNextBatch();
    expect(batch.map(t => t.id)).toContain('a');
    expect(batch.map(t => t.id)).not.toContain('b');
  });

  it('task with satisfied dependencies appears in next batch', () => {
    const scheduler = new TaskScheduler([task('a'), task('b', ['a'])]);
    scheduler.updateTaskStatus('a', TaskStatus.COMPLETED);
    const batch = scheduler.getNextBatch();
    expect(batch.map(t => t.id)).toContain('b');
  });

  it('isComplete() returns false when tasks are pending', () => {
    const scheduler = new TaskScheduler([task('a'), task('b')]);
    expect(scheduler.isComplete()).toBe(false);
  });

  it('isComplete() returns true when all tasks are completed', () => {
    const scheduler = new TaskScheduler([task('a'), task('b')]);
    scheduler.updateTaskStatus('a', TaskStatus.COMPLETED);
    scheduler.updateTaskStatus('b', TaskStatus.COMPLETED);
    expect(scheduler.isComplete()).toBe(true);
  });

  it('cancels downstream tasks when a parent task fails', () => {
    const scheduler = new TaskScheduler([task('a'), task('b', ['a'])]);
    scheduler.updateTaskStatus('a', TaskStatus.FAILED);
    const batch = scheduler.getNextBatch();
    expect(batch.map(t => t.id)).not.toContain('b');
  });

  it('getNextBatch() returns empty array when all tasks are done', () => {
    const scheduler = new TaskScheduler([task('a')]);
    scheduler.updateTaskStatus('a', TaskStatus.COMPLETED);
    expect(scheduler.getNextBatch()).toHaveLength(0);
  });
});
