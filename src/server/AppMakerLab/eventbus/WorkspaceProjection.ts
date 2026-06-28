// P4.2 — Event Sourcing + Replay (UPGRADE v3.0).
//
// A REAL, honest replay projection: fold a workspace's event log into the state the events
// actually prove. Verified ground truth (see the discovery notes): AppMakerLab event payloads
// carry NO file paths and NO file content — `WORKSPACE_MUTATION_*` events carry only
// `{ id }` (the batch id, == correlationId), and `WORKSPACE_CREATED`/`FILES_GENERATED` carry
// only a workspaceId with no payload. So this projection reconstructs the LIFECYCLE, the
// MUTATION LEDGER (keyed by transaction id), VCS refs (hashes/branch), checkpoint pointers,
// and build outcome — and is explicit that it CANNOT reconstruct file bytes (`reconstructable:
// false`). Inventing a `filesPresent[]` here would be a fake feature; the byte-level restore
// stays the job of the Journal + CheckpointStorage. This is a live-process audit/timeline view.

import { IEvent } from './IEvent';
import { EventType } from './EventTypes';

/** Lifecycle phase derived purely from the event stream. */
export type WorkspaceLifecycle =
  | 'UNKNOWN'         // no WORKSPACE_CREATED seen
  | 'CREATED'         // WORKSPACE_CREATED, nothing generated yet
  | 'GENERATING'      // GENERATION_STARTED / TASK_STARTED in flight
  | 'FILES_GENERATED' // FILES_GENERATED / GENERATION_COMPLETED
  | 'BUILDING'        // BUILD_STARTED
  | 'BUILT'           // BUILD_COMPLETED
  | 'BUILD_FAILED'    // BUILD_FAILED
  | 'REPAIRING'       // REPAIR_STARTED
  | 'CORRUPTED'       // WORKSPACE_MUTATION_CORRUPTED (manual recovery required)
  | 'DELETED';        // WORKSPACE_DELETED

/** One mutation transaction as seen ONLY through events (id + outcome — no paths/bytes). */
export interface MutationRecord {
  id: string;        // == batch.id == correlationId (TransactionCoordinator)
  state: 'STARTED' | 'COMMITTED' | 'FAILED' | 'ROLLED_BACK' | 'CORRUPTED';
  error?: string;    // present for FAILED / CORRUPTED
  lastEventAt: Date;
}

/** What the event log CAN prove about a workspace. Every field is payload-grounded. */
export interface WorkspaceProjection {
  workspaceId: string;
  lifecycle: WorkspaceLifecycle;
  exists: boolean;                 // created && !deleted

  // Mutation ledger — keyed by transaction id, NOT by file path (events carry no path).
  mutations: Record<string, MutationRecord>;
  committedMutationCount: number;
  rolledBackMutationCount: number;
  failedMutationCount: number;
  corruptedMutationIds: string[];  // require manual recovery

  // VCS facts the events DO carry (hashes/refs only — never file content).
  vcsInitialized: boolean;
  lastCommitId: string | null;
  lastKnownGoodCommitId: string | null;
  currentBranch: string | null;

  // Checkpoint pointers (ids only — content lives in CheckpointStorage, not events).
  knownCheckpointIds: string[];
  lastRestoredCheckpointId: string | null;

  // Build/repair signal.
  lastBuildOutcome: 'NONE' | 'SUCCESS' | 'FAILED';
  lastBuildError: string | null;

  // Bookkeeping / audit.
  totalEventsApplied: number;
  unappliedEventTypes: Partial<Record<EventType, number>>; // events seen but not state-affecting
  firstEventAt: Date | null;
  lastEventAt: Date | null;
  lastEventType: EventType | null;

  // Honesty boundary, embedded so callers can't miss it.
  reconstructable: false;          // file BYTES are never reconstructable from events
  notes: string[];
}

