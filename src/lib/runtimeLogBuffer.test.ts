import { describe, it, expect } from 'vitest';
import { appendLogChunk, runtimeLogEmptyMessage, RUNTIME_LOG_BUFFER_CHARS } from './runtimeLogBuffer';

describe('appendLogChunk', () => {
  it('appends in order', () => {
    expect(appendLogChunk('a\n', 'b\n')).toBe('a\nb\n');
  });

  it('treats missing input as empty rather than printing "undefined" into the pane', () => {
    expect(appendLogChunk(undefined as unknown as string, 'x')).toBe('x');
    expect(appendLogChunk('x', undefined as unknown as string)).toBe('x');
  });

  // A dev server under load emits megabytes a minute. An unbounded React state would grow until the tab
  // dies — a worse bug than the one this pane exists to expose.
  it('caps the buffer, dropping the OLDEST content', () => {
    const out = appendLogChunk('old\n'.repeat(100), 'new line\n', 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('new line\n')).toBe(true);
  });

  it('trims at a LINE boundary — a half-line at the top reads as corrupted output', () => {
    const out = appendLogChunk('aaaaaaaaaa\nbbbbbbbbbb\ncccccccccc\n', '', 25);
    expect(out.startsWith('bbbbbbbbbb') || out.startsWith('cccccccccc')).toBe(true);
    expect(out.split('\n')[0]).not.toMatch(/^a+$/); // never the tail of the dropped line
  });

  it('keeps one very long unbroken line rather than discarding the whole buffer', () => {
    const out = appendLogChunk('', 'x'.repeat(100), 20);
    expect(out).toBe('x'.repeat(20));
  });

  it('leaves a small buffer untouched at the default cap', () => {
    const small = 'line\n'.repeat(10);
    expect(appendLogChunk(small, '')).toBe(small);
    expect(RUNTIME_LOG_BUFFER_CHARS).toBeGreaterThan(10_000);
  });
});

// These three states look IDENTICAL (an empty pane) and mean completely different things. Saying which
// one it is IS the feature — a blank pane explains nothing and sends the user to ask for a rebuild.
describe('runtimeLogEmptyMessage — an empty pane must still say something true', () => {
  it('never built', () => {
    expect(runtimeLogEmptyMessage('not_started', false)).toMatch(/build an app/i);
  });

  it('built but not running — and says how to bring it back', () => {
    const m = runtimeLogEmptyMessage('dormant', false);
    expect(m).toMatch(/not running/i);
    expect(m).toMatch(/send a message/i);
  });

  it('running but silent — distinct from both of the above', () => {
    expect(runtimeLogEmptyMessage('live', false)).toMatch(/has not printed anything/i);
  });

  it('always returns something — no status may produce a blank pane', () => {
    for (const s of ['idle', 'live', 'dormant', 'not_started'] as const) {
      for (const hasLog of [true, false]) {
        expect(runtimeLogEmptyMessage(s, hasLog).length, `${s}/${hasLog}`).toBeGreaterThan(0);
      }
    }
  });
});
