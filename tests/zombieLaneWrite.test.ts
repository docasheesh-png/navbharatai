// REGRESSION — the zombie write that failed a working build (autopsy a38c6fef, 2026-09-13).
//
// "Music player for Android 16". The one-shot lane was abandoned at 150 s; seventeen minutes later it
// finished generating and wrote fourteen files over the app the full builder had meanwhile completed.
// Three survived the model's own hand-cleanup, and the eleven unused components in one of them
// (`src/icons.tsx`) cost 66 readiness points — 100 − 6×11 − 8 = 26/100, under the 50/100 bar — which
// turned the release gate RED and failed a build whose app had already rendered in a real browser.
//
// The identical bug had been root-caused in July and fixed inside `SimpleBuilder` with a `lapsed`
// flag. `OneShotBuilder` has the same shape and never got one, because it carried its own private
// copy of `withTimeout` and so never appeared in a search for the shared helper. These tests lock
// BOTH halves of the fix: the lane's own guard, and the write fence that no longer needs every lane
// to remember one.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLaneWriteFence, LaneAbandonedError } from '../src/server/AgentV3/laneWriteFence';
import { runOneShot, oneShotStillViable, oneShotSkipReason } from '../src/server/AgentV3/OneShotBuilder';

const never = <T,>(): Promise<T> => new Promise<T>(() => {});
const after = <T,>(ms: number, v: T): Promise<T> => new Promise((r) => setTimeout(() => r(v), ms));

const ONE_SHOT_OUTPUT = '<<<FILE src/icons.tsx>>>\nexport const PlayIcon = () => null;\n<<<ENDFILE>>>';

