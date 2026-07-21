import { describe, it, expect } from 'vitest';
import { createRevealPacer, isFileRevealEvent, isFlushEvent } from './revealPacer';

/** Manual clock + scheduler so the drip is fully deterministic. */
function harness(minIntervalMs = 600) {
  let t = 100_000;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextId = 1;
  const out: Array<{ type?: string; text?: string }> = [];
  const pacer = createRevealPacer<{ type?: string; text?: string }>((e) => out.push(e), {
    minIntervalMs,
    maxQueue: 3,
    now: () => t,
    schedule: (fn, ms) => { const id = nextId++; timers.push({ at: t + ms, fn, id }); return id; },
    cancel: (h) => { const i = timers.findIndex((x) => x.id === h); if (i >= 0) timers.splice(i, 1); },
  });
  const advance = (ms: number) => {
    const target = t + ms;
    for (;;) {
      const due = timers.filter((x) => x.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      t = due.at;
      timers.splice(timers.indexOf(due), 1);
      due.fn();
    }
    t = target;
  };
  return { pacer, out, advance, now: () => t };
}

const file = (n: number, total = 44) => ({ type: 'narration', text: `✓ src/f${n}.ts (${n}/${total})` });
const note = (text: string) => ({ type: 'narration', text });

describe('isFileRevealEvent / isFlushEvent', () => {
  it('matches the engine per-file line and nothing else', () => {
    expect(isFileRevealEvent(file(2))).toBe(true);
    expect(isFileRevealEvent(note('Planning the file list…'))).toBe(false);
    expect(isFileRevealEvent({ type: 'tool_call', text: '✓ x (1/2)' })).toBe(false);
    expect(isFileRevealEvent(null)).toBe(false);
  });
  it('flush events are the build-terminal types', () => {
    expect(isFlushEvent({ type: 'result' })).toBe(true);
    expect(isFlushEvent({ type: 'done' })).toBe(true);
    expect(isFlushEvent({ type: 'error' })).toBe(true);
    expect(isFlushEvent({ type: 'narration' })).toBe(false);
  });
});

describe('createRevealPacer — the honest drip', () => {
  it('a BURST of file completions reveals one-by-one at the min interval (background untouched)', () => {
    const { pacer, out, advance } = harness(600);
    pacer.push(file(1)); pacer.push(file(2)); pacer.push(file(3)); // 3 files land in the same ms
    expect(out).toHaveLength(1);          // first shows instantly
    advance(600); expect(out).toHaveLength(2);
    advance(600); expect(out).toHaveLength(3);
    expect(out.map((e) => e.text)).toEqual([file(1).text, file(2).text, file(3).text]); // exact order
  });

  it('non-file events pass through instantly when nothing is queued', () => {
    const { pacer, out } = harness(600);
    pacer.push(note('Planning the file list…'));
    pacer.push(note('Setting up your workspace…'));
    expect(out).toHaveLength(2); // zero added latency on the normal narration path
  });

  it('ORDER IS SACRED — a non-file event behind queued files waits its turn (never overtakes)', () => {
    const { pacer, out, advance } = harness(600);
    pacer.push(file(1)); pacer.push(file(2));
    pacer.push(note('Now wiring the backend…')); // arrives AFTER file 2 — must show after it
    expect(out).toHaveLength(1);
    advance(600);
    expect(out.map((e) => e.text)).toEqual([file(1).text, file(2).text, 'Now wiring the backend…']);
  });

  it('a terminal event FLUSHES everything instantly — the user never waits to learn the build finished', () => {
    const { pacer, out } = harness(600);
    pacer.push(file(1)); pacer.push(file(2)); pacer.push(file(3));
    expect(out).toHaveLength(1);
    pacer.push({ type: 'result' });
    expect(out).toHaveLength(4); // files 2+3 flushed, then the result — nothing dropped, order kept
    expect(out[3].type).toBe('result');
  });

  it('a BACKLOG past maxQueue drains at 4× speed (the drip never lags the real build)', () => {
    const { pacer, out, advance } = harness(600);
    for (let i = 1; i <= 6; i++) pacer.push(file(i)); // 5 queued > maxQueue 3
    expect(out).toHaveLength(1);
    advance(150); expect(out).toHaveLength(2); // 600/4 = 150ms while the backlog is deep
  });

  it('files arriving slower than the interval are never delayed at all', () => {
    const { pacer, out, advance } = harness(600);
    pacer.push(file(1)); expect(out).toHaveLength(1);
    advance(2_000);
    pacer.push(file(2)); expect(out).toHaveLength(2); // gap ≥ interval → instant
  });

  it('discard() drops the queue silently (stale stream — a newer turn owns the state)', () => {
    const { pacer, out } = harness(600);
    pacer.push(file(1)); pacer.push(file(2));
    pacer.discard();
    expect(out).toHaveLength(1);
    expect(pacer.queued()).toBe(0);
  });

  it('minIntervalMs <= 0 is a pure pass-through (pacing disabled)', () => {
    const { pacer, out } = harness(0);
    pacer.push(file(1)); pacer.push(file(2)); pacer.push(file(3));
    expect(out).toHaveLength(3);
  });
});
