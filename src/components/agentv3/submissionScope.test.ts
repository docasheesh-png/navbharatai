import { describe, expect, it } from 'vitest';
import { SubmissionScope, submissionIsWorking, submissionStatus } from './submissionScope';

describe('submission scope', () => {
  it('locks synchronously and launches only once in its captured session', () => {
    const scope = new SubmissionScope();
    const ticket = scope.begin('first')!;
    expect(scope.begin('first')).toBeNull();
    expect(scope.launch(ticket, 'other')).toBe(false);
    expect(scope.launch(ticket, 'first')).toBe(true);
    expect(scope.launch(ticket, 'first')).toBe(false);
    expect(scope.finish(ticket)).toBe(true);
    expect(scope.busy).toBe(false);
  });
  it('cancels in-flight work and rejects stale cleanup and callbacks, even after returning to the same chat', () => {
    const scope = new SubmissionScope();
    const old = scope.begin('same')!;
    scope.cancel();
    const fresh = scope.begin('same')!;
    expect(old.abort.signal.aborted).toBe(true);
    expect(scope.launch(old, 'same')).toBe(false);
    expect(scope.finish(old)).toBe(false);
    expect(scope.current(fresh, 'same')).toBe(true);
  });
  it('never represents waiting for the user as active work', () => {
    for (const phase of ['framework', 'confirmation'] as const) {
      expect(submissionIsWorking(phase)).toBe(false);
      expect(submissionStatus[phase]).toContain('Nothing has started yet');
    }
    expect(submissionIsWorking('features')).toBe(true);
  });
});
