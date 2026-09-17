import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  WorkspaceMemory,
  warmIndexFiles,
  RESTORED_STUB,
} from '../src/server/AgentV3/WorkspaceMemory';

/**
 * 🔎 THE HOLLOW GRAPH, MEASURED BEFORE IT IS FILLED (open root cause #2, PROGRESS.md 2026-09-17).
 *
 * A cold resume (`restoreWorkspaceMemory`) indexes every previously-known file with a PLACEHOLDER,
 * because the snapshot stores paths and not content. That puts the file into `graph.files` — and
 * `warmIndexFiles` builds its `known` set from `graph.files` and skips what is already there. So a
 * restored file keeps EMPTY facts (no imports, no exports, no components, no routes) for the whole
 * build, and `recall`, `evaluate`, the architecture analysis and the readiness score all reason
 * about a project that looks to them like a list of blank files.
 *
 * ⚠️ THE TWO COMMENTS AT THE RESTORE SITE CONTRADICTED EACH OTHER, and the FALSE one is the one a
 * reader would act on: *"warmIndexFiles will fill them later"* sat directly above *"so warmIndexFiles
 * skips already-known files."* Only the second is true.
 *
 * 🔴 THE FIX IS DELIBERATELY NOT SHIPPED. Filling the graph moves a real build's verdict in BOTH
 * directions — a restored import can fire `unresolvedImport`, a 25-point hard blocker ⇒ `ready:false`
 * ⇒ `ok:false` ⇒ "working app or free" ⇒ ₹0 on an app that works; while the hollow graph makes every
 * component look un-imported, which is `PENALTY.orphanComponent` against every resumed build. Which
 * dominates has never been measured. These tests pin the MEASUREMENT and pin that behaviour did not
 * change, which is what lets the decision be made on a number instead of on an argument.
 */

describe('a restored file is tracked as a stub, and stops being one when real content arrives', () => {
  it('indexing with the placeholder marks it; indexing real content clears it', () => {
    const m = new WorkspaceMemory();
    m.indexFile('src/App.tsx', RESTORED_STUB);
    expect(m.restoredStubPaths()).toEqual(['src/App.tsx']);

    m.indexFile('src/App.tsx', "import { z } from './z';\nexport function App() { return null; }");
    expect(m.restoredStubPaths()).toEqual([]);
  });

  it('a normally-written file is never a stub', () => {
    const m = new WorkspaceMemory();
    m.indexFile('src/real.ts', 'export const x = 1;');
    expect(m.restoredStubPaths()).toEqual([]);
  });

  it('deleting a file drops it from the stub set too — no phantom blind spot', () => {
    const m = new WorkspaceMemory();
    m.indexFile('src/gone.tsx', RESTORED_STUB);
    m.removeFile('src/gone.tsx');
    expect(m.restoredStubPaths()).toEqual([]);
    expect(m.graph().files).not.toContain('src/gone.tsx');
  });

  it('the blind spot is real: a stub contributes NO facts at all', () => {
    const m = new WorkspaceMemory();
    m.indexFile('src/App.tsx', RESTORED_STUB);
    const g = m.graph();
    expect(g.files).toContain('src/App.tsx');        // it IS in the graph…
    expect(g.imports['src/App.tsx'] ?? []).toEqual([]); // …and tells the graph nothing.
    expect(g.components).toEqual([]);
    expect(g.routes).toEqual([]);
    expect(g.symbols).toEqual([]);
  });
});

describe('behaviour is UNCHANGED — the stub is measured, not filled', () => {
  const read = async (p: string) =>
    p === 'src/App.tsx' ? "import Button from './Button';\nexport function App() { return null; }" : 'export const y = 2;';

  it('warmIndexFiles still SKIPS a stubbed file — this is the defect, pinned as-is', () => {
    const m = new WorkspaceMemory();
    m.indexFile('src/App.tsx', RESTORED_STUB);
    return warmIndexFiles(m, ['src/App.tsx', 'src/Other.ts'], read).then((indexed) => {
      // If a future change starts filling stubs, THIS is the assertion that must be updated
      // deliberately — with the measurement in hand — rather than drifting.
      expect(indexed).toEqual(['src/Other.ts']);
      expect(m.restoredStubPaths()).toEqual(['src/App.tsx']);
      expect(m.graph().imports['src/App.tsx'] ?? []).not.toContain('./Button');
    });
  });

  it('a file the resume never knew about is indexed for real, exactly as before', async () => {
    const m = new WorkspaceMemory();
    const indexed = await warmIndexFiles(m, ['src/App.tsx'], read);
    expect(indexed).toEqual(['src/App.tsx']);
    expect(m.restoredStubPaths()).toEqual([]);
    expect(m.graph().imports['src/App.tsx'] ?? []).toContain('./Button');
  });

  it('a warm graph still costs zero reads', async () => {
    const m = new WorkspaceMemory();
    m.indexFile('src/App.tsx', 'export const a = 1;');
    let reads = 0;
    await warmIndexFiles(m, ['src/App.tsx'], async (p) => { reads += 1; return `// ${p}`; });
    expect(reads).toBe(0);
  });
});

/** ⚠️ REVERSION GUARD — reads CODE with comments stripped, so prose can neither satisfy nor defeat it. */
describe('the one writer and the one counter cannot drift apart on a string literal', () => {
  const strip = (t: string) => t.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const store = strip(readFileSync(join(__dirname, '../src/server/AgentV3/FirestoreWorkspaceMemoryStore.ts'), 'utf8'));
  const route = strip(readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8'));

  it('the restore site uses the shared constant, never its own copy of the text', () => {
    expect(store).toContain('mem.indexFile(file, RESTORED_STUB)');
    expect(store).not.toMatch(/indexFile\(file, ['"]\/\* restored \*\/['"]\)/);
  });

  it('the measurement reaches the admin report', () => {
    expect(route).toContain("code: 'GRAPH_RESTORED_STUBS'");
    expect(route).toContain('wsMem.restoredStubPaths()');
  });

  it('it is recorded as INFO, so it can never become a build\'s rootCause', () => {
    // `deriveRootCause` picks only from `severity !== 'info'`, on BOTH its passes. A measurement
    // recorded as a warning is how `TIME_TO_FIRST_CALL` once headlined a successful build.
    const at = route.indexOf("code: 'GRAPH_RESTORED_STUBS'");
    expect(at).toBeGreaterThan(-1);
    expect(route.slice(Math.max(0, at - 200), at)).toContain("severity: 'info'");
  });
});
