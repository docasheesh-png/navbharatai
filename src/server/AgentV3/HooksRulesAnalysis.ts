// AgentV3 — React Rules-of-Hooks analyzer (build-robustness evaluator).
//
// A pure, AST-accurate checker that catches the #1 class of hard runtime crashes in generated React
// apps: hooks called in a way that violates the Rules of Hooks. A conditional/looped/early-returned
// hook throws "React has detected a change in the order of Hooks" (or "Rendered more hooks than during
// the previous render") and white-screens the app — a failure the existing scanX evaluator suite does
// NOT detect. Catching it before a build is reported ready directly hardens what the builder ships.
//
// It flags only HIGH-CONFIDENCE violations (real AST scope + control-flow, not regex) to keep false
// positives near zero:
//   • conditional-hook   — a hook called inside if/else/ternary/&&/||/switch/try within a component/hook
//   • hook-after-return  — a hook called after an early return in the component/hook body
//   • hook-in-loop       — a hook called inside a for/while/do loop within a component/hook
//   • hook-in-callback   — a hook called from a nested non-component/non-hook function (event handler, .map cb)
//
// ts-morph is loaded lazily (like ASTAnalyzer) so it never costs anything until a check runs. The
// analysis is deterministic and fully unit-tested.

export type HookViolationKind =
  | 'conditional-hook'
  | 'hook-after-return'
  | 'hook-in-loop'
  | 'hook-in-callback';

export interface HookViolation {
  file: string;
  line: number;
  hook: string;
  kind: HookViolationKind;
  detail: string;
}

export interface HooksReport {
  violations: HookViolation[];
  filesScanned: number;
  counts: Record<HookViolationKind, number>;
  /** True when no Rules-of-Hooks violations were found. */
  ok: boolean;
}

// Lazily-loaded ts-morph (optional dependency pattern, mirrors ASTAnalyzer).
let TsMorph: any;
async function loadTsMorph(): Promise<any | null> {
  if (TsMorph) return TsMorph;
  try {
    TsMorph = await import('ts-morph');
    return TsMorph;
  } catch {
    return null;
  }
}

const REACT_FILE = /\.(t|j)sx?$/;
/** A hook call is `use` optionally followed by an Uppercase name: useState, useEffect, useMyHook, use. */
const HOOK_NAME = /^use([A-Z0-9].*)?$/;

const FUNCTION_KINDS = new Set(['ArrowFunction', 'FunctionExpression', 'FunctionDeclaration', 'MethodDeclaration']);
const CONDITIONAL_KINDS = new Set(['IfStatement', 'ConditionalExpression', 'SwitchStatement', 'CaseClause', 'TryStatement', 'CatchClause']);
const LOOP_KINDS = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoStatement']);

/** The callee identifier of a call expression, e.g. `useState` from `useState(0)` or `React.useState`. */
function calleeName(call: any): string {
  const expr = call.getExpression?.();
  if (!expr) return '';
  const text: string = expr.getText?.() ?? '';
  // For `React.useState` / `a.b.useMemo`, take the last segment.
  const seg = text.split('.').pop() ?? text;
  return seg.trim();
}

/** Is this function-like node a React component (Uppercase) or a custom hook (useX)? */
function functionContextName(fn: any): string | null {
  // Named function declaration / method.
  const own = fn.getName?.();
  if (own) return own;
  // Arrow/function expression assigned to a variable: const Foo = () => {} / const useX = () => {}.
  const parent = fn.getParent?.();
  if (parent && parent.getKindName?.() === 'VariableDeclaration') {
    return parent.getName?.() ?? null;
  }
  // Property assignment: { Foo: () => {} } or class field.
  if (parent && typeof parent.getName === 'function') {
    try { return parent.getName() || null; } catch { return null; }
  }
  return null;
}

function isReactContext(fn: any): boolean {
  const name = functionContextName(fn);
  if (!name) return false;
  return /^[A-Z]/.test(name) || /^use[A-Z0-9]/.test(name) || name === 'use';
}

