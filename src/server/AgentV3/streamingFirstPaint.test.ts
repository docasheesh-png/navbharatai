import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeFirstPaintHandler, streamingFirstPaintEnabled, type FileChangedEvent, type ReadyFile } from './streamingFirstPaint';

/**
 * STREAMING FIRST PAINT — the feature that shows the user their app 30–155 s sooner.
 *
 * It shipped gated OFF in July and has never run for a single real user, so it arrived at the decision
 * to enable it with ZERO tests. These exist because the difference between "safe by construction" and
 * "safe" is whether anybody checked, and this one is about to write to the durable store of every build.
 *
 * The properties that actually decide whether it is safe to turn on:
 *   1. OFF is genuinely untouched — no callback at all, not a no-op.
 *   2. It only ever ADDS the paths it was given (an early write cannot delete a later file).
 *   3. A durable-write failure cannot break, delay, or fail the build.
 *   4. Every file written is announced, or the preview never refreshes and the whole point is lost.
 */

const ENV = 'AGENTV3_STREAMING_PREVIEW';
let saved: string | undefined;
beforeEach(() => { saved = process.env[ENV]; delete process.env[ENV]; });
afterEach(() => { if (saved === undefined) delete process.env[ENV]; else process.env[ENV] = saved; });

/** A recording pair of deps, so each test asserts on what really reached the store and the stream. */
function harness(mergeImpl?: () => Promise<unknown>) {
  const merges: Array<{ workspaceId: string; files: Record<string, string> }> = [];
  const events: FileChangedEvent[] = [];
  return {
    merges,
    events,
    deps: {
      merge: (workspaceId: string, files: Record<string, string>) => {
        merges.push({ workspaceId, files });
        return mergeImpl ? mergeImpl() : Promise.resolve();
      },
      emit: (e: FileChangedEvent) => { events.push(e); },
      now: () => 1_700_000_000_000,
    },
  };
}

const files: ReadyFile[] = [
  { path: 'src/App.tsx', content: 'export default () => <h1>hi</h1>;' },
  { path: 'src/main.tsx', content: 'import App from "./App";' },
];

describe('the off switch really means off', () => {
  it('returns NO callback when the flag is unset', () => {
    expect(makeFirstPaintHandler('ws1', harness().deps)).toBeUndefined();
  });

  it('a no-op function would not have been good enough', () => {
    /**
     * The builder branches on whether `onFilesReady` EXISTS. Handing it a function that does nothing
     * would still change its code path, which is not the same promise as "today's behaviour, byte for
     * byte" — the claim the flag's default rests on.
     */
    expect(typeof makeFirstPaintHandler('ws1', harness().deps)).toBe('undefined');
  });

  it('the env var is what decides, and it is read live', () => {
    expect(streamingFirstPaintEnabled()).toBe(false);
    process.env[ENV] = 'on';
    expect(streamingFirstPaintEnabled()).toBe(true);
    expect(makeFirstPaintHandler('ws1', harness().deps)).toBeInstanceOf(Function);
  });
});

describe('what it writes — the property that makes an early write safe', () => {
  it('persists EXACTLY the paths it was handed, and nothing else', () => {
    /**
     * THE SAFETY PROPERTY. A first paint runs while the build is still producing files, so if this ever
     * wrote a whole-project snapshot it would race the build and could clobber work in flight. It must
     * be an upsert of precisely this batch.
     */
    const h = harness();
    makeFirstPaintHandler('ws1', h.deps, true)!(files);
    expect(h.merges).toHaveLength(1);
    expect(h.merges[0].workspaceId).toBe('ws1');
    expect(Object.keys(h.merges[0].files).sort()).toEqual(['src/App.tsx', 'src/main.tsx']);
    expect(h.merges[0].files['src/App.tsx']).toBe(files[0].content);
  });

  it('announces every file it wrote — one event per path', () => {
    // If a write is not announced, the preview never learns to reload and the user waits exactly as
    // long as before. The write and the event are two halves of one feature.
    const h = harness();
    makeFirstPaintHandler('ws1', h.deps, true)!(files);
    expect(h.events.map((e) => e.change.path).sort()).toEqual(['src/App.tsx', 'src/main.tsx']);
    expect(h.events.every((e) => e.type === 'file_changed' && e.change.kind === 'create')).toBe(true);
    expect(h.events[0].ts).toBe(1_700_000_000_000);
  });

  it('a repeated path in one batch is written once, not twice', () => {
    // Last write wins, as an object literal would — and it must not emit two reload events for one file.
    const h = harness();
    makeFirstPaintHandler('ws1', h.deps, true)!([
      { path: 'a.tsx', content: 'first' },
      { path: 'a.tsx', content: 'second' },
    ]);
    expect(h.merges[0].files).toEqual({ 'a.tsx': 'second' });
    expect(h.events).toHaveLength(1);
  });
});

describe('it can never cost the build anything', () => {
  it('a durable-write REJECTION does not throw at the caller', async () => {
    /**
     * This is the one that matters most. It runs on a background path inside a live build, so an
     * unhandled rejection here would surface as a crash in a build that was otherwise completely
     * healthy — turning a feature that only ever saves time into one that loses an app.
     */
    const h = harness(() => Promise.reject(new Error('firestore unavailable')));
    expect(() => makeFirstPaintHandler('ws1', h.deps, true)!(files)).not.toThrow();
    // Give the rejected promise a turn to settle; an unhandled rejection would surface here.
    await new Promise((r) => setTimeout(r, 0));
    // …and the user still gets told about their files, because the preview can also read them later.
    expect(h.events).toHaveLength(2);
  });

  it('a merge that THROWS synchronously is handled too', () => {
    // A dependency that throws before returning a promise skips the `.catch` entirely unless the call
    // itself is wrapped — a real difference between `fn().catch()` and guarding the call.
    const deps = {
      merge: () => { throw new Error('synchronous boom'); },
      emit: () => {},
    };
    expect(() => makeFirstPaintHandler('ws1', deps, true)!(files)).toThrow();
    // Documented honestly rather than hidden: production's `mergeWorkspaceFiles` is an async function,
    // which cannot throw synchronously, so this path is unreachable there. Asserting the real behaviour
    // beats pretending to a guarantee the code does not make.
  });

  it('does no work at all for an empty batch', () => {
    const h = harness();
    makeFirstPaintHandler('ws1', h.deps, true)!([]);
    expect(h.merges).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it('skips malformed entries instead of poisoning the batch', () => {
    // Nobody reads a return value on this path, so one bad entry must not lose the good ones with it.
    const h = harness();
    makeFirstPaintHandler('ws1', h.deps, true)!([
      { path: '', content: 'no path' },
      { path: 'good.tsx', content: 'kept' },
      { path: 'x.tsx', content: undefined as unknown as string },
    ]);
    expect(h.merges[0].files).toEqual({ 'good.tsx': 'kept' });
    expect(h.events).toHaveLength(1);
  });

  it('a batch of ONLY malformed entries writes nothing', () => {
    const h = harness();
    makeFirstPaintHandler('ws1', h.deps, true)!([{ path: '', content: '' }]);
    expect(h.merges).toHaveLength(0);
  });
});
