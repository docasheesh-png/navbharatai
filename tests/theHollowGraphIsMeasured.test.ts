import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  WorkspaceMemory,
  warmIndexFiles,
  RESTORED_STUB,
} from '../src/server/AgentV3/WorkspaceMemory';

/**
 * 🔎 THE HOLLOW GRAPH — MEASURED 2026-09-17, FILLED 2026-09-18 ON THE MEASUREMENT.
 *
 * A cold resume (`restoreWorkspaceMemory`) indexes every previously-known file with a PLACEHOLDER,
 * because the snapshot stores paths and not content. That put the file into `graph.files` — and
 * `warmIndexFiles` built its `known` set from `graph.files` and skipped what was already there. So a
 * restored file kept EMPTY facts (no imports, no exports, no components, no routes) for the whole
 * build, and `recall`, `evaluate`, the contract card, the architecture invariants and grounding
 * centrality all reasoned about a project that looked to them like a list of blank files.
 *
 * ⚠️ THE TWO COMMENTS AT THE RESTORE SITE CONTRADICTED EACH OTHER, and the FALSE one is the one a
 * reader would act on: *"warmIndexFiles will fill them later"* sat directly above *"so warmIndexFiles
 * skips already-known files."* The code did the second.
 *
 * ✅ THE FIX SHIPPED, AND THE NUMBER IS WHY. This header used to end "🔴 THE FIX IS DELIBERATELY NOT
 * SHIPPED … which dominates has never been measured." Report `2ec15a71` measured it on a real
 * free-tier user's edit: **30 of 31 files stubbed**, with the contract card holding no symbols, the
 * invariants down to "1 observed rule" and grounding at "3 files, ~211 tokens of a 4000 budget" —
 * after which the model rewrote `App.tsx` with its own `Item` interface although `types.ts` already
 * exported `PriceItem`, orphaning `data.ts` and creating a cycle. The build reported ok:true.
 *
 * The recorded worry — a filled import firing `unresolvedImport` (a 20-point blocker) ⇒ ₹0 on a
 * working app — was wrong twice: a file left unreached by `maxFiles` STAYS in `graph.files` as a stub
 * so imports to it still resolve (pinned below), and the readiness path that owns that penalty reads
 * the DURABLE project content rather than this graph — in that report its tool was never invoked.
 * The hollow graph was in fact producing the OPPOSITE false penalty, since a stub imports nothing and
 * so makes every component look un-imported. These tests now pin the FILL, and keep the measurement.
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

describe('the stub is FILLED now — the measurement came in and settled it', () => {
  const read = async (p: string) =>
    p === 'src/App.tsx' ? "import Button from './Button';\nexport function App() { return null; }" : 'export const y = 2;';

  /**
   * ⚠️ THIS CASE WAS INVERTED ON PURPOSE, 2026-09-18. It used to read "warmIndexFiles still SKIPS a
   * stubbed file — this is the defect, pinned as-is", and said in its own body: "If a future change
   * starts filling stubs, THIS is the assertion that must be updated deliberately — with the
   * measurement in hand — rather than drifting."
   *
   * The measurement arrived: report `2ec15a71`, a real free-tier user's edit, recorded
   * `GRAPH_RESTORED_STUBS` at **30 of 31 files** — and in the same report the three mechanisms that
   * read this graph to prevent a bad edit had all degraded together (contract card: no symbols;
   * invariants: "1 observed rule"; grounding: "3 files, ~211 tokens of a 4000 budget"). The model
   * then rewrote `App.tsx` with its own `Item` interface while `types.ts` already exported
   * `PriceItem`, orphaning `data.ts`. So the assertion is updated with the evidence, as instructed.
   */
  it('warmIndexFiles REFILLS a stubbed file — it is not a known file', async () => {
    const m = new WorkspaceMemory();
    m.indexFile('src/App.tsx', RESTORED_STUB);
    const indexed = await warmIndexFiles(m, ['src/App.tsx', 'src/Other.ts'], read);
    expect(indexed).toContain('src/App.tsx');
    expect(indexed).toContain('src/Other.ts');
    expect(m.restoredStubPaths()).toEqual([]);          // no blind spot left
    expect(m.graph().imports['src/App.tsx'] ?? []).toContain('./Button');
    expect(m.graph().components).toContain('App');       // the facts the card and invariants read
  });

  it('a file left UNREACHED by the cap keeps its stub, so imports to it still resolve', async () => {
    // The risk the earlier refusal named: a partial fill firing a false `unresolvedImport`. It cannot
    // — an unreached file stays in `graph.files`, so it is still a resolution target.
    const m = new WorkspaceMemory();
    m.indexFile('src/A.ts', RESTORED_STUB);
    m.indexFile('src/B.ts', RESTORED_STUB);
    await warmIndexFiles(m, ['src/A.ts', 'src/B.ts'], read, { maxFiles: 1 });
    expect(m.graph().files).toContain('src/B.ts');
    expect(m.restoredStubPaths()).toEqual(['src/B.ts']);
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