/** Nearest enclosing function-like ancestor of a node (or null). */
function enclosingFunction(node: any): any | null {
  let p = node.getParent?.();
  while (p) {
    if (FUNCTION_KINDS.has(p.getKindName?.())) return p;
    p = p.getParent?.();
  }
  return null;
}

/**
 * Classify a single hook call relative to its enclosing React context. Returns the violation kind, or
 * null when the call obeys the Rules of Hooks (or isn't inside a React context at all — conservative).
 */
function classifyHookCall(call: any): HookViolationKind | null {
  const fn = enclosingFunction(call);
  if (!fn) return null; // top-level `use…()` outside any function — not a component; don't guess.

  if (!isReactContext(fn)) {
    // The hook is in a nested non-component/non-hook function. Only a violation if it is itself nested
    // inside a real React context (otherwise it may just be a helper coincidentally named useX-caller).
    let outer = enclosingFunction(fn);
    while (outer) {
      if (isReactContext(outer)) return 'hook-in-callback';
      outer = enclosingFunction(outer);
    }
    return null;
  }

  // fn IS the React context. Walk ancestors from the call up to fn, looking for control flow.
  let p = call.getParent?.();
  while (p && p !== fn) {
    const kind = p.getKindName?.();
    if (LOOP_KINDS.has(kind)) return 'hook-in-loop';
    if (CONDITIONAL_KINDS.has(kind)) return 'conditional-hook';
    // A short-circuit `cond && useThing()` — hook guarded by a logical operator.
    if (kind === 'BinaryExpression') {
      const op = p.getOperatorToken?.().getText?.();
      if (op === '&&' || op === '||' || op === '??') return 'conditional-hook';
    }
    p = p.getParent?.();
  }

  // Directly in the context body: check for an early return BEFORE this hook.
  if (hasEarlyReturnBefore(fn, call)) return 'hook-after-return';
  return null;
}

/**
 * True when the context function body has a `return` (top-level or inside a conditional) that appears
 * in source order BEFORE `call`. That makes the later hook conditional — a Rules-of-Hooks violation.
 */
function hasEarlyReturnBefore(fn: any, call: any): boolean {
  const body = fn.getBody?.();
  if (!body || body.getKindName?.() !== 'Block') return false;
  const callPos: number = call.getStart?.() ?? 0;
  const statements: any[] = body.getStatements?.() ?? [];
  for (const stmt of statements) {
    if (stmt.getStart?.() >= callPos) break; // only statements before the hook call
    if (stmt.getKindName?.() === 'ReturnStatement') return true;
    // An early return nested in a conditional (the classic `if (!x) return null;`).
    const returns = stmt.getDescendantsOfKind?.(TsMorph.SyntaxKind.ReturnStatement) ?? [];
    for (const r of returns) {
      // Ignore returns that belong to a NESTED function (those aren't early returns of this context).
      if (enclosingFunction(r) === fn) return true;
    }
  }
  return false;
}

/** Analyze a set of files for Rules-of-Hooks violations. Pure + deterministic. */
export async function analyzeHooksRules(files: Record<string, string>): Promise<HooksReport> {
  const counts: Record<HookViolationKind, number> = {
    'conditional-hook': 0, 'hook-after-return': 0, 'hook-in-loop': 0, 'hook-in-callback': 0,
  };
  const empty: HooksReport = { violations: [], filesScanned: 0, counts, ok: true };

  const mod = await loadTsMorph();
  if (!mod) return empty;

  const project = new mod.Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    // jsx: React(2). .tsx/.jsx files parse JSX by extension regardless; this just avoids diagnostics noise.
    compilerOptions: { allowJs: true, jsx: 2 },
  });

  const violations: HookViolation[] = [];
  let scanned = 0;

  for (const [path, content] of Object.entries(files)) {
    if (!REACT_FILE.test(path) || typeof content !== 'string' || !content.includes('use')) continue;
    scanned++;
    let sf: any;
    try {
      sf = project.createSourceFile(path, content, { overwrite: true });
    } catch {
      continue; // unparseable file — skip rather than fail the whole check
    }
    let calls: any[];
    try {
      calls = sf.getDescendantsOfKind(mod.SyntaxKind.CallExpression);
    } catch {
      continue;
    }
    for (const call of calls) {
      const name = calleeName(call);
      if (!HOOK_NAME.test(name)) continue;
      const kind = classifyHookCall(call);
      if (!kind) continue;
      counts[kind]++;
      violations.push({
        file: path,
        line: call.getStartLineNumber?.() ?? 0,
        hook: name,
        kind,
        detail: describe(kind, name),
      });
    }
  }

  return {
    violations,
    filesScanned: scanned,
    counts,
    ok: violations.length === 0,
  };
}

