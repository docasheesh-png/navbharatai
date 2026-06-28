import { describe, it, expect } from 'vitest';
import { replayWorkspaceState } from './WorkspaceProjection';
import { EventHistoryStore } from './EventHistoryStore';
import { EventType } from './EventTypes';
import { IEvent } from './IEvent';

let seq = 0;
function ev(type: EventType, opts: Partial<IEvent> = {}): IEvent {
  return {
    eventId: `e${seq++}`,
    correlationId: opts.correlationId ?? 'corr-1',
    workspaceId: opts.workspaceId ?? 'ws-1',
    sender: opts.sender ?? 'test',
    timestamp: opts.timestamp ?? new Date(1_000 + seq),
    type,
    payload: opts.payload ?? {},
  };
}

describe('replayWorkspaceState (P4.2 event replay)', () => {
  describe('lifecycle', () => {
    it('UNKNOWN with no events; not existing', () => {
      const p = replayWorkspaceState([], 'ws-1');
      expect(p.lifecycle).toBe('UNKNOWN');
      expect(p.exists).toBe(false);
      expect(p.totalEventsApplied).toBe(0);
    });

    it('CREATED → GENERATING → FILES_GENERATED → BUILDING → BUILT', () => {
      const p = replayWorkspaceState([
        ev(EventType.WORKSPACE_CREATED),
        ev(EventType.GENERATION_STARTED, { payload: { planId: 'pl1' } }),
        ev(EventType.GENERATION_COMPLETED, { payload: { planId: 'pl1' } }),
        ev(EventType.BUILD_STARTED),
        ev(EventType.BUILD_COMPLETED),
      ], 'ws-1');
      expect(p.exists).toBe(true);
      expect(p.lifecycle).toBe('BUILT');
      expect(p.lastBuildOutcome).toBe('SUCCESS');
    });

    it('BUILD_FAILED records the error and outcome', () => {
      const p = replayWorkspaceState([
        ev(EventType.WORKSPACE_CREATED),
        ev(EventType.BUILD_STARTED),
        ev(EventType.BUILD_FAILED, { payload: { error: 'tsc exploded' } }),
      ], 'ws-1');
      expect(p.lifecycle).toBe('BUILD_FAILED');
      expect(p.lastBuildOutcome).toBe('FAILED');
      expect(p.lastBuildError).toBe('tsc exploded');
    });

    it('DELETED is terminal — later events never resurrect the workspace', () => {
      const p = replayWorkspaceState([
        ev(EventType.WORKSPACE_CREATED),
        ev(EventType.WORKSPACE_DELETED),
        ev(EventType.BUILD_STARTED),
        ev(EventType.BUILD_COMPLETED),
      ], 'ws-1');
      expect(p.exists).toBe(false);
      expect(p.lifecycle).toBe('DELETED');
    });

    it('CORRUPTED is sticky and records the id for manual recovery', () => {
      const p = replayWorkspaceState([
        ev(EventType.WORKSPACE_CREATED),
        ev(EventType.WORKSPACE_MUTATION_CORRUPTED, { payload: { id: 'batch-9', error: 'journal mismatch' } }),
      ], 'ws-1');
      expect(p.lifecycle).toBe('CORRUPTED');
      expect(p.corruptedMutationIds).toEqual(['batch-9']);
      expect(p.mutations['batch-9'].state).toBe('CORRUPTED');
      expect(p.mutations['batch-9'].error).toBe('journal mismatch');
    });
  });

  describe('mutation ledger (last-write-wins by id)', () => {
    it('STARTED → FAILED → ROLLED_BACK ends as ROLLED_BACK with correct counts', () => {
      const p = replayWorkspaceState([
        ev(EventType.WORKSPACE_MUTATION_STARTED, { payload: { id: 'b1' } }),
        ev(EventType.WORKSPACE_MUTATION_FAILED, { payload: { id: 'b1', error: 'boom' } }),
        ev(EventType.WORKSPACE_MUTATION_ROLLED_BACK, { payload: { id: 'b1' } }),
        ev(EventType.WORKSPACE_MUTATION_COMMITTED, { payload: { id: 'b2' } }),
      ], 'ws-1');
      expect(p.mutations['b1'].state).toBe('ROLLED_BACK');
      expect(p.mutations['b2'].state).toBe('COMMITTED');
      expect(p.committedMutationCount).toBe(1);
      expect(p.failedMutationCount).toBe(1);
      expect(p.rolledBackMutationCount).toBe(1);
    });

    it('a STARTED with no terminal event is honestly reported as STARTED (not assumed committed)', () => {
      const p = replayWorkspaceState([ev(EventType.WORKSPACE_MUTATION_STARTED, { payload: { id: 'b1' } })], 'ws-1');
      expect(p.mutations['b1'].state).toBe('STARTED');
      expect(p.committedMutationCount).toBe(0);
    });
  });

  describe('VCS refs + checkpoints (ids/hashes only)', () => {
    it('captures commit, last-known-good, branch from real payload fields', () => {
      const p = replayWorkspaceState([
        ev(EventType.VCS_INITIALIZED),
        ev(EventType.VCS_BRANCH_CREATED, { payload: { branchName: 'feat/x' } }),
        ev(EventType.VCS_COMMITTED, { payload: { commitHash: 'abc123' } }),
        ev(EventType.VCS_COMMIT_COMPLETED, { payload: { commitId: 'def456' } }),
        ev(EventType.VCS_LAST_KNOWN_GOOD_SET, { payload: { commitHash: 'abc123' } }),
      ], 'ws-1');
      expect(p.vcsInitialized).toBe(true);
      expect(p.currentBranch).toBe('feat/x');
      expect(p.lastCommitId).toBe('def456'); // last write wins
      expect(p.lastKnownGoodCommitId).toBe('abc123');
    });

    it('tracks checkpoint ids; delete removes one; restore records the last', () => {
      const p = replayWorkspaceState([
        ev(EventType.CHECKPOINT_CREATED, { payload: { id: 'c1' } }),
        ev(EventType.CHECKPOINT_CREATED, { payload: { id: 'c2' } }),
        ev(EventType.CHECKPOINT_DELETED, { payload: { id: 'c1' } }),
        ev(EventType.CHECKPOINT_RESTORED, { payload: { id: 'c2' } }),
      ], 'ws-1');
      expect(p.knownCheckpointIds).toEqual(['c2']);
      expect(p.lastRestoredCheckpointId).toBe('c2');
    });
  });

  describe('honesty + purity', () => {
    it('is honest: reconstructable=false, no filesPresent field, notes present', () => {
      const p = replayWorkspaceState([ev(EventType.WORKSPACE_CREATED)], 'ws-1');
      expect(p.reconstructable).toBe(false);
      expect((p as any).filesPresent).toBeUndefined();
      expect(p.notes.join(' ')).toMatch(/not present in any AppMakerLab event payload/i);
    });

    it('counts only state-affecting events; audits the rest in unappliedEventTypes', () => {
      const p = replayWorkspaceState([
        ev(EventType.WORKSPACE_CREATED),
        ev(EventType.FILE_READ),
        ev(EventType.FILE_LISTED),
        ev(EventType.TASK_RETRYING),
      ], 'ws-1');
      expect(p.totalEventsApplied).toBe(1); // only WORKSPACE_CREATED moved state
      expect(p.unappliedEventTypes[EventType.FILE_READ]).toBe(1);
      expect(p.unappliedEventTypes[EventType.FILE_LISTED]).toBe(1);
      expect(p.unappliedEventTypes[EventType.TASK_RETRYING]).toBe(1);
    });

    it('is pure: identical input → deep-equal output, and does NOT mutate the input', () => {
      const events = [ev(EventType.WORKSPACE_CREATED), ev(EventType.BUILD_STARTED)];
      const frozen = JSON.stringify(events);
      const a = replayWorkspaceState(events, 'ws-1');
      const b = replayWorkspaceState(events, 'ws-1');
      expect(a).toEqual(b);
      expect(JSON.stringify(events)).toBe(frozen); // input untouched
    });
  });
});

