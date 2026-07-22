import { describe, it, expect } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from './ToolDispatcher';
import { fileDocId, loadWorkspaceFiles, capPathsToDocLimit, isEssentialManifest, essentialManifestsToCarry } from './WorkspaceFileStore';
import { ensureViteReactFoundation } from './FrameworkFoundation';
import type { ToolUse } from './ClaudeClient';

const call = (name: string, input: Record<string, unknown>): ToolUse => ({ id: 't1', name, input });

/** In-memory sandbox so write_file/edit_file run end-to-end. */
class MemActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string) {
    const f = this.files.get(p);
    if (f === undefined) throw new Error(`ENOENT ${p}`);
    return f;
  }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

function dispatcherWithCapture(act: ActuatorPort, captured: Array<[string, string]>) {
  const onFileWrite = (path: string, content: string) => captured.push([path, content]);
  return new ToolDispatcher(act, 'ws-1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, onFileWrite);
}

describe('durable file capture (onFileWrite)', () => {
  it('captures the exact content of a write_file', async () => {
    const captured: Array<[string, string]> = [];
    const d = dispatcherWithCapture(new MemActuator(), captured);
    await d.dispatch(call('write_file', { path: 'src/App.tsx', content: 'export const App = () => null;' }));
    expect(captured).toEqual([['src/App.tsx', 'export const App = () => null;']]);
  });

  it('captures the POST-EDIT content of an edit_file', async () => {
    const captured: Array<[string, string]> = [];
    const act = new MemActuator();
    act.files.set('src/App.tsx', 'const title = "old";');
    const d = dispatcherWithCapture(act, captured);
    await d.dispatch(call('edit_file', { path: 'src/App.tsx', old_string: '"old"', new_string: '"new"' }));
    expect(captured).toEqual([['src/App.tsx', 'const title = "new";']]);
  });

  it('does not capture on a failed/no-op tool (read_file)', async () => {
    const captured: Array<[string, string]> = [];
    const act = new MemActuator();
    act.files.set('a.ts', 'x');
    const d = dispatcherWithCapture(act, captured);
    await d.dispatch(call('read_file', { path: 'a.ts' }));
    expect(captured).toEqual([]);
  });
});

describe('WorkspaceFileStore helpers', () => {
  it('fileDocId is deterministic, slash-free, and bounded', () => {
    const id = fileDocId('src/components/Button.tsx');
    expect(id).toBe(fileDocId('src/components/Button.tsx'));
    expect(id).not.toContain('/');
    expect(id.length).toBeLessThanOrEqual(1500);
    expect(fileDocId('a/b')).not.toBe(fileDocId('a/c'));
  });

  it('loadWorkspaceFiles is a safe no-op without Firestore (returns {})', async () => {
    await expect(loadWorkspaceFiles('ws-x')).resolves.toEqual({});
  });
});

describe('capPathsToDocLimit (huge-repo durable-index safety)', () => {
  it('keeps every path when the list fits under the 1MB metadata-doc limit', () => {
    const paths = Array.from({ length: 16_000 }, (_, i) => `client/src/pages/module${i}/file${i}.tsx`);
    const r = capPathsToDocLimit(paths);
    // ~16k realistic paths (~45 bytes each ≈ 720KB) fit comfortably — nothing dropped.
    expect(r.capped).toBe(0);
    expect(r.paths.length).toBe(paths.length);
  });

  it('caps gracefully (never exceeds the budget) for a pathological oversized list', () => {
    const paths = Array.from({ length: 60_000 }, (_, i) => `very/deeply/nested/directory/structure/path/segment/file-${i}.tsx`);
    const r = capPathsToDocLimit(paths, 100_000);
    expect(r.capped).toBeGreaterThan(0);
    expect(r.paths.length + r.capped).toBe(paths.length);
    // The kept set stays under the byte budget (this is the whole point — no failed Firestore write).
    const bytes = r.paths.reduce((n, p) => n + Buffer.byteLength(p, 'utf8') + 8, 40);
    expect(bytes).toBeLessThanOrEqual(100_000);
  });

  it('handles an empty list', () => {
    expect(capPathsToDocLimit([])).toEqual({ paths: [], capped: 0 });
  });
});

describe('savePlanForFileSet — the shrink guard (the "49 files → 3, sab gayab" wipe can never recur)', () => {
  it('the EXACT reported wipe: a 3-file partial save against a 49-file index → merge, never replace', async () => {
    const { savePlanForFileSet } = await import('./WorkspaceFileStore');
    expect(savePlanForFileSet(49, 3)).toBe('merge');   // the reviewer-fix partial save
    expect(savePlanForFileSet(48, 1)).toBe('merge');   // a visual single-file edit
  });

  it('a genuine full save (comparable or larger file count) still replaces', async () => {
    const { savePlanForFileSet } = await import('./WorkspaceFileStore');
    expect(savePlanForFileSet(40, 40)).toBe('replace');
    expect(savePlanForFileSet(40, 45)).toBe('replace'); // rebuild grew the app
    expect(savePlanForFileSet(40, 20)).toBe('replace'); // exactly half — boundary allows a real trim
  });

  it('an empty/tiny index has nothing to protect — fresh builds replace freely', async () => {
    const { savePlanForFileSet } = await import('./WorkspaceFileStore');
    expect(savePlanForFileSet(0, 1)).toBe('replace');
    expect(savePlanForFileSet(3, 1)).toBe('replace');
  });
});

describe('essential-manifest carry-forward (the "No package.json found" preview bug can never recur)', () => {
  it('isEssentialManifest recognises the preview-critical ROOT manifests across frameworks', () => {
    for (const p of [
      'package.json', 'index.html', 'tsconfig.json', 'tsconfig.app.json', 'jsconfig.json',
      'vite.config.ts', 'vite.config.js', 'vite.config.mjs',
      'svelte.config.js', 'next.config.js', 'next.config.mjs', 'nuxt.config.ts',
      'astro.config.mjs', 'remix.config.js', 'angular.json',
    ]) {
      expect(isEssentialManifest(p)).toBe(true);
    }
    // Tolerates a leading ./ or / that some path forms carry.
    expect(isEssentialManifest('./package.json')).toBe(true);
    expect(isEssentialManifest('/package.json')).toBe(true);
  });

  it('is ROOT-only — a nested manifest is NOT treated as the preview-critical root manifest', () => {
    expect(isEssentialManifest('src/package.json')).toBe(false);
    expect(isEssentialManifest('packages/api/package.json')).toBe(false);
    expect(isEssentialManifest('src/App.tsx')).toBe(false);
    expect(isEssentialManifest('README.md')).toBe(false);
    expect(isEssentialManifest('')).toBe(false);
  });

  it('the EXACT bug: an AI-written partial save (no package.json) carries the scaffold manifest forward', () => {
    // The durable index has the scaffold (package.json + index.html) plus AI files; the next
    // authoritative save passes ONLY the AI-written files — package.json must NOT be dropped.
    const existing = ['package.json', 'index.html', 'src/App.tsx', 'src/main.tsx'];
    const incoming = ['src/App.tsx', 'src/main.tsx', 'src/pages/Home.tsx']; // AI writes, no manifests
    expect(essentialManifestsToCarry(existing, incoming).sort()).toEqual(['index.html', 'package.json']);
  });

  it('does NOT carry a manifest the incoming set DID rewrite (the new content must win)', () => {
    const existing = ['package.json', 'src/App.tsx'];
    const incoming = ['package.json', 'src/App.tsx']; // AI rewrote package.json (added deps)
    expect(essentialManifestsToCarry(existing, incoming)).toEqual([]);
  });

  it('carries nothing for a comparable full save that already includes the manifests', () => {
    const existing = ['package.json', 'index.html', 'src/App.tsx'];
    const incoming = ['package.json', 'index.html', 'src/App.tsx', 'src/new.tsx'];
    expect(essentialManifestsToCarry(existing, incoming)).toEqual([]);
  });

  it('never carries a non-manifest source file that was omitted (only essentials are protected here)', () => {
    const existing = ['package.json', 'src/App.tsx', 'src/util.ts'];
    const incoming = ['package.json']; // shrink guard handles this class; carry-forward only adds manifests
    expect(essentialManifestsToCarry(existing, incoming)).toEqual([]);
  });
});

describe('preview self-heal — the LAST line of defense when package.json was NEVER in durable (admin 2026-07-21)', () => {
  // Carry-forward (above) protects a package.json that EXISTS in durable from being dropped on a partial
  // save. But it cannot resurrect one that was NEVER written (a scaffold gap, or an imported project that
  // lacked one) — and that is when the Diagnose/preview path used to dead-end with "No package.json found".
  // The fix hydrates such a project through ensureViteReactFoundation before the structure check; this test
  // locks the recovery contract that path now relies on.
  it('a durable React project with source but NO package.json is recovered (package.json synthesized)', () => {
    const durable: Record<string, string> = {
      'src/App.tsx': "import React from 'react';\nexport default function App(){ return <div>Hi</div>; }",
      'src/main.tsx': "import { createRoot } from 'react-dom/client';",
    };
    const f = ensureViteReactFoundation(durable, { framework: 'vite-react' });
    expect(f.added).toContain('package.json');
    expect(f.files['package.json']).toContain('"react"'); // synthesized from the code's real imports
  });

  it('is idempotent — a project that ALREADY has package.json is left untouched (no spurious rewrite)', () => {
    const durable: Record<string, string> = {
      'package.json': '{"name":"app","dependencies":{"react":"^18.0.0"}}',
      'src/App.tsx': 'export default function App(){ return null; }',
    };
    expect(ensureViteReactFoundation(durable, { framework: 'vite-react' }).added).not.toContain('package.json');
  });

  it('the function self-guards a non-React / no-signal project (no spurious vite scaffold)', () => {
    // With no framework signal and no React source, isViteReactTarget → false → nothing synthesized.
    expect(ensureViteReactFoundation({}).added).toEqual([]);
    expect(ensureViteReactFoundation({ 'main.py': 'print(1)' }).added).toEqual([]);
    // The Diagnose path ADDITIONALLY guards `saved.length > 0`, so a genuinely-empty durable set never
    // reaches the heal at all — the honest "couldn't find your saved files" message still shows for it.
  });
});