/**
 * WRITE-TIME steering note for the Rules-of-Hooks violations in a JUST-WRITTEN file (M1-S1.1,
 * prevent-not-heal): a concise, model-actionable message appended to the write_file/edit_file tool
 * result so the builder fixes the hook IN THE SAME TURN, instead of shipping a runtime crash that the
 * post-build readiness gate would only catch later (the exact class that crashed the finance app:
 * useMemo@useChartData.ts:86). Returns '' when the file is clean. Pure — never throws.
 */
export function hookViolationWriteNote(report: HooksReport): string {
  if (!report || report.ok || !Array.isArray(report.violations) || report.violations.length === 0) return '';
  // Include the file on each line so a multi-file batch write is unambiguous (M1-S1.2). For a single-file
  // write the file is redundant with the "Edited X" prefix but harmless.
  const lines = report.violations.slice(0, 5).map((v) => `  • ${v.file}:${v.line}: ${v.hook} — ${v.detail}`);
  const more = report.violations.length > 5 ? `\n  …and ${report.violations.length - 5} more.` : '';
  return (
    `\n⚠️ RULES OF HOOKS — FIX THIS NOW (it crashes React at runtime): a React Hook in this file is not ` +
    `called unconditionally at the top level, so the hook order changes between renders.\n${lines.join('\n')}${more}\n` +
    `  Move every hook ABOVE any early return, and OUT of any if/else/ternary/loop/callback, then re-write the file.`
  );
}

/**
 * A precise, model-actionable repair instruction for a POST-BUILD bounded heal pass (build-report
 * autopsy 2026-08-02, buildId 84902e18: a weak-tier invoicing app shipped a `useMemo` called
 * conditionally → runtime crash → NOT READY 32/100). Unlike the general build loop, this hands the
 * healer the EXACT file:line, hook and rule broken, so even a weak coder can make the focused fix.
 * Returns '' when the report is clean. Pure — never throws.
 */
export function hooksRepairInstruction(report: HooksReport): string {
  if (!report || report.ok || !Array.isArray(report.violations) || report.violations.length === 0) return '';
  const lines = report.violations.slice(0, 8).map((v) => `  • ${v.file}:${v.line} — ${v.hook} (${v.kind}): ${v.detail}`);
  const more = report.violations.length > 8 ? `\n  …and ${report.violations.length - 8} more.` : '';
  return (
    `The app crashes at runtime because of React Rules-of-Hooks violations — a hook is not called ` +
    `unconditionally at the top level of its component/custom hook, so the hook order changes between ` +
    `renders. Fix EACH file listed:\n${lines.join('\n')}${more}\n` +
    `For each: move the hook ABOVE any early return and OUT of any if/else/ternary/&&/||/loop/callback, ` +
    `so it always runs on every render in the same order — preserve the component's behaviour, then ` +
    `re-write the file(s). Change nothing else.`
  );
}

function describe(kind: HookViolationKind, hook: string): string {
  switch (kind) {
    case 'conditional-hook':
      return `${hook} is called conditionally. Hooks must run in the same order every render — move it to the top level of the component/hook.`;
    case 'hook-after-return':
      return `${hook} is called after an early return, making it conditional. Move all hooks above any return.`;
    case 'hook-in-loop':
      return `${hook} is called inside a loop. Hooks cannot be called in loops — call it at the top level.`;
    case 'hook-in-callback':
      return `${hook} is called from a nested function (e.g. an event handler or .map callback). Hooks can only be called from a component or a custom hook.`;
  }
}
