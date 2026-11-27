// A PROBE THE BUILDER WROTE TO MEASURE SOMETHING IS NOT THE USER'S APP (build report #2566, 2026-11-27).
//
// The real run: the preview-render repair wrote `probe.test.ts` in the project ROOT (rewritten six times, run with
// `./node_modules/.bin/vitest run probe.test.ts`), the 25-minute cap stopped the build, and the delivered manifest
// listed `probe.test.ts`. The scratch-copy net had already run — BEFORE that repair — so nothing could see it.
// 🧬 THE CLASS: a throwaway investigation file surviving the turn, and an end-of-turn net that runs before the last
// writer. These tests lock the names, the five conservative conditions, and the wiring (rule + late sweep).
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isProbeName, scratchProbeCandidates, probeMentionCommand, applyScratchProbeNet, SCRATCH_PROBE_RULE } from '../src/server/AgentV3/scratchProbes';
import { sweepScratchAtTurnEnd } from '../src/server/AgentV3/buildPhases/turnEndScratch';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

/** The project as #2566 delivered it (from the manifest), plus the durable project at turn start. */
const LISTING = ['public/game-assets/manifest.json', 'src/game/three/assetModels.ts', 'src/game/player.ts', 'src/game/world.ts',
  'src/App.tsx', 'src/App.test.tsx', 'probe.test.ts', 'package.json', 'vite.config.ts', 'index.html'];
const AT_START = ['src/game/three/assetModels.ts', 'src/game/player.ts', 'src/game/world.ts', 'src/App.tsx', 'package.json', 'vite.config.ts', 'index.html'];
const WRITTEN = ['src/game/world.ts', 'src/App.tsx', 'src/game/player.ts', 'probe.test.ts'];
const REQUEST = 'Continue from where you left off and finish/fix the build so the app works end-to-end.';

describe('the scratch names, at the project root only', () => {
  it.each(['probe.test.ts', 'probe.ts', 'probe2.mjs', 'scratch.ts', 'debug.mjs', 'debug-world.ts', 'tmp_check.js', 'temp.cjs', 'repro.spec.ts', 'check.mjs', 'probe.py', 'debug.sh'])(
    '%s is probe-shaped', (p) => { expect(isProbeName(p)).toBe(true); });
  it.each(['src/probe.test.ts', 'src/game/debug.ts', 'scripts/check.mjs', 'checkout.ts', 'debugger.ts', 'probe.json', 'probe.txt', 'vite.config.ts',
    'index.html', 'package.json', 'src/App.test.tsx', 'probes/a.ts', 'template.ts', 'temperature.ts'])(
    '%s is NOT probe-shaped', (p) => { expect(isProbeName(p)).toBe(false); });
});

describe('the conservative conditions', () => {
  it('#2566: probe.test.ts is the one candidate — written this build, new, at the root', () => {
    expect(scratchProbeCandidates({ listing: LISTING, writtenThisBuild: WRITTEN, existedAtStart: AT_START, request: REQUEST }).candidates).toEqual(['probe.test.ts']);
  });
  it('a probe-shaped file that existed when the turn began is the user\'s — kept', () => {
    expect(scratchProbeCandidates({ listing: LISTING, writtenThisBuild: WRITTEN, existedAtStart: [...AT_START, 'probe.test.ts'], request: REQUEST }).candidates).toEqual([]);
  });
  it('a probe-shaped file this build did not write is kept', () => {
    expect(scratchProbeCandidates({ listing: [...LISTING, 'debug.mjs'], writtenThisBuild: WRITTEN.filter((p) => p !== 'probe.test.ts'), existedAtStart: AT_START, request: REQUEST }).candidates).toEqual([]);
  });
  it('a file the request names is kept and said so', () => {
    const d = scratchProbeCandidates({ listing: LISTING, writtenThisBuild: WRITTEN, existedAtStart: AT_START, request: 'add a probe.test.ts that checks the map' });
    expect(d.candidates).toEqual([]);
    expect(d.askedFor).toEqual(['probe.test.ts']);
  });
  it('the mention check looks for the file name and its extension-less import, nothing looser', () => {
    const cmd = probeMentionCommand('probe.test.ts')!;
    expect(cmd).toContain("-e 'probe.test.ts'");
    expect(cmd).toContain(`-e "/probe.test'"`);
    expect(cmd).toContain(`-e '/probe.test"'`);
    expect(probeMentionCommand('src/probe.ts')).toBeNull();
  });
});

