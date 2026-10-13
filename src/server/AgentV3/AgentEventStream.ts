import type { AgentEvent } from './types';
import { sanitizeResponseEmoji } from '../lib/responseEmoji';

export type AgentEventListener = (event: AgentEvent) => void;

/**
 * 🔒 EMOJI HONESTY, APPLIED BY CONSTRUCTION (admin 2026-08-15).
 *
 * Every v5 surface — chat, preview, IDE, history — reads from this one stream, so this is the only place
 * that has to be right. A celebratory emoji on a message about a build that failed (or has not finished)
 * is removed HERE, which means no call site can forget to do it and no future call site can reintroduce
 * it. The same discipline as the white-label redaction: one choke point, not a convention.
 *
 * The outcome is taken from the event's OWN `ok` flag — the platform's measurement — never guessed from
 * the words. `narration`/`thinking` carry no `ok` because the build is still running, which is exactly
 * the "app bani nahi aur 🎉 aa gaya" case, so they are treated as 'working'.
 *
 * ⚠️ `stream_delta` is deliberately NOT sanitized. A delta is an arbitrary slice of the model's output,
 * so an emoji can be split across two of them; stripping per-slice would be exact only sometimes and
 * would leave broken half-sequences the rest of the time. The COMPLETE text always arrives as a
 * `narration` or `done` event, and that is where the guarantee is exact. A half-guarantee that mangles
 * text would be worse than none.
 */
function withHonestEmoji(event: AgentEvent): AgentEvent {
  switch (event.type) {
    case 'done':
    case 'agent_done':
      return { ...event, summary: sanitizeResponseEmoji(event.summary, event.ok ? 'success' : 'failure') };
    case 'narration':
    case 'thinking':
      // Mid-build: nothing has succeeded yet, so nothing may be celebrated yet.
      return { ...event, text: sanitizeResponseEmoji(event.text, 'working') };
    case 'error':
      return { ...event, message: sanitizeResponseEmoji(event.message, 'failure') };
    default:
      return event;
  }
}

/**
 * AgentEventStream — the single broadcast spine all v5.0 surfaces subscribe to
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
  /**
   * When the user started waiting — the stream is made as the request arrives, and every runner of the build
   * shares it. User-visible clocks ("Still working — Ns so far") measure from here, never from the current
   * model call (autopsy 303e8a6f: a user 23 s in was told 11 s).
   */
  readonly startedAt: number;
  /**
   * The build-budget stages already told to the USER, for the whole build — a plain public property, so a
   * sub-agent's stream (`Object.create(events)`) reads and adds to the same set (see buildBudgetNarration).
   */
  readonly budgetStagesSaid: Set<string> = new Set();

  constructor(maxBuffer = 500, startedAt = Date.now()) {
    this.maxBuffer = maxBuffer;
    this.startedAt = startedAt;
  }

  /** Broadcast an event to all listeners and append it to the replay buffer. */
  emit(rawEvent: AgentEvent): void {
    // Sanitized BEFORE buffering, so a surface that mounts late and replays the buffer sees exactly the
    // same honest text as one that was listening live.
    const event = withHonestEmoji(rawEvent);
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