describe('EventHistoryStore replay methods (P4.2)', () => {
  it('replayWorkspace folds the events filtered by workspaceId', () => {
    const store = new EventHistoryStore('test');
    store.add(ev(EventType.WORKSPACE_CREATED, { workspaceId: 'ws-A' }));
    store.add(ev(EventType.BUILD_STARTED, { workspaceId: 'ws-A' }));
    store.add(ev(EventType.WORKSPACE_CREATED, { workspaceId: 'ws-B' })); // other workspace
    const p = store.replayWorkspace('ws-A');
    expect(p.workspaceId).toBe('ws-A');
    expect(p.exists).toBe(true);
    expect(p.lifecycle).toBe('BUILDING');
  });

  it('honest gap: mutation events stamped a different workspaceId are recovered via correlationId', () => {
    const store = new EventHistoryStore('test');
    // Mirrors TransactionCoordinator: mutation events carry workspaceId 'default' + correlationId = batch id.
    store.add(ev(EventType.WORKSPACE_MUTATION_STARTED, { workspaceId: 'default', correlationId: 'batch-7', payload: { id: 'batch-7' } }));
    store.add(ev(EventType.WORKSPACE_MUTATION_COMMITTED, { workspaceId: 'default', correlationId: 'batch-7', payload: { id: 'batch-7' } }));

    // replayWorkspace('ws-real') does NOT see them (they aren't stamped with the real workspace).
    expect(store.replayWorkspace('ws-real').committedMutationCount).toBe(0);
    // replayByCorrelationId DOES recover the mutation ledger for that batch.
    const byCorr = store.replayByCorrelationId('batch-7');
    expect(byCorr.committedMutationCount).toBe(1);
    expect(byCorr.mutations['batch-7'].state).toBe('COMMITTED');
  });
});