function fakeDeps(grepStdout: string | null) {
  const removed: string[] = [];
  return {
    removed,
    deps: {
      listProjectFiles: async () => LISTING,
      writtenThisBuild: () => WRITTEN,
      mentionedOutside: async () => false,
      runCommand: vi.fn(async () => (grepStdout === null ? null : { stdout: grepStdout })),
      removeLeftoverFiles: vi.fn(async (ps: readonly string[]) => { removed.push(...ps); return [...ps]; }),
    },
  };
}

describe('the net', () => {
  it('#2566: removes probe.test.ts when nothing mentions it, and says so', async () => {
    const { deps, removed } = fakeDeps('NBAI_GREP_EXIT:1');
    const record = vi.fn();
    expect(await applyScratchProbeNet(deps, { record }, { request: REQUEST, existedAtStart: AT_START })).toEqual(['probe.test.ts']);
    expect(removed).toEqual(['probe.test.ts']);
    expect(record.mock.calls[0][0]).toMatchObject({ code: 'SCRATCH_PROBES', severity: 'info' });
    expect(record.mock.calls[0][0].message).toMatch(/probe\.test\.ts .*no longer ships with the project or runs in its tests/);
  });
  it('keeps a probe that another file names (a package.json script, an import)', async () => {
    const { deps, removed } = fakeDeps('./package.json\nNBAI_GREP_EXIT:0');
    const record = vi.fn();
    expect(await applyScratchProbeNet(deps, { record }, { request: REQUEST, existedAtStart: AT_START })).toEqual([]);
    expect(removed).toEqual([]);
    expect(record.mock.calls[0][0].message).toMatch(/Kept probe\.test\.ts/);
  });
  it('keeps it silently when the sandbox cannot answer', async () => {
    const { deps, removed } = fakeDeps(null);
    const record = vi.fn();
    expect(await applyScratchProbeNet(deps, { record }, { request: REQUEST, existedAtStart: AT_START })).toEqual([]);
    expect(removed).toEqual([]);
    expect(record).not.toHaveBeenCalled();
  });
  it('kill switch', async () => {
    const { deps } = fakeDeps('NBAI_GREP_EXIT:1');
    expect(await applyScratchProbeNet(deps, { record: vi.fn() }, { request: REQUEST, existedAtStart: AT_START }, { AGENTV3_SCRATCH_PROBE_REMOVE: 'off' })).toEqual([]);
  });
});

describe('the late sweep — after every pass that writes', () => {
  it('runs both nets and returns what it removed; never on an import turn', async () => {
    const { deps } = fakeDeps('NBAI_GREP_EXIT:1');
    const args = { dispatcher: deps, run: deps.runCommand, report: { record: vi.fn() }, request: REQUEST, existedAtStart: AT_START };
    expect(await sweepScratchAtTurnEnd({ ...args, importTurn: false })).toEqual(['probe.test.ts']);
    expect(await sweepScratchAtTurnEnd({ ...args, importTurn: true })).toEqual([]);
  });
  it('the route calls it after the last repair pass and before the durable save', () => {
    const route = read('src/server/routes/agentv3.ts');
    const sweep = route.indexOf('await sweepScratchAtTurnEnd(');
    const repair = route.indexOf("runInPass('preview-render-repair'");
    const save = route.indexOf('// DURABLE FILE SAVE: persist the build');
    const toSave = route.indexOf('const toSave: Record<string, string> = {};', save);
    expect(sweep).toBeGreaterThan(repair);
    expect(sweep).toBeGreaterThan(save);
    expect(sweep).toBeLessThan(toSave);
  });
  it('the builder is told to delete its probes', () => {
    expect(read('src/server/AgentV3/systemPrompt.ts')).toContain('`- ${SCRATCH_PROBE_RULE}`');
    expect(SCRATCH_PROBE_RULE).toMatch(/probe\.test\.ts/);
  });
});
