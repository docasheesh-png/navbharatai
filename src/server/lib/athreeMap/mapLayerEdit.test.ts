// ✏️ ONE LAYER BY CHAT (admin 2026-11-27, wave 2 part 2). Each of the admin's own phrases changes ONLY the layer it names — every other
// plan field and the SEED stay exactly as they were — and the rewritten config.ts is the old file with only the plan changed. Words that
// are not a request to change a map layer change nothing. What the world cannot build yet is said, not claimed. And through the turn
// itself: the file is rewritten, the user is shown the new picture with the change named, and the builder is told it is done.
import { describe, it, expect, vi } from 'vitest';
import { generateAthreeMap } from './AthreeMapGenerator';
import { applyMapPlanToFiles, planAthreeMap } from './mapPlanWiring';
import { mapLayerEditsIn, changeVerdict } from './mapLayerEdit';
import { readMapPlanFromConfig, rewriteMapPlanInConfig, type MapPlanData } from './mapPlanData';
import { appliedMapLayers } from './mapPlan';
import { mapPlanFromData } from './mapPlanData';
import { mapLayerEditAtTurnStart, ATHREE_CONFIG } from '../../AgentV3/buildPhases/mapLayerTurn';
import type { MapPreviewCard } from '../../../lib/mapPreview';

vi.setConfig({ testTimeout: 180000 });

const CONFIG = 'src/game/athree/config.ts';
const SEED = 424242;
function game(prompt: string) {
  const plan = planAthreeMap(prompt);
  const a = applyMapPlanToFiles(generateAthreeMap(undefined, plan.choice).files, plan, plan.choice, { seed: SEED, profile: 'open-world' });
  return { files: a.files, data: readMapPlanFromConfig(a.files[CONFIG])! };
}
const shooter = game('athree map par 5 km ka shooter game, do talab');
const island = game('4 km ka island shooter game');

/** Every field except the ones a change is allowed to touch must be equal. */
function onlyChanged(before: MapPlanData, after: MapPlanData, allowed: Array<keyof MapPlanData>) {
  for (const k of Object.keys(before) as Array<keyof MapPlanData>) if (!allowed.includes(k)) expect(after[k], `field ${k}`).toEqual(before[k]);
  expect(after.seed).toBe(SEED);
}

describe('the admin\'s phrases change only their layer, and keep the seed', () => {
  it('"yahan nadi ki jagah jheel karo" → water only: the river becomes a lake', () => {
    const start = { ...shooter.data, water: { ...shooter.data.water, rivers: 1 } };
    const v = mapLayerEditsIn('yahan nadi ki jagah jheel karo', start);
    expect(v.kind).toBe('changed');
    if (v.kind !== 'changed') return;
    expect(v.changes.map((c) => c.layer)).toEqual(['water']);
    expect(v.data.water).toEqual({ ...start.water, rivers: 0, lakes: start.water.lakes + 1 });
    onlyChanged(start, v.data, ['water']);
  });

  it('"colony badi karo" → density only: normal becomes dense', () => {
    const v = mapLayerEditsIn('colony badi karo', shooter.data);
    expect(v.kind === 'changed' && v.changes.map((c) => c.layer)).toEqual(['density']);
    if (v.kind === 'changed') { expect(v.data.density).toBe('dense'); onlyChanged(shooter.data, v.data, ['density']); }
  });

  it('"sadkein tedhi-medhi karo" → roads only: grid becomes organic', () => {
    const v = mapLayerEditsIn('sadkein tedhi-medhi karo', shooter.data);
    expect(v.kind === 'changed' && v.changes.map((c) => c.layer)).toEqual(['roadStyle']);
    if (v.kind === 'changed') { expect(v.data.roadStyle).toBe('organic'); onlyChanged(shooter.data, v.data, ['roadStyle']); }
  });

  it('"map 2 guna bada karo" → frame only: twice the area, the side times √2', () => {
    const v = mapLayerEditsIn('map 2 guna bada karo', shooter.data);
    expect(v.kind === 'changed' && v.changes.map((c) => c.layer)).toEqual(['frame']);
    if (v.kind === 'changed') {
      expect(v.frameChanged).toBe(true);
      expect(v.data.areaKm2).toBeCloseTo(shooter.data.areaKm2 * 2, 0);
      expect(v.data.sideKm).toBeCloseTo(shooter.data.sideKm * Math.SQRT2, 1);
      onlyChanged(shooter.data, v.data, ['areaKm2', 'sideKm']);
    }
  });

  it('"kinara pahaadon wala karo" → edge only, on a map that has an edge', () => {
    const v = mapLayerEditsIn('kinara pahaadon wala karo', island.data);
    expect(v.kind === 'changed' && v.changes.map((c) => c.layer)).toEqual(['boundary']);
    if (v.kind === 'changed') { expect(v.data.boundary).toBe('mountains'); onlyChanged(island.data, v.data, ['boundary']); }
  });

  it('English and Devanagari input are read the same way', () => {
    const en = mapLayerEditsIn('make the roads curvy', shooter.data);
    expect(en.kind === 'changed' && en.data.roadStyle).toBe('hill');
    const hi = mapLayerEditsIn('नदी की जगह झील करो', { ...shooter.data, water: { ...shooter.data.water, rivers: 1 } });
    expect(hi.kind === 'changed' && hi.data.water.lakes).toBe(shooter.data.water.lakes + 1);
    const ponds = mapLayerEditsIn('3 talaab daalo', shooter.data);
    expect(ponds.kind === 'changed' && ponds.data.water.ponds).toBe(3);
    const none = mapLayerEditsIn('talab hatao', shooter.data);
    expect(none.kind === 'changed' && none.data.water.ponds).toBe(0);
  });
});

