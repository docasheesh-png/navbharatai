// AgentV3 — Security: real secrets in committed env templates (Section I #4 v7).
//
// A `.env.example` / `.env.sample` / `.env.template` is COMMITTED and must contain only
// placeholders. When a real API key/token is left in one (a common copy-paste slip), the
// live secret is exposed in git history forever. The source-code secret scan does not
// catch this — it matches quoted assignments in code, not `KEY=sk-realkey` lines in an
// env file. This PURE, deterministic scanner flags env-template VALUES that match a real,
// distinctive secret format. The ".env not gitignored" case is handled separately by
// SecretLeakAnalysis.

export interface EnvTemplateSecretIssue {
  file: string;
  line: number;
  key: string;
  kind: string;
}

const TEMPLATE_RE = /(^|[\\/])\.env\.(example|sample|template|dist|defaults?)$/i;

// Distinctive, real secret formats — matching one of these in an env template is almost
// certainly a real leaked credential (placeholders never look like this).
const SECRET_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'openai/anthropic key', re: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { kind: 'stripe live key', re: /\b[rs]k_live_[A-Za-z0-9]{16,}/ },
  { kind: 'aws access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'github token', re: /\bgh[posru]_[A-Za-z0-9]{30,}/ },
  { kind: 'xai key', re: /\bxai-[A-Za-z0-9_-]{16,}/ },
  { kind: 'google api key', re: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { kind: 'slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
];

const PLACEHOLDER = /(your[_-]?|example|placeholder|xxx+|<|changeme|dummy|redacted|\.\.\.)/i;

/** True for a committed, shareable env template (not a real secret-bearing .env). */
export function isEnvTemplateFile(file: string): boolean {
  return TEMPLATE_RE.test(file);
}

/** Scan one env-template file for real secret values. PURE. */
export function scanEnvTemplateSecrets(file: string, content: string): EnvTemplateSecretIssue[] {
  if (!isEnvTemplateFile(file) || !content) return [];
  const issues: EnvTemplateSecretIssue[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"`]/, '').replace(/['"`]$/, '');
    if (!value || PLACEHOLDER.test(value)) continue;
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(value)) {
        issues.push({ file, line: i + 1, key, kind: p.kind });
        break;
      }
    }
  }
  return issues;
}

/** A short, honest env-template-secret block for the `evaluate` output. */
export function envTemplateSecretSummary(issues: EnvTemplateSecretIssue[]): string {
  if (issues.length === 0) return 'Env template secrets: ✓ no real secrets in committed env templates.';
  const head = `Env template secrets — ${issues.length} REAL secret value(s) committed in an env template (rotate the key now, replace with a placeholder):`;
  const body = issues.slice(0, 10).map((x) => `  ⚠ ${x.file}:${x.line} — ${x.key} looks like a real ${x.kind}.`);
  return [head, ...body].join('\n');
}
