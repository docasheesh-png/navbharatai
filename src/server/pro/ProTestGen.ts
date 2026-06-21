/**
 * Phase 17 — Auto Test Generation.
 *
 * After a Pro build produces TypeScript/React files, generates a Vitest test
 * file covering the main component. The test file is injected into the result
 * so users always get a runnable test suite alongside their app.
 *
 * One focused AI call: sends the primary component source, returns a complete
 * Vitest + React Testing Library test file. Never throws — on any failure it
 * returns an empty record so the caller can safely merge it.
 */

import type { ModelCall } from '../project/aiEdits';

const TEST_SYSTEM_PROMPT = `You are an expert TypeScript/React test writer using Vitest and @testing-library/react.
Given a React component source file, write a complete test file.

Rules:
- Use Vitest (import { describe, it, expect, vi } from 'vitest')
- Use @testing-library/react (import { render, screen, fireEvent } from '@testing-library/react')
- Test: component renders without crashing, key UI text appears, main interactions work
- 3-5 meaningful tests — no trivial snapshot tests
- Use vi.mock() for external dependencies (fetch, router, etc.)
- Output ONLY the test file content (no markdown fences, no explanation)
- File should be runnable with: npx vitest run`;

/**
 * Detect the primary React component file from a files record.
 * Returns [path, content] or null if no suitable component found.
 */
function findPrimaryComponent(files: Record<string, string>): [string, string] | null {
  // Prefer App.tsx, then index.tsx, then the first .tsx with JSX
  const candidates = ['src/App.tsx', 'App.tsx', 'src/index.tsx', 'index.tsx'];
  for (const c of candidates) {
    if (files[c] && files[c].length > 100) return [c, files[c]];
  }
  // Fall back to any .tsx file with JSX return statement
  for (const [path, content] of Object.entries(files)) {
    if (/\.(tsx|jsx)$/.test(path) && /return\s*\(/.test(content) && content.length > 100) {
      return [path, content];
    }
  }
  return null;
}

/**
 * Derive the test file path from the component path.
 * src/App.tsx → src/App.test.tsx
 */
function testPathFor(componentPath: string): string {
  return componentPath.replace(/\.(tsx|jsx|ts|js)$/, '.test.$1');
}

/**
 * Generate a Vitest test file for the primary component in `files`.
 * Returns a Record with a single test file entry, or empty on failure.
 */
export async function generateTests(
  files: Record<string, string>,
  callModel: ModelCall,
): Promise<Record<string, string>> {
  // Only run for TypeScript/React projects
  const hasTsxFiles = Object.keys(files).some((p) => /\.(tsx|jsx)$/.test(p));
  if (!hasTsxFiles) return {};

  const primary = findPrimaryComponent(files);
  if (!primary) return {};

  const [componentPath, componentSource] = primary;
  const testPath = testPathFor(componentPath);

  // Don't regenerate if a test already exists
  if (files[testPath]) return {};

  try {
    const prompt = `Component file: ${componentPath}\n\n${componentSource.slice(0, 4000)}`;
    const testContent = await callModel(TEST_SYSTEM_PROMPT, prompt);
    // Strip accidental markdown fences
    const cleaned = testContent.replace(/^```[^\n]*\n?|```$/gm, '').trim();
    if (!cleaned || cleaned.length < 50) return {};
    return { [testPath]: cleaned };
  } catch {
    return {};
  }
}