describe('nothing changes on a guess', () => {
  for (const words of ['map kitna bada hai?', 'nadi ke upar pul banao', 'hero ka ghar bada karo', 'car ki speed badi karo', 'ghar ke andar jaana hai, darwaza kholo', 'shehar bada karo']) {
    it(`"${words}" is not a map layer change`, () => expect(mapLayerEditsIn(words, shooter.data).kind).toBe('none'));
  }

  it('an edge on a looping map is refused with the reason, never faked', () => {
    const v = mapLayerEditsIn('kinara pahaadon wala karo', shooter.data);
    expect(v.kind).toBe('refused');
    if (v.kind === 'refused') expect(v.reason).toMatch(/loops round at its edges/);
  });

  it('an open-world game\'s size belongs to its places: refused with the way to ask', () => {
    const v = mapLayerEditsIn('map 2 guna bada karo', shooter.data, { openWorld: true });
    expect(v.kind === 'refused' && v.reason).toMatch(/map 40 km x 40 km/);
  });
});

describe('the honest verdict per layer: what the world MEASURABLY built, never the source alone', () => {
  const worldSource = Object.entries(shooter.files).filter(([p]) => p !== CONFIG).map(([, s]) => s).join('\n');
  const applied = appliedMapLayers(worldSource, mapPlanFromData(shooter.data));
  const measured = { ponds: 3, rivers: 1, lakes: 0, boundary: 'none', roadStyle: 'grid', plots: 50, colonies: 4 };
  it('without a measurement nothing is claimed built', () => {
    const v = mapLayerEditsIn('colony badi karo', shooter.data);
    if (v.kind !== 'changed') throw new Error('expected a change');
    expect(changeVerdict(v.changes[0], applied, v.data)).toEqual({ built: false, why: expect.stringMatching(/could not be measured/) });
  });
  it('colonies: built when plots were laid, not when none were', () => {
    const v = mapLayerEditsIn('colony badi karo', shooter.data);
    if (v.kind !== 'changed') throw new Error('expected a change');
    expect(changeVerdict(v.changes[0], applied, v.data, measured).built).toBe(true);
    expect(changeVerdict(v.changes[0], applied, v.data, { ...measured, plots: 0, colonies: 0 })).toEqual({ built: false, why: expect.stringMatching(/no colony plots were laid/) });
  });
  it('ponds: "3 asked, 1 placed" is said with the numbers; a river turned into a lake is recorded (the world makes its own)', () => {
    const p = mapLayerEditsIn('3 talaab daalo', shooter.data);
    if (p.kind !== 'changed') throw new Error('expected a change');
    expect(changeVerdict(p.changes[0], applied, p.data, measured).built).toBe(true);
    expect(changeVerdict(p.changes[0], applied, p.data, { ...measured, ponds: 1 })).toEqual({ built: false, why: expect.stringMatching(/^ponds: 3 asked, 1 placed/) });
    const v = mapLayerEditsIn('nadi ki jagah jheel karo', { ...shooter.data, water: { ...shooter.data.water, rivers: 1 } });
    if (v.kind !== 'changed') throw new Error('expected a change');
    expect(changeVerdict(v.changes[0], applied, v.data, measured).built).toBe(false);
  });
  it('a road style the world did not lay (a map over 25 km keeps its village roads) is not built', () => {
    const v = mapLayerEditsIn('sadkein tedhi-medhi karo', shooter.data);
    if (v.kind !== 'changed') throw new Error('expected a change');
    expect(changeVerdict(v.changes[0], applied, v.data, { ...measured, roadStyle: 'organic' }).built).toBe(true);
    expect(changeVerdict(v.changes[0], applied, v.data, { ...measured, roadStyle: null })).toEqual({ built: false, why: expect.stringMatching(/wider than 25 km/) });
  });
});

