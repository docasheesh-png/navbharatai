// WHAT THE USER MUST DO — the one hook that records it (admin 2026-09-20).
//
// Three different places in the build emit an ask (`secret_request` twice, `permission_request` in
// three, `clarify` in one). Recording at each of those would be six call sites that must each remember
// to do it, and the seventh — written next month — would not. Every one of them already passes through
// the build's ONE event stream, so that is where the recorder sits: the same choke-point discipline as
// the checkpoint persister a few lines above it in the route, and as the emoji sanitiser inside the
// stream itself.
//
// This module holds no policy. `actionsFromEvent` decides what an event means, `saveUserActions`
// decides how it is stored, and this is the wire between them.

import { actionsFromEvent, type UserAction, type UserActionSourceEvent } from './userActions';
import { saveUserActions } from './UserActionStore';

/** The slice of `AgentEventStream` this needs. Narrow on purpose, so a test can pass a fake. */
export interface UserActionEventSource {
  subscribe(fn: (event: unknown) => void, replay?: boolean): () => void;
}

export interface RecorderOptions {
  workspaceId: string;
  /** The build this ask belongs to — a LATER build may re-open a row the user only said they did. */
  buildId: string;
  /** Injected for tests; defaults to the durable store. */
  save?: (workspaceId: string, actions: readonly UserAction[]) => Promise<unknown>;
  now?: () => number;
}

/**
 * Persist every ask this build makes, as it makes it. Returns the unsubscribe.
 *
 * 🔒 `replay: false`. The stream replays its buffer to a late subscriber, and this is attached at build
 * start, so replay would be harmless today — but a recorder that re-reads history is one refactor away
 * from re-opening rows the user has already dealt with, and rule 4 says a closed row must not come
 * back. Subscribing live only is the version that cannot develop that bug.
 *
 * ⚠️ Fire-and-forget by construction: the stream's own listener contract is synchronous, and a build
 * must never wait on a Firestore write to carry on building. Every failure is swallowed in the store.
 */
export function attachUserActionRecorder(
  stream: UserActionEventSource,
  opts: RecorderOptions,
): () => void {
  const { workspaceId, buildId } = opts;
  if (!workspaceId) return () => {};
  const save = opts.save ?? saveUserActions;
  const now = opts.now ?? Date.now;
  return stream.subscribe((event) => {
    try {
      const actions = actionsFromEvent(event as UserActionSourceEvent, buildId, now());
      if (actions.length === 0) return;
      void Promise.resolve(save(workspaceId, actions)).catch(() => {});
    } catch {
      /* a task record must never break the build loop */
    }
  }, false);
}
