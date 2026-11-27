// 🤖 THE ROBOT CHECKS, RUN AT BUILD TIME on the map that is about to be written (admin 2026-11-27, wave 1 part 1).
//
// The checks themselves are emitted into the game (athreeMapCheckSource.ts → src/game/athree/mapChecks.ts) so the game can measure
// its own map with the seed it chooses at runtime. Here the SAME emitted code runs once on the server, on the exact files the build
// writes, so the build notes carry a real verdict instead of a promise: spawns on dry land, nothing under the ground, the road graph in
// one piece, the boundary closed. It is measured on fixed sample seeds (the game's own seed is checked in the game), and it takes well
// under a second on every map size tested (the roads are built region by region, so a 1000 km map costs what a 20 km one does).
//
// The emitted modules are OUR code (the files this build is writing), transpiled and run the way tests/helpers/loadAthree.ts runs
// them — never anything a user typed. Any crash is caught and reported as "could not run", never as a pass.

import ts from 'typescript';
import type { AthreeProfile } from './AthreeMapGenerator';

const DIR = 'src/game/athree/';

/** Load the emitted Athree modules from a file set: transpile each and resolve its relative imports among the set. */
export function loadEmittedAthree(files: Readonly<Record<string, string>>, entry = 'index'): Record<string, unknown> {
  const cache = new Map<string, Record<string, unknown>>();
  const load = (name: string): Record<string, unknown> => {
    const hit = cache.get(name);
    if (hit) return hit;
    const source = files[`${DIR}${name}.ts`];
    if (!source) throw new Error(`athree module not emitted: ${name}`);
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const exports: Record<string, unknown> = {};
    cache.set(name, exports);
    const req = (id: string): unknown => {
      if (id.startsWith('./')) return load(id.slice(2));
      throw new Error(`unexpected import in an Athree module: ${id}`);
    };
    // Our own emitted module (see the header): the same evaluation the Athree tests use.
    // eslint-disable-next-line no-new-func
    new Function('exports', 'require', js)(exports, req);
    return exports;
  };
  return load(entry);
}

export interface RobotCheckLine { id: string; applicable: boolean; ok: boolean; detail: string }
export interface RobotRun { ran: boolean; seeds: number[]; ok: boolean; results: Array<RobotCheckLine & { seed: number }>; error?: string }

export const ROBOT_SAMPLE_SEEDS = [1, 7] as const;

/** Run the emitted robot checks on the emitted world, for each sample seed. Never throws. */
export function runRobotChecksOnFiles(files: Readonly<Record<string, string>>, profile: AthreeProfile, seeds: readonly number[] = ROBOT_SAMPLE_SEEDS): RobotRun {
  try {
    const index = loadEmittedAthree(files) as { createAthreeMap?: (o: Record<string, unknown>) => { world: unknown } };
    const checks = loadEmittedAthree(files, 'mapChecks') as { runMapChecks?: (w: unknown) => { results: RobotCheckLine[] } };
    if (typeof index.createAthreeMap !== 'function' || typeof checks.runMapChecks !== 'function') {
      return { ran: false, seeds: [...seeds], ok: false, results: [], error: 'the emitted map or its checks have no entry point' };
    }
    const results: RobotRun['results'] = [];
    for (const seed of seeds) {
      const map = index.createAthreeMap({ seed, profile });
      for (const r of checks.runMapChecks(map.world).results) results.push({ ...r, seed });
    }
    return { ran: true, seeds: [...seeds], ok: results.every((r) => r.ok), results };
  } catch (error) {
    return { ran: false, seeds: [...seeds], ok: false, results: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** The build-note lines for a run: every failure named, every check that does not apply said so, a crash said as a crash. */
export function describeRobotRun(run: RobotRun): string {
  if (!run.ran) return `ROBOT CHECKS (build time): could not run (${run.error ?? 'unknown error'}). Nothing was verified; do not claim the map passed them.`;
  const lines = [`ROBOT CHECKS (build time, sample seeds ${run.seeds.join(' and ')}): ${run.ok ? 'every check passed' : 'FAILED — say so to the user, do not hide it'}.`];
  const byId = new Map<string, Array<RobotCheckLine & { seed: number }>>();
  for (const r of run.results) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
  for (const [id, rs] of byId) {
    const failed = rs.filter((r) => !r.ok);
    if (failed.length) lines.push(`  - ${id}: FAILED — ${failed.map((r) => `seed ${r.seed}: ${r.detail}`).join(' ')}`);
    else if (rs.every((r) => !r.applicable)) lines.push(`  - ${id}: does not apply — ${rs[0].detail}`);
    else lines.push(`  - ${id}: passed — ${rs.find((r) => r.applicable)?.detail ?? rs[0].detail}`);
  }
  return lines.join('\n');
}
