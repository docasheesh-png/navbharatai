// 🏁 A RACE MOVES ONTO THE WORLD'S CITY ROADS ONLY ON THE USER'S YES (map expansion item 8, part 3 — raceWorld.ts).
// Owner decision: a racing user who asks for cities is asked ONCE; the builder asks, the platform makes the switch, and only
// after "race shehar me karo" (or the same said plainly). Behind AGENTV3_RACING_WORLD, OFF by default. Synthetic projects only.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { raceWorldYes, racingWorldEnabled, mapGrowthNote, mapGrowthRoute, mapGrowthIntent, trackOnWorld, RACE_WORLD_YES, WORLD_RACE_TOWNS } from '../src/server/AgentV3/mapGrowthIntent';
import { raceWorldAtTurnStart, planRaceWorld, setTrackWorld, NEW_TRACK_FILE, TRACK_PATH, RACE_STARTER_PATH } from '../src/server/AgentV3/raceWorld';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { WORLD_RACE, WORLD_RACE_PATH, WORLD_COURSE, WORLD_COURSE_PATH } from '../src/server/lib/GameWorldCourseGenerator';
import { RACE_CUSTOM_PATH } from '../src/server/lib/GameRaceCustomGenerator';

const root = join(__dirname, '..');
const ON = { AGENTV3_RACING_WORLD: 'on' } as NodeJS.ProcessEnv;
const APP = "import { RacingRoadGame } from './game/RacingRoadGame';\nexport default function App() { return <RacingRoadGame plan={null} />; }\n";

/** A road-library race as the kit lays it: every kit file except the open world's own layers, and the race's App. */
function racingProject(extra: Record<string, string> = {}): Map<string, string> {
  const disk = new Map<string, string>();
  for (const [p, f] of recipeFilePool()) if (f.recipe !== 'generate_open_world' && f.recipe !== 'generate_athree_map') disk.set(p, f.content);
  disk.set('src/App.tsx', APP);
  for (const [p, c] of Object.entries(extra)) disk.set(p, c);
  return disk;
}

function io(disk: Map<string, string>, opts: { prompt?: string; env?: NodeJS.ProcessEnv; failOn?: string; listing?: Record<string, string> } = {}) {
  const writes: Array<[string, string]> = [];
  const issues: Array<{ code: string; message: string }> = [];
  const files = opts.listing ?? Object.fromEntries(disk);
  return {
    writes, issues, disk,
    port: {
      prompt: opts.prompt ?? RACE_WORLD_YES,
      filesAtTurnStart: files,
      env: opts.env ?? ON,
      read: async (p: string) => { const c = disk.get(p); if (c === undefined) throw new Error('ENOENT'); return c; },
      write: async (p: string, c: string) => { if (p === opts.failOn) throw new Error('write refused'); writes.push([p, c]); disk.set(p, c); },
      record: (i: { code: string; message: string }) => { issues.push(i); },
    },
  };
}

afterEach(() => { vi.unstubAllEnvs(); });

describe('🗣️ the yes — read by its meaning, in Hindi, Hinglish, Devanagari and English', () => {
  it.each([
    RACE_WORLD_YES, 'Race shehar me karo', 'haan, race ko shehar ki sadkon par le jao', 'race ko city roads pe le chalo',
    'रेस को शहर की सड़कों पर ले जाओ', 'रेस शहर में करो', 'move the race onto city roads', 'Yes, put the race on the city roads',
  ])('yes: %s', (s) => { expect(raceWorldYes(s)).toBe(true); });
  it.each([
    'race shehar me mat karo', 'race ko shehar ki sadkon par nahi le jao', 'race shehar me karo?', 'kya race shehar me karein',
    'रेस को शहर में मत ले जाओ', 'रेस शहर में करो?', "don't move the race onto city roads", 'should I move the race onto city roads',
    'shehar me race game banao', 'make a race game in the city', 'track bada karo', 'ek aur shehar jodo', 'race lambi karo', '',
    `${RACE_WORLD_YES} ${'aur bhi bahut kuch '.repeat(12)}`,
  ])('not a yes: %s', (s) => { expect(raceWorldYes(s)).toBe(false); });
});

