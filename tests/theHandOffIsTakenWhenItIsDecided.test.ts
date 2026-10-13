// Q-982 (build report 9c612cdb, 2026-10-12, the ad-free video player). The fast lane's chain fell to a
// reasoning engine at 32.2 s, inside the call for src/utils/youtube.ts, and the lane decided to hand off
// there. Nothing reached the workspace until 54.3 s, when the in-flight src/hooks/usePlayer.ts landed and
// the NEXT tier's first call asked the question the lane only ever asked when a call STARTED. The first
// tier held three files at concurrency 8, so all three were in flight together and nothing started after
// the decision: Q-422's "the files finished so far are saved the moment the decision is taken" depended
// on the tier being bigger than the concurrency, and in the default shape it essentially never fired.
//
// The same report's ledger read "generate 47.1s (87%)" about 15 s of generating, 22 s of waiting for the
// one call still running after the decision, and 10 s of hand-off saves, and its SIMPLE_BUILD_FALLBACK line
// said "Simple build timed out after generating 3 file(s)" about a lane that never ran out of time.
//
// The CLASS these tests lock: the hand-off decision takes effect wherever a call learns of it, whatever the
// concurrency and tier shape; its wait and its saves are their own phases; and the lane's last line names
// the reason the lane ended, not one reason for every ending.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runSimpleBuild, laneFallbackSummary } from '../src/server/AgentV3/SimpleBuilder';
import { fastLanePhaseSummary, dominantFastLanePhase, type FastLanePhases } from '../src/server/AgentV3/fastLanePhases';
import { earlyBailReason } from '../src/server/AgentV3/FastLaneBudget';
import type { OneShotFile } from '../src/server/AgentV3/OneShotBuilder';

/** The report's prompt, verbatim. */
const PROMPT = 'Build a app where I can just similar to youtube where where there is an option for paste link and when user pasts the link then the video adds in the app and again shoss the option.. for add link ... There we could also stream the videos with no adds';

/** The report's file plan (its nine paths, in the model's order; the extraction kept one purpose, the rest are paraphrased). */
const PLAN = [
  'src/App.tsx :: Main app layout with paste input, video player, and playlist logic',
  'src/components/VideoPlayer.tsx :: embedded player for the active video',
  'src/components/VideoList.tsx :: the list of added videos',
  'src/components/VideoItem.tsx :: one video in the list',
  'src/utils/youtube.ts :: parse a pasted link into a video id and source',
  'src/hooks/usePlayer.ts :: which video is playing',
  'src/hooks/useVideoList.ts :: the saved list of videos',
  'src/components/Modal.tsx :: modal shell',
  'src/components/ModalInput.tsx :: the paste-a-link input',
].join('\n');

/** The report's shared contract, as the model returned it (the [cut] tail closed). */
const CONTRACT = [
  '```typescript',
  'export enum VideoSource {',
  "  YouTube = 'YouTube',",
  "  Vimeo = 'Vimeo'",
  '}',
  'export type VideoId = string;',
  'export interface Video { id: VideoId; source: VideoSource; url: string; thumbnailUrl: string | null; }',
  'export type VideoList = Video[];',
  'export interface PlayerState { activeVideo: Video | null; isPlaying: boolean; }',
  'export interface PlayerProps { video: Video; }',
  'export interface ModalProps { isOpen: boolean; onClose: () => void; }',
  'export interface VideoListProps { videos: VideoList; }',
  '```',
].join('\n');

/** The error the youtube.ts call ended with, verbatim from the report's LLM call 4. */
const HAND_OFF_ERROR = 'The next engine (kimi-k2.7-code) reasons before every answer; the fast lane stops here and hands off (after GLM ×51 keys).';

/** Real lane runs (import fixes and all): generous, so a regression fails on its assertion, never on the clock. */
const RUN_TIMEOUT = 30_000;

