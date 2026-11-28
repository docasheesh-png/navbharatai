// 🪷 PONDS ASKED FOR ARE PLACED, AND THE NOTE SAYS WHAT WAS REALLY PLACED (2026-11-28, follow-up to #4628).
//
// Two defects, one report: after #4627's stricter pond-vs-road rule a plan for 3 ponds on the 5 km loop map placed 0, and the build note
// still said "water: 3 ponds — APPLIED", because "applied" was read from the world's SOURCE (it reads options.water.ponds), never from
// what it built. Its siblings told the same lie: "a ring of mountains — APPLIED" on a LOOPING map that has no edge, a road style on a
// map wider than 25 km, colonies with no plots.
//   1. Placement: a town's talab now goes in the middle of a block (or half way to a corner), sized to keep POND_CLEAR from every kerb,
//      tried before random points; the "dry land" margin scales with the map's heights (it was an absolute 1 m on a map whose every
//      height is 0.07 of the reference world's). Ponds are placed before the colonies, which build round them.
//   2. Honesty: the robot-check worker measures the built world and the note says it ("2 asked, 0 placed — …", "NOT BUILT: loops").
import { describe, it, expect, vi } from 'vitest';
import { generateAthreeMap } from '../src/server/lib/athreeMap/AthreeMapGenerator';
import { applyMapPlanToFiles, measuredMapNote, planAthreeMap } from '../src/server/lib/athreeMap/mapPlanWiring';
import { loadEmittedAthree, runRobotChecksOnFiles } from '../src/server/lib/athreeMap/mapRobotRun';

vi.setConfig({ testTimeout: 240000 });

function game(prompt: string) {
  const plan = planAthreeMap(prompt);
  const out = applyMapPlanToFiles(generateAthreeMap(undefined, plan.choice).files, plan, plan.choice);
  return { plan, out, A: loadEmittedAthree(out.files) as any };
}

/** Every pond really carved: water at its centre, no road anywhere on its water or bank, no colony plot reaching into its bank. */
function checkPonds(w: any) {
  const plots = w.colonies().plots as Array<{ x: number; z: number; corners: Array<{ x: number; z: number }> }>;
  for (const p of w.ponds()) {
    expect(w.waterAt(p.x, p.z), `pond ${p.id} has water`).not.toBeNull();
    for (let r = 0; r <= p.radius * 1.35; r += 3) for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      expect(w.roadAt(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r), `road on pond ${p.id}`).toBeNull();
    }
    for (const q of plots) for (const c of [q, ...q.corners]) expect(Math.hypot(c.x - p.x, c.z - p.z), `plot on pond ${p.id}`).toBeGreaterThan(p.radius * 1.35);
  }
}

describe('3 ponds asked → 3 placed, off the roads and the plots', () => {
  const cases: Array<[string, string, number[]]> = [
    ['the 5 km loop map', 'pahaadon se ghira 5 km ka shooter jisme 3 talaab ho', [1, 7, 11, 42]],
    ['a 2.2 km grid town', 'open world game jisme 3 talaab ho', [1, 7, 42, 90551631]],
  ];
  for (const [what, prompt, seeds] of cases) {
    it(what, () => {
      const { plan, A } = game(prompt);
      expect(plan.water.ponds).toBe(3);
      for (const seed of seeds) {
        const w = A.createAthreeMap({ seed, profile: 'open-world' }).world;
        expect(w.ponds().length, `seed ${seed}`).toBe(3);
        checkPonds(w);
      }
    });
  }
});

describe('the note says what the world MEASURABLY built', () => {
  it('3 ponds placed is said with the count; the loop map\'s asked edge is NOT BUILT, with why', () => {
    const { out } = game('pahaadon se ghira 5 km ka shooter jisme 3 talaab ho');
    const run = runRobotChecksOnFiles(out.files, 'open-world', [11]);
    expect(run.measured).toMatchObject({ ponds: 3, boundary: 'none' });
    const note = measuredMapNote(out, run.measured);
    expect(note).toMatch(/water: 3 ponds — APPLIED \(measured: 3 ponds placed\)/);
    expect(note).toMatch(/boundary: a ring of mountains \(asked for\) — NOT BUILT \(measured: this map loops round/);
  });

  it('more ponds than the town has room for: "N asked, M placed", never APPLIED', () => {
    const { out } = game('open world game jisme 40 talaab ho');
    const run = runRobotChecksOnFiles(out.files, 'open-world', [7]);
    const placed = run.measured!.ponds;
    expect(placed).toBeLessThan(40);
    expect(measuredMapNote(out, run.measured)).toMatch(new RegExp(`water: 40 ponds — (ONLY PARTLY BUILT|NOT BUILT) \\(measured: ponds: 40 asked, ${placed} placed`));
  });

  it('without a measurement, no layer the world merely reads is called APPLIED', () => {
    const { out } = game('open world game jisme 3 talaab ho');
    expect(out.note).not.toMatch(/water: [^\n]*— APPLIED/);
    expect(out.note).toMatch(/water: 3 ponds — the world reads it, but what it built was not measured/);
  });
});
