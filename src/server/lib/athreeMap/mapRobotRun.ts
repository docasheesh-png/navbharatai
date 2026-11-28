// 🤖 THE ROBOT CHECKS, RUN AT BUILD TIME on the map that is about to be written (admin 2026-11-27, wave 1 part 1).
//
// The checks themselves are emitted into the game (athreeMapCheckSource.ts → src/game/athree/mapChecks.ts) so the game can measure
// its own map with the seed it chooses at runtime. Here the SAME emitted code runs once on the server, on the exact files the build
// writes, so the build notes carry a real verdict instead of a promise: spawns on dry land, nothing under the ground, the road graph in
// one piece, the boundary closed. It is measured on a fixed sample seed (the game's own seed is checked in the game).
//
// ⚠️ It runs in a WORKER THREAD with a time budget, never on the server's main thread: measuring a 500 km world takes one to two
// seconds of CPU, and the main thread serves every other user. A run that does not finish in its budget is stopped and reported as
// "could not run", never as a pass.
//
// The emitted modules are OUR code (the files this build is writing), transpiled and run the way tests/helpers/loadAthree.ts runs
// them — never anything a user typed. The loader below is ONE implementation shared by the worker, the in-process run the tests use,
// and tests/helpers/loadAthree.ts.

import ts from 'typescript';
import { Worker } from 'node:worker_threads';
import { BoundedCache } from '../boundedCache';
import type { MapProfile as AthreeProfile } from './athreeMapLibrary';

/**
 * The loader and the runner as plain JavaScript (they must run inside a worker, which has no bundler): `loadEmitted(compile, files, entry)`
 * compiles each emitted module and resolves its relative imports among the set; `runChecks(compile, files, profile, seeds)` builds the
 * world for each seed and runs the emitted checks on it.
 */
export const ATHREE_RUNNER_SOURCE = String.raw`
function loadEmitted(compile, files, entry) {
  var DIR = 'src/game/athree/';
  var cache = new Map();
  function load(name) {
    var hit = cache.get(name);
    if (hit) return hit;
    var source = files[DIR + name + '.ts'];
    if (!source) throw new Error('athree module not emitted: ' + name);
    var js = compile(source);
    var exports = {};
    cache.set(name, exports);
    var req = function (id) {
      if (id.indexOf('./') === 0) return load(id.slice(2));
      throw new Error('unexpected import in an Athree module: ' + id);
    };
    new Function('exports', 'require', js)(exports, req);
    return exports;
  }
  return load(entry || 'index');
}
function runChecks(compile, files, profile, seeds) {
  try {
    var index = loadEmitted(compile, files, 'index');
    var checks = loadEmitted(compile, files, 'mapChecks');
    if (typeof index.createAthreeMap !== 'function' || typeof checks.runMapChecks !== 'function') {
      return { ran: false, seeds: seeds.slice(), ok: false, results: [], error: 'the emitted map or its checks have no entry point' };
    }
    var results = [];
    for (var i = 0; i < seeds.length; i++) {
      var map = index.createAthreeMap({ seed: seeds[i], profile: profile });
      var rs = checks.runMapChecks(map.world).results;
      for (var j = 0; j < rs.length; j++) results.push({ id: rs[j].id, applicable: rs[j].applicable, ok: rs[j].ok, detail: rs[j].detail, seed: seeds[i] });
    }
    return { ran: true, seeds: seeds.slice(), ok: results.every(function (r) { return r.ok; }), results: results };
  } catch (error) {
    return { ran: false, seeds: seeds.slice(), ok: false, results: [], error: error && error.message ? error.message : String(error) };
  }
}
`;

type Compile = (source: string) => string;
type LoadFn = (compile: Compile, files: Readonly<Record<string, string>>, entry?: string) => Record<string, unknown>;
type RunFn = (compile: Compile, files: Readonly<Record<string, string>>, profile: string, seeds: number[]) => RobotRun;
// Our own constant source (above), evaluated once — the same text the worker runs.
// eslint-disable-next-line no-new-func
const RUNNER = new Function(ATHREE_RUNNER_SOURCE + '\nreturn { loadEmitted: loadEmitted, runChecks: runChecks };')() as { loadEmitted: LoadFn; runChecks: RunFn };

/**
 * TypeScript → JavaScript, cached by source text. The Athree modules are constants (only config.ts carries the map's choice), so a
 * server transpiles each one once in its life (a few hundred milliseconds, the first time) and the worker never loads TypeScript.
 */
// About 25 module sources exist; config.ts varies per map choice, so the least-recently-used entries give way past 200.
const transpiled = new BoundedCache<string, string>({ maxEntries: 200 });
export function transpileAthreeModule(source: string): string {
  const hit = transpiled.get(source);
  if (hit !== undefined) return hit;
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  transpiled.set(source, js);
  return js;
}