const pathOf = (user: string) => (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/x.ts';
const block = (p: string, body: string) => `<<<FILE ${p}>>>\n${body}\n<<<ENDFILE>>>`;

/**
 * One run in the report's shape. The youtube.ts call fails with the real hand-off, and the route's flag
 * (`fastLaneReasoningRung`) is set at that moment, exactly as the route's own catch sets it. The usePlayer.ts
 * call is held until the lane writes something (plus a pause, so its wait is measurable), with a safety
 * release so a regression fails on an assertion instead of hanging the suite.
 */
function run(concurrency: number, opts: { holdMs?: number } = {}) {
  const holdMs = opts.holdMs ?? 300;
  let rung: string | null = null;
  const events: string[] = [];
  const writes: Array<{ paths: string[]; usePlayerLanded: boolean }> = [];
  let usePlayerLanded = false;
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const safety = setTimeout(() => release(), 3_000);
  const p = runSimpleBuild({
    prompt: PROMPT, framework: 'vite-react', scaffoldPaths: ['index.html', 'src/App.tsx', 'src/main.tsx'],
    concurrency, depOrder: true,
    generate: async (system: string, user: string) => {
      if (user.includes('Plan the file list')) return PLAN;
      if (system.includes('SHARED CONTRACT')) return CONTRACT;
      const path = pathOf(user);
      if (path === 'src/utils/youtube.ts') {
        // The crawl: the call runs, then the chain falls to a rung that reasons before every answer.
        await new Promise((r) => setTimeout(r, 30));
        rung = 'kimi-k2.7-code';
        events.push('decided');
        throw new Error(HAND_OFF_ERROR);
      }
      if (path === 'src/hooks/usePlayer.ts') {
        await held;
        usePlayerLanded = true;
        events.push(`landed:${path}`);
        return block(path, "import type { Video, PlayerState } from '../types';\nexport function usePlayer(): PlayerState { return { activeVideo: null as Video | null, isPlaying: false }; }");
      }
      events.push(`landed:${path}`);
      return block(path, "import { useState } from 'react';\nimport type { Video } from '../types';\nexport function useVideoList() { const [videos] = useState<Video[]>([]); return videos; }");
    },
    // The route's stopLane, verbatim (agentv3.ts): it answers from the flag its own catch just set.
    stopLane: () => (rung
      ? `the lane's engine fell to ${rung}, which reasons before every answer; the lane's per-file budget cannot carry that, so the files finished so far go to the full builder now`
      : null),
    writeFiles: async (files: OneShotFile[]) => {
      const paths = files.map((f) => f.path);
      writes.push({ paths, usePlayerLanded });
      events.push(`write:${paths.join(',')}`);
      if (!usePlayerLanded) setTimeout(release, holdMs);
    },
    maxRepairs: 0,
  } as never);
  return { p: p.finally(() => clearTimeout(safety)), events, writes };
}

describe('Q-982 (A): the hand-off is taken when it is decided, whatever the tier shape', () => {
  it('🔴 the report\'s shape (concurrency 8, a first tier of 3): the first write lands BEFORE usePlayer.ts, with the contract and useVideoList.ts', async () => {
    const { p, writes } = run(8);
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.handedOff).toBe(true);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes[0].usePlayerLanded).toBe(false);
    expect(writes[0].paths).toContain('src/types.ts');
    expect(writes[0].paths).toContain('src/hooks/useVideoList.ts');
    // The in-flight file is still waited for (Q-422, the admin's choice) and still handed over.
    expect([...(r.salvagedPaths ?? [])].sort()).toEqual(['src/hooks/usePlayer.ts', 'src/hooks/useVideoList.ts', 'src/types.ts']);
  }, RUN_TIMEOUT);

  it('🔒 CENSUS over tier shapes: at every concurrency the first write follows the decision before any in-flight call lands', async () => {
    for (const concurrency of [1, 2, 3, 8]) {
      const { p, events } = run(concurrency, { holdMs: 20 });
      await p;
      const decided = events.indexOf('decided');
      expect(decided, `concurrency ${concurrency}: the hand-off was never decided`).toBeGreaterThanOrEqual(0);
      const after = events.slice(decided + 1);
      const firstWrite = after.findIndex((e) => e.startsWith('write:'));
      const firstLanding = after.findIndex((e) => e.startsWith('landed:'));
      expect(firstWrite, `concurrency ${concurrency}: nothing was saved after the decision`).toBeGreaterThanOrEqual(0);
      if (firstLanding >= 0) expect(firstWrite, `concurrency ${concurrency}: ${after.join(' → ')}`).toBeLessThan(firstLanding);
      // Every file finished before the decision is in that first write.
      const finishedBefore = events.slice(0, decided).filter((e) => e.startsWith('landed:')).map((e) => e.slice('landed:'.length));
      const firstPaths = after[firstWrite].slice('write:'.length).split(',');
      for (const f of finishedBefore) expect(firstPaths, `concurrency ${concurrency}`).toContain(f);
    }
  }, RUN_TIMEOUT);

  it('a lane that is never told to hand off saves nothing early and reports no hand-off phase', async () => {
    const writes: string[][] = [];
    const r = await runSimpleBuild({
      prompt: PROMPT, framework: 'vite-react', scaffoldPaths: ['index.html', 'src/App.tsx', 'src/main.tsx'],
      concurrency: 8, depOrder: true,
      generate: async (system: string, user: string) => {
        if (user.includes('Plan the file list')) return PLAN;
        if (system.includes('SHARED CONTRACT')) return CONTRACT;
        const path = pathOf(user);
        return block(path, path.endsWith('.tsx') ? 'export default function X() { return null; }' : 'export const x = 1;');
      },
      stopLane: () => null,
      writeFiles: async (files: OneShotFile[]) => { writes.push(files.map((f) => f.path)); },
      maxRepairs: 0,
    } as never);
    expect(r.ok).toBe(true);
    expect(writes.length).toBe(1); // the lane's one final write, nothing early
    expect(r.phases?.handOffWaitMs).toBeUndefined();
    expect(r.phases?.handOffSaveMs).toBeUndefined();
    expect(fastLanePhaseSummary(r.phases)).not.toContain('hand-off');
  }, RUN_TIMEOUT);

  it('a decision that arrives after every call of the LAST tier has started does not cancel a finished lane', async () => {
    // Taking the decision early only SAVES early. The tier boundary still hands off only when a call was
    // refused for it, so a lane whose last calls all landed writes and finishes its app, exactly as before
    // (the repair loop asks stopLane on its own and spends no repair call).
    let rung: string | null = null;
    const writes: string[][] = [];
    const r = await runSimpleBuild({
      prompt: 'a small app', framework: 'vite-react', scaffoldPaths: ['index.html', 'src/App.tsx', 'src/main.tsx'],
      concurrency: 8, depOrder: false,
      generate: async (system: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/components/Card.tsx :: card';
        if (system.includes('SHARED CONTRACT')) return '';
        const path = pathOf(user);
        // The call is served by a rung that reasons before every answer: the route sets its flag on success.
        if (path === 'src/components/Card.tsx') rung = 'kimi-k2.7-code';
        else await new Promise((res) => setTimeout(res, 20));
        return block(path, path.endsWith('App.tsx') ? "import Card from './components/Card';\nexport default function App() { return <Card />; }" : 'export default function Card() { return null; }');
      },
      stopLane: () => (rung ? `the lane's engine fell to ${rung}, which reasons before every answer` : null),
      writeFiles: async (files: OneShotFile[]) => { writes.push(files.map((f) => f.path)); },
      maxRepairs: 0,
    } as never);
    expect(r.ok).toBe(true);
    expect(r.handedOff).toBeUndefined();
    // The finished file was saved at the decision, and the lane's own final write still carries the whole app.
    expect(writes[0]).toEqual(['src/components/Card.tsx']);
    expect([...writes[writes.length - 1]].sort()).toEqual(expect.arrayContaining(['src/App.tsx', 'src/components/Card.tsx']));
  }, RUN_TIMEOUT);

  it('🔒 the hand-off decision has ONE door: stopLane is asked by the helper and by the repair loop, nowhere else', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/SimpleBuilder.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // A new call site that polls stopLane itself would decide without saving or stamping the ledger.
    expect(src.match(/deps\.stopLane\?\.\(\)/g)?.length).toBe(2);
    expect(src).toContain('if (deps.stopLane?.()) break;');
    // The decision is consulted where a call starts, where it returns a file, and where it fails.
    expect(src.match(/noteHandOffDecision\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(src).not.toContain('if (laneStopReason) saveForPreviewNow([file]);');
  });
});

