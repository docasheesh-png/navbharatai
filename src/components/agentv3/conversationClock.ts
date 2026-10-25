import type { AgentV3WireEvent } from './agentV3Types';

/** Display ordering is causal; a device clock must never place a new prompt before prior replies. */
export function nextUserMessageTs(now: number, groups: ReadonlyArray<ReadonlyArray<{ ts: number }>>): number {
  return groups.reduce((latest, rows) => rows.reduce((n, row) => Number.isFinite(row.ts) ? Math.max(n, row.ts + 1) : n, latest), now);
}

/**
 * Project a turn's server timestamps into the submitting device's conversation clock. The first
 * event follows its prompt, regardless of clock skew. Keep the same projection on reconnect and
 * cache event positions so replay and streaming finalization cannot move existing rows. These are
 * display timestamps only: request identities, persisted evidence and the elapsed clock are untouched.
 */
export function createConversationEventClock(after?: number) {
  let floor = Number.isFinite(after) ? after! : undefined;
  let offset: number | undefined;
  const positions = new Map<string, number>();
  return {
    markUserMessage(ts: number) {
      if (Number.isFinite(ts)) floor = Math.max(floor ?? ts, ts);
    },
    project(event: AgentV3WireEvent): AgentV3WireEvent {
      if (!('ts' in event) || !Number.isFinite(event.ts) || floor === undefined) return event;
      offset ??= floor + 1 - event.ts;
      const identity = event as unknown as { id?: string; callId?: string; agent?: string };
      const key = JSON.stringify([event.type, event.ts, identity.id, identity.callId, identity.agent]);
      let ts = positions.get(key);
      if (ts === undefined) {
        ts = Math.max(event.ts + offset, floor + 1);
        positions.set(key, ts);
        floor = ts;
      }
      return { ...event, ts } as AgentV3WireEvent;
    },
  };
}
