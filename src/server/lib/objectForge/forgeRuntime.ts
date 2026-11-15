// OBJECT FORGE — the server side. Loads the SAME engine source that is written into a game (forgeEngineSource.ts) and the checker
// (forgeCheckSource.ts), so what the builder is shown (measurements, drawings) is produced by the code the game will run. There is no
// second implementation to drift from the first.
import ts from 'typescript';
import { FORGE_ENGINE } from './forgeEngineSource';
import { FORGE_CHECK } from './forgeCheckSource';
import { FORGE_CUSTOMISE } from './forgeCustomiseKitSource';
import { FORGE_BEHAVE } from './forgeBehaveSource';

import { FORGE_DIR, OBJECTS_DIR } from './forgePaths';

export { FORGE_DIR, OBJECTS_DIR };

export interface ObjectReport {
  id: string;
  nodes: number;
  meshes: number;
  triangles: number;
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  perMaterial: Record<string, number>;
  degenerateTriangles: number;
  clips: Record<string, { minY: number; maxY: number; reach: number }>;
  warnings: string[];
  views: { front: string[]; side: string[]; top: string[] };
  legend: string;
}

interface CheckModule {
  validateObjectSpec(input: unknown): { errors: string[]; warnings: string[]; spec: Record<string, unknown> | null };
  measureObject(spec: Record<string, unknown>): ObjectReport;
  formatReport(report: ObjectReport): string;
  FORGE_LIMITS: Record<string, number>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ForgeEngine = Record<string, any>;

let cached: { engine: ForgeEngine; check: CheckModule } | null = null;

function run(source: string, require: (id: string) => unknown): Record<string, unknown> {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports: Record<string, unknown> = {};
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', js)(exports, require);
  return exports;
}

/** The engine and the checker, evaluated once. Tests and the tool both come through here. */
export function loadForge(): { engine: ForgeEngine; check: CheckModule } {
  if (cached) return cached;
  const engine = run(FORGE_ENGINE, () => { throw new Error('the forge engine imports nothing'); }) as ForgeEngine;
  const check = run(FORGE_CHECK, (id) => {
    if (id === './forge') return engine;
    throw new Error('unexpected import in the forge checker: ' + id);
  }) as unknown as CheckModule;
  cached = { engine, check };
  return cached;
}

export function pascal(id: string): string {
  return id.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

/** The file that holds one object: its spec as data, and a function that makes it. Editing the spec changes the object. */
export function objectFileSource(spec: Record<string, unknown>): string {
  const id = String(spec.id);
  const name = String(spec.name).replace(/[\r\n*/]+/g, ' ');
  return [
    '// ' + name + ' — made by the Object Forge. The spec below is the object: change a size, a colour or a node and it changes.',
    "import { createObject, type ForgeObject, type ObjectSpec } from '../forge/forge';",
    "import { behave, type BehaviourOptions } from '../forge/behave';",
    '',
    '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
    'type ThreeLike = any;',
    '',
    'export const SPEC: ObjectSpec = ' + JSON.stringify(spec, null, 2) + ';',
    '',
    '/** Make the object: pass the three.js module, add result.group to the scene, call result.play("walk") and result.update(dt) each frame. */',
    'export function create' + pascal(id) + '(THREE: ThreeLike): ForgeObject {',
    '  return createObject(THREE, SPEC);',
    '}',
    '',
    '/** Make it move as its spec says (rails, wander, drive, orbit or static). Pass the world heightAt so it stands on the ground; call .update(dt) each frame. */',
    'export function behave' + pascal(id) + '(obj: ForgeObject, options?: BehaviourOptions) {',
    '  return behave(obj, SPEC.behaviour, options);',
    '}',
    '',
  ].join('\n');
}

export interface AuthorResult {
  ok: boolean;
  /** What to tell the builder: the report on success, the list of problems on failure. */
  text: string;
  errors: string[];
  report?: ObjectReport;
  files?: Record<string, string>;
  id?: string;
}

/** Validate, measure and (when valid) produce the files for an object spec the builder wrote. */
export function authorObject(input: unknown): AuthorResult {
  const { check } = loadForge();
  const v = check.validateObjectSpec(input);
  if (!v.spec) {
    return { ok: false, errors: v.errors, text: 'The object spec was NOT built. Fix these and call author_object again:\n' + v.errors.map((e) => '- ' + e).join('\n') };
  }
  const report = check.measureObject(v.spec);
  const id = String(v.spec.id);
  const files: Record<string, string> = {
    [FORGE_DIR + 'forge.ts']: FORGE_ENGINE,
    [FORGE_DIR + 'customise.ts']: FORGE_CUSTOMISE,
    [FORGE_DIR + 'behave.ts']: FORGE_BEHAVE,
    [OBJECTS_DIR + id + '.ts']: objectFileSource(v.spec),
  };
  return { ok: true, errors: [], report, files, id, text: check.formatReport({ ...report, warnings: [...v.warnings.map((w) => w), ...report.warnings] }) };
}

/** The engine file alone (what a game needs once, however many objects it has). */
export function forgeKitFiles(): Record<string, string> {
  return { [FORGE_DIR + 'forge.ts']: FORGE_ENGINE, [FORGE_DIR + 'customise.ts']: FORGE_CUSTOMISE, [FORGE_DIR + 'behave.ts']: FORGE_BEHAVE };
}
