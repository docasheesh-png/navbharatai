/**
 * A "CONTINUE" TURN MAY FINISH WHAT THE LAST TURN STARTED (build reports #2527–#2530, 2026-11-25).
 *
 * The user asked for a gun that fires. One turn wrote src/game/features/gun-fire.ts (on APIs that do not exist) and never
 * listed it; the user typed "continue"; the growth guard refused both the rewrite and the edit of gun-fire.ts —
 * "the feature "gun-fire" was rewritten, and the request is not about it" — because it judged the edit against the one word
 * "continue", and because it locked a file nothing in the game ran. The builder could only leave it broken or write a second
 * gun beside it (it did: shoot.ts).
 *
 * Two roots, both closed in growthGuard.ts:
 *   1. featureInPlay — a feature file no file of the project imports at the start of the turn is unfinished work, never a
 *      working part: the guard does not lock it. A LISTED feature stays protected exactly as before.
 *   2. growthRequestFor — on a continuation the guard reads the message AND the request it continues.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { growthVerdict, featureInPlay, growthRequestFor, growthRestores } from '../src/server/AgentV3/growthGuard';

const INDEX = "import type { GameFeature } from '../play/features';\nimport police from './police';\nexport const FEATURES: GameFeature[] = [police];\n";
const POLICE = "export default defineFeature({ id: 'police', setup() {}, update() {} });\n";
const GUN_BROKEN = "import { setWorldBlocker } from '../three/collision';\nexport default defineFeature({ id: 'gun-fire', setup() {}, update() {} });\n";
const GUN_FIXED = "export default defineFeature({ id: 'gun-fire', setup() {}, update(ctx) { weapon.update(1 / 60, ctx.input.isDown('attack'), m, a, p); } });\n";
const START = { 'src/game/features/index.ts': INDEX, 'src/game/features/police.ts': POLICE, 'src/game/features/gun-fire.ts': GUN_BROKEN };

describe('🔴 the #2530 turn: "continue" on a half-built gun', () => {
  it('the unlisted gun-fire.ts can be finished — at the write and at the end of the turn', () => {
    expect(featureInPlay('gun-fire', START)).toBe(false);
    expect(growthVerdict({ path: 'src/game/features/gun-fire.ts', before: GUN_BROKEN, after: GUN_FIXED, request: 'continue', filesAtTurnStart: START }).allow).toBe(true);
    expect(growthRestores({ filesAtTurnStart: START, now: { 'src/game/features/gun-fire.ts': GUN_FIXED }, request: 'continue' })).toEqual([]);
  });
  it('a LISTED feature is still protected from a request about something else', () => {
    expect(featureInPlay('police', START)).toBe(true);
    const v = growthVerdict({ path: 'src/game/features/police.ts', before: POLICE, after: POLICE + '// x', request: 'continue', filesAtTurnStart: START });
    expect(v.allow).toBe(false);
    expect(growthRestores({ filesAtTurnStart: START, now: { 'src/game/features/police.ts': '' }, request: 'continue' }).map((r) => r.path)).toEqual(['src/game/features/police.ts']);
  });
  it('a feature imported by ANOTHER feature (not the list) is in play too — a dynamic import counts', () => {
    expect(featureInPlay('gun-fire', { ...START, 'src/game/features/shoot.ts': "import fire from './gun-fire';" })).toBe(true);
    expect(featureInPlay('gun-fire', { ...START, 'src/game/features/shoot.ts': "const m = await import('./gun-fire.ts');" })).toBe(true);
    // A name that only CONTAINS the id is not an import of it.
    expect(featureInPlay('gun', { ...START, 'src/game/features/shoot.ts': "import fire from './gun-fire';" })).toBe(false);
  });
});

describe('the continued request is read with the message', () => {
  it('"continue" carries the request it continues; a message that names its own work stands alone', () => {
    expect(growthRequestFor('continue', 'gun se goli chalni chahiye')).toBe('continue\ngun se goli chalni chahiye');
    expect(growthRequestFor('police hatao', 'police hatao')).toBe('police hatao');
    expect(growthRequestFor('continue', '')).toBe('continue');
  });
  it('🔒 both locks in the route read it', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('dispatcher.setGrowthBaseline(projectFilesAtTurnStart, growthRequestFor(prompt, checksRequest))');
    expect(route).toContain('enforceGrowthAtTurnEnd({ filesAtTurnStart: projectFilesAtTurnStart, request: growthRequestFor(prompt, checksRequest),');
    const dispatcher = readFileSync(join(__dirname, '../src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(dispatcher).toContain('known: this.growthKnown, filesAtTurnStart: this.growthBaseline });');
  });
});
