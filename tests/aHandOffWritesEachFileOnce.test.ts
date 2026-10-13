// Q-912 (build report 9c612cdb, 2026-10-12, the ad-free video player). The fast lane handed off before a
// reasoning engine. Its early saves (Q-422 / Q-939) put the three finished files in the workspace, and the
// salvage after the lane ended then wrote all three AGAIN — 61.4 s → 64.3 s of the report spent rewriting files
// that were already there. Neither writer knew what the other had written.
//
// Removing the second write naively was unsafe, and that is the half of this item that matters most: the lane's
// writer dispatched `write_file` once per file and threw each answer away. The workspace reports a refusal as
// `{ is_error: true }`, never as a throw, so `writeFiles` resolved whether or not a file landed, and
// `salvagedPaths`, `filesWritten`, the SIMPLE_BUILD_SALVAGE line and the CONTINUE prompt's file list could all
// name a file that was not there. The redundant salvage write was, by accident, the only retry a failed early
// save ever got.
//
// THE CLASSES these tests lock, over the REAL runSimpleBuild with a writer that answers per file the way the
// route's writer now does:
//  (1) no (path, content) pair is written again after it LANDED — over a whole hand-off, a whole stop, and a
//      lane that finishes after a last-tier decision; a file whose content changed (the import fixes) IS
//      written again and its fixed copy is the last word;
//  (2) a file is named as written only when the workspace took it — a failed early save is written again by
//      the salvage and then listed; a refused file is never listed, counted or announced;
//  (3) a lane that DECIDED to hand off is a hand-off however it ends, and its line says both facts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runSimpleBuild, laneFallbackSummary } from '../src/server/AgentV3/SimpleBuilder';
import { fastLanePhaseSummary } from '../src/server/AgentV3/fastLanePhases';
import type { OneShotFile } from '../src/server/AgentV3/OneShotBuilder';
import type { WriteOutcome } from '../src/server/AgentV3/writeOutcomes';

/** The report's prompt, verbatim. */
const PROMPT = 'Build a app where I can just similar to youtube where where there is an option for paste link and when user pasts the link then the video adds in the app and again shoss the option.. for add link ... There we could also stream the videos with no adds';

/** The report's file plan (its nine paths, in the model's order). */
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
  '```',
].join('\n');

/** The error the youtube.ts call ended with, verbatim from the report's LLM call 4. */
const HAND_OFF_ERROR = 'The next engine (kimi-k2.7-code) reasons before every answer; the fast lane stops here and hands off (after GLM ×51 keys).';

/** The route's stopLane wording (agentv3.ts), so the lane's reason is the one production produces. */
const routeStop = (rung: string | null) => (rung
  ? `the lane's engine fell to ${rung}, which reasons before every answer; the lane's per-file budget cannot carry that, so the files finished so far go to the full builder now`
  : null);

