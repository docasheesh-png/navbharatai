import type { AgentEvent } from './types';

export type AgentEventListener = (event: AgentEvent) => void;

/**
 * AgentEventStream — the single broadcast spine all v3.0 surfaces subscribe to
 * (Preview, IDE/Code Studio, File explorer, Git, History). One stream → zero
 * drift between panes (NAVBHARATAI_PRO_V3_DESIGN.md §3.2).
 *
 * Synchronous, in-process, per session. Keeps a bounded replay buffer so a
 * surface that mounts mid-build can catch up. Best-effort: a listener that
 * throws is isolated and never breaks the agent loop.
 */
export class AgentEventStream {
  private readonly listeners = new Set<AgentEventListener>();
  private readonly buffer: AgentEvent[] = [];
  private readonly maxBuffer: number;

  constructor(maxBuffer = 500) {
    this.maxBuffer = maxBuffer;
  }

  /** Broadcast an event to all listeners and append it to the replay buffer. */
  emit(event: AgentEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > this.maxBuffer) this.buffer.shift();
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
        // A surface listener must never break the agent loop.
      }
    }
  }

  /**
   * Subscribe to the stream. When `replay` is true (default) the listener first
   * receives every buffered event, so a late-mounting surface catches up.
   * Returns an unsubscribe function.
   */
  subscribe(fn: AgentEventListener, replay = true): () => void {
    if (replay) {
      for (const e of this.buffer) {
        try {
          fn(e);
        } catch {
          // isolated — see emit()
        }
      }
    }
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Number of buffered events (observability / tests). */
  get bufferedCount(): number {
    return this.buffer.length;
  }

  /** Number of active listeners (observability / tests). */
  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Get a snapshot of all buffered events (for health checks / early validation). */
  snapshot(): AgentEvent[] {
    return [...this.buffer];
  }
}
