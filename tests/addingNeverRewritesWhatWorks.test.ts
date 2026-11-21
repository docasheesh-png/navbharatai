// ADDING ONE THING NEVER REWRITES WHAT ALREADY WORKS — enforced, not asked (admin 2026-11-21: "'baaki files ko mat chhuo'
// abhi nirdesh hai, kamzor AI kabhi-kabhi ise tod sakta hai … isko ROCKSOLID karo").
//
// 🧬 THE CLASS: an invariant of the user's project that only a prompt defends. Two deterministic locks now hold it:
// (1) the write is refused at the tool, (2) at the end of the turn anything changed without being asked is put back —
// whatever door it came through. Both read ONE pure verdict (growthGuard.ts).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  growthVerdict, growthRestores, growthAskNote, partNameOf, growthProtectedPaths, growsByLists, requestNames, mayEdit, mayRemove, repairFeatureList, repairWorld,
  parseFeatureList, parseRegions, lostMount, growthUserNote, growthGuardEnabled, FEATURES_INDEX, WORLD_FILE, APP_FILE,
} from '../src/server/AgentV3/growthGuard';
import { enforceGrowthAtTurnEnd } from '../src/server/AgentV3/growthTurn';
import { ToolDispatcher } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { FakeActuator } from './helpers/dispatcherHarness';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { openWorldAppSource } from '../src/server/lib/GameOpenWorldGenerator';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const COINS = "import { defineFeature } from '../play/features';\nexport default defineFeature({ id: 'coins', setup() { return { count: 0 }; } });\n";
const POLICE = "import { defineFeature } from '../play/features';\nexport default defineFeature({ id: 'police', update() { /* chase */ } });\n";
const INDEX = "import type { GameFeature } from '../play/features';\nimport type { OpenWorld } from '../play/openWorld';\nimport coins from './coins';\nimport police from './police';\n\nexport const FEATURES: GameFeature<OpenWorld>[] = [\n  coins,\n  police,\n];\n";
const WORLD = "import type { OpenWorldOptions } from './play/openWorld';\n\nexport const WORLD: OpenWorldOptions = {\n  seed: 7,\n  regions: [\n    { id: 'main-city', kind: 'city' },\n    { id: 'old-town', kind: 'town', toward: 'east', city: { blocksX: 3 } },\n  ],\n};\n";
const APP = openWorldAppSource({ city: true });
const KIT = 'src/game/Game.ts';
const kit = recipeFilePool().get(KIT)!.content;
const PROJECT: Record<string, string> = {
  [FEATURES_INDEX]: INDEX, 'src/game/features/coins.ts': COINS, 'src/game/features/police.ts': POLICE, [WORLD_FILE]: WORLD, [APP_FILE]: APP, [KIT]: kit,
  'src/pages/About.tsx': 'export default function About() { return null; }',
};

describe('🧱 who the request is about', () => {
  it('a feature is named by its own words, in English or Hinglish — never by a word every game has', () => {
    expect(requestNames('police ko aur tez karo', 'police')).toBe(true);
    expect(requestNames('make the delivery mission longer', 'missionDelivery')).toBe(true);
    expect(requestNames('coins ka colour badlo', 'coins')).toBe(true);
    expect(requestNames('add rain to the game', 'police')).toBe(false);
    expect(requestNames('make the game better', 'game-rules')).toBe(false);   // "game" names nothing
    expect(mayEdit('sab kuch thoda fast karo', 'police')).toBe(true);          // about everything
    expect(mayEdit('game crash ho raha hai, fix karo', 'police')).toBe(true);  // a repair
    expect(mayEdit('add rain', 'police')).toBe(false);
    expect(mayRemove('police hata do', 'police')).toBe(true);
    expect(mayRemove('fix the police', 'police')).toBe(false);                 // a repair is not a removal
    expect(mayRemove('remove the rain', 'police')).toBe(false);                // a removal of something else
  });
});