describe('🔒 the switch is OFF by default', () => {
  it('only "on" (1/true/yes) turns it on', () => {
    expect(racingWorldEnabled({})).toBe(false);
    expect(racingWorldEnabled({ AGENTV3_RACING_WORLD: 'off' })).toBe(false);
    expect(racingWorldEnabled({ AGENTV3_RACING_WORLD: 'maybe' })).toBe(false);
    for (const v of ['on', '1', 'true', 'YES']) expect(racingWorldEnabled({ AGENTV3_RACING_WORLD: v })).toBe(true);
  });
  it('off: the yes changes nothing and says nothing (the race is as it was)', async () => {
    const disk = racingProject();
    const t = io(disk, { env: {} });
    expect(await raceWorldAtTurnStart(t.port)).toBe('');
    expect(t.writes).toEqual([]);
  });
  it('off: a city request still gets the old "not available yet" note, never the question', () => {
    const files = Object.fromEntries(racingProject());
    const note = mapGrowthNote('ek aur shehar jodo', files);
    expect(note).toMatch(/→ TELL\./);
    expect(note).toMatch(/offer a longer track/);
    expect(note).not.toContain(RACE_WORLD_YES);
  });
});

describe('❓ the ONE question (switch on)', () => {
  it('asks, names the reply, and tells the builder to change nothing — the platform makes the switch', () => {
    vi.stubEnv('AGENTV3_RACING_WORLD', 'on');
    const note = mapGrowthNote('ek aur shehar jodo', Object.fromEntries(racingProject()));
    expect(note).toMatch(/→ ASK\./);
    expect(note).toContain(`they reply "${RACE_WORLD_YES}"`);
    expect(note).toMatch(/change NOTHING this turn/i);
    expect(note).toMatch(/do not set TRACK\.world/);
    expect(note).toMatch(/never ask again/);
  });
  it('the yes turn gets no note (the question is never asked again on the answer)', () => {
    vi.stubEnv('AGENTV3_RACING_WORLD', 'on');
    expect(mapGrowthNote(RACE_WORLD_YES, Object.fromEntries(racingProject()))).toBe('');
  });
  it('a longer track is still the race\'s own finishKm, switch on or off', () => {
    vi.stubEnv('AGENTV3_RACING_WORLD', 'on');
    expect(mapGrowthNote('track bada karo', Object.fromEntries(racingProject()))).toMatch(/TRACK\.finishKm/);
  });
  it('a race already on the world: a city is ONE region of world.ts (the four towns kept when the file is new)', () => {
    const files = Object.fromEntries(racingProject({ [TRACK_PATH]: NEW_TRACK_FILE }));
    const note = mapGrowthNote('ek aur shehar jodo', files, { racingWorld: true });
    expect(note).toMatch(/→ EDIT\./);
    expect(note).toMatch(/ONE more region in WORLD\.regions of src\/game\/world\.ts/);
    expect(note).toContain(WORLD_RACE_TOWNS);
    expect(note).toMatch(/Change NOTHING in src\/game\/RacingRoadGame\.tsx/);
    expect(mapGrowthRoute(mapGrowthIntent('track bada karo'), 'racing-library', { raceOnWorld: true }).note).toMatch(/finishKm/);
  });
  it('the four towns the note names are the world race\'s own', () => {
    const towns = WORLD_RACE.slice(WORLD_RACE.indexOf('const TOWNS'), WORLD_RACE.indexOf('] as WorldRegion[]'));
    for (const id of ['start-town', 'east-town', 'north-town', 'far-town']) { expect(towns).toContain(`'${id}'`); expect(WORLD_RACE_TOWNS).toContain(`'${id}'`); }
    expect(towns.replace(/\s+/g, ' ')).toContain(WORLD_RACE_TOWNS.split('}, {')[0].replace(/\s+/g, ' '));
  });
});