/**
 * A writer whose FIRST write (the early save) is slow, the way a model-facing workspace write is (it reads
 * the file, guards it and compiles it). Records when each write starts and ends.
 */
function slowFirstWriter(firstWriteMs: number, onStart?: () => void) {
  const log: Array<{ id: number; at: 'start' | 'end'; paths: string[] }> = [];
  let n = 0;
  const writeFiles = async (files: OneShotFile[]) => {
    const id = ++n;
    const paths = files.map((f) => f.path);
    log.push({ id, at: 'start', paths });
    onStart?.();
    await new Promise((r) => setTimeout(r, id === 1 ? firstWriteMs : 5));
    log.push({ id, at: 'end', paths });
  };
  /** The lane's LAST write started only after every earlier write had ended. */
  const lastWriteWaited = (): string | null => {
    const lastId = n;
    const lastStart = log.findIndex((e) => e.id === lastId && e.at === 'start');
    for (let id = 1; id < lastId; id++) {
      const end = log.findIndex((e) => e.id === id && e.at === 'end');
      if (end < 0 || end > lastStart) return log.map((e) => `${e.at}#${e.id}:${e.paths.join(',')}`).join(' → ');
    }
    return null;
  };
  return { writeFiles, log, lastWriteWaited, count: () => n };
}

