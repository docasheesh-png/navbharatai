/**
 * Phase 17 — Test Analyzer.
 *
 * Inspects the files of a generated app (via VirtualFileSystem) and returns
 * a ranked list of source files that should have test coverage.
 *
 * Mirrors what Claude Code does: categorizes every source file, assigns a
 * priority score based on type and size, and returns the top N targets so
 * the test generator can parallelize AI calls per file.
 *
 * Pure module — no I/O, no model calls. Unit-testable.
 */

import type { VirtualFileSystem } from '../project/ProjectModel';

export type FileCategory =
  | 'component'  // React .tsx/.jsx with JSX return
  | 'hook'       // custom hook (use*.ts/tsx)
  | 'service'    // api / service / client layer
  | 'util'       // pure utility functions
  | 'page'       // page-level component (pages/ or routes/)
  | 'context'    // React context provider
  | 'store'      // state management (zustand, redux, jotai)
  | 'other';     // everything else that could still use tests

export interface TestTarget {
  sourcePath: string;
  testPath: string;
  category: FileCategory;
  /** Higher = more important to test first. */
  priority: number;
}

/** Patterns that are never worth auto-testing. */
const SKIP_PATTERNS = [
  /\.test\.(ts|tsx|js|jsx)$/,
  /\.spec\.(ts|tsx|js|jsx)$/,
  /\.stories\.(ts|tsx)$/,
  /node_modules/,
  /\/(dist|build|out|\.next)\//,
  /vite\.config\./,
  /vitest\.config\./,
  /tailwind\.config\./,
  /postcss\.config\./,
  /\.(css|scss|less|svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|pdf|json|md|lock|yaml|yml|env|gitignore)$/,
  /package\.json$/,
  /tsconfig/,
  /eslintrc/,
  /prettier/,
  /main\.(ts|tsx|jsx)$/,     // Vite entry points are boilerplate
  /index\.(ts|tsx|jsx)$/,    // barrel exports rarely need tests
];

function shouldSkip(path: string): boolean {
  return SKIP_PATTERNS.some((re) => re.test(path));
}

function categoryOf(path: string, content: string): FileCategory {
  const base = path.split('/').pop() ?? '';
  const lower = base.toLowerCase();

  if (/^use[A-Z]/.test(base) || /^use[A-Z]/.test(lower.replace(/^use/, 'use'))) {
    // hook: file starts with "use" followed by capital letter
    if (/^use[A-Z]/.test(base)) return 'hook';
  }

  if (/\/(pages|routes|screens)\//.test(path) || /page\.(tsx|jsx)$/.test(lower)) return 'page';
  if (/\/(context|contexts|providers)\//.test(path) || /context\.(tsx?)$/.test(lower) || /provider\.(tsx?)$/.test(lower)) return 'context';
  if (/\/(store|stores|state|atoms|slices)\//.test(path) || /store\.(ts|tsx)$/.test(lower) || /slice\.(ts)$/.test(lower)) return 'store';
  // util before service: utils/ and helpers/ paths are utilities, not services
  if (/\/(utils?|helpers?)\//i.test(path) && /\.(ts)$/.test(path)) return 'util';
  if (/\/(service|services|api|client|lib)\//i.test(path) && /\.(ts)$/.test(path)) return 'service';

  // React component detection: has JSX and a default/named export
  if (/\.(tsx|jsx)$/.test(path) && /return\s*\(?\s*</.test(content)) return 'component';

  // TypeScript helper that's not a component
  if (/\.ts$/.test(path) && !content.includes('createElement') && !content.includes('JSX.Element')) {
    if (/export (function|const|class)/.test(content)) return 'util';
  }

  return 'other';
}

const PRIORITY_BY_CATEGORY: Record<FileCategory, number> = {
  hook:      90,
  service:   85,
  store:     80,
  util:      75,
  component: 70,
  page:      60,
  context:   55,
  other:     30,
};

/** Content-based priority boost: larger, more complex files are more valuable to test. */
function priorityBoost(content: string): number {
  const lines = content.split('\n').length;
  if (lines > 200) return 15;
  if (lines > 100) return 8;
  if (lines > 50) return 4;
  return 0;
}

/**
 * Prefer App.tsx as the primary component (always high priority if present).
 * Everything in src/components/ gets a moderate boost.
 * hooks/ gets a boost so useXxx files always outrank equivalent components.
 */
function pathBoost(path: string): number {
  if (/\/(App|app)\.(tsx|jsx)$/.test(path)) return 15;
  if (/\/hooks\//i.test(path)) return 12;
  if (/\/components\//i.test(path)) return 8;
  return 0;
}

/** Derive the .test. sibling path for a source file. */
export function testPathFor(sourcePath: string): string {
  return sourcePath.replace(/\.(tsx|jsx|ts|js)$/, (m) => `.test${m}`);
}

/**
 * Analyze VFS files and return test targets sorted by descending priority.
 * Already-existing test files are excluded from the results.
 */
export function analyzeForTests(
  vfs: VirtualFileSystem,
  existingTestPaths?: Set<string>,
): TestTarget[] {
  const existing = existingTestPaths ?? new Set(
    vfs.paths().filter((p) => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(p)),
  );

  const targets: TestTarget[] = [];

  for (const sourcePath of vfs.paths()) {
    if (shouldSkip(sourcePath)) continue;

    const content = vfs.readText(sourcePath);
    if (!content || content.length < 60) continue;

    const tp = testPathFor(sourcePath);
    if (existing.has(tp)) continue;

    const category = categoryOf(sourcePath, content);
    if (category === 'other' && !/\.(ts|tsx)$/.test(sourcePath)) continue;

    const priority =
      PRIORITY_BY_CATEGORY[category] +
      priorityBoost(content) +
      pathBoost(sourcePath);

    targets.push({ sourcePath, testPath: tp, category, priority });
  }

  return targets.sort((a, b) => b.priority - a.priority);
}

/**
 * Return the highest-priority subset of targets, up to maxFiles.
 * Ensures diversity: at most one 'page' and one 'context' target to focus
 * test budget on the highest-value files (hooks, services, stores, components).
 */
export function selectTopTargets(targets: TestTarget[], maxFiles: number = 4): TestTarget[] {
  if (targets.length <= maxFiles) return targets;

  const selected: TestTarget[] = [];
  const seenPages = 0;
  let pagesSeen = seenPages;
  let contextsSeen = 0;

  for (const t of targets) {
    if (selected.length >= maxFiles) break;
    if (t.category === 'page' && pagesSeen >= 1) continue;
    if (t.category === 'context' && contextsSeen >= 1) continue;

    if (t.category === 'page') pagesSeen++;
    if (t.category === 'context') contextsSeen++;
    selected.push(t);
  }

  return selected;
}