describe('✍️ track.ts: one line changes, every other byte kept', () => {
  it('no track.ts: a new one with world: true', () => {
    expect(setTrackWorld(null)).toEqual({ ok: true, source: NEW_TRACK_FILE, already: false });
    expect(trackOnWorld(NEW_TRACK_FILE)).toBe(true);
  });
  it('an existing TRACK keeps its fields; world: false becomes true; already true is left', () => {
    const own = "import type { TrackChoice } from './play/raceCustom';\nexport const TRACK: TrackChoice = {\n  laps: 5,\n};\n";
    const r = setTrackWorld(own);
    expect(r.ok && r.source).toBe("import type { TrackChoice } from './play/raceCustom';\nexport const TRACK: TrackChoice = {\n  world: true,\n  laps: 5,\n};\n");
    expect(setTrackWorld('export const TRACK = { world: false, laps: 2 };')).toMatchObject({ ok: true, source: 'export const TRACK = { world: true, laps: 2 };' });
    expect(setTrackWorld('export const TRACK = {};')).toMatchObject({ ok: true, source: 'export const TRACK = { world: true };' });
    expect(setTrackWorld(NEW_TRACK_FILE)).toMatchObject({ ok: true, already: true });
  });
  it('the user\'s own track model, or a shape it cannot read: refused', () => {
    expect(setTrackWorld("export const TRACK = { model: 'public/models/my-track.glb' };")).toEqual({ ok: false, reason: 'own-track' });
    expect(setTrackWorld('export const TRACK = makeTrack();')).toEqual({ ok: false, reason: 'unreadable' });
    expect(setTrackWorld('export const TRACK = { world: isOn };')).toEqual({ ok: false, reason: 'unreadable' });
  });
});

