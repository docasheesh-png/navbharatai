/**
 * 🔴 A COUNT IS NOT A WINDOW — and two caps that disagree about which end matters compose into a
 * window neither one intended.
 *
 * ## The bug, end to end (found 2026-09-21, while acting on the 40-cap item in PROGRESS.md)
 *
 * A build report is capped twice, and each layer was written in isolation:
 *
 * | layer | cap | which end it kept | its stated reason |
 * |---|---|---|---|
 * | `BuildDiagnostics` (the recorder) | 300 model calls | the **FIRST** 300 | none — `if (length < MAX) push(...)` |
 * | `DiagnosticsStore` (the store) | 40 model calls | the **LAST** 40 | "the end of a build is where its failure lives" |
 *
 * Compose them on a 312-call build and the stored window is calls **261–300**.
 *
 * - Not the head: the first-turn starvation, the plan-call timeout and the rung-1 ladder fall are gone.
 * - Not the tail either: the twelve calls the build actually died on were **never recorded at all** —
 *   the recorder stopped writing at 300 and nothing downstream could know.
 *
 * And `{ kept: 40, total: 312 }` — the truncation fact added the day before — is perfectly TRUE and
 * perfectly unusable: it says forty survived and nothing whatever about *which* forty. The store's
 * own docblock told the reader they were the last forty. They were not, and the record could not
 * contradict it.
 *
 * ## What this suite locks
 *
 * 1. **The composition**, on the REAL recorder and the REAL store: call #1 and call #312 both
 *    survive into the stored report. That is the failure case, and it is asserted end to end rather
 *    than as two unit-level halves that could each pass while the pair stays broken — which is
 *    exactly how this survived a day-old fix to the same module.
 * 2. **The window is declared** (`head`), so no reader has to take a docblock's word for it.
 * 3. **Reversion guards at SOURCE level.** `tsc` and `vitest` cannot see that a bounded push is
 *    written as a prefix cap — the old code compiled, passed every test, and silently threw away
 *    the end of every long build. Only reading the source can catch its return.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  boundedWindow, pushBounded, trimChannel, mergeTruncation, truncationNote, windowShape,
  COMPLETE, type ChannelTruncation,
} from '../src/server/AgentV3/reportTruncation';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { trimReportForStorage, STORED_LLM_CALLS_MAX } from '../src/server/AgentV3/DiagnosticsStore';

const RECORDER = readFileSync('src/server/AgentV3/BuildDiagnostics.ts', 'utf8');
const STORE = readFileSync('src/server/AgentV3/DiagnosticsStore.ts', 'utf8');

/** Comments are prose, not behaviour — a guard that matches one proves nothing (this repo has been
 *  bitten twice by exactly that). Strip them before asserting on the source. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const call = (i: number) => ({
  model: 'glm-4.7-flashx', finishReason: 'end_turn', toolCalls: 1,
  inputTokens: 10, outputTokens: 5, latencyMs: 100, ok: true,
  promptPreview: `call#${i}`,
});

describe('🔴 THE COMPOSED BUG — a 312-call build through the real recorder and the real store', () => {
  function build(calls: number) {
    let t = 0;
    const d = new BuildDiagnostics({ now: () => (t += 10) });
    for (let i = 1; i <= calls; i++) d.recordLlmCall(call(i));
    return trimReportForStorage(d.report());
  }

  it('the build’s FIRST call survives — it used to be gone with certainty', () => {
    const stored = build(312);
    expect(stored.llmCalls?.[0]?.promptPreview).toBe('call#1');
  });

  it('the build’s LAST call survives — it was never even recorded before', () => {
    const stored = build(312);
    expect(stored.llmCalls?.[stored.llmCalls.length - 1]?.promptPreview).toBe('call#312');
  });

  it('🔑 the old window (calls 261–300) is NOT what is stored — that was neither end', () => {
    const stored = build(312);
    const kept = stored.llmCalls!.map((c) => c.promptPreview);
    // The precise shape of the defect: the store believed it held the tail, and held a middle.
    expect(kept).not.toEqual(Array.from({ length: 40 }, (_, i) => `call#${261 + i}`));
    expect(kept).toContain('call#1');
    expect(kept).toContain('call#312');
  });

  it('the cap is unchanged — this buys the head with bytes, not with more storage', () => {
    expect(build(312).llmCalls).toHaveLength(STORED_LLM_CALLS_MAX);
    expect(STORED_LLM_CALLS_MAX).toBe(40);
  });

  it('the record STATES the window, so nobody has to trust a docblock', () => {
    const t = build(312).truncation;
    expect(t?.channels?.llmCalls).toEqual({ kept: 40, total: 312, head: 20 });
    expect(t?.note).toContain('40 of 312 model calls');
    expect(t?.note).toContain('the first 20 and the last 20');
    expect(t?.note).toContain('272 from the middle are gone');
  });

  it('a build under every cap is still reported complete, with no gap invented', () => {
    const stored = build(12);
    expect(stored.llmCalls).toHaveLength(12);
    expect(stored.truncation?.complete).toBe(true);
    expect(stored.truncation?.channels).toBeUndefined();
  });

  it('chronological order is preserved across the gap', () => {
    const ts = build(312).llmCalls!.map((c) => c.ts);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });
});

describe('boundedWindow — the one rule both layers use', () => {
  it('a list that fits is kept whole and claims no tail', () => {
    expect(boundedWindow(10, 40)).toEqual({ head: 10, tail: 0 });
  });

  it('splits half and half, the odd entry to the tail', () => {
    expect(boundedWindow(312, 40)).toEqual({ head: 20, tail: 20 });
    expect(boundedWindow(312, 41)).toEqual({ head: 20, tail: 21 });
  });

  it('🔒 the tail is NEVER the smaller half — the one asymmetry that was already argued for', () => {
    for (const cap of [2, 3, 7, 40, 41, 199, 300, 2000]) {
      const { head, tail } = boundedWindow(10_000, cap);
      expect(head + tail).toBe(cap);
      expect(tail).toBeGreaterThanOrEqual(head);
    }
  });

  it('degrades to a plain tail at cap 1, and refuses a cap of 0', () => {
    expect(boundedWindow(500, 1)).toEqual({ head: 0, tail: 1 });
    expect(boundedWindow(500, 0)).toEqual({ head: 0, tail: 0 });
  });
});

describe('pushBounded — the recorder half', () => {
  it('fills to the cap without evicting anything', () => {
    const arr: number[] = [];
    for (let i = 1; i <= 40; i++) expect(pushBounded(arr, i, 40)).toBe(false);
    expect(arr).toHaveLength(40);
    expect(arr[0]).toBe(1);
  });

  it('🔴 past the cap it keeps recording — the old code stopped dead', () => {
    const arr: number[] = [];
    for (let i = 1; i <= 100; i++) pushBounded(arr, i, 40);
    expect(arr).toHaveLength(40);
    expect(arr[arr.length - 1]).toBe(100);   // the newest entry is present; before, it was refused
  });

  it('keeps the build’s opening and evicts the oldest MIDDLE', () => {
    const arr: number[] = [];
    for (let i = 1; i <= 100; i++) pushBounded(arr, i, 40);
    expect(arr.slice(0, 20)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(arr.slice(20)).toEqual(Array.from({ length: 20 }, (_, i) => 81 + i));
  });

  it('reports the eviction, so a caller can count what it refused', () => {
    const arr: number[] = [1, 2];
    expect(pushBounded(arr, 3, 2)).toBe(true);
    expect(arr).toEqual([1, 3]);
  });

  it('a cap of 0 refuses the item rather than growing without bound', () => {
    const arr: number[] = [];
    expect(pushBounded(arr, 1, 0)).toBe(true);
    expect(arr).toHaveLength(0);
  });

  it('stays in chronological order for every cap', () => {
    for (const cap of [1, 2, 5, 40, 300]) {
      const arr: number[] = [];
      for (let i = 1; i <= 500; i++) pushBounded(arr, i, cap);
      expect([...arr].sort((a, b) => a - b)).toEqual(arr);
      expect(arr[arr.length - 1]).toBe(500);
    }
  });
});

describe('trimChannel — a second pass cannot over-claim the head', () => {
  const n = (i: number) => i;

  it('trimming an already-gapped list keeps the TRUE head and the TRUE tail', () => {
    // Recorder kept the first 150 and last 150 of 312; the store now takes 40 of those 300.
    const recorder = [...Array.from({ length: 150 }, (_, i) => n(i + 1)),
                      ...Array.from({ length: 150 }, (_, i) => n(163 + i))];
    const { list, fact } = trimChannel(recorder, 40, { kept: 300, total: 312, head: 150 });
    expect(list!.slice(0, 20)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(list!.slice(20)).toEqual(Array.from({ length: 20 }, (_, i) => 293 + i));
    expect(fact).toEqual({ kept: 40, total: 312, head: 20 });
  });

  it('🔒 head is CLAMPED to what the prior pass actually held — never invented', () => {
    // A prior window with only 3 head entries cannot yield 5 head entries here. Without the clamp,
    // two tail entries would be labelled as the build's opening — a false window, which is the one
    // thing this field exists to prevent.
    const list = [1, 2, 3, 90, 91, 92, 93, 94, 95, 96];
    const { fact } = trimChannel(list, 10 - 0, { kept: 10, total: 500, head: 3 });
    expect(fact).toEqual({ kept: 10, total: 500, head: 3 });
    const tighter = trimChannel(list, 6, { kept: 10, total: 500, head: 3 });
    expect(tighter.fact!.head).toBe(3);
    expect(tighter.list).toEqual([1, 2, 3, 94, 95, 96]);
  });

  it('an untouched channel with a prior loss keeps that loss AND its shape', () => {
    const { list, fact } = trimChannel([1, 2, 3, 98, 99], 40, { kept: 5, total: 99, head: 3 });
    expect(list).toHaveLength(5);
    expect(fact).toEqual({ kept: 5, total: 99, head: 3 });
  });

  it('no head is claimed when the window is a plain tail', () => {
    const { fact } = trimChannel(Array.from({ length: 50 }, (_, i) => i), 1);
    expect(fact).toEqual({ kept: 1, total: 50 });
    expect(fact!.head).toBeUndefined();
  });
});

describe('the merge and the sentence', () => {
  it('the NEWEST window shape wins — an older head describes a longer list', () => {
    const afterRecorder = mergeTruncation(COMPLETE, { llmCalls: { kept: 300, total: 500, head: 150 } });
    const afterStorage = mergeTruncation(afterRecorder, { llmCalls: { kept: 40, total: 300, head: 20 } });
    expect(afterStorage.channels?.llmCalls).toEqual({ kept: 40, total: 500, head: 20 });
  });

  it('an emergency drop clears the shape along with the entries', () => {
    const after = mergeTruncation(
      mergeTruncation(COMPLETE, { llmCalls: { kept: 40, total: 312, head: 20 } }),
      { llmCalls: { kept: 0, total: 40 } },
    );
    expect(after.channels?.llmCalls).toEqual({ kept: 0, total: 500 - 188 });   // 312
    expect(after.channels?.llmCalls?.head).toBeUndefined();
  });

  it('windowShape says nothing about a plain tail, and names the gap otherwise', () => {
    expect(windowShape({ kept: 40, total: 312 })).toBe('');
    expect(windowShape({ kept: 40, total: 312, head: 0 } as ChannelTruncation)).toBe('');
    expect(windowShape({ kept: 40, total: 312, head: 20 }))
      .toBe(' (the first 20 and the last 20 — 272 from the middle are gone)');
  });

  it('the note still leads with the worst loss', () => {
    const note = truncationNote({
      errors: { kept: 50, total: 60 },
      llmCalls: { kept: 40, total: 312, head: 20 },
    });
    expect(note.indexOf('312')).toBeLessThan(note.indexOf('60'));
  });
});

describe('🔒 REVERSION GUARDS — the source, because no behavioural test can see this shape', () => {
  it('the recorder’s four capped channels go through pushBounded', () => {
    const src = code(RECORDER);
    for (const cap of ['MAX_LLM_CALLS', 'MAX_COMMANDS', 'MAX_ERRORS', 'MAX_ISSUES']) {
      expect(src).toContain(`}, ${cap});`);
    }
  });

  it('🔴 no channel is capped by a length test again — that IS the bug', () => {
    const src = code(RECORDER);
    // The exact shapes the four caps used to have. Each compiled, passed the suite, and silently
    // refused every entry past the cap.
    expect(src).not.toMatch(/this\.llmCalls\.length\s*<\s*MAX_LLM_CALLS/);
    expect(src).not.toMatch(/this\.commands\.length\s*<\s*MAX_COMMANDS/);
    expect(src).not.toMatch(/this\.errors\.length\s*>=\s*MAX_ERRORS\s*\)\s*return/);
    expect(src).not.toMatch(/this\.issues\.push\(/);
  });

  it('the store still trims through the one function that declares the loss', () => {
    const src = code(STORE);
    expect(src).toContain('trimChannel(report.llmCalls, STORED_LLM_CALLS_MAX');
    expect(src).toContain('trimChannel(report.commands, 40');
    expect(src).toContain('trimChannel(report.issues, 500');
    expect(src).toContain('trimChannel(report.errors, 50');
  });

  it('the recorder passes its own window shape forward rather than letting the store guess', () => {
    expect(code(RECORDER)).toContain('capFact(this.llmCalls.length, this.channelTotals.llmCalls, MAX_LLM_CALLS)');
  });

  it('the TIMELINE_TRUNCATED line describes the rule the timeline is actually built by', () => {
    // On the CODE, not the file: the comment beside that line quotes the superseded sentence on
    // purpose, so asserting against the raw source would match the record of the fix. Third time
    // this trap has been walked into in this repo — hence `code()` on both halves.
    const src = code(RECORDER);
    expect(src).toContain('the start and the end of the build are kept, the middle is dropped');
    expect(src).not.toContain('earlier detail retained, later activity omitted');
  });
});