describe('🧱 the one verdict', () => {
  const ask = 'baarish bhi daalo';   // "add rain too" — names nothing that exists
  it('adding is always allowed; a file outside the game is not the guard\'s business', () => {
    expect(growthVerdict({ path: 'src/game/features/rain.ts', before: undefined, after: 'x', request: ask }).allow).toBe(true);
    expect(growthVerdict({ path: 'src/pages/About.tsx', before: 'a', after: 'b', request: ask }).allow).toBe(true);
  });

  it('🔴 another feature rewritten or deleted for a request that does not name it → not allowed, and its old content is what goes back', () => {
    const rewritten = growthVerdict({ path: 'src/game/features/police.ts', before: POLICE, after: 'export default {};', request: ask });
    expect(rewritten).toMatchObject({ allow: false, restore: POLICE });
    expect(growthVerdict({ path: 'src/game/features/police.ts', before: POLICE, after: null, request: ask })).toMatchObject({ allow: false, restore: POLICE });
    // …and allowed when the user asked for exactly that.
    expect(growthVerdict({ path: 'src/game/features/police.ts', before: POLICE, after: 'x', request: 'police ko tez karo' }).allow).toBe(true);
    expect(growthVerdict({ path: 'src/game/features/police.ts', before: POLICE, after: null, request: 'police hata do' }).allow).toBe(true);
    expect(growthVerdict({ path: 'src/game/features/police.ts', before: POLICE, after: null, request: 'police ko tez karo' }).allow).toBe(false);   // edit asked, not delete
  });

  it('🔴 the features list is append-only: a dropped feature is re-listed, and what the turn added is KEPT', () => {
    const added = INDEX.replace("import police from './police';\n", "import rain from './rain';\n").replace('  police,\n', '  rain,\n');   // rain added, police dropped
    const v = growthVerdict({ path: FEATURES_INDEX, before: INDEX, after: added, request: ask });
    expect(v.allow).toBe(false);
    const fixed = parseFeatureList(v.restore!)!;
    expect(fixed.listed.sort()).toEqual(['coins', 'police', 'rain']);
    expect(fixed.imports.map((i) => i.name).sort()).toEqual(['coins', 'police', 'rain']);
    // Adding only: allowed. Removing by name: allowed. The list deleted or wrecked: the list as it was.
    expect(growthVerdict({ path: FEATURES_INDEX, before: INDEX, after: INDEX.replace('  police,\n', '  police,\n  rain,\n'), request: ask }).allow).toBe(true);
    expect(repairFeatureList(INDEX, INDEX.replace("import police from './police';\n", '').replace('  police,\n', ''), 'police hata do')).toBeNull();
    expect(repairFeatureList(INDEX, null, ask)).toBe(INDEX);
    expect(repairFeatureList(INDEX, 'export const nothing = 1;', ask)).toBe(INDEX);
  });

  it('🔴 the map is append-only too: a dropped place comes back with its own settings, and the new place stays', () => {
    const after = WORLD.replace("    { id: 'old-town', kind: 'town', toward: 'east', city: { blocksX: 3 } },\n", "    { id: 'hill-village', kind: 'village' },\n");
    const v = growthVerdict({ path: WORLD_FILE, before: WORLD, after, request: 'ek gaon aur jodo' });
    expect(v.allow).toBe(false);
    const regions = parseRegions(v.restore!)!;
    expect(regions.map((r) => r.id).sort()).toEqual(['hill-village', 'main-city', 'old-town']);
    expect(regions.find((r) => r.id === 'old-town')!.text).toContain('blocksX: 3');
    expect(repairWorld(WORLD, WORLD.replace("    { id: 'old-town', kind: 'town', toward: 'east', city: { blocksX: 3 } },\n", ''), 'old town hata do')).toBeNull();
    expect(growthVerdict({ path: WORLD_FILE, before: WORLD, after: WORLD.replace('blocksX: 3', 'blocksX: 5'), request: 'old town bada karo' }).allow).toBe(true);
  });

  it('🔴 the mount cannot be replaced, and the game kit cannot be edited — but the platform\'s own writes are never undone', () => {
    expect(lostMount(APP, 'export default function App() { return <CustomGame />; }')).toEqual(['<OpenWorldGame', 'features={FEATURES}', 'world={WORLD}']);
    expect(growthVerdict({ path: APP_FILE, before: APP, after: 'export default function App() { return null; }', request: ask })).toMatchObject({ allow: false, restore: APP });
    expect(growthVerdict({ path: APP_FILE, before: APP, after: APP.replace('title="Open World"', 'title="Mera Shehar"'), request: ask }).allow).toBe(true);
    expect(growthVerdict({ path: KIT, before: kit, after: `${kit}\n// hacked`, request: ask })).toMatchObject({ allow: false, restore: kit });
    expect(growthVerdict({ path: KIT, before: 'an older kit version', after: kit, request: ask }).allow).toBe(true);                       // brought up to date
    expect(growthVerdict({ path: KIT, before: kit, after: 'a variant', request: ask, platformWrote: 'a variant' }).allow).toBe(true);     // a recipe wrote it
  });
});

