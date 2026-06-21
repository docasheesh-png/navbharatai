/**
 * Phase 17 — Auto Test Generation.
 *
 * After a Pro build produces TypeScript/React files, generates Vitest test
 * files covering the most important parts of the app — matching what Claude
 * Code does for apps it builds.
 *
 * generateTestSuite()  — the main entry point. Takes a VirtualFileSystem,
 *   uses TestAnalyzer to pick the highest-value files, then fires parallel
 *   AI calls (one per file) via Promise.allSettled. Returns a Record of
 *   test file paths → content that callers merge into the result.
 *
 * generateTests()  — legacy single-file API kept for backward compat.
 *   Internally delegates to generateTestSuite().
 *
 * Never throws — on any failure returns an empty record so the build
 * continues undisturbed.
 */

import type { ModelCall } from '../project/aiEdits';
import type { VirtualFileSystem } from '../project/ProjectModel';
import { analyzeForTests, selectTopTargets } from './TestAnalyzer';
import type { FileCategory } from './TestAnalyzer';

// ─── Category-specific system prompts ───────────────────────────────────────

const BASE_RULES = `Rules:
- Use Vitest (import { describe, it, expect, vi } from 'vitest')
- Write 3-5 meaningful, focused tests — no trivial snapshot tests
- Use vi.mock() for external dependencies (fetch, router, localStorage, etc.)
- Keep setup minimal — test behavior, not implementation details
- Output ONLY the test file content (no markdown fences, no explanation)
- File must be runnable with: npx vitest run`;

const SYSTEM_PROMPTS: Record<FileCategory, string> = {
  component: `You are an expert TypeScript/React test writer using Vitest and @testing-library/react.
Given a React component source file, write a complete test file.
Import: import { render, screen, fireEvent, waitFor } from '@testing-library/react'
Test: renders without crashing, key UI text/elements are visible, main user interactions work.
${BASE_RULES}`,

  hook: `You are an expert TypeScript/React test writer using Vitest and @testing-library/react.
Given a custom React hook source file, write a complete test file.
Use renderHook from @testing-library/react to test the hook in isolation.
Test: initial state, state transitions after actions, cleanup on unmount (if applicable).
${BASE_RULES}`,

  service: `You are an expert TypeScript test writer using Vitest.
Given a service/API client source file, write a complete test file.
Mock all fetch/axios/HTTP calls with vi.fn() or vi.mock().
Test: happy-path response, error handling, correct request construction.
${BASE_RULES}`,

  util: `You are an expert TypeScript test writer using Vitest.
Given a utility/helper source file, write a complete test file.
Test every exported function with representative inputs including edge cases (empty, null, large).
${BASE_RULES}`,

  store: `You are an expert TypeScript test writer using Vitest.
Given a state store (Zustand/Redux/Jotai) source file, write a complete test file.
Test: initial state shape, each action/selector, state after mutations.
${BASE_RULES}`,

  page: `You are an expert TypeScript/React test writer using Vitest and @testing-library/react.
Given a page-level React component, write a focused test file.
Mock all child components and router hooks (vi.mock('react-router-dom', ...)).
Test: page renders without crashing, key section headings/CTAs are present, loading/error states.
${BASE_RULES}`,

  context: `You are an expert TypeScript/React test writer using Vitest and @testing-library/react.
Given a React Context/Provider source file, write a complete test file.
Test: default context value, value updates when provider props change, consumers receive correct value.
${BASE_RULES}`,

  other: `You are an expert TypeScript test writer using Vitest.
Given a TypeScript source file, write a complete test file.
Test every exported function or class with clear happy-path and error cases.
${BASE_RULES}`,
};

// ─── Individual file test generation ────────────────────────────────────────

async function generateFileTest(
  sourcePath: string,
  content: string,
  category: FileCategory,
  callModel: ModelCall,
): Promise<string> {
  const systemPrompt = SYSTEM_PROMPTS[category];
  const userPrompt = `Source file: ${sourcePath}\n\n${content.slice(0, 4000)}`;
  const raw = await callModel(systemPrompt, userPrompt);
  const cleaned = raw.replace(/^```[^\n]*\n?|```$/gm, '').trim();
  if (!cleaned || cleaned.length < 50) throw new Error('Empty test output');
  return cleaned;
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Generate Vitest test files for the most important files in a VFS.
 *
 * Selects up to maxFiles targets (highest priority first), fires one AI call
 * per file in parallel, and returns all that succeed as a path→content record.
 * This mirrors Claude Code behavior: multiple targeted test files, not one blob.
 */
export async function generateTestSuite(
  vfs: VirtualFileSystem,
  callModel: ModelCall,
  maxFiles: number = 4,
): Promise<Record<string, string>> {
  const hasSrc = vfs.paths().some((p) => /\.(tsx|jsx|ts)$/.test(p));
  if (!hasSrc) return {};

  const targets = analyzeForTests(vfs);
  if (targets.length === 0) return {};

  const selected = selectTopTargets(targets, maxFiles);
  if (selected.length === 0) return {};

  const results = await Promise.allSettled(
    selected.map(async ({ sourcePath, testPath, category }) => {
      const content = vfs.readText(sourcePath) ?? '';
      const testContent = await generateFileTest(sourcePath, content, category, callModel);
      return { testPath, testContent };
    }),
  );

  const testFiles: Record<string, string> = {};
  for (const r of results) {
    if (r.status === 'fulfilled') {
      testFiles[r.value.testPath] = r.value.testContent;
    }
  }
  return testFiles;
}

// ─── Legacy API (backward compat) ───────────────────────────────────────────

/**
 * @deprecated Use generateTestSuite() with a VirtualFileSystem instead.
 * Kept for call sites that still pass a Record<string, string>.
 */
export async function generateTests(
  files: Record<string, string>,
  callModel: ModelCall,
): Promise<Record<string, string>> {
  // Inline VFS construction to avoid a circular import via ProjectModel.
  const { VirtualFileSystem } = await import('../project/ProjectModel');
  const vfs = VirtualFileSystem.fromRecord(files);
  try {
    return await generateTestSuite(vfs, callModel, 4);
  } catch {
    return {};
  }
}
