// AgentV3 — Environment Variable Completeness analysis (additive sixth evaluate dimension).
//
// Real static scanning over the project's actual source vs its `.env.example`, for a
// common "your app won't run for the user" defect: code reads `process.env.X` or
// `import.meta.env.X`, but X is never documented in `.env.example`, so the user has no
// idea which variables to set and the app fails at runtime. Findings are computed
// deterministically from real content so the `evaluate` tool can report concrete
// missing-env defects for the team to fix — never a synthetic "looks complete".
//
// Pure and deterministic: no I/O. The caller (ToolDispatcher.evaluate) collects the
// referenced names from real source and reads `.env.example` best-effort.

export interface EnvVarIssue {
  name: string;
  severity: 'high' | 'low';
  detail: string;
}

const MAX_ISSUES = 40;

/** Paths that are NOT code we should scan for env references. */
const SKIP_PATH = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__|(^|[\\/])tests?([\\/]|$)|(^|[\\/])\.env(\.|$)|(^|[\\/])\.env[^\\/]*$/i;

/** Uppercase env-style names only (e.g. API_KEY, VITE_URL). */
const ENV_NAME = '[A-Z_][A-Z0-9_]*';

/**
 * Match `process.env.NAME`, `process.env['NAME']`, `process.env["NAME"]`,
 * `import.meta.env.NAME`, and the bracket forms of `import.meta.env`. Global so we
 * capture every reference in the file; the alternation captures the name group from
 * whichever form matched.
 */
const REF_RE = new RegExp(
  '(?:process\\.env|import\\.meta\\.env)' +
    `(?:\\.(${ENV_NAME})|\\[\\s*['"\`](${ENV_NAME})['"\`]\\s*\\])`,
  'g',
);

/**
 * Well-known framework/runtime variables that are always present (or builtin to the
 * toolchain), so a missing `.env.example` entry for them is not a real defect. Skipping
 * these avoids noisy false positives.
 */
const ALWAYS_PRESENT = new Set<string>([
  'NODE_ENV', 'PORT', 'HOST', 'PWD', 'HOME', 'PATH', 'CI',
  // Vite `import.meta.env` builtins.
  'BASE_URL', 'MODE', 'DEV', 'PROD', 'SSR',
]);

/** True for vars we never flag (allowlisted builtins, plus npm_* runtime vars). */
function isAlwaysPresent(name: string): boolean {
  return ALWAYS_PRESENT.has(name) || name.startsWith('npm_');
}

/**
 * Extract the env-var NAMES referenced in one file's content. Matches
 * `process.env.NAME` / bracket forms and `import.meta.env.NAME` / bracket forms,
 * capturing only uppercase env-style names. De-dupes within the file. Returns [] for
 * files whose path is test/`node_modules`/`dist`/`.env*` (not code).
 */
export function extractEnvRefs(file: string, content: string): string[] {
  if (SKIP_PATH.test(file)) return [];
  const found = new Set<string>();
  REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(content)) !== null) {
    const name = m[1] ?? m[2];
    if (name) found.add(name);
  }
  return [...found];
}

/**
 * Parse a `.env.example` (or `.env`) file into the set of declared KEY names. For each
 * non-comment, non-blank line of the form `KEY=...` (optionally `export KEY=...`),
 * collect KEY. Null/empty content → empty set.
 */
export function parseEnvKeys(envExampleContent: string | null): Set<string> {
  const keys = new Set<string>();
  if (!envExampleContent) return keys;
  for (const raw of envExampleContent.split('\n')) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) keys.add(key);
  }
  return keys;
}

/**
 * For each unique referenced env var NOT in `documentedKeys` and NOT an always-present
 * framework/runtime var, produce a `high` issue. One-directional by design: we do not
 * flag documented-but-unused vars (keeps the report low-noise). Capped at MAX_ISSUES.
 */
export function analyzeEnvVars(
  referenced: string[],
  documentedKeys: Set<string>,
): EnvVarIssue[] {
  const issues: EnvVarIssue[] = [];
  const seen = new Set<string>();
  for (const name of referenced) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (documentedKeys.has(name)) continue;
    if (isAlwaysPresent(name)) continue;
    issues.push({
      name,
      severity: 'high',
      detail: `'${name}' is read in code but not documented in .env.example`,
    });
    if (issues.length >= MAX_ISSUES) break;
  }
  return issues;
}

/** A concise, honest environment-variable completeness report for the agent (and user). */
export function envVarSummary(issues: EnvVarIssue[]): string {
  if (issues.length === 0) {
    return 'Env var check: ✓ All referenced environment variables are documented in .env.example.';
  }
  const head = `Env var check: ${issues.length} undocumented variable(s) read in code.`;
  const shown = issues.slice(0, 15);
  const body = shown.map((x) => `  - [${x.severity}] ${x.name} — ${x.detail}`);
  const more = issues.length > shown.length ? [`  …and ${issues.length - shown.length} more.`] : [];
  const hint = 'Add these to .env.example so the app can run.';
  return [head, ...body, ...more, hint].join('\n');
}
