// AgentV3 — Frontend runtime readiness: Vite client env-var exposure (Section I #5).
//
// In a Vite app, ONLY env vars prefixed `VITE_` (plus the builtins MODE / DEV / PROD /
// BASE_URL / SSR) are exposed to client code through `import.meta.env`. Reading
// `import.meta.env.API_KEY` (no VITE_ prefix) yields `undefined` in the browser at
// runtime — a silent breakage that compiles and "looks" fine. This PURE, deterministic
// scanner flags such references so they get renamed to VITE_*.
//
// Precision: only `import.meta.env.<UPPER_SNAKE>` references are considered; the caller
// SKIPS this check entirely when the project's vite config customises `envPrefix`
// (then a different prefix may be valid and we cannot be sure).

export interface ViteEnvIssue {
  file: string;
  line: number;
  name: string;
}

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/i;
/** Vite's built-in import.meta.env members, valid without a VITE_ prefix. */
const VITE_BUILTINS = new Set<string>(['MODE', 'DEV', 'PROD', 'BASE_URL', 'SSR']);
// import.meta.env.NAME or import.meta.env['NAME'] — uppercase env-style names only.
const REF_RE = /import\.meta\.env(?:\.([A-Z_][A-Z0-9_]*)|\[\s*['"`]([A-Z_][A-Z0-9_]*)['"`]\s*\])/g;

/** Scan one file for non-VITE_-prefixed import.meta.env references. PURE. */
export function scanViteEnvExposure(file: string, content: string): ViteEnvIssue[] {
  if (!CODE_RE.test(file) || !content) return [];
  const issues: ViteEnvIssue[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\/\/|\*)/.test(line)) continue; // skip comments
    REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REF_RE.exec(line)) !== null) {
      const name = m[1] ?? m[2];
      if (!name) continue;
      if (name.startsWith('VITE_') || VITE_BUILTINS.has(name)) continue;
      issues.push({ file, line: i + 1, name });
    }
  }
  return issues;
}

/** Does a vite config customise `envPrefix`? If so the caller must skip the check. */
export function hasCustomEnvPrefix(viteConfigContent: string | null): boolean {
  return !!viteConfigContent && /\benvPrefix\b/.test(viteConfigContent);
}

/** A short, honest Vite client-env block for the `evaluate` output. */
export function viteEnvSummary(issues: ViteEnvIssue[]): string {
  if (issues.length === 0) return 'Vite client env: ✓ client env vars are VITE_-prefixed (or none used).';
  const head = `Vite client env — ${issues.length} non-VITE_ import.meta.env reference(s) (undefined in the browser):`;
  const body = issues
    .slice(0, 10)
    .map((x) => `  ⚠ ${x.file}:${x.line} — import.meta.env.${x.name} → rename to VITE_${x.name} so Vite exposes it to the client.`);
  return [head, ...body].join('\n');
}