describe('Q-982: the lane\'s last write is the last word, however the lane ends', () => {
  // Workspace writes run concurrently and nothing orders two writes to one path, so an early save still in
  // flight when the lane's last write starts can land on top of it with the copy from BEFORE the import
  // fixes and the entry and stylesheet guards. Taking the decision where a call settles means an early save
  // can now happen in a lane that then FINISHES (the decision came in its last tier), so the lane's own
  // final write must wait for it exactly as the hand-off's salvage always did.
  it('🔒 CENSUS: a lane that finishes after a last-tier decision, and a lane that hands off, both write last', async () => {
    // (1) Finishes: the decision arrives at a success in the last tier, every call already in flight.
    {
      let rung: string | null = null;
      const w = slowFirstWriter(150);
      const r = await runSimpleBuild({
        prompt: 'a small app', framework: 'vite-react', scaffoldPaths: ['index.html', 'src/App.tsx', 'src/main.tsx'],
        concurrency: 8, depOrder: false,
        generate: async (system: string, user: string) => {
          if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/components/Card.tsx :: card';
          if (system.includes('SHARED CONTRACT')) return '';
          const path = pathOf(user);
          if (path === 'src/components/Card.tsx') rung = 'kimi-k2.7-code';
          else await new Promise((res) => setTimeout(res, 20));
          return block(path, path.endsWith('App.tsx') ? "import Card from './components/Card';\nexport default function App() { return <Card />; }" : 'export default function Card() { return null; }');
        },
        stopLane: () => (rung ? `the lane's engine fell to ${rung}, which reasons before every answer` : null),
        writeFiles: w.writeFiles,
        maxRepairs: 0,
      } as never);
      expect(r.ok).toBe(true);
      expect(w.count()).toBeGreaterThan(1); // there was an early save to wait for
      expect(w.lastWriteWaited(), 'the lane\'s final write started while an early save was still landing').toBeNull();
    }
    // (2) Hands off: the report's shape, its salvage after the early saves.
    {
      let rung: string | null = null;
      let release!: () => void;
      const held = new Promise<void>((res) => { release = res; });
      const safety = setTimeout(() => release(), 3_000);
      const w = slowFirstWriter(150, () => setTimeout(release, 20));
      const r = await runSimpleBuild({
        prompt: PROMPT, framework: 'vite-react', scaffoldPaths: ['index.html', 'src/App.tsx', 'src/main.tsx'],
        concurrency: 8, depOrder: true,
        generate: async (system: string, user: string) => {
          if (user.includes('Plan the file list')) return PLAN;
          if (system.includes('SHARED CONTRACT')) return CONTRACT;
          const path = pathOf(user);
          if (path === 'src/utils/youtube.ts') { await new Promise((res) => setTimeout(res, 30)); rung = 'kimi-k2.7-code'; throw new Error(HAND_OFF_ERROR); }
          if (path === 'src/hooks/usePlayer.ts') await held;
          return block(path, "import type { Video } from '../types';\nexport const x: Video | null = null;");
        },
        stopLane: () => (rung ? `the lane's engine fell to ${rung}, which reasons before every answer` : null),
        writeFiles: w.writeFiles,
        maxRepairs: 0,
      } as never).finally(() => clearTimeout(safety));
      expect(r.handedOff).toBe(true);
      expect(w.count()).toBeGreaterThan(1);
      expect(w.lastWriteWaited(), 'the salvage started while an early save was still landing').toBeNull();
    }
  }, RUN_TIMEOUT);

  it('🔒 one door waits for the early saves, and both of the lane\'s last writes go through it', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/SimpleBuilder.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src.match(/Promise\.allSettled\(handOffSaves\)/g)?.length).toBe(1);
    expect(src.match(/await earlySavesSettled\(\);/g)?.length).toBe(2);
  });
});

