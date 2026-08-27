import { describe, it, expect } from 'vitest';
import { GAME_3D_MODULES, generateGame3D } from '../src/server/lib/Game3DGenerator';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';

/**
 * THE TOOL DESCRIPTION IS THE ONLY THING THAT TELLS THE MODEL A MODULE EXISTS.
 *
 * `generate_game_3d` takes an optional `include` subset. The model picks that subset by reading the
 * tool's own description — so a module the description does not name is, from the model's point of
 * view, not there.
 *
 * THIS DRIFTED FOR REAL, TWICE, AND BOTH TIMES SILENTLY. The description listed the five original
 * modules long after environment/surfaces/humanoid shipped (2026-08-26) and objects shipped
 * (2026-08-27). Nothing failed: a model that passed `include: ['renderer','lighting','camera','world']`
 * simply got a build with no sky, no reflections, no real surfaces and nothing to put in the world —
 * and then followed a system prompt telling it to call createCar() from a file that was never written.
 * The symptom is a flat-looking game, which is exactly the complaint this whole line of work exists to
 * answer, arriving by a route nobody would think to check.
 *
 * So the description is pinned against the generator itself. A tenth module cannot be added without
 * this test failing.
 */

const tool = defaultToolCatalog().find((t) => t.name === 'generate_game_3d');

describe('generate_game_3d advertises every module it can emit', () => {
  it('the tool exists and takes an include subset', () => {
    expect(tool, 'generate_game_3d has been renamed or removed').toBeTruthy();
  });

  it('every module the generator can write is named in the include description', () => {
    const schema = tool!.input_schema as { properties?: { include?: { description?: string } } };
    const described = String(schema.properties?.include?.description ?? '');
    expect(described, 'the include parameter lost its description').not.toBe('');

    const missing = GAME_3D_MODULES.filter((m) => !described.toLowerCase().includes(m));
    expect(missing, `modules the model is never told about: ${missing.join(', ')}`).toEqual([]);
  });

  it('the default (no subset) really does write every module — what "Default = all" claims', () => {
    /**
     * Executed, not asserted from prose: the description tells the model omitting `include` is safe,
     * and that promise has to be true or the advice above makes things worse.
     */
    const all = generateGame3D();
    for (const m of GAME_3D_MODULES) {
      expect(Object.keys(all.files), `default build is missing ${m}`).toContain(`src/game/three/${m}.ts`);
    }
  });

  it('the description warns that a subset is how a scene ends up flat', () => {
    /**
     * The honest half. Naming the modules is not enough — a model optimising for a small diff will
     * narrow the list unless it is told what narrowing costs.
     */
    const schema = tool!.input_schema as { properties?: { include?: { description?: string } } };
    const described = String(schema.properties?.include?.description ?? '').toLowerCase();
    expect(described).toContain('default = all');
    expect(described).toMatch(/flat|near-black/);
  });
});
