// A RENAMED FILE HAS ONE KEY IN THE PROJECT MAP (autopsy ce115e1f, 2026-09-30 — "Bus Simulator India").
//
// `codemod_rename` touched two files, and ts-morph's in-memory file system returned them ROOTED
// (`/src/hooks/useBusData.ts`). The dispatcher indexed those paths into the graph beside the seeder's
// `src/hooks/useBusData.ts`, so the graph held both. The slash twin resolved `../types` to
// `/src/types.ts` — no key — and a build whose `npm run build` had exited 0 reported
// "READINESS_BLOCKER — 2 unresolved import(s) — the build will fail", fed it back to the model as
// unfinished work, and told the user the app was not fully working.

import { describe, it, expect } from 'vitest';
import { WorkspaceMemory, graphKey } from '../src/server/AgentV3/WorkspaceMemory';
import { analyzeArchitecture } from '../src/server/AgentV3/ArchitectureAnalysis';
import { renameSymbol } from '../src/server/AgentV3/CodemodeExecutor';

const TYPES = 'export interface Bus { id: string }\n';
const HOOK = "import type { Bus } from '../types';\nexport function useBusData(): Bus[] { return []; }\n";

describe('the graph has one key shape, whoever writes to it', () => {
  it('a rooted path lands on the same key as the seeded one — no phantom unresolved import', () => {
    const mem = new WorkspaceMemory();
    mem.indexFile('src/types.ts', TYPES);
    mem.indexFile('src/hooks/useBusData.ts', HOOK);
    mem.indexFile('/src/hooks/useBusData.ts', HOOK); // what codemod_rename used to hand it
    expect(mem.knownFilePaths().sort()).toEqual(['src/hooks/useBusData.ts', 'src/types.ts']);
    expect(analyzeArchitecture(mem.graph()).unresolvedImports).toEqual([]);
  });

  it('removeFile forgets a file however its path is spelled', () => {
    const mem = new WorkspaceMemory();
    mem.indexFile('src/a.ts', 'export const a = 1;\n');
    mem.removeFile('./src/a.ts');
    expect(mem.knownFilePaths()).toEqual([]);
  });

  it('graphKey strips the root, a leading slash and ./, and never throws', () => {
    expect(graphKey('/src/a.ts')).toBe('src/a.ts');
    expect(graphKey('./src/a.ts')).toBe('src/a.ts');
    expect(graphKey('/home/user/workspace/src/a.ts')).toBe('src/a.ts');
    expect(graphKey('src\\a.ts')).toBe('src/a.ts');
    expect(graphKey('')).toBe('');
  });
});

describe('renameSymbol reports the paths it was given', () => {
  it('keeps the caller\'s path and the real "before"', async () => {
    const files = [
      { path: 'src/hooks/useBusData.ts', content: HOOK },
      { path: 'src/context/BusDataContext.tsx', content: "import { useBusData } from '../hooks/useBusData';\nexport const x = useBusData;\n" },
    ];
    const r = await renameSymbol(files, 'useBusData', 'useBuses');
    expect(r.ok).toBe(true);
    expect(r.changes.map((c) => c.path).sort()).toEqual(['src/context/BusDataContext.tsx', 'src/hooks/useBusData.ts']);
    for (const c of r.changes) expect(c.before).toBe(files.find((f) => f.path === c.path)!.content);
  });
});
