import { describe, it, expect } from 'vitest';
import { appendEvents, eventsSince, emptyLiveBuffer, DEFAULT_LIVE_BUFFER_MAX } from './LiveEventBuffer';

describe('appendEvents', () => {
  it('assigns monotonic sequence numbers and is pure (no mutation)', () => {
    const a = emptyLiveBuffer();
    const b = appendEvents(a, [{ type: 'x' }, { type: 'y' }]);
    expect(a.seq).toBe(0);          // original untouched
    expect(a.events).toEqual([]);
    expect(b.seq).toBe(2);
    expect(b.events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('continues the sequence across multiple appends', () => {
    let buf = appendEvents(emptyLiveBuffer(), ['a', 'b']);
    buf = appendEvents(buf, ['c']);
    expect(buf.seq).toBe(3);
    expect(buf.events.map((e) => e.e)).toEqual(['a', 'b', 'c']);
  });

  it('a no-op publish (empty/garbage) never advances the sequence', () => {
    const buf = appendEvents(emptyLiveBuffer(), ['a']);
    expect(appendEvents(buf, []).seq).toBe(1);
    expect(appendEvents(buf, undefined as unknown as unknown[]).seq).toBe(1);
  });

  it('caps the ring to `max`, keeping the NEWEST events (seq keeps climbing)', () => {
    let buf = emptyLiveBuffer();
    for (let i = 1; i <= 250; i++) buf = appendEvents(buf, [`e${i}`], 200);
    expect(buf.events.length).toBe(200);
    expect(buf.seq).toBe(250);
    expect(buf.events[0].e).toBe('e51');                 // oldest 50 trimmed
    expect(buf.events[buf.events.length - 1].e).toBe('e250');
  });

  it('tolerates a null/garbage prior buffer', () => {
    expect(appendEvents(null, ['a']).events.map((e) => e.e)).toEqual(['a']);
    expect(appendEvents({} as never, ['a']).seq).toBe(1);
  });
});

describe('eventsSince', () => {
  it('returns the whole tail for a fresh subscriber (sinceSeq=0)', () => {
    const buf = appendEvents(emptyLiveBuffer(), ['a', 'b', 'c']);
    const r = eventsSince(buf, 0);
    expect(r.events).toEqual(['a', 'b', 'c']);
    expect(r.seq).toBe(3);
    expect(r.gap).toBe(false);
  });

  it('returns only the delta for a returning poller', () => {
    const buf = appendEvents(emptyLiveBuffer(), ['a', 'b', 'c', 'd']);
    const r = eventsSince(buf, 2);
    expect(r.events).toEqual(['c', 'd']);
    expect(r.seq).toBe(4);
  });

  it('returns no events but still advances the cursor when caught up', () => {
    const buf = appendEvents(emptyLiveBuffer(), ['a', 'b']);
    const r = eventsSince(buf, 2);
    expect(r.events).toEqual([]);
    expect(r.seq).toBe(2);
    expect(r.gap).toBe(false);
  });

  it('flags a gap when the poller cursor predates the trimmed ring', () => {
    let buf = emptyLiveBuffer();
    for (let i = 1; i <= 250; i++) buf = appendEvents(buf, [`e${i}`], 200);
    // poller last saw seq 10, but the ring now only retains seq 51..250 → events 11..50 were trimmed.
    const r = eventsSince(buf, 10);
    expect(r.gap).toBe(true);
    expect(r.seq).toBe(250);
    expect(r.events[0]).toBe('e51'); // delivers what survives
  });

  it('uses the default cap when none is given', () => {
    let buf = emptyLiveBuffer();
    for (let i = 0; i < DEFAULT_LIVE_BUFFER_MAX + 10; i++) buf = appendEvents(buf, [i]);
    expect(buf.events.length).toBe(DEFAULT_LIVE_BUFFER_MAX);
  });
});
