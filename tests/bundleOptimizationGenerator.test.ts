import { describe, it, expect } from 'vitest';
import { generateBundleOptimization } from '../src/server/AppMakerLab/generator/BundleOptimizationGenerator';

/** P-CGE.10 — bundle optimization generator (pure). */

describe('generateBundleOptimization', () => {
  it('always emits a lazyWithRetry helper and a manualChunks snippet', () => {
    const { files, manualChunksSnippet } = generateBundleOptimization({ hasViteConfig: true });
    const helper = files.find((f) => f.path === 'src/lib/lazyWithRetry.tsx');
    expect(helper).toBeTruthy();
    expect(helper!.content).toContain('export function lazyWithRetry');
    expect(helper!.content).toContain("import { lazy } from 'react';");
    expect(helper!.content).toContain('window.location.reload()');
    expect(manualChunksSnippet).toContain('manualChunks');
    expect(manualChunksSnippet).toContain("'react-vendor'");
    expect(manualChunksSnippet).toContain("'vendor'");
  });

  it('does NOT write a vite.config when one already exists', () => {
    const { files, summary } = generateBundleOptimization({ hasViteConfig: true });
    expect(files.find((f) => f.path === 'vite.config.ts')).toBeUndefined();
    expect(summary).toContain('merge');
  });

  it('writes a complete optimized vite.config when none exists', () => {
    const { files } = generateBundleOptimization({ hasViteConfig: false });
    const vite = files.find((f) => f.path === 'vite.config.ts');
    expect(vite).toBeTruthy();
    expect(vite!.content).toContain('defineConfig');
    expect(vite!.content).toContain('@vitejs/plugin-react');
    expect(vite!.content).toContain('manualChunks');
  });

  it('defaults to writing a vite.config (no input = no existing config)', () => {
    const { files } = generateBundleOptimization();
    expect(files.map((f) => f.path)).toContain('vite.config.ts');
  });
});