describe('🧱 lock 2: the end of the turn puts back whatever was changed without being asked', () => {
  it('one pass over the whole project: only the violations, each with its reason', () => {
    const now: Record<string, string | null> = {
      ...PROJECT,
      'src/game/features/police.ts': 'export default {};',                 // rewritten (a shell script did it)
      'src/game/features/coins.ts': null,                                  // deleted
      [APP_FILE]: APP.replace('title="Open World"', 'title="Shehar"'),     // a legitimate edit
      'src/pages/About.tsx': 'changed',                                    // not the guard's
    };
    const restores = growthRestores({ filesAtTurnStart: PROJECT, now, request: 'baarish bhi daalo' });
    expect(restores.map((r) => r.path).sort()).toEqual(['src/game/features/coins.ts', 'src/game/features/police.ts']);
    expect(restores.find((r) => r.path.endsWith('coins.ts'))!.restore).toBe(COINS);
    expect(growthUserNote(restores)).toMatch(/I kept what already worked/);
    expect(growthUserNote(restores)).toMatch(/2 parts of your game that you did not ask to change \(coins, police\)/);
    expect(growthUserNote(restores)).not.toMatch(/src\//);                 // plain words, no file paths
    expect(growthUserNote([])).toBe('');
  });

  it('a file that could not be read is never judged; a project that does not grow by lists is never guarded', () => {
    const now = { ...PROJECT }; delete (now as Record<string, string>)['src/game/features/police.ts'];
    expect(growthRestores({ filesAtTurnStart: PROJECT, now, request: 'x' })).toEqual([]);
    expect(growsByLists({ 'src/App.tsx': 'x' })).toBe(false);
    expect(growthProtectedPaths({ 'src/App.tsx': 'x', [KIT]: kit })).toEqual([]);
    expect(growthGuardEnabled({ AGENTV3_GROWTH_GUARD: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(growthGuardEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('the route runs it before any check looks at the app, on every door, and tells the report and the user', () => {
    const route = read('src/server/routes/agentv3.ts');
    const at = route.indexOf('GROWTH GUARD, lock 2');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(route.indexOf('const integrityStartedAt = Date.now();'));
    const block = route.slice(at, route.indexOf('const integrityStartedAt = Date.now();'));
    expect(block).toMatch(/await enforceGrowthAtTurnEnd\(\{ filesAtTurnStart: projectFilesAtTurnStart, request: prompt,/);
    expect(block).toMatch(/await runInPass\('growth-guard-restore', \(\) => actuator\.writeFile\(workspaceId, p, c\)\); writtenFiles\.set\(p, c\);/);
    expect(block).toMatch(/dispatcher\.platformWritesThisTurn\(\)/);
    expect(block).toMatch(/refused: dispatcher\.growthRefusedThisTurn\(\)/);
    expect(route).toMatch(/dispatcher\.setGrowthBaseline\(projectFilesAtTurnStart, prompt\)/);
  });

  it('the end-of-turn step itself: puts back, keeps what could not be read, reports and tells — through real ports', async () => {
    const disk = new Map<string, string>(Object.entries(PROJECT));
    disk.set('src/game/features/police.ts', 'export default {};');   // changed by a shell command
    disk.delete('src/game/features/coins.ts');                        // deleted
    const said: string[] = []; const issues: string[] = []; const wrote: string[] = [];
    const out = await enforceGrowthAtTurnEnd({
      filesAtTurnStart: PROJECT, request: 'baarish bhi daalo',
      read: async (p) => { if (p === WORLD_FILE) throw new Error('sandbox timeout'); const c = disk.get(p); if (c === undefined) throw new Error(`ENOENT: ${p}`); return c; },
      write: async (p, c) => { disk.set(p, c); wrote.push(p); },
      platformWrote: new Map(), refused: [KIT], record: (i) => { issues.push(i.code); }, say: (t) => { said.push(t); },
    });
    expect(wrote.sort()).toEqual(['src/game/features/coins.ts', 'src/game/features/police.ts']);
    expect(disk.get('src/game/features/police.ts')).toBe(POLICE);
    expect(disk.get('src/game/features/coins.ts')).toBe(COINS);
    expect(out.restored.sort()).toEqual(wrote.sort());
    expect(issues).toEqual(['GROWTH_GUARD_RESTORED', 'GROWTH_GUARD_ASKED']);
    expect(said.join(' ')).toMatch(/I kept what already worked/);
    expect(said.join(' ')).toMatch(/"coins bhi badlo"|"police bhi badlo"/);
    expect(said.join(' ')).toMatch(/game engine itself is never edited/);   // the refused kit write is named too
    // Nothing to do → silent, and a guard that throws leaves the turn alone.
    const quiet: string[] = [];
    await enforceGrowthAtTurnEnd({ filesAtTurnStart: PROJECT, request: 'x', read: async (p) => PROJECT[p], write: async () => { throw new Error('no'); }, platformWrote: new Map(), refused: [], record: () => undefined, say: (t) => { quiet.push(t); } });
    expect(quiet).toEqual([]);
    expect(await enforceGrowthAtTurnEnd({ filesAtTurnStart: PROJECT, request: 'x', read: () => { throw new Error('boom'); }, write: async () => undefined, platformWrote: new Map(), refused: [], record: () => undefined, say: () => undefined, env: { AGENTV3_GROWTH_GUARD: 'off' } as NodeJS.ProcessEnv })).toEqual({ restored: [], blocked: [] });
  });
});

describe('🔓 when a change really IS needed, the user decides — and is never left stuck', () => {
  it('the user opens it in their own words: by name, or by letting the builder change what is needed this once', () => {
    expect(mayEdit('coins lene par police aaye', 'police')).toBe(true);                       // named
    expect(mayEdit('baarish daalo, jo zaroori ho badal do', 'police')).toBe(true);            // permission, Hinglish
    expect(mayEdit('add rain, you may change whatever is needed', 'police')).toBe(true);     // permission, English
    expect(mayEdit('haan allow hai, police file badal sakte ho', 'coins')).toBe(true);
    expect(mayEdit('baarish daalo', 'police')).toBe(false);                                   // not asked: still closed
    // Permission to change is never permission to delete.
    expect(mayRemove('jo zaroori ho badal do', 'police')).toBe(false);
  });

  it('the platform itself names what was blocked and the words that allow it — plain words, no file paths', () => {
    const note = growthAskNote(['src/game/features/police.ts', 'src/game/features/coins.ts']);
    expect(note).toMatch(/I would also have changed parts of your game that already work: police, coins/);
    expect(note).toMatch(/I did not touch them, because you did not ask me to/);
    expect(note).toMatch(/"police bhi badlo"/);
    expect(note).toMatch(/"jo zaroori ho badal do"/);
    expect(note).not.toMatch(/src\//);
    expect(growthAskNote([KIT])).toMatch(/The game engine itself is never edited for one game/);
    expect(growthAskNote(['src/pages/About.tsx'])).toBe('');
    expect(partNameOf('src/game/features/missionDelivery.ts')).toBe('missionDelivery');
  });

});

describe('🧱 lock 1: the builder\'s own tools are refused at the write', () => {
  const dispatcher = async (request: string) => {
    const act = new FakeActuator();
    for (const [p, c] of Object.entries(PROJECT)) act.files.set(p, c);
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(act, `ws-growth-${Math.random()}`, new WorkspaceState(stream), stream);
    d.setGrowthBaseline(PROJECT, request);
    return { d, act };
  };

  it('write_file over another feature is refused, with what to do instead; the file is untouched', async () => {
    const { d, act } = await dispatcher('baarish bhi daalo');
    const r = await d.dispatch({ id: '1', name: 'write_file', input: { path: 'src/game/features/police.ts', content: 'export default {};', overwrite: true } }, 'architect');
    expect(r.is_error).toBe(true);
    expect(String(r.content)).toMatch(/REFUSED \(growth guard\)/);
    expect(String(r.content)).toMatch(/create a NEW file under src\/game\/features\//);
    expect(act.files.get('src/game/features/police.ts')).toBe(POLICE);
    expect(d.growthRefusedThisTurn()).toEqual(['src/game/features/police.ts']);   // remembered, so the user is told
  });

  it('edit_file inside another feature is refused; adding a new feature and appending to the list go through', async () => {
    const { d, act } = await dispatcher('baarish bhi daalo');
    const edit = await d.dispatch({ id: '2', name: 'edit_file', input: { path: 'src/game/features/police.ts', old_string: '/* chase */', new_string: 'throw 1;' } }, 'architect');
    expect(edit.is_error).toBe(true);
    expect(String(edit.content)).toMatch(/growth guard/);
    expect(act.files.get('src/game/features/police.ts')).toBe(POLICE);
    const add = await d.dispatch({ id: '3', name: 'write_file', input: { path: 'src/game/features/rain.ts', content: "import { defineFeature } from '../play/features';\nexport default defineFeature({ id: 'rain' });\n" } }, 'architect');
    expect(add.is_error).not.toBe(true);
    const list = await d.dispatch({ id: '4', name: 'edit_file', input: { path: FEATURES_INDEX, old_string: '  police,\n', new_string: '  police,\n  rain,\n' } }, 'architect');
    expect(list.is_error).not.toBe(true);
    expect(act.files.get(FEATURES_INDEX)).toContain('rain,');
  });

  it('the same edit is allowed when the user asked for it by name', async () => {
    const { d, act } = await dispatcher('police ko aur tez karo');
    const edit = await d.dispatch({ id: '5', name: 'edit_file', input: { path: 'src/game/features/police.ts', old_string: '/* chase */', new_string: '/* chase faster */' } }, 'architect');
    expect(edit.is_error).not.toBe(true);
    expect(act.files.get('src/game/features/police.ts')).toContain('chase faster');
  });

  it('the kit and the mount are refused; a project with no lists is not guarded at all', async () => {
    const { d } = await dispatcher('baarish bhi daalo');
    const kitEdit = await d.dispatch({ id: '6', name: 'write_file', input: { path: KIT, content: `${kit}\n// mine`, overwrite: true } }, 'architect');
    expect(String(kitEdit.content)).toMatch(/growth guard/);
    const mount = await d.dispatch({ id: '7', name: 'write_file', input: { path: APP_FILE, content: 'export default function App() { return null; }', overwrite: true } }, 'architect');
    expect(String(mount.content)).toMatch(/growth guard/);
    const plain = new FakeActuator(); plain.files.set('src/App.tsx', 'export default function App() { return null; }');
    const stream = new AgentEventStream();
    const free = new ToolDispatcher(plain, 'ws-free', new WorkspaceState(stream), stream);
    free.setGrowthBaseline({ 'src/App.tsx': 'x' }, 'anything');
    const ok = await free.dispatch({ id: '8', name: 'write_file', input: { path: 'src/App.tsx', content: 'export default function App() { return <main />; }', overwrite: true } }, 'architect');
    expect(String(ok.content)).not.toMatch(/growth guard/);
  });
});
