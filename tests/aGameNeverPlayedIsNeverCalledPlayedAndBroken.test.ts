// failedbr #2494 (2026-11-22, one open-world 3D game). Two lies in 0.3 seconds:
//   1115.1 s  GAME_PLAYTEST_NOT_RUN — "The game was never played — the playtest ran out of time … (the page drew 1 frames per second)"
//   1115.4 s  GAME_COMPLETE_GATE_BLOCKED — "Not reported complete: the game was played and is not playable (missing layer)."
//   RELEASE_GATE RED — "Not shippable — the game is not complete: the game was played and is not playable (missing layer)"
// (a) the gate phrased a CODE-read defect as a play result, with no knowledge of whether the game was played;
// (b) the "missing layer" itself was false: the five kit files were in the sandbox (PROD_BUILD_OK) but absent
//     from the saved copy the playtest's file map was built from (EDIT_BASE_PARTIAL at the start of the turn).
// Class: a reader of the playtest result states "played" / "not on disk" without asking the evidence that knows.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gameIncompleteReason, CODE_READ_DEFECTS, HARD_DEFECTS } from '../src/server/AgentV3/gameRepair';
import { playtestOutcome, playtestDefects, missingKitLayerPaths, withKitLayersFromDisk } from '../src/server/AgentV3/gamePlaytest';
import { releaseGate } from '../src/server/AgentV3/releaseGate';

// The real report lines (#2494, historyId 1795338140721), verbatim.
const REAL = {
  notRunCode: 'GAME_PLAYTEST_NOT_RUN',
  notRun: 'The game was never played — the playtest ran out of time while driving it with the keyboard (the page drew 1 frames per second). Nothing here shows that it is playable: its controls, its speed and its camera were not checked in a browser.',
  defects: 'GAME_DEFECT_MISSING_LAYER — imports kit files not on disk: src/game/core/feel.ts, src/game/core/events.ts, src/game/core/dialogue.ts, src/game/core/economy.ts, src/game/core/crafting.ts.',
  editBasePartial: 'missing=src/game/core/crafting.ts, src/game/core/dialogue.ts, src/game/core/economy.ts, src/game/core/events.ts, src/game/core/feel.ts',
  falseGate: 'the game was played and is not playable (missing layer)',
};
const MISSING = REAL.editBasePartial.replace('missing=', '').split(', ');

describe('a game the playtest never played is never reported as played-and-broken (#2494)', () => {
  it('the real #2494 sequence: not-run + a code-read defect → no "played" anywhere in the gate', () => {
    const played = playtestOutcome(REAL.notRunCode) !== 'not-run';
    expect(played).toBe(false);
    const why = gameIncompleteReason([{ code: 'GAME_DEFECT_MISSING_LAYER', evidence: REAL.defects }], [], { played });
    expect(why).not.toBeNull();
    expect(why).not.toContain(REAL.falseGate);
    expect(why).not.toMatch(/\bwas played\b/);
    expect(why).toMatch(/code imports game-kit files/);
    const gate = releaseGate({ buildOk: true, preview: 'passed', typecheck: 'passed', tests: 'passed', game: 'not-run', gameIncomplete: why }, { blockers: 0, highSeverity: 0, warnings: 0 });
    expect(`${gate.headline} ${gate.failures.join(' ')}`).not.toMatch(/\bwas played\b/);
  });

  it('a defect measured by PLAY is "played" only when the game was played', () => {
    const blank = [{ code: 'GAME_DEFECT_RUNTIME_ERROR' as const, evidence: 'TypeError' }];
    expect(gameIncompleteReason(blank, [], { played: true })).toContain('the game was played and is not playable (runtime error)');
    const partial = gameIncompleteReason(blank, [], { played: false });
    expect(partial).not.toMatch(/\bwas played\b/);
    expect(partial).toMatch(/could not finish playing/);
  });

  it('every code-read defect is a hard defect and is phrased the same played or not', () => {
    for (const code of CODE_READ_DEFECTS) {
      expect(HARD_DEFECTS.has(code)).toBe(true);
      const d = [{ code, evidence: 'x' }];
      expect(gameIncompleteReason(d, [], { played: true })).toBe(gameIncompleteReason(d, [], { played: false }));
    }
  });
});

describe('"not on disk" is asked of the disk (#2494 saved copy missing five kit files)', () => {
  const importer = { 'src/game/world.ts': MISSING.map((p, i) => `import * as m${i} from './core/${p.split('/').pop()!.replace(/\.ts$/, '')}';`).join('\n') + '\n' };

  it('the saved-copy map alone reports the five files missing (the false finding)', () => {
    const paths = missingKitLayerPaths(importer);
    for (const p of MISSING) expect(paths).toContain(p);
  });

  it('files the sandbox has are read back, so no missing layer is recorded', async () => {
    const files = await withKitLayersFromDisk(importer, async (p) => `// ${p} on disk\nexport {};\n`);
    expect(missingKitLayerPaths(files)).toEqual([]);
    expect(playtestDefects(null, null, missingKitLayerPaths(files)).map((d) => d.code)).not.toContain('GAME_DEFECT_MISSING_LAYER');
  });

  it('a file the sandbox does not have stays missing (a real missing layer is still found)', async () => {
    const files = await withKitLayersFromDisk(importer, async (p) => { if (p.endsWith('feel.ts')) throw new Error('ENOENT'); return 'export {};\n'; });
    expect(missingKitLayerPaths(files)).toEqual(['src/game/core/feel.ts']);
  });
});

describe('source guard: every reader states the evidence it was given', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  it('the route passes the playtest\'s own played answer to the gate', () => {
    const calls = route.match(/gameIncompleteReason\([^;]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).toMatch(/played:/);
    expect(route).toContain("played: gameProof.outcome !== 'not-run'");
  });
  it('the playtest\'s defect and scope readers use the map completed from the sandbox', () => {
    expect(route).toContain('const playedFiles = await withKitLayersFromDisk(playtestFiles,');
    const at = route.indexOf('const playedFiles = await withKitLayersFromDisk(');
    const known = route.lastIndexOf('const playtestFiles =', at);
    expect(known).toBeGreaterThan(0);
    // No reader between the known map and the completed one judges kit layers or scope from the partial map.
    expect(route.slice(known, at)).not.toMatch(/missingKitLayerPaths\(|scopeMatch\(|replayFromCode\(/);
  });
  it('census: "the game was played" appears in server code only where a play is known to have happened', () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.ts$/.test(n) || /\.test\.ts$/.test(n)) continue;
        const text = readFileSync(p, 'utf8');
        for (const line of text.split('\n')) if (/['"`][^'"`]*the game was played/i.test(line) && !/^\s*(\/\/|\*)/.test(line)) hits.push(`${p}: ${line.trim().slice(0, 120)}`);
      }
    };
    walk('src/server');
    // gameRepair.ts: inside `opts.played ?`; releaseGate.ts: the `ev.game === 'passed'` branch.
    for (const h of hits) expect(h).toMatch(/gameRepair\.ts: \? `the game was played|releaseGate\.ts:/);
  });
});
