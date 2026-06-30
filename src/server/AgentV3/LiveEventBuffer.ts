// AgentV3 — Live Event Buffer (cross-device live sync, pure core).
//
// The live build event stream lives in ONE server instance's memory (runningBuilds), keyed by user,
// so a second device whose request lands on a DIFFERENT Cloud Run instance can't see it. To mirror
// the live activity across devices/instances we publish events to a SHARED channel; this is the pure,
// deterministic core of that channel — a capped ring buffer with a monotonic sequence number so any
// device can ask "give me everything after seq N" and catch up exactly, without duplicates or gaps.
//
// Why a seq + ring (not a growing log): the events are THROWAWAY progress (file writes, tool calls,
// status lines). We only ever need the recent tail for a device that just attached + the live tip for
// a device already watching. Capping the ring keeps the shared store tiny (cheap at 1M users) and the
// seq lets a poller fetch only the delta. PURE & deterministic — no I/O, fully unit-testable.

/** One buffered event tagged with its global sequence number. */
export interface SeqEvent {
  seq: number;
  e: unknown;
}

/** The serialisable channel state persisted to / read from the shared store. */
export interface LiveBuffer {
  /** The highest sequence number assigned so far (monotonic, never resets within a build). */
  seq: number;
  /** The most recent events (oldest→newest), capped to `max`. */
  events: SeqEvent[];
}

/** Default ring size — enough for a device to catch up on recent activity without bloating the doc. */
export const DEFAULT_LIVE_BUFFER_MAX = 200;

export function emptyLiveBuffer(): LiveBuffer {
  return { seq: 0, events: [] };
}

/**
 * Append events to the buffer, assigning each the next sequence number, and trim to the last `max`.
 * Pure — returns a NEW buffer (never mutates the input). Non-array / empty input returns the buffer
 * unchanged (same seq), so a no-op publish never advances the sequence.
 */
export function appendEvents(
  buf: LiveBuffer | null | undefined,
  events: readonly unknown[],
  max = DEFAULT_LIVE_BUFFER_MAX,
): LiveBuffer {
  const base: LiveBuffer = buf && typeof buf.seq === 'number' && Array.isArray(buf.events)
    ? { seq: buf.seq, events: [...buf.events] }
    : emptyLiveBuffer();
  if (!Array.isArray(events) || events.length === 0) return base;
  let seq = base.seq;
  const out = base.events;
  for (const e of events) out.push({ seq: ++seq, e });
  const cap = Math.max(1, Math.floor(max));
  return { seq, events: out.length > cap ? out.slice(out.length - cap) : out };
}

/**
 * Return every event with seq STRICTLY GREATER than `sinceSeq`, plus the buffer's latest seq (so the
 * caller advances its cursor even when no event survived the ring trim). A caller starting fresh
 * passes sinceSeq=0 to get the whole tail; a returning poller passes its last seen seq to get only the
 * delta. PURE & deterministic.
 *
 * `gap` is true when the requested `sinceSeq` is OLDER than the oldest event still in the ring — i.e.
 * some events were trimmed before this poller could read them. The caller can surface that honestly
 * (e.g. "catching up…") rather than silently dropping events.
 */
export function eventsSince(
  buf: LiveBuffer | null | undefined,
  sinceSeq: number,
): { events: unknown[]; seq: number; gap: boolean } {
  const b: LiveBuffer = buf && typeof buf.seq === 'number' && Array.isArray(buf.events)
    ? buf
    : emptyLiveBuffer();
  const since = typeof sinceSeq === 'number' && sinceSeq >= 0 ? sinceSeq : 0;
  const fresh = b.events.filter((x) => x && typeof x.seq === 'number' && x.seq > since);
  const oldest = b.events.length > 0 ? b.events[0].seq : b.seq + 1;
  // A gap exists only when the poller had already seen past 0 but its cursor predates the ring's
  // oldest retained event (so intermediate events were trimmed away before it polled).
  const gap = since > 0 && since < oldest - 1;
  return { events: fresh.map((x) => x.e), seq: b.seq, gap };
}