const RUN_TIMEOUT = 30_000;
const pathOf = (user: string) => (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/x.ts';
const block = (p: string, body: string) => `<<<FILE ${p}>>>\n${body}\n<<<ENDFILE>>>`;

/** useVideoList.ts as the report's hook: it reads the enum as a VALUE through a type-only import — the kind
 * of line the salvage's import fixes change (autopsy 6cd698cc), so its content differs after the hand-off. */
const USE_VIDEO_LIST_NEEDS_FIX = "import { useState } from 'react';\nimport type { Video, VideoSource } from '../types';\nexport function useVideoList() { const [videos] = useState<Video[]>([]); const s = VideoSource.YouTube; return { videos, s }; }";
/** The same hook with nothing for the import fixes to change. */
const USE_VIDEO_LIST_CLEAN = "import { useState } from 'react';\nimport type { Video } from '../types';\nexport function useVideoList() { const [videos] = useState<Video[]>([]); return videos; }";
const USE_PLAYER = "import type { Video, PlayerState } from '../types';\nexport function usePlayer(): PlayerState { return { activeVideo: null as Video | null, isPlaying: false }; }";

interface Write { path: string; content: string; ok: boolean }

/**
 * A writer that answers per file, as the route's does now. `refuse(path, n)` decides whether the n-th write
 * (1-based) of `path` is refused by the workspace.
 */
function workspace(refuse: (path: string, n: number) => boolean = () => false) {
  const writes: Write[] = [];
  const seen = new Map<string, number>();
  const writeFiles = async (files: OneShotFile[]): Promise<WriteOutcome[]> => files.map((f) => {
    const n = (seen.get(f.path) ?? 0) + 1;
    seen.set(f.path, n);
    const ok = !refuse(f.path, n);
    writes.push({ path: f.path, content: f.content, ok });
    return ok ? { path: f.path, ok: true } : { path: f.path, ok: false, error: `Could not read the existing ${f.path} safely (transient sandbox error) — not overwriting it.` };
  });
  /** THE CENSUS: every write of a (path, content) pair the workspace had ALREADY taken. Empty = no double write. */
  const rewrites = (): string[] => {
    const landed = new Set<string>();
    const out: string[] = [];
    for (const w of writes) {
      const key = `${w.path}\u0000${w.content}`;
      if (landed.has(key)) out.push(w.path);
      if (w.ok) landed.add(key);
    }
    return out;
  };
  const lastWriteOf = (path: string) => [...writes].reverse().find((w) => w.path === path);
  const countOf = (path: string) => writes.filter((w) => w.path === path).length;
  return { writeFiles, writes, rewrites, lastWriteOf, countOf };
}

/**
 * One lane in the report's shape: concurrency 8, a first tier of three hooks. The youtube.ts call carries the
 * hand-off (the route's flag is set as its own catch sets it); usePlayer.ts is held until the lane has written
 * something, so it lands after the decision, as it did at 54.3 s.
 */
function reportRun(ws: ReturnType<typeof workspace>, opts: { useVideoList?: string; signal?: AbortSignal; onFirstWrite?: () => void; env?: Record<string, string> } = {}) {
  let rung: string | null = null;
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const safety = setTimeout(() => release(), 3_000);
  let wrote = false;
  const saved = { ...process.env };
  Object.assign(process.env, opts.env ?? {});
  const p = runSimpleBuild({
    prompt: PROMPT, framework: 'vite-react', scaffoldPaths: ['index.html', 'src/App.tsx', 'src/main.tsx'],
    concurrency: 8, depOrder: true, maxRepairs: 0,
    ...(opts.signal ? { signal: opts.signal } : {}),
    generate: async (system: string, user: string) => {
      if (user.includes('Plan the file list')) return PLAN;
      if (system.includes('SHARED CONTRACT')) return CONTRACT;
      const path = pathOf(user);
      if (path === 'src/utils/youtube.ts') {
        await new Promise((r) => setTimeout(r, 30));
        rung = 'kimi-k2.7-code';
        throw new Error(HAND_OFF_ERROR);
      }
      if (path === 'src/hooks/usePlayer.ts') { await held; return block(path, USE_PLAYER); }
      if (path === 'src/hooks/useVideoList.ts') return block(path, opts.useVideoList ?? USE_VIDEO_LIST_CLEAN);
      return block(path, 'export default function X() { return null; }');
    },
    stopLane: () => routeStop(rung),
    writeFiles: async (files: OneShotFile[]) => {
      const out = await ws.writeFiles(files);
      if (!wrote) { wrote = true; opts.onFirstWrite?.(); setTimeout(release, 20); }
      return out;
    },
  } as never);
  return p.finally(() => { clearTimeout(safety); process.env = saved; });
}

const sorted = (xs: readonly string[] | undefined) => [...(xs ?? [])].sort();
const THREE = ['src/hooks/usePlayer.ts', 'src/hooks/useVideoList.ts', 'src/types.ts'];

describe('Q-912 (1): no file is written again once the workspace has it — the census over whole runs', () => {
  it('🔴 the report\'s hand-off: each finished file lands once, and salvagedPaths names all three', async () => {
    const ws = workspace();
    const r = await reportRun(ws);
    expect(r.handedOff).toBe(true);
    expect(ws.rewrites(), ws.writes.map((w) => w.path).join(' → ')).toEqual([]);
    for (const p of THREE) expect(ws.countOf(p), p).toBe(1);
    expect(sorted(r.salvagedPaths)).toEqual(THREE);
    expect(r.filesWritten).toBe(3);
  }, RUN_TIMEOUT);

  it('a file the salvage\'s import fixes CHANGED is written again, and its fixed copy is the last word', async () => {
    const ws = workspace();
    const r = await reportRun(ws, { useVideoList: USE_VIDEO_LIST_NEEDS_FIX });
    expect(ws.rewrites()).toEqual([]);
    expect(ws.countOf('src/hooks/useVideoList.ts')).toBe(2); // the early save, then the fixed copy
    const last = ws.lastWriteOf('src/hooks/useVideoList.ts')!;
    expect(last.content).not.toBe(USE_VIDEO_LIST_NEEDS_FIX);
    expect(last.content).not.toMatch(/import type \{[^}]*VideoSource/);
    // …and nothing written after it touches that path again.
    expect(ws.writes.indexOf(last)).toBe(ws.writes.map((w) => w.path).lastIndexOf('src/hooks/useVideoList.ts'));
    expect(sorted(r.salvagedPaths)).toEqual(THREE);
  }, RUN_TIMEOUT);

  it('🔴 a stop after the early saves writes nothing twice, and reports every file it holds as saved', async () => {
    const ws = workspace();
    const ac = new AbortController();
    const r = await reportRun(ws, { signal: ac.signal, onFirstWrite: () => ac.abort() });
    expect(r.stopped).toBe(true);
    expect(ws.rewrites(), ws.writes.map((w) => w.path).join(' → ')).toEqual([]);
    expect(sorted(r.salvagedPaths)).toEqual(THREE);
    expect(r.filesWritten).toBe(3);
  }, RUN_TIMEOUT);

  it('a lane that FINISHES after a last-tier decision does not write its early-saved file again', async () => {
    let rung: string | null = null;
    const ws = workspace();
    const r = await runSimpleBuild({
      prompt: 'a small app', framework: 'vite-react', scaffoldPaths: ['index.html', 'src/App.tsx', 'src/main.tsx'],
      concurrency: 8, depOrder: false, maxRepairs: 0,
      generate: async (system: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/components/Card.tsx :: card';
        if (system.includes('SHARED CONTRACT')) return '';
        const path = pathOf(user);
        if (path === 'src/components/Card.tsx') rung = 'kimi-k2.7-code';
        else await new Promise((res) => setTimeout(res, 20));
        return block(path, path.endsWith('App.tsx') ? "import Card from './components/Card';\nexport default function App() { return <Card />; }" : 'export default function Card() { return null; }');
      },
      stopLane: () => routeStop(rung),
      writeFiles: ws.writeFiles,
    } as never);
    expect(r.ok).toBe(true);
    expect(ws.rewrites(), ws.writes.map((w) => w.path).join(' → ')).toEqual([]);
    expect(ws.countOf('src/components/Card.tsx')).toBe(1);
    expect(r.filesWritten).toBe(2);
  }, RUN_TIMEOUT);
});

describe('Q-912 (2): a file is named as written only when the workspace took it', () => {
  it('🔴 a FAILED early save is written again by the salvage, and listed once it lands', async () => {
    const ws = workspace((path, n) => path === 'src/hooks/useVideoList.ts' && n === 1);
    const r = await reportRun(ws);
    const tries = ws.writes.filter((w) => w.path === 'src/hooks/useVideoList.ts');
    expect(tries.map((w) => w.ok)).toEqual([false, true]);
    expect(tries[0].content).toBe(tries[1].content); // the retry is because it failed, not because it changed
    expect(sorted(r.salvagedPaths)).toEqual(THREE);
    expect(ws.rewrites()).toEqual([]);
  }, RUN_TIMEOUT);

  it('🔴 a file the workspace refuses at the salvage too is NOT listed, counted or summarised as handed over', async () => {
    const ws = workspace((path) => path === 'src/hooks/usePlayer.ts');
    const r = await reportRun(ws);
    expect(ws.countOf('src/hooks/usePlayer.ts')).toBe(2); // the early save, then the salvage's one more try
    expect(sorted(r.salvagedPaths)).toEqual(['src/hooks/useVideoList.ts', 'src/types.ts']);
    expect(r.filesWritten).toBe(2);
    expect(r.summary).toContain('handed 2 finished file(s)');
  }, RUN_TIMEOUT);

  it('🔴 the first paint announces only what landed', async () => {
    const ws = workspace((path) => path === 'src/components/Card.tsx');
    const ready: string[][] = [];
    const r = await runSimpleBuild({
      prompt: 'a small app', framework: 'vite-react', scaffoldPaths: ['index.html', 'src/App.tsx', 'src/main.tsx'],
      concurrency: 8, depOrder: false, maxRepairs: 0,
      generate: async (system: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/components/Card.tsx :: card\nsrc/components/Badge.tsx :: badge';
        if (system.includes('SHARED CONTRACT')) return '';
        const path = pathOf(user);
        return block(path, path.endsWith('App.tsx') ? 'export default function App() { return null; }' : 'export default function C() { return null; }');
      },
      stopLane: () => null,
      writeFiles: ws.writeFiles,
      onFilesReady: (files: OneShotFile[]) => { ready.push(files.map((f) => f.path)); },
    } as never);
    expect(r.ok).toBe(true);
    expect(r.filesWritten).toBe(2);
    expect(r.summary).toContain('2 file(s)');
    expect(ready.flat()).not.toContain('src/components/Card.tsx');
    expect(sorted(ready.flat())).toEqual(['src/App.tsx', 'src/components/Badge.tsx']);
  }, RUN_TIMEOUT);

  it('🔴 a REFUSED root component is not an app: the lane hands over, it does not report success on the starter page', async () => {
    // No verify wired, so the old path ended `ok: true` here — over a page that still showed the starter.
    const ws = workspace((path) => path === 'src/App.tsx');
    const r = await runSimpleBuild({
      prompt: 'a small app', framework: 'vite-react', scaffoldPaths: ['index.html', 'src/App.tsx', 'src/main.tsx'],
      concurrency: 8, depOrder: false, maxRepairs: 0,
      generate: async (system: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/components/Card.tsx :: card';
        if (system.includes('SHARED CONTRACT')) return '';
        const path = pathOf(user);
        return block(path, path.endsWith('App.tsx') ? "import Card from './components/Card';\nexport default function App() { return <Card />; }" : 'export default function Card() { return null; }');
      },
      stopLane: () => null,
      writeFiles: ws.writeFiles,
    } as never);
    expect(r.ok).toBe(false);
    expect(String(r.reason)).toContain('root component');
    expect(r.salvagedPaths).toEqual(['src/components/Card.tsx']);
    expect(r.summary).toContain("the app's root component was not written");
  }, RUN_TIMEOUT);

  it('🔴 a repair file the workspace refused is not handed over, and not counted as a file the repair CREATED', async () => {
    // The repair makes things worse and also "creates" a file the workspace refuses. Only what landed is the
    // repair's to undo: with the refused file counted as created, the lane kept the worse state and stopped
    // ("It also added 1 new file") instead of reverting a repair whose only real change was an overwrite.
    const saved = { ...process.env };
    process.env.AGENTV3_ENDGAME_REPAIR = 'off';
    process.env.AGENTV3_SCAFFOLD_RESTORE = 'off';
    const ws = workspace((path) => path === 'src/components/Extra.tsx');
    const logs: string[] = [];
    let verifies = 0;
    const r = await runSimpleBuild({
      prompt: 'a small app', framework: 'vite-react', scaffoldPaths: ['index.html', 'src/App.tsx', 'src/main.tsx'],
      concurrency: 8, depOrder: false, maxRepairs: 1,
      generate: async (system: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/components/Card.tsx :: card';
        if (system.includes('SHARED CONTRACT')) return '';
        const path = pathOf(user);
        return block(path, path.endsWith('App.tsx') ? "import Card from './components/Card';\nexport default function App() { return <Card />; }" : 'export default function Card() { return null; }');
      },
      stopLane: () => null,
      writeFiles: ws.writeFiles,
      log: (m: string) => { logs.push(m); },
      verify: async () => {
        verifies += 1;
        const one = "src/App.tsx(1,1): error TS2307: Cannot find module './x'.";
        return verifies === 1
          ? { ok: false, errors: one, ran: true }
          : { ok: false, errors: [one, "src/components/Card.tsx(1,1): error TS2322: bad.", "src/components/Card.tsx(2,1): error TS2322: bad."].join('\n'), ran: true };
      },
      repair: async () => [
        { path: 'src/components/Card.tsx', content: 'export default function Card() { return 1; }' },
        { path: 'src/components/Extra.tsx', content: 'export const Extra = 1;' },
      ],
    } as never).finally(() => { process.env = saved; });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('verify_failed');
    expect(r.salvagedPaths).not.toContain('src/components/Extra.tsx');
    expect(logs.join('\n')).toContain('errors went from 1 to 3');
    expect(logs.join('\n')).not.toMatch(/also added 1 new file/);
    // The overwrite that landed was undone, in the workspace too.
    expect(ws.lastWriteOf('src/components/Card.tsx')!.content).toBe('export default function Card() { return null; }');
  }, RUN_TIMEOUT);

  it('a writer that answers NOTHING keeps today\'s assumption: every file is written and counted, and the salvage rewrites them', async () => {
    const plain = workspace();
    const writes: string[] = [];
    const r = await reportRun({ ...plain, writeFiles: (async (files: OneShotFile[]) => { writes.push(...files.map((f) => f.path)); }) as never });
    expect(sorted(r.salvagedPaths)).toEqual(THREE);
    // Unknown is never confirmed, so nothing is skipped: the early saves AND the salvage write each file.
    for (const p of THREE) expect(writes.filter((w) => w === p).length, p).toBe(2);
  }, RUN_TIMEOUT);
});

describe('Q-912 (3): a hand-off the lane decided is a hand-off however the lane ends', () => {
  /** The decision is carried by the ROOT component's own call, in the last tier, while a page call is still in flight. */
  function rootCarriesTheHandOff() {
    let rung: string | null = null;
    let decidedAt = 0;
    const ws = workspace();
    const p = runSimpleBuild({
      prompt: 'a small app', framework: 'vite-react', scaffoldPaths: ['index.html', 'src/App.tsx', 'src/main.tsx'],
      concurrency: 8, depOrder: true, maxRepairs: 0,
      generate: async (system: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/pages/Home.tsx :: home page\nsrc/components/Card.tsx :: card';
        if (system.includes('SHARED CONTRACT')) return '';
        const path = pathOf(user);
        if (path === 'src/App.tsx') {
          await new Promise((res) => setTimeout(res, 20));
          rung = 'kimi-k2.7-code';
          decidedAt = Date.now();
          throw new Error(HAND_OFF_ERROR);
        }
        // The page shares the root's tier and is still running when the decision is taken.
        if (path === 'src/pages/Home.tsx') await new Promise((res) => setTimeout(res, 300));
        return block(path, 'export default function X() { return null; }');
      },
      stopLane: () => routeStop(rung),
      writeFiles: ws.writeFiles,
    } as never);
    return { p, ws, decidedAt: () => decidedAt };
  }

  it('🔴 the root component\'s call carried the decision: handedOff, and the line says both facts', async () => {
    const { p } = rootCarriesTheHandOff();
    const r = await p;
    expect(r.ok).toBe(false);
    expect(String(r.reason)).toContain('root component');
    expect(r.handedOff).toBe(true);
    expect(r.summary).toContain('the next engine reasons before every answer');
    expect(r.summary).toContain("the app's root component was not written");
    expect(r.summary).toContain('a planned handoff, not a failure');
    expect(r.summary).not.toMatch(/timed out/i);
  }, RUN_TIMEOUT);

  it('🔴 its ledger: the wait for the page still running after the decision is not inside "generate"', async () => {
    const { p } = rootCarriesTheHandOff();
    const r = await p;
    const ph = r.phases!;
    expect(ph.handOffWaitMs).toBeGreaterThanOrEqual(200);
    expect(ph.handOffInFlight).toBeGreaterThanOrEqual(1);
    expect(ph.generateMs).toBeLessThan(ph.handOffWaitMs!);
    expect(fastLanePhaseSummary(ph)).toContain('after the hand-off decision');
  }, RUN_TIMEOUT);

  it('the line names the second fact only when there is one', () => {
    const handOff = `simple-build fast lane stopped early — ${routeStop('kimi-k2.7-code')}`;
    expect(laneFallbackSummary(3, true, handOff)).toBe('Fast lane handed 3 finished file(s) to the full builder: the next engine reasons before every answer, which the lane cannot carry — a planned handoff, not a failure.');
    const root = "simple-build fast lane stopped early — the app's root component (src/App.tsx) was not written, so the files built so far are not connected to the page yet";
    expect(laneFallbackSummary(2, true, root)).toBe("Fast lane handed 2 finished file(s) to the full builder: the next engine reasons before every answer, which the lane cannot carry, and the app's root component was not written — a planned handoff, not a failure.");
    expect(laneFallbackSummary(2, true, 'simple-build timed out after 240000ms')).toContain('and its time budget ran out before it could finish');
    // Without a decision, every ending keeps its own words (Q-939).
    expect(laneFallbackSummary(2, false, root)).toBe("Simple build stopped after generating 2 file(s): the app's root component was not written — the full builder continues from them.");
  });
});

describe('Q-912: one door for every lane write, so the census above covers them all', () => {
  const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/SimpleBuilder.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('🔒 deps.writeFiles is called in exactly one place, which reads the answer and records it', () => {
    // A new write site that calls the writer directly would neither skip what is there nor learn what landed.
    expect(src.match(/deps\.writeFiles\(/g)?.length).toBe(1);
    expect(src).toMatch(/const read = readWriteOutcomes\(batch, await deps\.writeFiles\(batch\)\);/);
  });

  it('🔒 the lane\'s three last writes skip what is already there', () => {
    expect(src.match(/\.filter\(\(f\) => !alreadyThere\(f\)\)/g)?.length).toBe(3);
  });
});
