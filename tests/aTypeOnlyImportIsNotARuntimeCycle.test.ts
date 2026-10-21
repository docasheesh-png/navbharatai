// Autopsy 1d3ff0d5 (2026-10-21): a learning app whose 14 screens each wrote `import type { AppContextType }
// from '../App'` was reported as having 18 import cycles; Readiness priced each at 8 points, the score hit
// 0/100, and a working app that had rendered 7 minutes in was handed back as unfinished. CLASS: a
// compile-time-only edge counted as a runtime cycle. This file pins the class in BOTH cycle detectors and in
// the readiness number that consumed them.
import { describe, it, expect } from 'vitest';
import { WorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';
import { analyzeArchitecture } from '../src/server/AgentV3/ArchitectureAnalysis';
import { findCircularDependencies } from '../src/server/AgentV3/ImportExportAnalysis';
import { assessReadiness } from '../src/server/AgentV3/Readiness';
import { typeOnlyImportSpecs } from '../src/server/AgentV3/typeOnlyImports';

const SCREENS = ['Login', 'Dashboard', 'Courses', 'Fees', 'Progress', 'Lectures'];

function kbsApp(screenImport: (name: string) => string): Record<string, string> {
  const files: Record<string, string> = {
    'src/App.tsx': `${SCREENS.map((s) => `import ${s}Screen from './screens/${s}Screen';`).join('\n')}\n`
      + 'export interface AppContextType { role: string }\nexport default function App() { return null; }\n',
  };
  for (const s of SCREENS) {
    files[`src/screens/${s}Screen.tsx`] = `${screenImport(s)}\nexport default function ${s}Screen(p: { ctx: AppContextType }) { return null; }\n`;
  }
  return files;
}

const graphOf = (files: Record<string, string>) => {
  const mem = new WorkspaceMemory();
  for (const [f, c] of Object.entries(files)) mem.indexFile(f, c);
  return mem.graph();
};

describe('a type-only import is not an edge of a runtime import cycle', () => {
  const typeFiles = kbsApp(() => "import type { AppContextType } from '../App';");
  const valueFiles = kbsApp(() => "import { AppContextType } from '../App';");

  it('the real report shape: screens import the context TYPE from App — no cycle in the architecture analysis', () => {
    expect(analyzeArchitecture(graphOf(typeFiles)).cycles).toEqual([]);
  });
  it('… and none in the integrity-check detector that raised INTEGRITY_CIRCULAR_DEP', () => {
    expect(findCircularDependencies(typeFiles)).toEqual([]);
  });
  it('the readiness score is not cratered by them (it was 0/100 with 18 cycles)', () => {
    const r = assessReadiness(analyzeArchitecture(graphOf(typeFiles)), []);
    expect(r.warnings.join(' ')).not.toMatch(/import cycle/);
    expect(r.score).toBe(100);
    expect(r.ready).toBe(true);
  });
  it('a REAL runtime cycle (value import) is still found by both detectors', () => {
    expect(analyzeArchitecture(graphOf(valueFiles)).cycles.length).toBe(SCREENS.length);
    expect(findCircularDependencies(valueFiles).length).toBe(SCREENS.length);
  });
  it('a file that imports BOTH the type and a value from the same module keeps its edge', () => {
    const files = kbsApp(() => "import type { AppContextType } from '../App';\nimport { somethingElse } from '../App';");
    expect(findCircularDependencies(files).length).toBe(SCREENS.length);
    expect(analyzeArchitecture(graphOf(files)).cycles.length).toBe(SCREENS.length);
  });
  it('a type-only import must still RESOLVE — a missing file is still an unresolved import', () => {
    const g = graphOf({ 'src/a.ts': "import type { X } from './missing';\nexport const a = 1;\n" });
    expect(analyzeArchitecture(g).unresolvedImports.length).toBe(1);
  });
  it('a type-only import still counts the target as used (it is not reported as an orphan)', () => {
    const g = graphOf({
      'src/App.tsx': "import type { Props } from './Card';\nexport default function App() { return null; }\n",
      'src/Card.tsx': 'export interface Props { a: string }\nexport function Card() { return null; }\n',
    });
    expect(analyzeArchitecture(g).orphanComponents).toEqual([]);
  });
  it('helper: only statement-level type imports/exports count; inline `{ type A }`, dynamic, require and side-effect imports are runtime', () => {
    const s = typeOnlyImportSpecs([
      "import type { A } from './a';", "export type { B } from './b';", "import type C from './c';",
      "import { type D } from './d';", "import('./e');", "import './f';", "const g = require('./g');",
      "import type { H } from './h';", "import { h } from './h';",
    ].join('\n'));
    expect([...s].sort()).toEqual(['./a', './b', './c']);
  });
  it('helper: a semicolon-free `export type { A }` never swallows the NEXT line\'s real import', () => {
    const s = typeOnlyImportSpecs("export type { A }\nimport Z from './z'\n");
    expect(s.has('./z')).toBe(false);
  });
});

describe('real cycles stay advisory: they can never zero the readiness score by themselves', () => {
  it('18 genuine runtime cycles cost at most 3 cycles of points and do not trip the score-floor blocker', () => {
    const arch = { fileCount: 19, edgeCount: 36, cycles: Array.from({ length: 18 }, (_, i) => [`a${i}`, `b${i}`, `a${i}`]),
      unresolvedImports: [], layeringViolations: [], nodeBuiltinsInFrontend: [], orphanComponents: [] };
    const r = assessReadiness(arch, []);
    expect(r.warnings.join(' ')).toMatch(/18 import cycle/); // still REPORTED in full
    expect(r.score).toBe(76);                                  // 100 − 3×8
    expect(r.ready).toBe(true);
  });
});
