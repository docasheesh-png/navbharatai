// Forensic audit 2026-10-04 — no character of a secret's VALUE may reach a log line, a file on disk, or
// an unauthenticated response.
//
// THE CLASS. Four places each "masked" a key by keeping some of its characters, and each believed a few
// characters were harmless:
//   • server.ts wrote `test_environment_debug.json` on every boot (production included) with the first six
//     characters of EVERY environment variable;
//   • audit_env.ts logged the first four and last four characters of four Gemini key names on every boot;
//   • aiClients.resolveApiKey logged six + four characters of the key on every AI call;
//   • GET /api/agentv3/diag answered anyone on the internet with the key's prefix, the provider and model
//     names, and ran a real paid probe for them.
// A secret with ten known characters has ten fewer to guess, and a log is read by far more people than
// the secret manager. Presence and length diagnose a missing or truncated key; nothing more is needed.
//
// These tests are behavioural where the code can be run (a planted key never appears in what is logged)
// and a source census where it cannot (a NEW sibling — any log line that slices a key-named value — fails
// the build).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PLANTED = 'AIzaPLANTEDsecretVALUE0123456789abcdefXY';

/** Every 4-character window of the planted value — a log that contains any of them leaked material. */
function leaksPlanted(text: string): boolean {
  for (let i = 0; i + 4 <= PLANTED.length; i++) {
    if (text.includes(PLANTED.slice(i, i + 4))) return true;
  }
  return false;
}

function captureConsole(): { lines: () => string; restore: () => void } {
  const out: string[] = [];
  const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { out.push(args.map(String).join(' ')); }));
  return { lines: () => out.join('\n'), restore: () => spies.forEach((s) => s.mockRestore()) };
}

afterEach(() => { vi.unstubAllEnvs(); });

describe('a key that is used is never written, in any part, to the log', () => {
  it('auditEnv reports presence and length only', async () => {
    vi.stubEnv('GEMINI_API_KEY', PLANTED);
    const { auditEnv } = await import('../src/server/audit_env');
    const cap = captureConsole();
    try { auditEnv(); } finally { cap.restore(); }
    expect(cap.lines()).toContain('GEMINI_API_KEY Exists: true');
    expect(cap.lines()).toContain(`Length: ${PLANTED.length}`);
    expect(leaksPlanted(cap.lines())).toBe(false);
  });

  it('resolveApiKey logs no character of a SYSTEM key', async () => {
    vi.stubEnv('GEMINI_API_KEY', PLANTED);
    const { resolveApiKey } = await import('../src/server/lib/aiClients');
    const cap = captureConsole();
    let r: { key: string | null } = { key: null };
    try { r = resolveApiKey('gemini'); } finally { cap.restore(); }
    expect(r.key).toBe(PLANTED);
    expect(leaksPlanted(cap.lines())).toBe(false);
  });

  it('resolveApiKey logs no character of a USER key', async () => {
    const { resolveApiKey } = await import('../src/server/lib/aiClients');
    const cap = captureConsole();
    let r: { key: string | null } = { key: null };
    try { r = resolveApiKey('gemini', PLANTED); } finally { cap.restore(); }
    expect(r.key).toBe(PLANTED);
    expect(leaksPlanted(cap.lines())).toBe(false);
  });
});

describe('the boot sequence writes no environment material to disk', () => {
  const server = readFileSync('server.ts', 'utf8');

  it('no environment dump file is written', () => {
    expect(server).not.toMatch(/test_environment_debug/);
    expect(server).not.toMatch(/Object\.(keys|entries|values)\(process\.env\)/);
  });

  it('the committed example file is documentation, never loaded as configuration', () => {
    expect(server).not.toMatch(/loadEnvFile\(.*\.env\.example/);
  });
});

/** Every server-side source file (the code that holds real secrets). */
function serverSources(): string[] {
  const out: string[] = ['server.ts'];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== 'node_modules' && name !== '__tests__') walk(p); continue; }
      if (/\.(ts|mjs|js)$/.test(name) && !/\.test\.|\.spec\./.test(name)) out.push(p);
    }
  };
  walk('src/server');
  return out;
}

describe('census: no NEW sibling slices a secret into a log line', () => {
  // A log call whose arguments slice a value named like a secret — `key.substring(0, 6)`, `token.slice(-4)`.
  const SECRET_NAME = '(?:[A-Za-z_]*(?:[Kk]ey|[Tt]oken|[Ss]ecret|[Pp]assword|[Pp]at))';
  const LOGGED_SLICE = new RegExp(
    `(?:console\\.(?:log|info|warn|error|debug)|logger\\.\\w+|log\\.\\w+)\\([^\\n]*\\b${SECRET_NAME}\\??\\.(?:substring|slice|substr)\\(`,
  );
  // The "masked = key.substring(...)" idiom, which only exists to be logged.
  const MASK_VAR = new RegExp(`\\bmasked\\w*\\s*=\\s*${SECRET_NAME}\\??\\.(?:substring|slice|substr)\\(`);

  it('no server file logs a slice of a key, token, secret or password', () => {
    const offenders: string[] = [];
    for (const f of serverSources()) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (LOGGED_SLICE.test(line) || MASK_VAR.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the census is live: it catches the exact lines this audit removed', () => {
    expect(MASK_VAR.test("    const masked = envKey.substring(0, 6) + '...' + envKey.substring(envKey.length - 4);")).toBe(true);
    expect(LOGGED_SLICE.test('    console.log(`[AUDIT] ${v} Prefix: ${apiKey?.substring(0, 4)}`);')).toBe(true);
  });
});

describe('the provider diagnosis is the admin\'s tool, not a public endpoint', () => {
  it('GET /api/agentv3/diag is behind the admin gate', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(src).toMatch(/app\.get\('\/api\/agentv3\/diag', requireAdmin,/);
    expect(src).not.toMatch(/lastDiagProbeTs/);
  });
});