function initial(workspaceId: string): WorkspaceProjection {
  return {
    workspaceId, lifecycle: 'UNKNOWN', exists: false,
    mutations: {}, committedMutationCount: 0, rolledBackMutationCount: 0,
    failedMutationCount: 0, corruptedMutationIds: [],
    vcsInitialized: false, lastCommitId: null, lastKnownGoodCommitId: null, currentBranch: null,
    knownCheckpointIds: [], lastRestoredCheckpointId: null,
    lastBuildOutcome: 'NONE', lastBuildError: null,
    totalEventsApplied: 0, unappliedEventTypes: {},
    firstEventAt: null, lastEventAt: null, lastEventType: null,
    reconstructable: false,
    notes: [
      'File paths and content are NOT present in any AppMakerLab event payload; this ' +
      'projection reconstructs lifecycle / mutation-ledger / VCS-refs / checkpoint-ids only. ' +
      'To restore actual files use the Journal + CheckpointStorage restore path.',
    ],
  };
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (v instanceof Error) return v.message;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function upsertMutation(p: WorkspaceProjection, id: unknown, state: MutationRecord['state'], error: string | undefined, at: Date): void {
  if (typeof id !== 'string') return;
  p.mutations[id] = { id, state, error, lastEventAt: at }; // last-write-wins == final outcome
}

/**
 * PURE reducer: fold a (chronological) event slice into a WorkspaceProjection. No I/O, no
 * Date.now() — identical input → identical output. The caller passes events already filtered
 * for one workspace/correlation; ordering relies on the store's push-only insertion order
 * (timestamps are NOT re-sorted — they aren't guaranteed monotonic across senders).
 */
export function replayWorkspaceState(events: IEvent[], workspaceId: string): WorkspaceProjection {
  const p = initial(workspaceId);

  for (const e of events) {
    p.totalEventsApplied++;
    if (!p.firstEventAt) p.firstEventAt = e.timestamp;
    p.lastEventAt = e.timestamp;
    p.lastEventType = e.type;
    const pay = (e.payload ?? {}) as Record<string, unknown>;
    let applied = true;

    switch (e.type) {
      // ---- Workspace lifecycle ----
      case EventType.WORKSPACE_CREATED:
        p.exists = true; if (p.lifecycle === 'UNKNOWN') p.lifecycle = 'CREATED'; break;
      case EventType.WORKSPACE_DELETED:
        p.exists = false; p.lifecycle = 'DELETED'; break;
      case EventType.FILES_SAVED:
      case EventType.GENERATION_COMPLETED:
        if (p.lifecycle !== 'DELETED') p.lifecycle = 'FILES_GENERATED'; break;
      case EventType.GENERATION_STARTED:
      case EventType.TASK_STARTED:
        if (p.lifecycle === 'CREATED' || p.lifecycle === 'UNKNOWN') p.lifecycle = 'GENERATING'; break;

      // ---- Mutation ledger: id only ----
      case EventType.WORKSPACE_MUTATION_STARTED:
        upsertMutation(p, pay.id, 'STARTED', undefined, e.timestamp); break;
      case EventType.WORKSPACE_MUTATION_COMMITTED:
        upsertMutation(p, pay.id, 'COMMITTED', undefined, e.timestamp); p.committedMutationCount++; break;
      case EventType.WORKSPACE_MUTATION_FAILED:
        upsertMutation(p, pay.id, 'FAILED', str(pay.error), e.timestamp); p.failedMutationCount++; break;
      case EventType.WORKSPACE_MUTATION_ROLLED_BACK:
        upsertMutation(p, pay.id, 'ROLLED_BACK', undefined, e.timestamp); p.rolledBackMutationCount++; break;
      case EventType.WORKSPACE_MUTATION_CORRUPTED:
        upsertMutation(p, pay.id, 'CORRUPTED', str(pay.error), e.timestamp);
        if (typeof pay.id === 'string' && !p.corruptedMutationIds.includes(pay.id)) p.corruptedMutationIds.push(pay.id);
        p.lifecycle = 'CORRUPTED'; break;

      // ---- VCS: hashes/refs only ----
      case EventType.VCS_INITIALIZED: p.vcsInitialized = true; break;
      case EventType.VCS_COMMITTED: p.lastCommitId = str(pay.commitHash) ?? p.lastCommitId; break;
      case EventType.VCS_COMMIT_COMPLETED: p.lastCommitId = str(pay.commitId) ?? p.lastCommitId; break;
      case EventType.VCS_LKG_UPDATED: p.lastKnownGoodCommitId = str(pay.commitId) ?? p.lastKnownGoodCommitId; break;
      case EventType.VCS_LAST_KNOWN_GOOD_SET: p.lastKnownGoodCommitId = str(pay.commitHash) ?? p.lastKnownGoodCommitId; break;
      case EventType.VCS_BRANCH_CREATED:
      case EventType.VCS_CHECKOUT: p.currentBranch = str(pay.branchName) ?? p.currentBranch; break;

      // ---- Checkpoints: ids only ----
      case EventType.CHECKPOINT_CREATED: {
        const id = str(pay.id) ?? str(pay.planId);
        if (id && !p.knownCheckpointIds.includes(id)) p.knownCheckpointIds.push(id); break;
      }
      case EventType.CHECKPOINT_RESTORED:
        p.lastRestoredCheckpointId = str(pay.id) ?? str(pay.planId) ?? p.lastRestoredCheckpointId; break;
      case EventType.CHECKPOINT_DELETED: {
        const id = str(pay.id);
        if (id) p.knownCheckpointIds = p.knownCheckpointIds.filter((c) => c !== id); break;
      }

      // ---- Build / repair signal ----
      case EventType.BUILD_STARTED:
        if (p.lifecycle !== 'DELETED') p.lifecycle = 'BUILDING'; break;
      case EventType.BUILD_COMPLETED:
        p.lastBuildOutcome = 'SUCCESS'; p.lastBuildError = null;
        if (p.lifecycle !== 'DELETED') p.lifecycle = 'BUILT'; break;
      case EventType.BUILD_FAILED:
        p.lastBuildOutcome = 'FAILED'; p.lastBuildError = str(pay.error) ?? null;
        if (p.lifecycle !== 'DELETED') p.lifecycle = 'BUILD_FAILED'; break;
      case EventType.REPAIR_STARTED:
        if (p.lifecycle !== 'DELETED') p.lifecycle = 'REPAIRING'; break;

      default:
        applied = false; // FILE_READ, FILE_LISTED, TASK_RETRYING, ERROR_OCCURRED, *_STARTED markers, …
    }

    if (!applied) {
      p.totalEventsApplied--; // it didn't move state — back out the count and record it as audit
      p.unappliedEventTypes[e.type] = (p.unappliedEventTypes[e.type] ?? 0) + 1;
    }
  }

  return p;
}
