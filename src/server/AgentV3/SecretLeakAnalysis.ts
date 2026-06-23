// AgentV3 — Security: secret-leak check (Section I #4 v1).
//
// The single most common real secret leak is a committed `.env`: the file holds
// live API keys / DB passwords and, if it is not gitignored, it gets committed and
// the secrets are exposed forever in git history. This PURE, deterministic analyser
// flags a real .env file (NOT .env.example/.sample/.template) that the project's
// .gitignore does not cover.
//
// High-precision: only fires when an actual secret-bearing env file exists and the
// .gitignore does not mention .env, so a well-configured project is never nagged.

export interface SecretLeakReport {
  /** Whether there was a secret-bearing env file to assess. */
  assessed: boolean;
  /** Real env files (excluding examples/templates) that are not gitignored. */
  exposed: string[];
  findings: Array<{ level: 'high'; message: string }>;
}

const base = (p: string): string => p.split('/').pop() || p;

// A real, secret-bearing env file (not a shareable template).
const REAL_ENV = /^\.env(\.|$)/;
const TEMPLATE = /\.(example|sample|template|dist|defaults?)$/i;

/** True if the .gitignore content has a non-comment line that references .env. */
function gitignoreCoversEnv(gitignore: string | null | undefined): boolean {
  if (!gitignore) return false;
  return gitignore
    .split(/\r?\n/)
    .map((l) => l.trim())
    .some((l) => l && !l.startsWith('#') && /\.env\b|\.env\*|\*\.env/.test(l));
}

/**
 * Flag committed-secret risk: a real .env file not covered by .gitignore. PURE.
 * `files` is the real file list; `gitignore` is the .gitignore content (or null).
 */
export function analyzeSecretLeak(files: string[], gitignore: string | null | undefined): SecretLeakReport {
  const list = Array.isArray(files) ? files : [];
  const realEnv = list.filter((f) => {
    const b = base(f);
    return REAL_ENV.test(b) && !TEMPLATE.test(b);
  });
  if (realEnv.length === 0) return { assessed: false, exposed: [], findings: [] };

  if (gitignoreCoversEnv(gitignore)) {
    return { assessed: true, exposed: [], findings: [] };
  }

  const exposed = [...new Set(realEnv)];
  return {
    assessed: true,
    exposed,
    findings: [
      {
        level: 'high',
        message: `Secret leak risk: ${exposed.join(', ')} ${exposed.length === 1 ? 'is' : 'are'} not covered by .gitignore — the file holds live secrets and will be committed to git. Add ".env" to .gitignore now (and rotate any key already committed).`,
      },
    ],
  };
}

/** A short, honest secret-leak block for the `evaluate` output. */
export function secretLeakSummary(report: SecretLeakReport): string {
  if (!report.assessed) return 'Secret leak: — (no .env file to assess).';
  if (report.findings.length === 0) return 'Secret leak: ✓ .env files are gitignored.';
  return ['Secret leak — CRITICAL:', ...report.findings.map((f) => `  ⚠ ${f.message}`)].join('\n');
}
