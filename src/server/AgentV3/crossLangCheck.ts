// B6 (roadmap Tier 2A) — cross-language typecheck / compile check, not just frontend `tsc`.
//
// v3.0 now builds polyglot apps (TS + Python + Java + Go). "Verified" must mean every language in
// the workspace actually compiles — a Java or Python or Go type/compile error is just as fatal as a
// TS one. This module is PURE: detection reads the file tree + package.json; parsing reads a command's
// raw output. The ToolDispatcher `typecheck` tool runs each detected check via the sandbox actuator.

export type CheckLang = 'ts' | 'python' | 'java' | 'go';

export interface CheckPlan {
  language: CheckLang;
  /** Command to run in the workspace root. */
  command: string;
  /** Honest one-line reason this check applies (surfaced to the agent). */
  reason: string;
}

export interface CheckOutcome {
  language: CheckLang;
  command: string;
  exitCode: number;
  /** The compiler/type-checker exited clean. */
  ok: boolean;
  /** Best-effort count of reported errors; null when it couldn't be parsed. */
  errorCount: number | null;
  /** First few error lines (for the agent to act on). */
  firstErrors: string[];
  summary: string;
}

function hasScript(pkgRaw: string | undefined, name: string): boolean {
  if (!pkgRaw) return false;
  try {
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
    return typeof pkg.scripts?.[name] === 'string' && pkg.scripts[name].trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Detect every language-level compile/typecheck a workspace needs — one plan per language present.
 * Pure. Returns [] when nothing checkable is found (an honest "nothing to check").
 */
export function detectChecks(files: string[], packageJsonRaw?: string): CheckPlan[] {
  const has = (re: RegExp) => files.some(f => re.test(f));
  const plans: CheckPlan[] = [];

  // TypeScript — prefer the project's own `typecheck` script, else `tsc --noEmit` when a tsconfig exists.
  if (has(/(^|\/)tsconfig(\.[\w-]+)?\.json$/) && has(/\.tsx?$/)) {
    if (hasScript(packageJsonRaw, 'typecheck')) {
      plans.push({ language: 'ts', command: 'npm run typecheck', reason: 'package.json defines a typecheck script.' });
    } else {
      // `--no-install` forces the project's LOCAL typescript; bare `npx tsc` downloads an unrelated
      // squatter package ("This is not the tsc command…") when typescript isn't installed yet.
      plans.push({ language: 'ts', command: 'npx --no-install tsc --noEmit', reason: 'tsconfig present — type-checking the TS/TSX sources.' });
    }
  }

  // Python — compile every module (catches syntax/compile errors without needing a mypy config).
  if (has(/\.py$/)) {
    plans.push({ language: 'python', command: 'python -m compileall -q .', reason: 'Python sources present — compiling all modules.' });
  }

  // JVM — prefer Maven (`mvn compile`), else Gradle (`gradlew classes`, which compiles the Java AND
  // Kotlin main source sets). Both surface type/compile errors. `else if` so a repo carrying both build
  // files doesn't push two competing Java plans (Maven wins, matching the run_tests precedence).
  if (has(/(^|\/)pom\.xml$/)) {
    plans.push({ language: 'java', command: 'mvn -q -B compile', reason: 'Maven pom.xml — compiling the Java sources.' });
  } else if (has(/(^|\/)build\.gradle(\.kts)?$/)) {
    const wrapper = has(/(^|\/)gradlew$/);
    plans.push({
      language: 'java',
      command: wrapper ? './gradlew classes' : 'gradle classes',
      reason: wrapper
        ? 'Gradle build file + gradlew wrapper — compiling the JVM sources (./gradlew classes).'
        : 'Gradle build file — compiling the JVM sources (gradle classes).',
    });
  }

  // Go — `go build ./...` type-checks and compiles every package.
  if (has(/\.go$/)) {
    plans.push({ language: 'go', command: 'go build ./...', reason: 'Go sources present — building all packages.' });
  }

  return plans;
}

const uniqFirst = (lines: string[], n: number): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    const t = l.trim();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); if (out.length >= n) break; }
  }
  return out;
};

/** Interpret a check command's output into an honest outcome. Pure. Exit code is authoritative for ok. */
export function parseCheckOutcome(
  plan: CheckPlan,
  exitCode: number,
  stdout: string,
  stderr: string,
): CheckOutcome {
  const out = `${stdout}\n${stderr}`;
  const lines = out.split('\n');
  let errorCount: number | null = null;
  let errorLines: string[] = [];

  switch (plan.language) {
    case 'ts': {
      errorLines = lines.filter(l => /error TS\d+/.test(l));
      // tsc prints "Found N errors" — trust it when present, else fall back to the matched line count.
      const found = out.match(/Found\s+(\d+)\s+error/i);
      errorCount = found ? parseInt(found[1], 10) : errorLines.length || (exitCode === 0 ? 0 : null);
      break;
    }
    case 'go': {
      errorLines = lines.filter(l => /\.go:\d+:\d+:/.test(l));
      errorCount = errorLines.length || (exitCode === 0 ? 0 : null);
      break;
    }
    case 'java': {
      // Maven "[ERROR]", javac "Foo.java:12:" (also Gradle's Java compile), and Kotlin "e: Foo.kt: …".
      errorLines = lines.filter(l => /\[ERROR\]/.test(l) || /\.java:\[?\d+/.test(l) || /^e:\s/.test(l.trim()));
      errorCount = errorLines.length || (exitCode === 0 ? 0 : null);
      break;
    }
    case 'python': {
      errorLines = lines.filter(l => /Error|error:/.test(l) && !/0 error/i.test(l));
      errorCount = errorLines.length || (exitCode === 0 ? 0 : null);
      break;
    }
  }

  const ok = exitCode === 0;
  const firstErrors = uniqFirst(errorLines, 5);
  const summary = `${plan.language}: ${ok ? 'OK' : `FAIL${errorCount != null ? ` (${errorCount} error${errorCount === 1 ? '' : 's'})` : ''}`}`;
  return { language: plan.language, command: plan.command, exitCode, ok, errorCount: ok ? 0 : errorCount, firstErrors, summary };
}
