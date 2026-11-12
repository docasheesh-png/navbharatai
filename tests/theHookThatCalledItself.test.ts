// Autopsy BR1959 (2026-11-09). Six hooks of a school app imported `fetchAttendanceRecords` (and friends) from
// ../utils/api and then, inside the hook, declared `const fetchAttendanceRecords = async () => { … await
// fetchAttendanceRecords() … }` — the hook's names came from the contract's return interface, which used the
// api's names. The local shadows the import: the "api call" is the wrapper calling ITSELF. `tsc` saw only a
// symptom (TS2345 `void`), and the full builder fixed the hooks one per turn for about four minutes.
// These hold the deterministic fix (fixSelfShadowedImports), where it runs, and the prompt rule.

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { fixSelfShadowedImports } from '../src/server/AgentV3/ImportExportReconcile';
import { endgameDeterministicPass } from '../src/server/AgentV3/EndgameRepair';
import { deterministicImportFixes, contractBlock, NO_SHADOWED_IMPORT_RULE } from '../src/server/AgentV3/SimpleBuilder';

const API = [
  "export interface AttendanceRecord { id: string; status: string }",
  "export const fetchAttendanceRecords = async (): Promise<AttendanceRecord[]> => { (globalThis as any).__apiCalls.push('fetch'); return [{ id: '1', status: 'present' }]; };",
  "export const createAttendanceRecord = async (a: Omit<AttendanceRecord, 'id'>): Promise<AttendanceRecord> => { (globalThis as any).__apiCalls.push('create'); return { ...a, id: '2' }; };",
  "export const deleteAttendanceRecord = async (id: string): Promise<boolean> => { (globalThis as any).__apiCalls.push('delete:' + id); return true; };",
  '',
].join('\n');

// The BR1959 hook, as captured (multi-line import, try/catch/finally wrappers), trimmed to three operations.
const HOOK = `import { useState } from 'react';
import type { AttendanceRecord } from '../utils/api';
import { 
  fetchAttendanceRecords, 
  createAttendanceRecord, 
  deleteAttendanceRecord 
} from '../utils/api';

export const useAttendance = () => {
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchAttendanceRecords = async () => {
    setError(null);
    try {
      const data = await fetchAttendanceRecords();
      setAttendanceRecords(data);
    } catch (err) {
      setError('Failed to fetch attendance records');
    }
  };

  const createAttendanceRecord = async (attendance: Omit<AttendanceRecord, 'id'>): Promise<AttendanceRecord | null> => {
    setError(null);
    try {
      const newAttendance = await createAttendanceRecord(attendance);
      return newAttendance;
    } catch (err) {
      setError('Failed to create attendance record');
      return null;
    }
  };

  const removeRecord = async (id: string) => deleteAttendanceRecord(id);

  return { attendanceRecords, error, fetchAttendanceRecords, createAttendanceRecord, removeRecord };
};
`;

/**
 * Transpile both modules and RUN the hook with a stub `useState`: which api functions really ran. The stub's
 * setter stops a runaway recursion after 100 state writes (each wrapper call writes state first), so the
 * broken shape is MEASURED as a recursion instead of being left to overflow the stack.
 */
