// AN EDITED WORLD IS UPGRADED ONLY WHEN THE USER SAYS SO (map expansion plan, item 11; owner decision 2026-11-23: an old
// hand-edited game gets the new system only after the user agrees). A game whose openWorld.ts was changed by hand never takes
// the newer map features by itself. On a map request the builder is told so and asks ONE question; on the user's explicit
// "world upgrade karo" the platform keeps ONE backup, writes the current bridge and the kit files it needs — or, where that
// could break the game, changes NOTHING and says why. Synthetic projects only.
import { describe, it, expect } from 'vitest';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { BRIDGE_PATH, BRIDGE_BACKUP_PATH, bridgeState, editedBridgeNote, worldUpgradeAsked, planWorldUpgrade, upgradeWorldAtTurnStart } from '../src/server/AgentV3/worldUpgrade';
import { mapGrowthNoteAtTurnStart, OPEN_WORLD_FILE } from '../src/server/AgentV3/growthTurn';
import { worldWishAtTurnStart } from '../src/server/AgentV3/worldTurn';

const pool = recipeFilePool();
const CURRENT = pool.get(BRIDGE_PATH)!.content;
const EDITED = CURRENT.replace('export function createOpenWorld(', '// my own tweak: brighter sky\nexport function createOpenWorld(');
const WORLD_TS = "export const WORLD = { regions: [{ id: 'main-city', kind: 'city' }] };\n";
/** A synthetic open-world project: every kit file of src/game, the given bridge, and a world list. */
function project(bridge: string | null, extra: Record<string, string> = {}): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [p, f] of pool) if (p.startsWith('src/game/') && !/\.test\.tsx?$/.test(p)) files[p] = f.content;
  if (bridge === null) delete files[BRIDGE_PATH]; else files[BRIDGE_PATH] = bridge;
  files['src/game/world.ts'] = WORLD_TS;
  return { ...files, ...extra };
}
function fs(files: Record<string, string>, failOn?: string) {
  const disk = new Map(Object.entries(files));
  const writes: string[] = [];
  return {
    disk, writes,
    read: async (p: string) => { if (!disk.has(p)) throw new Error('ENOENT: not found'); return disk.get(p)!; },
    write: async (p: string, c: string) => { if (p === failOn) throw new Error('refused'); writes.push(p); disk.set(p, c); },
  };
}
const issues: any[] = [];
const record = (i: any) => { issues.push(i); };

describe('🧬 reading "world upgrade karo"', () => {
  it.each(['world upgrade karo', 'World upgrade kar do', 'please upgrade my world', 'upgrade the world', 'वर्ल्ड अपग्रेड करो', 'naya world system lagao', 'new world system', 'haan, world upgrade karo na'])('asks: %s', (p) => {
    expect(worldUpgradeAsked(p)).toBe(true);
  });
  it.each(['world upgrade mat karo', 'world upgrade nahi chahiye', "don't upgrade the world", 'kya world upgrade karna chahiye?', 'should I upgrade the world', 'वर्ल्ड अपग्रेड मत करो',
    'upgrade the car', 'gun upgrade karo', 'map update karo', 'world bada karo', 'ek aur shehar jodo', `world upgrade karo ${'aur bahut kuch '.repeat(20)}`])('does not ask: %s', (p) => {
    expect(worldUpgradeAsked(p)).toBe(false);
  });
});

describe('🧬 the bridge and the note', () => {
  it('bridgeState: absent, current, edited', () => {
    expect(bridgeState(null)).toBe('absent');
    expect(bridgeState(CURRENT)).toBe('current');
    expect(bridgeState(EDITED)).toBe('edited');
    expect(editedBridgeNote('edited')).toMatch(/world upgrade karo/);
    for (const s of ['absent', 'current', 'older-kit'] as const) expect(editedBridgeNote(s)).toBe('');
  });

  it('a map request in a game with an EDITED bridge carries the ask-first note; with the current bridge it does not; the switch turns it off', () => {
    const ask = (files: Record<string, string>, env: NodeJS.ProcessEnv = {}) => mapGrowthNoteAtTurnStart({ prompt: 'ek aur shehar jodo', filesAtTurnStart: files, record, env });
    expect(ask(project(EDITED))).toMatch(/EDITED COPY/);
    expect(ask(project(EDITED))).toMatch(/MAP REQUEST READ AS/);                         // the map note itself is unchanged
    expect(ask(project(CURRENT))).not.toMatch(/EDITED COPY/);
    expect(ask(project(EDITED), { AGENTV3_WORLD_UPGRADE: 'off' })).not.toMatch(/EDITED COPY/);
    expect(OPEN_WORLD_FILE).toBe(BRIDGE_PATH);
  });
});

