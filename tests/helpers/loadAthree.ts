// Loads the EMITTED Athree map modules the way a game would use them: transpile each emitted TypeScript file and run it, resolving
// its relative imports among the emitted files. The tests run the generated code, not a copy of it.
import ts from 'typescript';
import { generateAthreeMap } from '../../src/server/lib/athreeMap/AthreeMapGenerator';

const DIR = 'src/game/athree/';

export function loadAthree(include?: string[], choiceOrExclusions?: {archetype:any;sizeKm:number} | null | readonly string[], excludedModules: readonly string[] = []): Record<string, any> {
  const files = generateAthreeMap(include, choiceOrExclusions, excludedModules).files;
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
    // eslint-disable-next-line no-new-func
    new Function('exports', 'require', js)(exports, req);
    return exports;
  };
  return load('index');
}
