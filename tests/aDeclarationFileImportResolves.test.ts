// 🔴 AN IMPORT OF A .d.ts FILE RESOLVES (failedbr #2399, b821cef6, 2026-11-16).
//
// A PDF viewer imported its types from '../types/pdf' with src/types/pdf.d.ts on disk. tsc passed and the app rendered,
// but the readiness resolver never tried `.d.ts` and reported "3 unresolved import(s) — the build will fail", which forced
// an unfinished-resume; the user pressed Stop during it.
// Reversion: drop the two `.d.ts` candidates from localImportCandidates and the first test fails.

import { describe, it, expect } from 'vitest';
import { resolveLocalImport } from '../src/server/AgentV3/ArchitectureAnalysis';

const FILES = new Set(['src/types/pdf.d.ts', 'src/context/PDFContext.tsx', 'src/hooks/usePDFLoader.ts', 'src/components/PDFViewer.tsx', 'src/lib/index.d.ts']);

describe('declaration files are local imports', () => {
  it('#2399: the three report imports resolve to src/types/pdf.d.ts', () => {
    for (const from of ['src/context/PDFContext.tsx', 'src/hooks/usePDFLoader.ts', 'src/components/PDFViewer.tsx']) {
      expect(resolveLocalImport(from, '../types/pdf', FILES), from).toBe('src/types/pdf.d.ts');
    }
    expect(resolveLocalImport('src/App.tsx', './lib', FILES)).toBe('src/lib/index.d.ts');
  });
  it('a missing module is still unresolved', () => {
    expect(resolveLocalImport('src/App.tsx', './types/missing', FILES)).toBeNull();
  });
});