describe('the write fence — only the lane that owns the workspace may write', () => {
  it('refuses a write from a lane that was handed off, and says so', async () => {
    const write = vi.fn(async () => {});
    const refusals: Array<{ lane: string; holder: string | null; paths: string[] }> = [];
    const fence = createLaneWriteFence(write, (info) => refusals.push(info));

    const zombie = fence.open('one-shot');
    fence.handoff(); // the full builder now owns the workspace

    await expect(zombie([{ path: 'src/icons.tsx', content: 'x' }])).rejects.toBeInstanceOf(LaneAbandonedError);
    expect(write).not.toHaveBeenCalled();
    // The evidence half: before this, a zombie write left no trace at all in the report.
    expect(refusals).toEqual([{ lane: 'one-shot', holder: null, paths: ['src/icons.tsx'] }]);
  });

  it('THE EXACT SEQUENCE THAT HAPPENED: an abandoned lane cannot write through its SUCCESSOR\'s ownership', async () => {
    // Simple build abandoned → one-shot opens → the simple build's orphan finally returns. A fence
    // that only asked "is SOME lane open?" would wave this through, because one-shot is live. The
    // writer is bound to its own lease precisely so it cannot.
    const write = vi.fn(async () => {});
    const fence = createLaneWriteFence(write);

    const simpleWrite = fence.open('simple-build');
    const oneShotWrite = fence.open('one-shot'); // opening revokes the previous lane

    await expect(simpleWrite([{ path: 'src/types.d.ts', content: 'x' }])).rejects.toBeInstanceOf(LaneAbandonedError);
    expect(write).not.toHaveBeenCalled();

    // …while the lane that actually owns the workspace writes normally.
    await oneShotWrite([{ path: 'src/App.tsx', content: 'ok' }]);
    expect(write).toHaveBeenCalledTimes(1);
    expect(fence.holder).toBe('one-shot');
  });

  it('never blocks the live lane — including the salvage write inside its own catch', async () => {
    // SimpleBuilder salvages its finished files from the catch block, through this same writer, BEFORE
    // returning. If the fence revoked on timeout rather than on handoff, salvage would break and the
    // full builder would start from an empty tree — turning the fix into a regression.
    const write = vi.fn(async () => {});
    const fence = createLaneWriteFence(write);
    const laneWrite = fence.open('simple-build');
    await laneWrite([{ path: 'src/a.ts', content: 'generated' }]);
    await laneWrite([{ path: 'src/b.ts', content: 'salvaged' }]);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('handoff is idempotent and a refusal never throws out of the evidence callback', async () => {
    const fence = createLaneWriteFence(async () => {}, () => { throw new Error('reporting blew up'); });
    const zombie = fence.open('one-shot');
    fence.handoff();
    fence.handoff();
    expect(fence.holder).toBeNull();
    // The refusal must still be a LaneAbandonedError, not the reporter's error.
    await expect(zombie([{ path: 'x', content: 'y' }])).rejects.toBeInstanceOf(LaneAbandonedError);
  });
});

describe('OneShotBuilder — the lane stops itself the moment it loses the race', () => {
  it('does NOT write when its generation finishes after the deadline', async () => {
    const writeFiles = vi.fn(async () => {});
    const res = await runOneShot({
      prompt: 'Music player for Android 16',
      framework: 'vite-react',
      scaffoldPaths: [],
      // Returns well after the 60ms deadline — exactly the real shape, compressed.
      generate: () => after(160, ONE_SHOT_OUTPUT),
      writeFiles,
      overallTimeoutMs: 60,
    });

    expect(res.ok).toBe(false);
    expect(res.reason).toContain('timed out');
    // Let the orphaned closure run to completion — this is the seventeen minutes, in miniature.
    await after(200, null);
    expect(writeFiles).not.toHaveBeenCalled();
  });

  it('still writes normally when it finishes in time', async () => {
    const writeFiles = vi.fn(async () => {});
    const res = await runOneShot({
      prompt: 'tiny app', framework: 'vite-react', scaffoldPaths: [],
      generate: async () => ONE_SHOT_OUTPUT,
      writeFiles,
      overallTimeoutMs: 5_000,
    });
    expect(res.ok).toBe(true);
    expect(writeFiles).toHaveBeenCalledTimes(1);
  });

  it('a stalled generate falls back rather than hanging', async () => {
    const res = await runOneShot({
      prompt: 'x', framework: 'vite-react', scaffoldPaths: [],
      generate: () => never<string>(),
      writeFiles: async () => {},
      overallTimeoutMs: 40,
    });
    expect(res.ok).toBe(false);
  });

  it('uses the SHARED withTimeout — the private copy is what hid the sibling for two months', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/OneShotBuilder.ts'), 'utf8');
    expect(src).toContain("from './asyncUtils'");
    // A second private implementation is exactly the drift that caused the July fix to miss this file.
    expect(src).not.toMatch(/function withTimeout</);
  });
});

describe('oneShotStillViable — a lane that timed out has proven the engine is stalling', () => {
  it('declines the one-shot after the sibling lane timed out (the 150 wasted seconds)', () => {
    // The real report: the plan call never returned, so plannedFiles was 0, which the old rule read as
    // "tiny app, still worth a try". It then spent 150s on a LARGER call to the same stalling engine —
    // and that abandoned lane is what came back and overwrote the app.
    expect(oneShotStillViable({ plannedFiles: 0, reason: 'simple-plan timed out after 90000ms' })).toBe(false);
    expect(oneShotSkipReason({ plannedFiles: 0, reason: 'simple-plan timed out after 90000ms' }))
      .toContain('timed out waiting on the engine');
  });

  it('still tries when the engine was ANSWERING and the lane failed for another reason', () => {
    // Narrow on purpose: a parse or verify failure met a responsive provider, so a single call may
    // genuinely do better. Only a proven stall declines.
    expect(oneShotStillViable({ plannedFiles: 0, reason: 'no_files_parsed' })).toBe(true);
    expect(oneShotStillViable({ reason: 'simple-build verify failed' })).toBe(true);
    expect(oneShotStillViable(null)).toBe(true);
    expect(oneShotSkipReason({ plannedFiles: 0, reason: 'no_files_parsed' })).toBeNull();
  });

  it('keeps the existing multi-file rule, and reports WHICH reason applied', () => {
    expect(oneShotStillViable({ plannedFiles: 8 })).toBe(false);
    expect(oneShotSkipReason({ plannedFiles: 8 })).toContain('already found 8 files');
    expect(oneShotStillViable({ plannedFiles: 1 })).toBe(true);
  });
});