describe('🏁 the yes, carried out by the platform', () => {
  it('adds the world race and its layers, then sets TRACK.world LAST — nobody\'s file is overwritten', async () => {
    const disk = racingProject();
    const before = new Map(disk);
    const t = io(disk);
    const out = await raceWorldAtTurnStart(t.port);
    expect(out).toMatch(/^✅ ALREADY DONE BY THE PLATFORM/);
    expect(out).toMatch(/Do NOT edit these files/);
    const paths = t.writes.map(([p]) => p);
    expect(paths[paths.length - 1]).toBe(TRACK_PATH);
    expect(paths).toContain(WORLD_RACE_PATH);
    expect(paths).toContain(WORLD_COURSE_PATH);
    expect(paths).toContain('src/game/play/worldLayer.ts');
    expect(paths).toContain('src/game/play/openWorld.ts');
    for (const p of paths.slice(0, -1)) expect(before.has(p)).toBe(false);          // only absent files were added
    expect(disk.get(WORLD_RACE_PATH)).toBe(WORLD_RACE);
    expect(disk.get(WORLD_COURSE_PATH)).toBe(WORLD_COURSE);
    expect(trackOnWorld(disk.get(TRACK_PATH))).toBe(true);
    expect(t.issues.map((i) => i.code)).toEqual(['RACE_ON_WORLD']);
    // Every relative import of what was written resolves in the project now.
    const pool = recipeFilePool();
    for (const p of paths) {
      for (const m of String(disk.get(p)).matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)) {
        const base = p.split('/').slice(0, -1);
        for (const seg of m[1].split('/')) { if (seg === '..') base.pop(); else if (seg !== '.') base.push(seg); }
        const target = base.join('/');
        expect(['', '.ts', '.tsx', '/index.ts', '/index.tsx'].some((e) => disk.has(target + e)) || !pool.size, `${p} imports ${m[1]}`).toBe(true);
      }
    }
  });
  it('a second yes: already on the world — nothing is written', async () => {
    const disk = racingProject();
    await raceWorldAtTurnStart(io(disk).port);
    const t = io(disk);
    expect(await raceWorldAtTurnStart(t.port)).toMatch(/ALREADY runs on the world's city roads/);
    expect(t.writes).toEqual([]);
  });
  it('the user\'s own track.ts keeps every other field', async () => {
    const own = "import type { TrackChoice } from './play/raceCustom';\nexport const TRACK: TrackChoice = {\n  laps: 5,\n};\n";
    const disk = racingProject({ [TRACK_PATH]: own });
    await raceWorldAtTurnStart(io(disk).port);
    expect(disk.get(TRACK_PATH)).toBe(own.replace('{\n  laps', '{\n  world: true,\n  laps'));
  });
  it.each([
    ['the user\'s own track model', { [TRACK_PATH]: "export const TRACK = { model: 'public/models/t.glb' };" }, /own track model/],
    ['a hand-edited race starter', { [RACE_STARTER_PATH]: `${recipeFilePool().get(RACE_STARTER_PATH)!.content}\n// my change\n` }, /changed by hand/],
    ['a hand-edited raceCustom', { [RACE_CUSTOM_PATH]: `// mine\n${recipeFilePool().get(RACE_CUSTOM_PATH)!.content}` }, /changed by hand/],
    ['a different worldRace.ts already there', { [WORLD_RACE_PATH]: 'export const mine = 1;\n' }, /already exists with other content/],
  ])('%s: refused, NOTHING written, the builder told why', async (_n, extra, why) => {
    const disk = racingProject(extra as Record<string, string>);
    const t = io(disk);
    const out = await raceWorldAtTurnStart(t.port);
    expect(out).toMatch(/the platform did NOT do it/);
    expect(out).toMatch(why);
    expect(t.writes).toEqual([]);
    expect(t.issues.map((i) => i.code)).toEqual(['RACE_ON_WORLD_NOT_DONE']);
  });
  it('a file the listing missed but the disk has is never overwritten', async () => {
    const disk = racingProject({ 'src/game/play/worldLayer.ts': '// somebody\'s own worldLayer\nexport const x = 1;\n' });
    const listing = Object.fromEntries([...disk].filter(([p]) => p !== 'src/game/play/worldLayer.ts'));
    const t = io(disk, { listing });
    const out = await raceWorldAtTurnStart(t.port);
    expect(out).toMatch(/the platform did NOT do it/);
    expect(t.writes).toEqual([]);
    expect(disk.get('src/game/play/worldLayer.ts')).toMatch(/somebody's own/);
  });
  it('the switch write fails: the race stays on the road library (track.ts untouched) and the builder is told', async () => {
    const disk = racingProject();
    const t = io(disk, { failOn: TRACK_PATH });
    const out = await raceWorldAtTurnStart(t.port);
    expect(out).toMatch(/could not be written, so the race was left on the road library/);
    expect(disk.has(TRACK_PATH)).toBe(false);
  });
  it('not a race, not a yes, an import turn: nothing', async () => {
    const ow = racingProject({ 'src/App.tsx': '<OpenWorldGame />', 'src/game/world.ts': 'export const WORLD = { regions: [] };' });
    for (const [disk, opts, skip] of [
      [ow, {}, false], [racingProject(), { prompt: 'ek aur shehar jodo' }, false], [racingProject(), { prompt: 'race shehar me mat karo' }, false], [racingProject(), {}, true],
    ] as Array<[Map<string, string>, { prompt?: string }, boolean]>) {
      const t = io(disk, opts);
      expect(await raceWorldAtTurnStart({ ...t.port, skip })).toBe('');
      expect(t.writes).toEqual([]);
    }
  });
  it('planRaceWorld asks to READ a kit path before it would add it (a stale listing never decides)', () => {
    const plan = planRaceWorld({ track: null, has: new Set(['src/App.tsx']), live: new Map() });
    expect(plan).toMatchObject({ ok: false, reason: 'unread' });
  });
});

describe('🔌 wired, and documented', () => {
  it('the route runs it at turn start, after the map wishes, skipped on import and module turns', () => {
    const route = readFileSync(join(root, 'src/server/routes/agentv3.ts'), 'utf8');
    const at = route.indexOf('await raceWorldAtTurnStart({ skip: isImportTurn || !!projectModuleRef');
    expect(at).toBeGreaterThan(route.indexOf('await worldWishAtTurnStart({'));
    expect(route.slice(at, at + 600)).toContain('preseededGolden.set(p, c)');
  });
  it('the rollout page and the env registry name the switch as OFF', () => {
    expect(readFileSync(join(root, 'docs/MAP_EXPANSION_ROLLOUT.md'), 'utf8')).toMatch(/env `AGENTV3_RACING_WORLD=on` \| \*\*off\*\*/);
    expect(readFileSync(join(root, 'docs/claude/ENV_REGISTRY.md'), 'utf8')).toMatch(/### AGENTV3_RACING_WORLD \(code default: OFF/);
  });
});
