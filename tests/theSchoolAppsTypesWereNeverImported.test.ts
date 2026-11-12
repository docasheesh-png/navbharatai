// Autopsy BR1959 (2026-11-09). The fast lane's src/utils/api.ts used the contract's Student, Teacher, Course,
// ClassSchedule, AttendanceRecord, GradeRecord and FeeRecord as TYPES (`let students: Student[]`,
// `Promise<Student[]>`) and imported none of them: TS2304 on every one. Every deterministic pass skipped
// them, because `addMissingProjectImports` only knew value exports and value uses — so a paid repair and then
// the full builder were spent on a fix with exactly one right answer. These hold the type arm.

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { addMissingProjectImports } from '../src/server/AgentV3/ImportExportReconcile';
import { endgameDeterministicPass } from '../src/server/AgentV3/EndgameRepair';
import { deterministicImportFixes } from '../src/server/AgentV3/SimpleBuilder';

const NAMES = ['AttendanceRecord', 'ClassSchedule', 'Course', 'FeeRecord', 'GradeRecord', 'Student', 'Teacher'];
const TYPES = NAMES.map((n) => `export interface ${n} { id: string }`).join('\n') + '\nexport type Role = "admin" | "teacher";\n';
// The BR1959 shape: mock storage typed with contract types, and api helpers returning them.
const API = [
  '// Mock API utility functions for demonstration purposes',
  'const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));',
  ...NAMES.map((n) => `let store${n}: ${n}[] = [];`),
  ...NAMES.map((n) => `export const fetch${n}s = async (): Promise<${n}[]> => { await delay(1); return store${n}; };`),
  'export const createStudent = async (s: Omit<Student, "id">): Promise<Student> => ({ ...s, id: "x" });',
  '',
].join('\n');

/** Real `tsc` over the files (DOM + ES2020 libs): the codes it reports. */
function compileCodes(files: Record<string, string>): string[] {
  const root = '/virtual/';
  const options: ts.CompilerOptions = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'], types: [] };
  const host = ts.createCompilerHost(options);
  const orig = { getSourceFile: host.getSourceFile, fileExists: host.fileExists, readFile: host.readFile };
  const virt = (f: string) => (f.startsWith(root) ? files[f.slice(root.length)] : undefined);
  host.getSourceFile = (f, lang, ...rest) => { const v = virt(f); return v !== undefined ? ts.createSourceFile(f, v, lang) : orig.getSourceFile.call(host, f, lang, ...rest); };
  host.fileExists = (f) => virt(f) !== undefined || orig.fileExists.call(host, f);
  host.readFile = (f) => virt(f) ?? orig.readFile.call(host, f);
  const origDir = host.directoryExists?.bind(host);
  host.directoryExists = (d) => d.startsWith('/virtual') || (origDir ? origDir(d) : true);
  const program = ts.createProgram(Object.keys(files).map((p) => root + p), options, host);
  return ts.getPreEmitDiagnostics(program).map((d) => `TS${d.code}`);
}

describe('a contract type used and never imported gets `import type`', () => {
  it('BR1959: api.ts gets one `import type` of all seven contract types — and then compiles', async () => {
    const files = { 'src/types.ts': TYPES, 'src/utils/api.ts': API };
    expect(compileCodes(files).filter((c) => c === 'TS2304').length).toBeGreaterThanOrEqual(7);
    const r = await addMissingProjectImports(files);
    expect(r.added.map((a) => a.name).sort()).toEqual(NAMES);
    expect(r.files['src/utils/api.ts'].startsWith(`import type { ${NAMES.join(', ')} } from "../types";`)).toBe(true);
    expect(compileCodes(r.files)).toEqual([]);
    // the contract file itself is never touched
    expect(r.files['src/types.ts']).toBe(TYPES);
  });

  it('a name the TypeScript library already declares (Event) is imported only on the compiler\'s word', async () => {
    const files = { 'src/types.ts': 'export interface Event { id: string; title: string }\n', 'src/cal.ts': 'export const t = (e: Event) => e.title;\n' };
    expect((await addMissingProjectImports(files)).added).toEqual([]);
    const proven = await addMissingProjectImports(files, { unresolvedNames: ['Event'] });
    expect(proven.added.map((a) => a.statement)).toEqual(['import type { Event } from "./types";']);
  });

  it('a type parameter, a local declaration, an existing import, two owners — all left alone', async () => {
    const owner = { 'src/types.ts': 'export interface Student { id: string }\nexport interface Teacher { id: string }\n' };
    const cases: Record<string, string> = {
      'src/generic.ts': 'export function first<Student>(xs: Student[]): Student { return xs[0]; }\n',
      'src/local.ts': 'interface Student { name: string }\nexport const s: Student = { name: "a" };\n',
      'src/imported.ts': 'import type { Student } from "./types";\nexport const s: Student[] = [];\n',
      'src/valueOnly.ts': 'export const label = "Student";\nexport const Teacher = 1;\nexport const n = Teacher;\n',
    };
    const r = await addMissingProjectImports({ ...owner, ...cases });
    expect(r.added).toEqual([]);
    const twoOwners = { ...owner, 'src/other.ts': 'export interface Student { other: true }\n', 'src/use.ts': 'export const s: Student[] = [];\n' };
    expect((await addMissingProjectImports(twoOwners)).added).toEqual([]);
  });

  it('a declaration file is never made a module by an import', async () => {
    const r = await addMissingProjectImports({ 'src/types.ts': 'export interface Student { id: string }\n', 'src/global.d.ts': 'declare const roster: Student[];\n' });
    expect(r.added).toEqual([]);
  });

  it('a value AND a type use of one value-exported name still yields one plain import (the value arm wins)', async () => {
    const files = { 'src/model.ts': 'export class Student { id = "" }\n', 'src/use.ts': 'export const s: Student = new Student();\n' };
    const r = await addMissingProjectImports(files);
    expect(r.added.map((a) => a.statement)).toEqual(['import { Student } from "./model";']);
  });

  it('both lanes run it: the fast lane\'s deterministic fixes and the endgame pass', async () => {
    const files = { 'src/types.ts': TYPES, 'src/utils/api.ts': API };
    const fast = await deterministicImportFixes(Object.entries(files).map(([path, content]) => ({ path, content })));
    expect(fast.changes).toBeGreaterThanOrEqual(NAMES.length);
    expect(compileCodes(fast.files)).toEqual([]);
    const end = await endgameDeterministicPass(files, NAMES.map((n, i) => ({ file: 'src/utils/api.ts', line: 3 + i, col: 1, code: 'TS2304', message: `Cannot find name '${n}'.` })) as any);
    expect(end.changedPaths).toEqual(['src/utils/api.ts']);
    expect(compileCodes(end.files)).toEqual([]);
  });
});
