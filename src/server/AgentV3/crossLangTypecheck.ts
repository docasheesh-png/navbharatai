// B6 (roadmap Tier 2A) — cross-language TYPE-CHECK. `tsc` (TscGate) already type-checks TS/JS; this
// closes the gap for a polyglot app by planning + interpreting a Python (mypy), Java (javac via
// Maven/Gradle) and Go (`go build ./...`) type/compile check alongside it, so "it compiles" is judged for
// EVERY language the app ships, not just TypeScript. Mirrors testRunner.ts (B4): PURE detection + parsing
// here; the actual run rides the sandbox actuator (the `typecheck` tool). Advisory — reports honest error
// counts, never a fake "clean".
//
// HONEST SCOPE: execution needs the toolchain present in the sandbox — Java IS (JDK 17 + Maven, AB-1/AB-2),
// Python's `mypy` and Go's toolchain may need an install; a missing tool surfaces as an honest "could not
// run", never a fake pass. Detection + command planning + output parsing are pure + fully unit-tested.

export type TypecheckLang = 'python' | 'java' | 'go';

export interface TypecheckPlan {
  lang: TypecheckLang;
  /** The shell command to run in the sandbox. */
  command: string;
  /** Why this plan was chosen (the detected signal). */
  reason: string;
}

export interface TypecheckOutcome {
  lang: TypecheckLang;
  /** True only when the check RAN and found no errors. */
  ok: boolean;
  /** False when the tool could not execute at all (missing tool / command threw) — distinct from "ran + failed". */
  ran: boolean;
  errorCount: number;
  /** A few representative error lines (capped). */
  firstErrors: string[];
}

function hasExt(files: string[], re: RegExp): boolean {
  return files.some((f) => typeof f === 'string' && re.test(f) && !/(^|\/)(node_modules|\.git|dist|build|target|__pycache__|venv|\.venv|vendor)\//.test(f));
}

/**
 * Plan the non-TS type/compile checks for a polyglot project. Pure. Returns one plan per language whose
 * source files are present. TS/JS is deliberately excluded (TscGate/tsc already own it).
 * `files` = the project's file paths; `configs` = a small map of key config file contents (optional).
 */
export function detectTypecheckPlan(files: string[], configs: Record<string, string> = {}): TypecheckPlan[] {
  const out: TypecheckPlan[] = [];
  if (!Array.isArray(files)) return out;

  // Python — prefer mypy (a real type checker); fall back to a py_compile syntax check.
  if (hasExt(files, /\.py$/)) {
    const pyproject = configs['pyproject.toml'] || '';
    const reqs = configs['requirements.txt'] || configs['requirements-dev.txt'] || '';
    const hasMypy = /\bmypy\b/.test(pyproject) || /\bmypy\b/i.test(reqs) || files.some((f) => /(^|\/)mypy\.ini$/.test(f)) || /\[tool\.mypy\]/.test(pyproject);
    out.push(
      hasMypy
        ? { lang: 'python', command: 'mypy . --no-error-summary --hide-error-context', reason: 'Python sources + mypy configured' }
        : { lang: 'python', command: 'python -m mypy . --ignore-missing-imports --no-error-summary || python -m py_compile $(git ls-files "*.py")', reason: 'Python sources present (mypy if available, else a syntax compile)' },
    );
  }

  // Java — compile via the project's build tool (compile == the type check for Java).
  if (hasExt(files, /\.java$/)) {
    const hasMaven = files.some((f) => /(^|\/)pom\.xml$/.test(f));
    const hasGradle = files.some((f) => /(^|\/)build\.gradle(\.kts)?$/.test(f));
    if (hasMaven) out.push({ lang: 'java', command: 'mvn -q -DskipTests compile', reason: 'Java sources + pom.xml (Maven)' });
    else if (hasGradle) out.push({ lang: 'java', command: './gradlew -q compileJava', reason: 'Java sources + build.gradle (Gradle)' });
    else out.push({ lang: 'java', command: 'javac -d /tmp/nbi-javac $(git ls-files "*.java")', reason: 'Java sources present (plain javac)' });
  }

  // Go — `go build ./...` type-checks AND compiles every package (Go has no separate type-checker; the
  // compiler is the type check). Fails on an unused import/variable or a type mismatch, exactly like tsc.
  if (hasExt(files, /\.go$/)) {
    out.push({ lang: 'go', command: 'go build ./...', reason: 'Go sources present (go build type-checks + compiles every package)' });
  }

  return out;
}

const MYPY_COUNT = /Found (\d+) errors?/i;
const MYPY_ERROR_LINE = /^[^\s].*: error:/;
const JAVAC_ERROR_LINE = /error:|\berror\b.*\.java|\[ERROR\]/i;
// `go build` prints "path/file.go:LINE:COL: message" per error, plus a bare "# package" header line.
const GO_ERROR_LINE = /\.go:\d+(?::\d+)?:/;

/**
 * Interpret a type/compile check's raw output into an honest outcome. Pure. `exitCode` null/undefined =
 * the command could not execute (missing tool) → ran:false (never a fake pass).
 */
export function parseTypecheckOutcome(
  lang: TypecheckLang,
  exitCode: number | null | undefined,
  stdout: string,
  stderr: string,
): TypecheckOutcome {
  const text = `${stdout || ''}\n${stderr || ''}`;
  // A tool-not-found / could-not-execute signal → ran:false (honest "unknown", not a pass).
  if (exitCode === null || exitCode === undefined || /command not found|No such file|is not recognized|ModuleNotFoundError: No module named ['"]?mypy|go: command not found/i.test(text)) {
    return { lang, ok: false, ran: false, errorCount: 0, firstErrors: [] };
  }
  const lineRe = lang === 'python' ? MYPY_ERROR_LINE : lang === 'go' ? GO_ERROR_LINE : JAVAC_ERROR_LINE;
  const errLines = text.split(/\r?\n/).filter((l) => lineRe.test(l.trim()));
  let errorCount = errLines.length;
  const m = text.match(MYPY_COUNT);
  if (lang === 'python' && m) errorCount = Number(m[1]);
  const ok = exitCode === 0 && errorCount === 0;
  // If the process failed but we parsed no specific lines, treat exit!=0 as at least one error (honest).
  if (!ok && errorCount === 0 && exitCode !== 0) errorCount = 1;
  return { lang, ok, ran: true, errorCount, firstErrors: errLines.slice(0, 6).map((l) => l.trim().slice(0, 300)) };
}

/** Advisory summary line for the `evaluate`/tool output, or '' when there is nothing non-TS to report. Pure. */
export function typecheckSummary(outcomes: TypecheckOutcome[]): string {
  if (!outcomes || outcomes.length === 0) return '';
  const parts: string[] = [];
  for (const o of outcomes) {
    if (!o.ran) { parts.push(`  ⏭️ ${o.lang}: type-check could not run (toolchain not available in the sandbox).`); continue; }
    if (o.ok) { parts.push(`  ✓ ${o.lang}: type-checks clean.`); continue; }
    const head = `  ⚠️ ${o.lang}: ${o.errorCount} type/compile error(s).`;
    parts.push([head, ...o.firstErrors.slice(0, 3).map((e) => `      ${e}`)].join('\n'));
  }
  return `Cross-language type-check (beyond tsc):\n${parts.join('\n')}`;
}
