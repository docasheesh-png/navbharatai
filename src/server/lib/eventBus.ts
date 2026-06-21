/**
 * G1.1 — shared, process-wide event bus.
 *
 * The platform already has a well-designed event vocabulary in
 * `AppMakerLab/eventbus/EventTypes.ts` (BUILD_STARTED/COMPLETED/FAILED, …) but the
 * AppMakerLab bus is dormant (instantiated per-operation, in-memory only, never
 * wired into the live server). This is the ONE shared singleton that Pro + Engineer
 * publish lifecycle events to — the spine for event sourcing, audit trail, and the
 * observability feed (G2).
 *
 * Hard rule: `publish()` is best-effort and MUST NEVER throw or block the caller.
 * It dispatches to in-process listeners and a persistence sink (registered by
 * eventStore) fire-and-forget, and keeps a bounded in-memory ring for fast reads
 * even when Firestore is unavailable.
 */
import { randomUUID } from 'crypto';

/** A normalized event. `type` reuses EventType values, or an `engineer:<...>` mirror. */
export interface BusEvent {
  eventId: string;
  type: string;
  workspaceId: string;
  correlationId: string;
  sender: string;
  ts: number;
  payload: Record<string, unknown>;
}

export interface PublishInput {
  type: string;
  workspaceId?: string;
  correlationId?: string;
  sender?: string;
  payload?: Record<string, unknown>;
}

type Sink = (e: BusEvent) => void;
type Listener = (e: BusEvent) => void;

const RING_LIMIT = 500;

class EventBus {
  private ring: BusEvent[] = [];
  private sink: Sink | null = null;
  private listeners: Listener[] = [];

  /** Registered once by eventStore so every event is persisted (fire-and-forget). */
  setPersistSink(fn: Sink): void {
    this.sink = fn;
  }

  /** Subscribe to every event (returns an unsubscribe fn). Used by G2 telemetry later. */
  onAny(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Best-effort publish — never throws, never blocks. */
  publish(input: PublishInput): void {
    try {
      const ws = input.workspaceId || 'unknown';
      const event: BusEvent = {
        eventId: randomUUID(),
        type: input.type,
        workspaceId: ws,
        correlationId: input.correlationId || ws,
        sender: input.sender || 'system',
        ts: Date.now(),
        payload: input.payload || {},
      };
      this.ring.push(event);
      if (this.ring.length > RING_LIMIT) this.ring.shift();
      for (const l of this.listeners) {
        try { l(event); } catch { /* a listener must never break publish */ }
      }
      if (this.sink) {
        try { void Promise.resolve(this.sink(event)); } catch { /* persistence is best-effort */ }
      }
    } catch { /* publish is a side-channel — it must never affect the caller */ }
  }

  /** Newest-first in-memory events, optionally filtered. Used as the read fallback. */
  recent(opts?: { workspaceId?: string; correlationId?: string }): BusEvent[] {
    let out = this.ring;
    if (opts?.workspaceId) out = out.filter(e => e.workspaceId === opts.workspaceId);
    if (opts?.correlationId) out = out.filter(e => e.correlationId === opts.correlationId);
    return [...out].reverse();
  }
}

export const eventBus = new EventBus();
