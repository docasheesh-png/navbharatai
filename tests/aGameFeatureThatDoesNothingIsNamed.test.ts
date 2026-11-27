// A GAME FEATURE THAT DOES NOTHING IS NAMED (failedbr #2559–#2561, 2026-11-27). Asked to fix "characters sinking" — a kit
// fault it could not see — the builder registered src/game/features/groundFix.ts, a feature whose setup and update did
// nothing, and gunMechanics.ts of the same shape. hollowFeature.ts now reads that shape: the builder hears it on the write,
// the build report lists it, and the claim audit can contradict a summary that names it as delivered.
import { describe, it, expect } from 'vitest';
import { findHollowFeatures, hollowFeatureWriteNote, gameFeatureDoesNothing, hollowFeatureReport } from '../src/server/AgentV3/hollowFeature';

const GROUND_FIX = `import { defineFeature } from '../play/features';
import type { OpenWorld } from '../play/openWorld';
export default defineFeature<OpenWorld>({
  id: 'groundFix',
  about: ['ground', 'sink', 'jameen'],
  async setup(ctx, world) {
    // Ensure all characters stay on the ground
    console.log('ground fix active');
  },
  update(ctx, world, dt) {
    // ground contact is handled by the kit
  },
});
`;
const GUN_STUB = `import { defineFeature } from '../play/features';
export default defineFeature({ id: 'gunMechanics', about: ['gun'], setup: (ctx, world, api) => { return; }, update: (ctx, world, dt, api) => {} });
`;
const REAL = `import { defineFeature } from '../play/features';
export default defineFeature({ id: 'ammo', about: ['ammo'], setup(ctx) { ctx.hud?.show('ammo'); }, update(ctx, w, dt) { if (ctx.input.wasPressed('attack')) w.ammo--; } });
`;

describe('🎮 an empty game feature', () => {
  it('🔴 the reported shapes (groundFix.ts, gunMechanics.ts) are named; a real feature and the list are not', () => {
    expect(gameFeatureDoesNothing('src/game/features/groundFix.ts', GROUND_FIX)).toBe(true);
    expect(gameFeatureDoesNothing('src/game/features/gunMechanics.ts', GUN_STUB)).toBe(true);
    expect(gameFeatureDoesNothing('src/game/features/ammo.ts', REAL)).toBe(false);
    expect(gameFeatureDoesNothing('src/game/features/index.ts', GROUND_FIX)).toBe(false);
    expect(gameFeatureDoesNothing('src/components/groundFix.ts', GROUND_FIX)).toBe(false);   // only game features
    expect(gameFeatureDoesNothing('src/game/features/odd.ts', 'export default defineFeature(make())')).toBe(false);   // unknown shape: silent
  });
  it('the builder hears it on the write; the report lists it', () => {
    expect(hollowFeatureWriteNote('src/game/features/groundFix.ts', GROUND_FIX)).toMatch(/⛔ EMPTY GAME FEATURE — src\/game\/features\/groundFix\.ts: its setup and update hold no statement/);
    expect(hollowFeatureWriteNote('src/game/features/ammo.ts', REAL)).toBe('');
    const found = findHollowFeatures({ 'src/game/features/groundFix.ts': GROUND_FIX, 'src/game/features/ammo.ts': REAL });
    expect(found.map((h) => [h.kind, h.name])).toEqual([['game-feature', 'groundFix']]);
    expect(hollowFeatureReport(found)).toMatch(/game feature that does nothing: groundFix \(src\/game\/features\/groundFix\.ts\)/);
  });
});