async function apiCallsWhenUsed(files: Record<string, string>): Promise<string[]> {
  const g = globalThis as any;
  g.__apiCalls = [];
  let writes = 0;
  const setter = () => { if (++writes > 100) throw new Error('RECURSION'); };
  const cache: Record<string, any> = {};
  const load = (path: string): any => {
    if (cache[path]) return cache[path];
    const js = ts.transpileModule(files[path], { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const module = { exports: {} as any };
    cache[path] = module.exports;
    const req = (spec: string) => (spec === 'react' ? { useState: (v: unknown) => [v, setter] } : load('src/utils/api.ts'));
    new Function('require', 'module', 'exports', js)(req, module, module.exports);
    return (cache[path] = module.exports);
  };
  const hook = load('src/hooks/useAttendance.ts').useAttendance();
  for (const run of [() => hook.fetchAttendanceRecords(), () => hook.createAttendanceRecord({ status: 'absent' }), () => hook.removeRecord('9')]) {
    writes = 0;
    try { await run(); } catch (e) { g.__apiCalls.push(String((e as Error).message)); }
    if (writes > 100) g.__apiCalls.push('RECURSION');
  }
  return [...new Set<string>(g.__apiCalls)];
}

const FILES = { 'src/utils/api.ts': API, 'src/hooks/useAttendance.ts': HOOK };

describe('a wrapper that shadows the import it wraps, and calls itself', () => {
  it('BR1959 as written: the two shadowing wrappers never reach the api — they recurse', async () => {
    expect(await apiCallsWhenUsed(FILES)).toEqual(['RECURSION', 'delete:9']);
  });

  it('fixed: the import is aliased, only the self-calls are pointed at it, and the api really runs', async () => {
    const r = await fixSelfShadowedImports(FILES);
    expect(r.fixes.map((f) => [f.name, f.alias, f.calls])).toEqual([
      ['fetchAttendanceRecords', 'importedFetchAttendanceRecords', 1],
      ['createAttendanceRecord', 'importedCreateAttendanceRecord', 1],
    ]);
    const hook = r.files['src/hooks/useAttendance.ts'];
    expect(hook).toContain('fetchAttendanceRecords as importedFetchAttendanceRecords,');
    expect(hook).toContain('const data = await importedFetchAttendanceRecords();');
    // the hook's own names, which callers read from its return value, are unchanged
    expect(hook).toContain('const fetchAttendanceRecords = async () => {');
    expect(hook).toContain('return { attendanceRecords, error, fetchAttendanceRecords, createAttendanceRecord, removeRecord };');
    // line count is unchanged: every other diagnostic's line number still holds
    expect(hook.split('\n').length).toBe(HOOK.split('\n').length);
    expect(await apiCallsWhenUsed(r.files)).toEqual(['fetch', 'create', 'delete:9']);
    expect(r.files['src/utils/api.ts']).toBe(API);
  });

  it('a recursion with a base case is an algorithm — never touched, whatever the imports say', async () => {
    const files = {
      'src/walk.ts': 'export function walk(n: number) { return n; }\n',
      'src/tree.ts': [
        "import { walk } from './walk';",
        'export function outer() {',
        '  function walk(n: number): number { return n <= 0 ? 0 : walk(n - 1); }',
        '  const poll = () => { if (Math.random() > 2) return; setTimeout(() => poll(), 10); };',
        '  return walk(3);',
        '}',
        '',
      ].join('\n'),
    };
    expect((await fixSelfShadowedImports(files)).fixes).toEqual([]);
    const guarded = { ...files, 'src/tree.ts': "import { walk } from './walk';\nexport const outer = () => {\n  const walk = (n: number): number => { if (n <= 0) return 0; return walk(n - 1); };\n  return walk(2);\n};\n" };
    expect((await fixSelfShadowedImports(guarded)).fixes).toEqual([]);
  });

  it('an import that is USED somewhere, a module-level twin, a package import — all left alone', async () => {
    const used = { 'src/api.ts': 'export const load = async () => 1;\n', 'src/a.ts': "import { load } from './api';\nexport const first = () => load();\nexport const h = () => { const load = async (): Promise<number> => load(); return load; };\n" };
    expect((await fixSelfShadowedImports(used)).fixes).toEqual([]);
    const pkg = { 'src/a.ts': "import { useState } from 'react';\nexport const h = () => { const useState = () => useState(); return useState; };\n" };
    expect((await fixSelfShadowedImports(pkg)).fixes).toEqual([]);
    const typeOnly = { 'src/api.ts': 'export interface Load { a: 1 }\n', 'src/a.ts': "import type { Load } from './api';\nexport const h = () => { const Load = (): unknown => Load(); return Load; };\n" };
    expect((await fixSelfShadowedImports(typeOnly)).fixes).toEqual([]);
  });

  it('the fast lane\'s deterministic fixes run it', async () => {
    const fast = await deterministicImportFixes(Object.entries(FILES).map(([path, content]) => ({ path, content })));
    expect(fast.files['src/hooks/useAttendance.ts']).toContain('await importedFetchAttendanceRecords()');
  });

  it('the endgame runs it BEFORE removing "unused" imports — the shadowed import is exactly what tsc calls unused', async () => {
    const oneLine = { 'src/utils/api.ts': API, 'src/hooks/useAttendance.ts': HOOK.replace(/import \{ \n  fetchAttendanceRecords, \n  createAttendanceRecord, \n  deleteAttendanceRecord \n\} from '\.\.\/utils\/api';/, "import { fetchAttendanceRecords, createAttendanceRecord, deleteAttendanceRecord } from '../utils/api';") };
    expect(oneLine['src/hooks/useAttendance.ts']).toContain("import { fetchAttendanceRecords, createAttendanceRecord, deleteAttendanceRecord } from '../utils/api';");
    const unused = ['fetchAttendanceRecords', 'createAttendanceRecord'].map((n) => ({ file: 'src/hooks/useAttendance.ts', line: 3, col: 10, code: 'TS6133', message: `'${n}' is declared but its value is never read.` }));
    const end = await endgameDeterministicPass(oneLine, unused as any);
    const hook = end.files['src/hooks/useAttendance.ts'];
    expect(hook).toContain("import { fetchAttendanceRecords as importedFetchAttendanceRecords, createAttendanceRecord as importedCreateAttendanceRecord, deleteAttendanceRecord } from '../utils/api';");
    expect(await apiCallsWhenUsed(end.files)).toEqual(['fetch', 'create', 'delete:9']);
  });

  it('the per-file prompt says it: never redeclare an imported name, alias the import', () => {
    expect(NO_SHADOWED_IMPORT_RULE).toContain('import { fetchCourses as apiFetchCourses }');
    expect(contractBlock('export interface A { x: number }', { path: 'src/types.ts', from: 'src/hooks/useA.ts' })).toContain(NO_SHADOWED_IMPORT_RULE);
    expect(contractBlock('export interface A { x: number }')).toContain(NO_SHADOWED_IMPORT_RULE);
  });
});