describe('Q-982 (D): the ledger closes generate at the decision; the wait and the saves are their own phases', () => {
  it('🔴 the report\'s shape: one call in flight at the decision, its wait measured apart from generating', async () => {
    const { p } = run(8, { holdMs: 300 });
    const r = await p;
    const ph = r.phases!;
    expect(ph.handOffInFlight).toBe(1);
    expect(ph.handOffWaitMs).toBeGreaterThanOrEqual(250);
    expect(ph.generateMs).toBeLessThan(ph.handOffWaitMs!);
    expect(typeof ph.handOffSaveMs).toBe('number');
    const line = fastLanePhaseSummary(ph);
    expect(line).toContain('waiting on 1 in-flight call(s) after the hand-off decision');
    expect(line).toContain('hand-off saves');
  }, RUN_TIMEOUT);

  it('the report\'s own numbers read as three phases, add up, and name the wait as the dominant one', () => {
    const p: FastLanePhases = {
      planMs: 2_000, contractMs: 5_100, generateMs: 15_000, handOffWaitMs: 22_100, handOffInFlight: 1, handOffSaveMs: 10_000,
      verifyMs: 0, repairMs: 0, verifyRuns: 0, repairRuns: 0, totalMs: 54_200,
    };
    const line = fastLanePhaseSummary(p);
    expect(line).toBe('Fast lane took 54.2s: plan 2s (4%), contract 5.1s (9%), generate 15s (28%), waiting on 1 in-flight call(s) after the hand-off decision 22.1s (41%), hand-off saves 10s (18%), verify 0s (0%) over 0 run(s), repair 0s (0%) over 0 round(s).');
    expect(line).not.toContain('everything else'); // the measured phases account for the whole lane
    expect(dominantFastLanePhase(p)).toBe('hand-off wait 22.1s of 54.2s');
  });

  it('a ledger without a hand-off prints exactly as before', () => {
    const line = fastLanePhaseSummary({ planMs: 2_000, contractMs: 5_100, generateMs: 47_100, verifyMs: 0, repairMs: 0, verifyRuns: 0, repairRuns: 0, totalMs: 54_200 });
    expect(line).toBe('Fast lane took 54.2s: plan 2s (4%), contract 5.1s (9%), generate 47.1s (87%), verify 0s (0%) over 0 run(s), repair 0s (0%) over 0 round(s).');
  });
});

describe('Q-982 (E): the fallback line names the reason the lane ended', () => {
  it('🔴 the report\'s hand-off with three salvaged files does not say "timed out"', async () => {
    const { p } = run(8, { holdMs: 20 });
    const r = await p;
    expect(r.handedOff).toBe(true);
    expect(r.summary).not.toMatch(/timed out/i);
    expect(r.summary).toBe('Fast lane handed 3 finished file(s) to the full builder: the next engine reasons before every answer, which the lane cannot carry — a planned handoff, not a failure.');
  }, RUN_TIMEOUT);

  it('a lane whose root component was never written says so, not "timed out"', async () => {
    const r = await runSimpleBuild({
      prompt: PROMPT, framework: 'vite-react', scaffoldPaths: ['index.html', 'src/App.tsx', 'src/main.tsx'],
      concurrency: 8, depOrder: true,
      generate: async (system: string, user: string) => {
        if (user.includes('Plan the file list')) return PLAN;
        if (system.includes('SHARED CONTRACT')) return CONTRACT;
        const path = pathOf(user);
        if (path === 'src/App.tsx') throw new Error('the provider returned nothing');
        return block(path, path.endsWith('.tsx') ? 'export default function X() { return null; }' : 'export const x = 1;');
      },
      stopLane: () => null,
      writeFiles: async () => undefined,
      maxRepairs: 0,
    } as never);
    expect(r.ok).toBe(false);
    expect(String(r.reason)).toContain('root component');
    expect(r.summary).not.toMatch(/timed out/i);
    expect(r.summary).toContain("the app's root component was not written");
  }, RUN_TIMEOUT);

  it('every other ending gets its own words, and a real timeout still says it timed out', () => {
    const bail = `simple-build ${earlyBailReason({ tiersRemaining: 2, lastTierMs: 120_000, elapsedMs: 150_000, overallMs: 240_000 })}`;
    expect(laneFallbackSummary(4, false, bail)).not.toMatch(/timed out/i);
    expect(laneFallbackSummary(4, false, bail)).toContain('could not finish inside its time budget');
    expect(laneFallbackSummary(8, false, 'simple-build timed out after 240000ms')).toBe('Simple build timed out after generating 8 file(s) — the full builder continues from them.');
    expect(laneFallbackSummary(2, false, 'simple-build fast lane stopped early — something new')).not.toMatch(/timed out/i);
    expect(laneFallbackSummary(0, true, 'x')).toContain('handed its plan to the full builder');
    expect(laneFallbackSummary(0, false, 'simple-build timed out after 240000ms')).toBe('Simple build could not produce the app — switching to the full builder.');
  });
});
