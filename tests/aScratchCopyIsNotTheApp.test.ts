// A BUILDER'S SCRATCH COPY OF A PROJECT FILE IS NOT THE USER'S APP (failedbr #2494, 2026-11-22).
//
// The real run: `cp src/game/world.ts src/game/world.ts.backup` (shipped in the saved project's manifest), then
// write_file `src/game/worldCorrected.ts` (compiled with the app: five TS2322 errors) and `src/game/worldFixed.ts`.
// 🧬 THE CLASS: a duplicate of an existing project file made by the builder, surviving the turn. These tests lock the
// exact name patterns, the four conservative conditions, and the wiring (rule line + end-of-turn net).
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  scratchCopyOriginal, scratchCopyToken, scratchCopyCandidates, applyScratchCopyNet, scratchCopyNote, SCRATCH_COPY_RULE,
} from '../src/server/AgentV3/scratchCopies';
import { applyLeftoverNetAfterBuild } from '../src/server/AgentV3/leftoverComponents';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const has = (files: string[]) => (p: string) => files.includes(p);

/** The project as #2494 left it before the net: the original, its backup, and the user's real files. */
const PROJECT = ['src/game/world.ts', 'src/game/world.ts.backup', 'src/game/worldCorrected.ts', 'src/game/main.ts', 'src/App.tsx', 'index.html'];

describe('the exact scratch-copy names, each only beside an original that exists', () => {
  it.each([
    ['src/game/world.ts.backup', 'src/game/world.ts'],
    ['src/game/world.ts.bak', 'src/game/world.ts'],
    ['src/game/world.ts.orig', 'src/game/world.ts'],
    ['src/game/world.bak.ts', 'src/game/world.ts'],
    ['src/game/worldFixed.ts', 'src/game/world.ts'],
    ['src/game/worldCorrected.ts', 'src/game/world.ts'],
    ['src/game/worldCopy.ts', 'src/game/world.ts'],
    ['src/game/worldOld.ts', 'src/game/world.ts'],
    ['src/game/world-fixed.ts', 'src/game/world.ts'],
    ['src/game/world_copy.ts', 'src/game/world.ts'],
  ])('%s is a scratch copy of %s', (copy, original) => {
    expect(scratchCopyOriginal(copy, has(['src/game/world.ts']))).toBe(original);
  });

  it.each(['src/game/worldFixed.ts', 'src/game/world.ts.backup', 'src/hooks/useOld.ts', 'src/components/CopyButton.tsx', 'src/game/world.ts', 'src/game/bakery.ts'])(
    '%s is NOT a scratch copy when no sibling original exists', (p) => {
      expect(scratchCopyOriginal(p, has(['src/game/main.ts']))).toBeNull();
    });

  it('never looks inside dependencies or build output', () => {
    expect(scratchCopyOriginal('node_modules/x/indexCopy.js', has(['node_modules/x/index.js']))).toBeNull();
    expect(scratchCopyOriginal('dist/appOld.js', has(['dist/app.js']))).toBeNull();
  });

  it('the mention token is how an import would name it', () => {
    expect(scratchCopyToken('src/game/worldFixed.ts')).toBe('worldFixed');
    expect(scratchCopyToken('src/game/world.ts.backup')).toBe('world.ts.backup');
  });
});

describe('the four conservative conditions', () => {
  const base = { listing: PROJECT, existedAtStart: ['src/game/world.ts', 'src/game/main.ts', 'src/App.tsx', 'index.html'], request: 'make the city bigger' };

  it('#2494: the backup and the trial copy this build made are candidates', () => {
    const d = scratchCopyCandidates({ ...base, writtenThisBuild: ['src/game/world.ts', 'src/game/world.ts.backup', 'src/game/worldCorrected.ts'] });
    expect(d.candidates.map((c) => c.path)).toEqual(['src/game/world.ts.backup', 'src/game/worldCorrected.ts']);
  });

  it('a file this build did not write is never touched', () => {
    expect(scratchCopyCandidates({ ...base, writtenThisBuild: ['src/game/world.ts'] }).candidates).toEqual([]);
  });

  it('a file that was in the saved project when the turn began is never touched (the user\'s own worldOld.ts)', () => {
    const d = scratchCopyCandidates({ ...base, existedAtStart: [...base.existedAtStart, 'src/game/world.ts.backup'], writtenThisBuild: ['src/game/world.ts.backup'] });
    expect(d.candidates).toEqual([]);
  });

  it('a file the request names is kept and said so', () => {
    const d = scratchCopyCandidates({ ...base, request: 'keep a backup as world.ts.backup', writtenThisBuild: ['src/game/world.ts.backup'] });
    expect(d.candidates).toEqual([]);
    expect(d.askedFor).toEqual(['src/game/world.ts.backup']);
  });

  it('the kill switch turns it off', () => {
    expect(scratchCopyCandidates({ ...base, writtenThisBuild: ['src/game/world.ts.backup'], env: { AGENTV3_SCRATCH_COPY_REMOVE: 'off' } }).candidates).toEqual([]);
  });
});