/** Load the emitted Athree modules from a file set: transpile each and resolve its relative imports among the set. */
export function loadEmittedAthree(files: Readonly<Record<string, string>>, entry = 'index'): Record<string, unknown> {
  return RUNNER.loadEmitted(transpileAthreeModule, files, entry);
}

export interface RobotCheckLine { id: string; applicable: boolean; ok: boolean; detail: string }
export interface RobotRun { ran: boolean; seeds: number[]; ok: boolean; results: Array<RobotCheckLine & { seed: number }>; error?: string }

export const ROBOT_SAMPLE_SEEDS: readonly number[] = [1];
/** The most a build-time run may take before it is stopped (a 500 km world takes about two seconds). */
export const ROBOT_BUDGET_MS = 8000;

/** Run the emitted robot checks on the emitted world, in this thread (tests). Never throws. */
export function runRobotChecksOnFiles(files: Readonly<Record<string, string>>, profile: AthreeProfile, seeds: readonly number[] = ROBOT_SAMPLE_SEEDS): RobotRun {
  return RUNNER.runChecks(transpileAthreeModule, files, profile, [...seeds]);
}

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
${ATHREE_RUNNER_SOURCE}
let result;
try { result = runChecks(function (js) { return js; }, workerData.files, workerData.profile, workerData.seeds); }
catch (error) { result = { ran: false, seeds: workerData.seeds, ok: false, results: [], error: error && error.message ? error.message : String(error) }; }
parentPort.postMessage(result);
`;

/**
 * Run a script on the emitted Athree files in a worker thread, within a time budget, so the server's main thread is never blocked.
 * The script sees `workerData.files` already compiled to JavaScript (load them with `loadEmitted(function (js) { return js; }, …)`)
 * and posts ONE message. Never rejects: a worker that fails to start, crashes, posts something unusable or runs past its budget
 * resolves to `failed(reason)`. The ONE worker runner the robot checks and the map preview share.
 */
export function runAthreeScriptInWorker<T>(
  script: string,
  files: Readonly<Record<string, string>>,
  extra: Record<string, unknown>,
  budgetMs: number,
  failed: (error: string) => T,
  usable: (value: unknown) => value is T,
): Promise<T> {
  const budget = Math.max(100, budgetMs);
  return new Promise<T>((resolve) => {
    let worker: Worker;
    let compiled: Record<string, string>;
    try { compiled = Object.fromEntries(Object.entries(files).map(([p, src]) => [p, transpileAthreeModule(src)])); }
    catch (error) { resolve(failed('the map could not be compiled: ' + (error instanceof Error ? error.message : String(error)))); return; }
    try { worker = new Worker(script, { eval: true, workerData: { ...extra, files: compiled } }); }
    catch (error) { resolve(failed('the worker could not start: ' + (error instanceof Error ? error.message : String(error)))); return; }
    let settled = false;
    const finish = (value: T): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().catch(() => undefined);
      resolve(value);
    };
    const timer = setTimeout(() => finish(failed(`it did not finish within ${Math.round(budget / 100) / 10} s and was stopped`)), budget);
    worker.once('message', (value: unknown) => finish(usable(value) ? value : failed('the worker returned nothing usable')));
    worker.once('error', (error) => finish(failed('the worker crashed: ' + (error instanceof Error ? error.message : String(error)))));
    worker.once('exit', (code) => finish(failed(`the worker exited (code ${code}) without a result`)));
  });
}

/**
 * Run the robot checks in a worker thread, within a time budget, so the server's main thread is never blocked. Never rejects: a
 * worker that fails to start, crashes or runs past its budget resolves to a run that says it could not run.
 */
export function runRobotChecksInWorker(files: Readonly<Record<string, string>>, profile: AthreeProfile, options: { seeds?: readonly number[]; budgetMs?: number } = {}): Promise<RobotRun> {
  const seeds = [...(options.seeds ?? ROBOT_SAMPLE_SEEDS)];
  const failed = (error: string): RobotRun => ({ ran: false, seeds, ok: false, results: [], error: error.replace(/^the worker /, 'the check worker ') });
  const usable = (run: unknown): run is RobotRun => !!run && typeof run === 'object' && Array.isArray((run as RobotRun).results);
  return runAthreeScriptInWorker(WORKER_SOURCE, files, { profile, seeds }, options.budgetMs ?? ROBOT_BUDGET_MS, failed, usable);
}

/** The build-note lines for a run: every failure named, every check that does not apply said so, a crash said as a crash. */
export function describeRobotRun(run: RobotRun): string {
  if (!run.ran) return `ROBOT CHECKS (build time): could not run (${run.error ?? 'unknown error'}). Nothing was verified; do not claim the map passed them.`;
  const lines = [`ROBOT CHECKS (build time, sample seed${run.seeds.length === 1 ? '' : 's'} ${run.seeds.join(' and ')}; the game re-checks its own seed): ${run.ok ? 'every check passed' : 'FAILED — say so to the user, do not hide it'}.`];
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
