// THE MAP ROLLOUT PAGE MATCHES THE CODE (map expansion plan, item 13). docs/MAP_EXPANSION_ROLLOUT.md lists every switch the
// map expansion ships with and its default; a page that names a switch the code no longer has, or a wrong default, would send
// the admin to the wrong lever during an incident. Each switch is checked against the code it names.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gameGeometryProbeEnabled } from '../src/server/AgentV3/gameGeometryProbe';
import { growthGuardEnabled } from '../src/server/AgentV3/growthGuard';
import { MAX_PLACES } from '../src/server/AgentV3/worldGrow';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { worldUpgradeEnabled } from '../src/server/AgentV3/worldUpgrade';

const root = join(__dirname, '..');
const page = readFileSync(join(root, 'docs/MAP_EXPANSION_ROLLOUT.md'), 'utf8');
const src = (p: string) => readFileSync(join(root, p), 'utf8');

describe('📋 the map rollout page', () => {
  it('lateEdits: on in the open world (lateEdits: false opts out), off for a bare Athree map unless a game asks for it', () => {
    expect(page).toMatch(/\*\*on\*\* in the open world, \*\*off\*\* for a bare Athree map/);
    const bridge = recipeFilePool().get('src/game/play/openWorld.ts')!.content;
    expect(bridge).toContain('const lateEdits = options.lateEdits !== false;');
    expect(src('src/server/lib/athreeMap/AthreeMapGenerator.ts')).toContain("const lateEdits = options.lateEdits === true;");
    expect(page).toMatch(/Until both land, `lateEdits` stays off for a bare Athree map/);
  });
  it('liveCities and the 1,000 cap: the numbers the page gives are the kit\'s', () => {
    const bridge = recipeFilePool().get('src/game/play/openWorld.ts')!.content;
    expect(bridge).toMatch(/liveCities === false \? Infinity/);
    expect(bridge).toMatch(/LIVE_CITIES = \{ phone: 2, mid: 5, desktop: 8 \}/);
    expect(page).toMatch(/phone 2, mid 5, desktop 8/);
    expect(bridge).toContain(`export const MAX_REGIONS = ${MAX_PLACES};`);
    expect(page).toMatch(/\| 1,000 \|/);
  });
  it('the server switches it names exist, default on, and turn off with "off"', () => {
    expect(gameGeometryProbeEnabled({})).toBe(true);
    expect(gameGeometryProbeEnabled({ AGENTV3_GAME_GEOMETRY_PROBE: 'off' })).toBe(false);
    expect(growthGuardEnabled({})).toBe(true);
    expect(growthGuardEnabled({ AGENTV3_GROWTH_GUARD: 'off' })).toBe(false);
    expect(worldUpgradeEnabled({})).toBe(true);
    expect(worldUpgradeEnabled({ AGENTV3_WORLD_UPGRADE: 'off' })).toBe(false);
    for (const name of ['AGENTV3_GAME_GEOMETRY_PROBE', 'AGENTV3_GROWTH_GUARD', 'AGENTV3_MAP_GROWTH_NOTE', 'AGENTV3_WORLD_UPGRADE']) expect(page).toContain(`\`${name}=off\``);
  });
});
