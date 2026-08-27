import { describe, it, expect } from 'vitest';
import { GAME_3D_MODULES, generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { generateGameVfxAudio } from '../src/server/lib/GameVfxAudioGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';

/**
 * A TOOL'S DESCRIPTION IS THE ONLY THING THAT TELLS THE MODEL A MODULE EXISTS.
 *
 * Six generate_game_* tools take an optional `include` subset, and the model picks that subset by
 * reading the tool's own description. A module the description does not name is, to the model, not
 * there.
 *
 * THIS DRIFTED FOR REAL, AND SILENTLY. generate_game_3d listed its five original modules long after
 * environment/surfaces/humanoid shipped (2026-08-26) and objects shipped (2026-08-27). Nothing failed:
 * `include` is optional and defaults to all, so most builds were fine — but a model that read the
 * description and passed a subset got a build with no sky, no reflections, no real surfaces and nothing
 * to put in the world, then followed a system prompt telling it to call createCar() from a file the
 * build never wrote. The symptom is a flat-looking 3D game: exactly the complaint this line of work
 * exists to answer, arriving by a route nobody would check.
 *
 * ⚠️ HOW THIS TEST IS ALLOWED TO CHECK, AND WHY IT MATTERS. The first version searched the description
 * PROSE for each module name, and it was VACUOUS — deleting `objects` from the list still passed,
 * because the word appeared later in a warning sentence. Short names make that far worse: `ai`, `game`,
 * `state`, `pool`, `feel` and `input` match almost any English sentence, so five of the six tools were
 * being "guarded" by a check that could not fail. A guard that cannot fail is worse than no guard,
 * because it reads as coverage.
 *
 * So the descriptions carry a MACHINE-CHECKABLE list — `Optional subset: a, b, c.` — which is parsed
 * here and compared as an exact SET against what the generator really writes. Missing AND extra names
 * both fail. The convention was already in use by five of the six tools; the sixth now matches it.
 */

/** Parse the `Optional subset: a, b, c.` sentence. Returns null if the convention is broken. */
function declaredModules(description: string): string[] | null {
  const m = /Optional subset:\s*([^.]+)\./i.exec(description);
  if (!m) return null;
  return m[1]
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

/** The module names `include` actually matches on — the generated file's basename. */
function emittedModules(files: Record<string, string>): string[] {
  return Object.keys(files)
    .map((f) => (f.split('/').pop() ?? '').replace(/\.[^.]+$/, '').toLowerCase())
    .filter(Boolean)
    .sort();
}

const SUBSET_TOOLS: Array<[string, () => { files: Record<string, string> }]> = [
  ['generate_game_runtime', generateGameRuntime],
  ['generate_game_controller', generateGameController],
  ['generate_game_systems', generateGameSystems],
  ['generate_game_vfx', generateGameVfxAudio],
  ['generate_game_shell', generateGameShell],
  ['generate_game_3d', generateGame3D],
];

describe.each(SUBSET_TOOLS)('%s declares exactly the modules it emits', (name, generate) => {
  const def = defaultToolCatalog().find((t) => t.name === name);
  const schema = def?.input_schema as { properties?: { include?: { description?: string } } } | undefined;
  const description = String(schema?.properties?.include?.description ?? '');

  it('still exists and still takes an include subset', () => {
    expect(def, `${name} has been renamed or removed`).toBeTruthy();
    expect(description, `${name} lost its include description`).not.toBe('');
  });

  it('keeps the parseable "Optional subset: …" convention this test depends on', () => {
    /**
     * Asserted separately and first: if the sentence is reworded, the parse silently returns null and
     * every check below would pass on nothing. That is the exact failure mode this file was rewritten
     * to eliminate, so it is made loud rather than assumed.
     */
    expect(
      declaredModules(description),
      `${name}'s include description no longer starts "Optional subset: a, b, c." — reword it back, or `
        + 'this guard is inert',
    ).not.toBeNull();
  });

  it('declares every module it writes, and declares nothing it does not', () => {
    expect(declaredModules(description)).toEqual(emittedModules(generate().files));
  });

  it('"Default = all" is true — executed, not taken from the prose', () => {
    /**
     * The description tells the model that omitting `include` is the safe choice. That promise has to
     * hold, or the advice makes things worse rather than better.
     */
    expect(emittedModules(generate().files).length).toBeGreaterThan(0);
    expect(description.toLowerCase()).toContain('default = ');
  });
});

describe('generate_game_3d specifically', () => {
  it('the exported module list and the generated files agree', () => {
    /**
     * GAME_3D_MODULES is what the rest of the codebase reasons about; the files are what a user gets.
     * They are two lists that must not drift apart either.
     */
    expect([...GAME_3D_MODULES].sort()).toEqual(emittedModules(generateGame3D().files));
  });

  it('warns what narrowing costs — naming the modules is not enough on its own', () => {
    /**
     * A model optimising for a small diff will narrow the list unless it is told the price. This is the
     * sentence that stops "include: [renderer, lighting]" looking like a tidy choice.
     */
    const def = defaultToolCatalog().find((t) => t.name === 'generate_game_3d');
    const schema = def!.input_schema as { properties?: { include?: { description?: string } } };
    const described = String(schema.properties?.include?.description ?? '').toLowerCase();
    expect(described).toMatch(/flat|near-black/);
  });
});