describe('🧬 the upgrade, on the user\'s words only', () => {
  it('"world upgrade karo" on an edited bridge: the backup is written FIRST, then the current bridge; told and recorded', async () => {
    const files = project(EDITED); const f = fs(files);
    const note = await upgradeWorldAtTurnStart({ prompt: 'world upgrade karo', filesAtTurnStart: files, read: f.read, write: f.write, record, env: {} });
    expect(note).toMatch(/UPGRADED THIS GAME'S WORLD/);
    expect(f.writes[0]).toBe(BRIDGE_BACKUP_PATH);
    expect(f.disk.get(BRIDGE_BACKUP_PATH)).toBe(EDITED);
    expect(f.disk.get(BRIDGE_PATH)).toBe(CURRENT);
    expect(f.writes[f.writes.length - 1]).toBe(BRIDGE_PATH);
    expect(issues.some((i) => i.code === 'WORLD_UPGRADED')).toBe(true);
  });

  it('a second upgrade never overwrites the first backup: nothing is written, and it is said', async () => {
    const files = project(EDITED, { [BRIDGE_BACKUP_PATH]: 'the very first copy' }); const f = fs(files);
    const note = await upgradeWorldAtTurnStart({ prompt: 'world upgrade karo', filesAtTurnStart: files, read: f.read, write: f.write, record, env: {} });
    expect(note).toMatch(/DID NOT DO IT/); expect(note).toMatch(/never overwritten/);
    expect(f.writes).toEqual([]);
  });

  it('the game\'s own code imports a name the current bridge lacks: nothing is written, the name is said', async () => {
    const files = project(EDITED.replace('export function createOpenWorld(', 'export const myHelper = 1;\nexport function createOpenWorld('), { 'src/App.tsx': "import { myHelper } from './game/play/openWorld';\nexport default () => myHelper;\n" });
    const f = fs(files);
    const note = await upgradeWorldAtTurnStart({ prompt: 'world upgrade karo', filesAtTurnStart: files, read: f.read, write: f.write, record, env: {} });
    expect(note).toMatch(/myHelper/);
    expect(f.writes).toEqual([]);
  });

  it('an edited kit file the new bridge needs lacks a name: nothing is written, the file is said', async () => {
    const files = project(EDITED, { 'src/game/ui/worldMap.ts': 'export const placeName = (x: unknown) => String(x);\nexport type WorldMapPlace = { id: string };\n' });
    const f = fs(files);
    const note = await upgradeWorldAtTurnStart({ prompt: 'world upgrade karo', filesAtTurnStart: files, read: f.read, write: f.write, record, env: {} });
    expect(note).toMatch(/worldMap\.ts lacks setWorldMapSource/);
    expect(f.writes).toEqual([]);
  });

  it('an absent kit file the new bridge needs is added from the kit, after the backup and before the bridge', async () => {
    const files = project(EDITED); delete files['src/game/three/groundContact.ts'];
    const f = fs(files);
    await upgradeWorldAtTurnStart({ prompt: 'world upgrade karo', filesAtTurnStart: files, read: f.read, write: f.write, record, env: {} });
    expect(f.disk.get('src/game/three/groundContact.ts')).toBe(pool.get('src/game/three/groundContact.ts')!.content);
    expect(f.writes.indexOf('src/game/three/groundContact.ts')).toBeGreaterThan(0);
    expect(f.writes.indexOf('src/game/three/groundContact.ts')).toBeLessThan(f.writes.indexOf(BRIDGE_PATH));
  });

  it('a write that fails half-way puts back what was written (the backup stays)', async () => {
    const files = project(EDITED); delete files['src/game/three/groundContact.ts'];
    const f = fs(files, BRIDGE_PATH);
    const note = await upgradeWorldAtTurnStart({ prompt: 'world upgrade karo', filesAtTurnStart: files, read: f.read, write: f.write, record, env: {} });
    expect(note).toMatch(/put back/);
    expect(f.disk.get(BRIDGE_PATH)).toBe(EDITED);
    expect(f.disk.get(BRIDGE_BACKUP_PATH)).toBe(EDITED);
  });

  it('opposite class — no explicit words, a negation, the current bridge, no bridge, or the switch off: nothing is written', async () => {
    for (const [prompt, bridge, env] of [['ek aur shehar jodo', EDITED, {}], ['world upgrade mat karo', EDITED, {}], ['world upgrade karo', EDITED, { AGENTV3_WORLD_UPGRADE: 'off' }]] as const) {
      const files = project(bridge); const f = fs(files);
      expect(await upgradeWorldAtTurnStart({ prompt, filesAtTurnStart: files, read: f.read, write: f.write, record, env })).toBe('');
      expect(f.writes).toEqual([]);
    }
    for (const bridge of [CURRENT, null]) {
      const files = project(bridge); const f = fs(files);
      expect(await upgradeWorldAtTurnStart({ prompt: 'world upgrade karo', filesAtTurnStart: files, read: f.read, write: f.write, record, env: {} })).toMatch(/DID NOT DO IT/);
      expect(f.writes).toEqual([]);
    }
  });

  it('planWorldUpgrade asks for the kit files it has not seen before it decides', () => {
    const p = planWorldUpgrade({ bridge: EDITED, backupExists: false, files: { [BRIDGE_PATH]: EDITED }, kitFiles: new Map() });
    expect(p.ok).toBe(false);
    expect((p as any).unread).toContain('src/game/ui/worldMap.ts');                    // never added on a listing alone
  });

  it('the route\'s world-wish step runs it (already wired at turn start), and never on an import or module turn', async () => {
    const files = project(EDITED); const f = fs(files);
    const out = await worldWishAtTurnStart({ prompt: 'world upgrade karo', filesAtTurnStart: files, read: f.read, write: f.write, record });
    expect(out).toMatch(/UPGRADED THIS GAME'S WORLD/);
    expect(f.disk.get(BRIDGE_PATH)).toBe(CURRENT);
    const g = fs(project(EDITED));
    expect(await worldWishAtTurnStart({ skip: true, prompt: 'world upgrade karo', filesAtTurnStart: project(EDITED), read: g.read, write: g.write, record })).toBe('');
    expect(g.writes).toEqual([]);
  });
});
