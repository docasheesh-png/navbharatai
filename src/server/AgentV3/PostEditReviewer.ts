// AgentV3 — Post-Edit Self-Review (Level 4 — diff-then-verify).
//
// After every write_file or edit_file, this reviewer runs a fast STATIC analysis
// on the resulting file content to catch the most common coding mistakes BEFORE
// the agent moves to the next step:
//   - Stub / placeholder-only files (insufficient real code)
//   - Common spelling typos in JS/TS built-ins and popular hooks
//   - Missing imports for frequently-used symbols
//   - JSX without any React-family import in files that use JSX
//   - Excessive TODO/FIXME/PLACEHOLDER markers (incomplete implementation)
//
// PURE & best-effort: no I/O, no async, never throws.
// Wired into ToolDispatcher so the model sees the review appended to the
// tool_result and can immediately apply a fix in the same turn.

export interface PostEditReview {
  /** Human-readable issues found (each a short one-liner). */
  issues: string[];
  /** True when at least one CRITICAL issue was detected. */
  hasCritical: boolean;
}

// Common typos → their correct form.
const COMMON_TYPOS: Array<[RegExp, string]> = [
  [/\bconsol\.log\b/g, 'console.log'],
  [/\buseEffct\b/g, 'useEffect'],
  [/\buseStatee\b/g, 'useState'],
  [/\buseContextt\b/g, 'useContext'],
  [/\buseCallbackk\b/g, 'useCallback'],
  [/\buseMemmmo\b/g, 'useMemo'],
  [/\bconsole\.log\b[^;]*\bpassword\b/gi, 'password printed to console'],
];

// Symbols that suggest a commonly-missing import.
const IMPORT_HINTS: Array<{ pattern: RegExp; symbol: string; from: string }> = [
  { pattern: /\buseNavigate\b/, symbol: 'useNavigate', from: 'react-router-dom' },
  { pattern: /\buseParams\b/, symbol: 'useParams', from: 'react-router-dom' },
  { pattern: /\buseLocation\b/, symbol: 'useLocation', from: 'react-router-dom' },
  { pattern: /\buseQuery\b/, symbol: 'useQuery', from: '@tanstack/react-query' },
  { pattern: /\buseMutation\b/, symbol: 'useMutation', from: '@tanstack/react-query' },
  { pattern: /\bclsx\(/, symbol: 'clsx', from: 'clsx' },
  { pattern: /\baxios\b/, symbol: 'axios', from: 'axios' },
  { pattern: /\bz\.object\b/, symbol: 'z', from: 'zod' },
];

const isCode = (f: string): boolean => /\.(t|j)sx?$/.test(f);
const isJsx = (f: string): boolean => /\.(tsx|jsx)$/.test(f);

/**
 * Statically review a just-written or just-edited file for common issues.
 * Pure and synchronous — no I/O. Never throws.
 */
export function reviewEdit(file: string, content: string): PostEditReview {
  if (!isCode(file)) return { issues: [], hasCritical: false };

  const issues: string[] = [];
  let hasCritical = false;

  // 1. Empty / stub-only file — fewer than 3 non-blank, non-comment lines.
  const codeLines = content
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  if (codeLines.length < 3) {
    issues.push('File appears empty or stub-only (fewer than 3 real code lines).');
    hasCritical = true;
  }

  // 2. Common JS/TS typos.
  for (const [re, fix] of COMMON_TYPOS) {
    if (re.test(content)) issues.push(`Possible typo: should be "${fix}".`);
    re.lastIndex = 0;
  }

  // 3. Missing imports for frequently-used symbols (JSX files only).
  if (isJsx(file)) {
    const importBlock = content
      .split('\n')
      .filter((l) => l.trimStart().startsWith('import '))
      .join('\n');
    for (const { pattern, symbol, from } of IMPORT_HINTS) {
      if (pattern.test(content) && !importBlock.includes(symbol)) {
        issues.push(`"${symbol}" is used but not imported — add: import { ${symbol} } from '${from}'.`);
      }
    }

    // 4. JSX without a React/react import.
    // Match any lowercase or PascalCase opening tag (e.g. <div>, <Button>, <>).
    const hasJsx = /<[A-Za-z][A-Za-z0-9]*[\s/>]/.test(content) || /<>/.test(content);
    const hasReactImport =
      /import\s+React\b/.test(content) ||
      /from\s+['"]react['"]/.test(content);
    if (hasJsx && !hasReactImport) {
      issues.push(
        "JSX used but no 'react' import found — add: import React from 'react' (or import { ... } from 'react').",
      );
    }
  }

  // 5. Excessive placeholder markers (≥ 3 = likely incomplete implementation).
  const todoCount = (content.match(/\bTODO\b|\bFIXME\b|\bPLACEHOLDER\b/g) ?? []).length;
  if (todoCount >= 3) {
    issues.push(
      `${todoCount} TODO/FIXME/PLACEHOLDER markers found — ensure the implementation is real, not stubs.`,
    );
  }

  return { issues, hasCritical };
}

/** Format a PostEditReview into a tool-result annotation. Returns '' when clean. */
export function formatReviewResult(review: PostEditReview, file: string): string {
  if (review.issues.length === 0) return '';
  const tag = review.hasCritical
    ? '⚠️  POST-WRITE REVIEW — CRITICAL issues in'
    : '📋 POST-WRITE REVIEW — Notes on';
  const lines = [
    `\n${tag} ${file}:`,
    ...review.issues.map((i) => `  • ${i}`),
    review.hasCritical
      ? '\nFix the critical issue(s) above before moving on.'
      : '\nConsider addressing these before finishing.',
  ];
  return lines.join('\n');
}
