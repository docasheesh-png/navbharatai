/**
 * AUTOPSY 0bb437b4 — "Make a racing game" (Weak, 15.1 min, ok). Every item, locked at its CLASS.
 *
 * 1. The fast lane planned five generic files for a GAME, spent 96 s and wrote nothing — it cannot call
 *    the game recipes the full builder's own prompt requires. → `fastLaneSkipsGame`.
 * 2. The sub-agent invented members of the recipe library's types (`melody.playCue()`, `input.attach()`)
 *    and then edited the platform's own `src/audio/melody.ts` to add them. The compiler says what is
 *    wrong, never what is right. → `typeMembers.ts`, handed back with the write.
 * 3. The reviewer saw the first 20 tree entries — all library files — guessed paths and timed out.
 *    → `reviewFileList`, changed files first.
 * 4. The click explorer could not press "Start Race": the kit's game button pulses for ever and
 *    Playwright only clicks an element that has stopped moving. → reduced motion on EVERY browser lane,
 *    one definition, plus a same-element dispatch for an app's own endless animation.
 * 5. The screen used `.nb-hud`; the kit has `.nb-game-hud`. → the write-time note names it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { missingMembers, declaredMembers, memberListNote, relativeImports, resolveCandidates, RECIPE_LIBRARY_PATH } from '../src/server/AgentV3/typeMembers';
import { fastLaneSkipsGame } from '../src/server/AgentV3/fastLaneRung';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { reviewFileList, reviewerInstruction, REVIEW_TREE_CAP } from '../src/server/AgentV3/ReviewerAgent';
import { clickExplorerScript, clickExplorerModule } from '../src/server/AgentV3/clickExplorer';
import { newPageOptionsExpr, signInScript, BROWSER_PAGE_OPTIONS } from '../src/server/AgentV3/signInExplore';
import { pageCheckScript } from '../src/server/AgentV3/PageRouteCheck';
import { journeyScript } from '../src/server/AgentV3/journeyDerivation';
import { mobileLayoutScript } from '../src/server/AgentV3/mobileLayoutCheck';
import { nearestKitClass, inventedKitClassNote } from '../src/server/AgentV3/kitRestore';

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('1 · a game never starts in the fast lane', () => {
  it('the report prompt is a game to the platform classifier, and the lane stands down for it', () => {
    expect(analyzeRequirementGaps('Make a racing game').domain).toBe('game');
    expect(fastLaneSkipsGame('game', {})).toBe(true);
  });
  it('every other domain keeps the lane, and the kill switch lets games back in', () => {
    expect(fastLaneSkipsGame('ecommerce', {})).toBe(false);
    expect(fastLaneSkipsGame(null, {})).toBe(false);
    expect(fastLaneSkipsGame('game', { AGENTV3_FASTLANE_GAMES: 'on' })).toBe(false);
  });
  it('the route gates the lane on it and records why (source guard)', () => {
    const route = src('src/server/routes/agentv3.ts');
    expect(route).toContain('if (fastLaneWouldRun && !fastLaneRung.skip && !fastLaneGameSkip) {');
    expect(route).toContain("fastLaneGameSkip = fastLaneSkipsGame(analyzeRequirementGaps(prompt).domain)");
    // Both registries are module-private sets; read them where they are declared.
    for (const [file, name] of [['src/server/AgentV3/BuildDiagnostics.ts', 'PROCESS_ONLY_CODES'], ['src/server/AgentV3/buildFindingSuggestions.ts', 'NEVER_SUGGEST']]) {
      const text = src(file);
      const at = text.indexOf(`const ${name} = new Set([`);
      expect(text.slice(at, text.indexOf(']);', at)), name).toContain("'FAST_LANE_SKIPPED_GAME'");
    }
  });
});

const MELODY = `
export interface PlayOptions { loop?: boolean }
export class MelodyPlayer {
  private ctx: unknown;
  #secret = 1;
  constructor() {}
  play(tune: string, options?: PlayOptions): void {}
  stop(): void {}
  get playing(): boolean { return false; }
  protected tick() {}
}
`;

describe('2 · a guessed member is answered with the members that exist', () => {
  const errors = [
    { file: 'src/game/racing/RaceScreen.tsx', line: 4, col: 3, code: 'TS2339', message: "Property 'playCue' does not exist on type 'MelodyPlayer'." },
    { file: 'src/game/racing/RaceScreen.tsx', line: 9, col: 3, code: 'TS2353', message: "Object literal may only specify known properties, and 'volume' does not exist in type 'PlayOptions'." },
    { file: 'src/game/racing/RaceScreen.tsx', line: 4, col: 3, code: 'TS2339', message: "Property 'playCue' does not exist on type 'MelodyPlayer'." },
    { file: 'src/game/racing/RaceScreen.tsx', line: 1, col: 1, code: 'TS2307', message: "Cannot find module './x'." },
  ] as any;
  it('reads the member and the type out of both error shapes, once each', () => {
    expect(missingMembers(errors)).toEqual([
      { file: 'src/game/racing/RaceScreen.tsx', member: 'playCue', type: 'MelodyPlayer' },
      { file: 'src/game/racing/RaceScreen.tsx', member: 'volume', type: 'PlayOptions' },
    ]);
  });
  it('lists what the type declares as the code would call it — never private, protected or #', () => {
    expect(declaredMembers(MELODY, 'MelodyPlayer')).toEqual(['play(tune, options?)', 'stop()', 'playing']);
    expect(declaredMembers(MELODY, 'PlayOptions')).toEqual(['loop']);
    expect(declaredMembers(MELODY, 'Nope')).toBeNull();
    expect(declaredMembers('type Cfg = { a: number; run(x: number): void }', 'Cfg')).toEqual(['a', 'run(x)']);
  });
  it('a platform library is named as one not to edit; the app\'s own file is not', () => {
    expect(RECIPE_LIBRARY_PATH.test('src/audio/melody.ts')).toBe(true);
    expect(RECIPE_LIBRARY_PATH.test('src/game/core/loop.ts')).toBe(true);
    expect(RECIPE_LIBRARY_PATH.test('src/game/racing/RaceScreen.tsx')).toBe(false);
    const lib = memberListNote([{ file: 'a.tsx', member: 'playCue', type: 'MelodyPlayer', declaredIn: 'src/audio/melody.ts', members: ['play(tune, options?)', 'stop()'], library: true }]);
    expect(lib).toContain('`MelodyPlayer` (src/audio/melody.ts) has: play(tune, options?), stop()');
    expect(lib).toContain('`playCue` is not among them');
    expect(lib).toContain('do not edit src/audio/melody.ts');
    const own = memberListNote([{ file: 'a.tsx', member: 'x', type: 'T', declaredIn: 'src/types.ts', members: ['y'], library: false }]);
    expect(own).not.toContain('do not edit');
    expect(memberListNote([])).toBe('');
  });
  it('finds the declaring file through the importer\'s relative imports', () => {
    expect(relativeImports("import { MelodyPlayer } from '../../audio/melody';\nimport x from 'react';")).toEqual(['../../audio/melody']);
    expect(resolveCandidates('src/game/racing/RaceScreen.tsx', '../../audio/melody')).toContain('src/audio/melody.ts');
  });
  it('the dispatcher hands it back with every typechecked write (source guard)', () => {
    const d = src('src/server/AgentV3/ToolDispatcher.ts');
    expect(d).toContain('const members = await this.missingMemberNote(splitByWrittenFiles(errors, tsPaths).own, sources);');
    expect(d).toContain('private async missingMemberNote(own: TscError[], sources: Record<string, string>)');
  });
});

describe('3 · the reviewer sees the files this turn wrote', () => {
  const library = Array.from({ length: 30 }, (_, i) => `src/game/core/lib${i}.ts`);
  const own = ['src/game/racing/RaceScreen.tsx', 'src/game/racing/track.ts'];
  it('changed files come first and the rest is counted, not dropped silently', () => {
    const tree = [...library, ...own, ...Array.from({ length: 40 }, (_, i) => `src/x${i}.ts`)];
    const list = reviewFileList(tree, own).split('\n');
    expect(list.slice(0, 2)).toEqual(own);
    expect(list.length).toBe(REVIEW_TREE_CAP + 1);
    expect(list[list.length - 1]).toBe(`…and ${tree.length - REVIEW_TREE_CAP} more (use glob to list them)`);
  });
  it('the report case: 30 library files first, the app\'s own screen is still in the instruction', () => {
    const text = reviewerInstruction({ userRequest: 'Make a racing game', fileTree: [...library, ...own], fileSample: [], changedFiles: own });
    expect(text).toContain('src/game/racing/RaceScreen.tsx');
  });
});

describe('4 · every browser lane opens pages with reduced motion — one definition', () => {
  it('the shared options ask for it, with and without a saved session', () => {
    expect(BROWSER_PAGE_OPTIONS.reducedMotion).toBe('reduce');
    expect(JSON.parse(newPageOptionsExpr(null))).toEqual({ reducedMotion: 'reduce' });
    expect(JSON.parse(newPageOptionsExpr('/tmp/s.json'))).toEqual({ reducedMotion: 'reduce', storageState: '/tmp/s.json' });
  });
  it('the explorer, the page check, the journey (signed in AND on a sign-in route) and the sign-in explorer all carry it', () => {
    const cfg = JSON.parse(clickExplorerScript('http://x/', { blockWrites: false }).match(/const cfg = (\{.*\});/)![1]);
    expect(cfg.pageOpts).toEqual({ reducedMotion: 'reduce' });
    expect(clickExplorerModule({ base: 'http://x/' })).toContain('browser.newPage(cfg.pageOpts)');
    expect(pageCheckScript('http://x/', ['/a'])).toContain('"reducedMotion":"reduce"');
    const j = (route: string) => ({ id: 'j', kind: 'create', route, title: 't', fields: [], submit: null, writes: false }) as any;
    expect(journeyScript('http://x/', [j('/notes')], 'M', { storageState: '/tmp/s.json' })).toContain('"reducedMotion":"reduce","storageState":"/tmp/s.json"');
    const signInRoute = journeyScript('http://x/', [j('/login')], 'M', { storageState: '/tmp/s.json' });
    expect(signInRoute).toContain('pageOpts: {"reducedMotion":"reduce"}');
    expect(signInScript('http://x/', [])).toContain('browser.newContext({"reducedMotion":"reduce"})');
    expect(mobileLayoutScript('http://x/', { storageState: '/tmp/s.json' })).toContain('"pageOpts":{"reducedMotion":"reduce","storageState":"/tmp/s.json"}');
  });
  it('no browser lane opens a page without the shared options (census over the generators)', () => {
    const allowed = ['({ ...cfg.pageOpts,', '(cfg.pageOpts)', '(j.pageOpts)', '(${newPageOptionsExpr(opts.storageState)})', '(${JSON.stringify(BROWSER_PAGE_OPTIONS)})'];
    let seen = 0;
    for (const f of ['src/server/AgentV3/clickExplorer.ts', 'src/server/AgentV3/PageRouteCheck.ts', 'src/server/AgentV3/journeyDerivation.ts', 'src/server/AgentV3/signInExplore.ts', 'src/server/AgentV3/mobileLayoutCheck.ts']) {
      for (const line of src(f).split('\n')) {
        if (!/\b(?:browser\.newPage|browser\.newContext)\(/.test(line)) continue;
        seen += 1;
        expect(allowed.some((a) => line.includes(a)), `${f}: ${line.trim()}`).toBe(true);
      }
    }
    expect(seen).toBe(5);
  });
  it('an element that never stops moving is pressed on itself — for that failure alone', () => {
    const mod = clickExplorerModule({ base: 'http://x/' });
    expect(mod).toContain("if (!/not stable/i.test(String(e && e.message || e))) throw e;");
    expect(mod).toContain("await loc.dispatchEvent('click');");
    expect(mod).not.toContain(`first().click({ timeout: 4000 })`);
    expect(mod.split('await press(page, ').length - 1).toBe(2);
  });
  it('the generated explorer is still valid JavaScript with no raw control character', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nbai-race-'));
    const file = join(dir, 'run.mjs');
    const mod = clickExplorerModule({ base: 'http://x/', pageOpts: { reducedMotion: 'reduce' } });
    writeFileSync(file, mod);
    expect(() => execFileSync(process.execPath, ['--check', file])).not.toThrow();
    expect(mod).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
  });
});

describe('5 · an invented kit class is answered with the one it meant', () => {
  it('the report case', () => {
    expect(nearestKitClass('nb-hud')).toBe('nb-game-hud');
    expect(nearestKitClass('nb-bar-fill')).toBe('nb-game-bar-fill');
    expect(inventedKitClassNote('src/game/racing/RaceScreen.tsx', ['nb-hud'])).toContain('.nb-hud (the kit has .nb-game-hud)');
  });
  it('no match, or two equally good ones, names nothing — a guess is not a fact', () => {
    expect(nearestKitClass('nb-zzqx')).toBeNull();
    expect(nearestKitClass('nb')).toBeNull();
    expect(inventedKitClassNote('a.tsx', ['nb-zzqx'])).toContain('.nb-zzqx —');
    expect(inventedKitClassNote('a.tsx', [])).toBe('');
  });
});