describe('the end-of-turn net', () => {
  const deps = (mentions: Record<string, boolean | null>) => ({
    listProjectFiles: async () => PROJECT,
    writtenThisBuild: () => ['src/game/world.ts', 'src/game/world.ts.backup', 'src/game/worldCorrected.ts'],
    mentionedOutside: vi.fn(async (p: string) => (p in mentions ? mentions[p] : false)),
    removeLeftoverFiles: vi.fn(async (ps: readonly string[]) => [...ps]),
  });
  const input = { request: 'make the city bigger', existedAtStart: ['src/game/world.ts', 'src/game/main.ts', 'src/App.tsx', 'index.html'] };

  it('removes unreferenced scratch copies and records it honestly', async () => {
    const d = deps({}); const record = vi.fn();
    expect(await applyScratchCopyNet(d, { record }, input, {})).toEqual(['src/game/world.ts.backup', 'src/game/worldCorrected.ts']);
    expect(d.removeLeftoverFiles).toHaveBeenCalledWith(['src/game/world.ts.backup', 'src/game/worldCorrected.ts']);
    expect(record.mock.calls[0][0]).toMatchObject({ code: 'SCRATCH_COPIES', severity: 'info' });
    expect(record.mock.calls[0][0].message).toContain('src/game/world.ts.backup (a copy of src/game/world.ts)');
  });

  it('keeps a copy something refers to, and one it could not check', async () => {
    const d = deps({ 'src/game/worldCorrected.ts': true, 'src/game/world.ts.backup': null }); const record = vi.fn();
    expect(await applyScratchCopyNet(d, { record }, input, {})).toEqual([]);
    expect(d.removeLeftoverFiles).not.toHaveBeenCalled();
    expect(record.mock.calls[0][0].message).toContain('Kept src/game/worldCorrected.ts');
  });

  it('only reports what the sandbox confirmed gone', async () => {
    const d = { ...deps({}), removeLeftoverFiles: vi.fn(async () => ['src/game/worldCorrected.ts']) }; const record = vi.fn();
    expect(await applyScratchCopyNet(d, { record }, input, {})).toEqual(['src/game/worldCorrected.ts']);
    expect(record.mock.calls[0][0].message).not.toContain('world.ts.backup');
  });

  it('never throws', async () => {
    const d = { ...deps({}), listProjectFiles: async () => { throw new Error('sandbox gone'); } };
    expect(await applyScratchCopyNet(d, { record: () => undefined }, input, {})).toEqual([]);
  });

  it('runs after a failed or edit-mode turn too (scratch is never the app), but never on an import turn', async () => {
    const leftoverDeps = { undefinedClassesNow: async () => ({ orphans: [] }) };
    for (const facts of [{ ok: false, importTurn: false, editMode: false, aborted: false }, { ok: true, importTurn: false, editMode: true, aborted: false }]) {
      const d = deps({});
      await applyLeftoverNetAfterBuild(facts, { ...leftoverDeps, ...d }, { record: () => undefined, retract: () => 0 }, input.request, {}, { existedAtStart: input.existedAtStart });
      expect(d.removeLeftoverFiles).toHaveBeenCalledTimes(1);
    }
    const d = deps({});
    await applyLeftoverNetAfterBuild({ ok: true, importTurn: true, editMode: false, aborted: false }, { ...leftoverDeps, ...d }, { record: () => undefined, retract: () => 0 }, input.request, {}, { existedAtStart: input.existedAtStart });
    expect(d.removeLeftoverFiles).not.toHaveBeenCalled();
  });

  it('the note says nothing when there is nothing to say', () => {
    expect(scratchCopyNote([], [], [])).toBe('');
  });
});

describe('wiring — layer one (the rule) and layer two (the net)', () => {
  it('the tool-using builder is told not to make scratch copies', () => {
    expect(read('src/server/AgentV3/systemPrompt.ts')).toContain('`- ${SCRATCH_COPY_RULE}`');
    expect(SCRATCH_COPY_RULE).toMatch(/backup/);
    expect(SCRATCH_COPY_RULE).toMatch(/Fixed\.ts/);
  });

  it('the route hands the net the files that existed when the turn began', () => {
    expect(read('src/server/routes/agentv3.ts')).toContain('checksRequest, process.env, { existedAtStart: durableFilePaths });');
  });

  it('the dispatcher implements every effect the net needs', () => {
    const src = read('src/server/AgentV3/ToolDispatcher.ts');
    for (const m of ['writtenThisBuild(): string[]', 'async listProjectFiles(): Promise<string[]>', 'async mentionedOutside(path: string, token: string)', 'async removeLeftoverFiles(']) {
      expect(src).toContain(m);
    }
  });
});

describe('the mention check reads the sandbox answer conservatively', () => {
  it('builds a fixed-string grep only for a plain token', async () => {
    const { mentionGrepCommand } = await import('../src/server/AgentV3/scratchCopies');
    expect(mentionGrepCommand('worldFixed')).toContain('-rlF');
    expect(mentionGrepCommand("x'; rm -rf /")).toBeNull();
  });
  it('no match is FALSE, a match elsewhere is TRUE, only itself is FALSE, anything else is unknown', async () => {
    const { parseMentionGrep } = await import('../src/server/AgentV3/scratchCopies');
    expect(parseMentionGrep('NBAI_GREP_EXIT:1\n', 'src/game/worldFixed.ts')).toBe(false);
    expect(parseMentionGrep('./src/game/main.ts\nNBAI_GREP_EXIT:0\n', 'src/game/worldFixed.ts')).toBe(true);
    expect(parseMentionGrep('./src/game/worldFixed.ts\nNBAI_GREP_EXIT:0\n', 'src/game/worldFixed.ts')).toBe(false);
    expect(parseMentionGrep('NBAI_GREP_EXIT:2\n', 'x')).toBeNull();
    expect(parseMentionGrep('', 'x')).toBeNull();
  });
});