describe('the rewrite keeps the file and changes only the plan', () => {
  it('a road change rewrites MAP_PLAN and the merged options, nothing else; the seed line stays', () => {
    const v = mapLayerEditsIn('sadkein tedhi-medhi karo', shooter.data);
    if (v.kind !== 'changed') throw new Error('expected a change');
    const before = shooter.files[CONFIG];
    const after = rewriteMapPlanInConfig(before, v.data, v.frameChanged)!;
    expect(after).not.toBeNull();
    const cut = before.indexOf('\n/** THE MAP PLAN');
    expect(after.slice(0, cut)).toBe(before.slice(0, cut));
    expect(readMapPlanFromConfig(after)).toEqual(v.data);
    expect(after).toContain(`Object.assign(MAP_OPTIONS, { seed: ${SEED} });`);
    expect(after).toContain('"roadStyle":"organic"');
  });

  it('a frame change rewrites MAP_OPTIONS\' size too', () => {
    const v = mapLayerEditsIn('map 2 guna bada karo', shooter.data);
    if (v.kind !== 'changed') throw new Error('expected a change');
    const after = rewriteMapPlanInConfig(shooter.files[CONFIG], v.data, true)!;
    expect(after).toMatch(new RegExp(`"sizeMeters": ${Math.round(v.data.sideKm * 1000)}`));
  });

  it('a plan edited by hand into another shape is not rewritten', () => {
    expect(rewriteMapPlanInConfig('export const MAP_OPTIONS: MapOptions = {};\n', shooter.data, false)).toBeNull();
  });
});

describe('the turn: rewritten by the platform, shown to the user, told to the builder', () => {
  function io(files: Record<string, string>, prompt: string, saved: Array<{ name: string; plan: MapPlanData }> = []) {
    const disk = { ...files };
    const cards: MapPreviewCard[] = [];
    const issues: string[] = [];
    return {
      disk, cards, issues,
      run: () => mapLayerEditAtTurnStart({
        prompt, filesAtTurnStart: files, read: async (p) => { if (!(p in disk)) throw new Error('ENOENT'); return disk[p]; },
        write: async (p, c) => { disk[p] = c; }, record: (i) => issues.push(i.code), showMap: (c) => cards.push(c), savedMaps: async () => saved,
      }),
    };
  }

  it('"sadkein tedhi-medhi karo": config rewritten, a changed picture shown, the builder told', async () => {
    const t = io(shooter.files, 'sadkein tedhi-medhi karo');
    const handoff = await t.run();
    expect(readMapPlanFromConfig(t.disk[ATHREE_CONFIG])!.roadStyle).toBe('organic');
    expect(readMapPlanFromConfig(t.disk[ATHREE_CONFIG])!.seed).toBe(SEED);
    expect(t.cards).toHaveLength(1);
    expect(t.cards[0].changed).toMatch(/^Changed only the roads: a smart-city grid with highways → random, winding old-town lanes\./);
    expect(t.cards[0].preview?.seed).toBe(SEED);
    expect(handoff).toMatch(/MAP LAYER — ALREADY DONE BY THE PLATFORM/);
    expect(handoff).toMatch(/Do NOT edit it/);
    expect(t.issues).toContain('MAP_LAYER_CHANGED');
  });

  it('a message that is not a map change leaves the file alone and shows nothing', async () => {
    const t = io(shooter.files, 'score board upar right me lagao');
    expect(await t.run()).toBe('');
    expect(t.disk[ATHREE_CONFIG]).toBe(shooter.files[ATHREE_CONFIG]);
    expect(t.cards).toHaveLength(0);
  });

  it('a saved map named on a game with a map puts that map on it, seed included', async () => {
    const saved = { ...island.data, seed: 777 };
    const t = io(shooter.files, 'Make an open world game on my saved map "Ganga Nagar".', [{ name: 'Ganga Nagar', plan: saved }]);
    const handoff = await t.run();
    const now = readMapPlanFromConfig(t.disk[ATHREE_CONFIG])!;
    expect(now.seed).toBe(777);
    expect(now.archetype).toBe('island');
    expect(t.disk[ATHREE_CONFIG]).toMatch(/"mode": "bounded"/);
    expect(handoff).toMatch(/saved map "Ganga Nagar"/);
    expect(t.cards[0].title).toBe('Your saved map "Ganga Nagar", from above');
  });
});
