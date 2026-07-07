// P-DEV.10 — Code Explanation engine.
//
// A pure, deterministic, dependency-free explainer for a snippet or file of TS/JS/TSX code. It answers
// "what is this code?" instantly and for free — no AI call, no credit spend — with a plain-language
// summary, a complexity label, the design patterns it detected, and concrete refactoring suggestions.
// Every number is a real structural count of the actual code, so the result is fully unit-testable and
// never fabricated. It intentionally uses conservative regex heuristics (not a full AST) so it degrades
// gracefully on partial selections and never throws on malformed input.

export interface CodeExplanation {
  /** Plain-language description of what the code is and does. */
  summary: string;
  /** e.g. 'React component', 'React hook', 'utility module', 'stylesheet'. */
  kind: string;
  /** Cyclomatic-style branch complexity + a human label. */
  complexity: { score: number; label: 'Low' | 'Moderate' | 'High' };
  /** Design/behaviour patterns detected (state, effects, async data, context, routing, forms, …). */
  patterns: string[];
  /** Conservative, deterministic refactoring suggestions (empty when nothing clear stands out). */
  refactors: string[];
  /** Real structural counts of the code. */
  stats: {
    lines: number;
    functions: number;
    components: number;
    hooks: number;
    imports: number;
    exports: number;
    jsxElements: number;
  };
}

/** Count non-overlapping matches of a global regex. */
function count(code: string, re: RegExp): number {
  const m = code.match(re);
  return m ? m.length : 0;
}

/**
 * Explain a piece of code. Pure & deterministic — the same input always yields the same explanation.
 * Never throws: on empty/blank input it returns an honest "nothing to explain" result.
 */
export function explainCode(code: unknown, filename?: string): CodeExplanation {
  const src = typeof code === 'string' ? code : '';
  const name = typeof filename === 'string' ? filename : '';
  const empty: CodeExplanation = {
    summary: 'No code to explain — the selection is empty.',
    kind: 'empty',
    complexity: { score: 0, label: 'Low' },
    patterns: [],
    refactors: [],
    stats: { lines: 0, functions: 0, components: 0, hooks: 0, imports: 0, exports: 0, jsxElements: 0 },
  };
  if (!src.trim()) return empty;

  const lines = src.split('\n').length;
  const isCss = /\.(css|scss|sass|less)$/i.test(name);

  // --- structural counts ----------------------------------------------------
  const namedFns = count(src, /\bfunction\s+[A-Za-z_$]/g);
  const arrowFns = count(src, /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g)
    + count(src, /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>/g);
  const functions = namedFns + arrowFns;
  const jsxElements = count(src, /<[A-Za-z][A-Za-z0-9]*/g);
  const hasJsx = jsxElements > 0 && /<\/[A-Za-z]|\/>/.test(src);
  const componentDecls = count(src, /(?:function\s+|(?:const|let|var)\s+)[A-Z][A-Za-z0-9]*/g);
  const components = hasJsx ? componentDecls : 0;
  const hooks = count(src, /\buse[A-Z]\w*\s*\(/g);
  const customHookDecls = count(src, /(?:function\s+|(?:const|let|var)\s+)use[A-Z]\w*/g);
  const imports = count(src, /^\s*import\s.+from\s|^\s*import\s+['"]/gm);
  const exports = count(src, /\bexport\b/g);

  // --- complexity (cyclomatic-style branch count) ---------------------------
  const decisions =
    count(src, /\bif\s*\(/g) +
    count(src, /\bfor\s*\(/g) +
    count(src, /\bwhile\s*\(/g) +
    count(src, /\bcase\s+/g) +
    count(src, /\bcatch\s*\(/g) +
    count(src, /&&/g) +
    count(src, /\|\|/g);
  const score = 1 + decisions;
  const label: CodeExplanation['complexity']['label'] = score <= 5 ? 'Low' : score <= 15 ? 'Moderate' : 'High';

  // --- kind -----------------------------------------------------------------
  let kind = 'utility module';
  if (isCss) kind = 'stylesheet';
  else if (customHookDecls > 0) kind = 'React hook';
  else if (components > 0) kind = components > 1 ? 'React module (multiple components)' : 'React component';
  else if (/\bclass\s+[A-Za-z_$]/.test(src)) kind = 'class module';
  else if (/\bexport\s+default\b/.test(src) && !hasJsx) kind = 'module';

  // --- patterns -------------------------------------------------------------
  const patterns: string[] = [];
  if (/\buse(State|Reducer)\s*\(/.test(src)) patterns.push('State management');
  if (/\buse(Effect|LayoutEffect)\s*\(/.test(src)) patterns.push('Side effects (lifecycle)');
  if (/\buse(Memo|Callback)\s*\(|\bReact\.memo\b|\bmemo\s*\(/.test(src)) patterns.push('Memoization');
  if (/\bcreateContext\s*\(|\buseContext\s*\(/.test(src)) patterns.push('React Context');
  if (/\bfetch\s*\(|\baxios\b|\bawait\b/.test(src)) patterns.push('Async data / I/O');
  if (/react-router|\buseNavigate\b|<Route\b|\buseRouter\b/.test(src)) patterns.push('Routing');
  if (/<form\b|onSubmit=|\bhandleSubmit\b/.test(src)) patterns.push('Forms');
  if (/\binterface\s+[A-Za-z_$]|\btype\s+[A-Za-z_$][\w$]*\s*=/.test(src)) patterns.push('TypeScript types');
  if (/\btry\s*\{/.test(src)) patterns.push('Error handling');

  // --- refactoring suggestions (conservative, deterministic) ----------------
  const refactors: string[] = [];
  if (lines > 300) refactors.push(`Large file (${lines} lines) — consider splitting it into smaller modules.`);
  if (label === 'High') refactors.push('High branching complexity — extract helper functions to reduce nesting.');
  if (components > 1 && lines > 150) refactors.push('Multiple components in one file — consider one component per file.');
  if (/\b(fetch|await)\b/.test(src) && !/\btry\s*\{/.test(src)) {
    refactors.push('Async work without a try/catch — add error handling so failures do not crash the UI.');
  }
  if (imports > 20) refactors.push(`Many imports (${imports}) — this module may be taking on too many responsibilities.`);
  if (hasJsx && /\.map\s*\(/.test(src) && !/key=/.test(src)) {
    refactors.push('A list render (.map) appears to lack a "key" prop — add one to avoid React reconciliation bugs.');
  }

  // --- summary --------------------------------------------------------------
  const summaryBits: string[] = [`This is a ${kind} of about ${lines} line${lines === 1 ? '' : 's'}`];
  if (functions > 0) summaryBits.push(`${functions} function${functions === 1 ? '' : 's'}`);
  if (components > 0) summaryBits.push(`${components} component${components === 1 ? '' : 's'}`);
  if (hooks > 0) summaryBits.push(`${hooks} hook call${hooks === 1 ? '' : 's'}`);
  let summary = summaryBits.join(', ') + `. Branch complexity is ${label.toLowerCase()}`;
  summary += patterns.length ? `; it uses ${patterns.slice(0, 4).join(', ').toLowerCase()}.` : '.';
  if (refactors.length) summary += ` ${refactors.length} refactoring suggestion${refactors.length === 1 ? '' : 's'} below.`;

  return {
    summary,
    kind,
    complexity: { score, label },
    patterns,
    refactors,
    stats: { lines, functions, components, hooks, imports, exports, jsxElements },
  };
}
