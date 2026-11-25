/**
 * Security audit 2026-11-21, point 20: about sixty 5xx responses sent the raw `err.message` to the client —
 * internal paths, upstream hosts, provider names (a White-Label Law breach), even a token in a clone URL. The
 * repo already had the one safe way (`httpError.ts`: sendSafeError / toSafeClientMessage); these sites simply
 * bypassed it.
 *
 * The class locked here: "a server error's own text reaches a user". Every route file is scanned; a 5xx
 * response that carries `err.message` / `String(err)` without passing it through the redactor fails, unless
 * the file is listed below with the reason its messages are safe.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { toSafeClientMessage } from '../src/server/lib/httpError';

/** Files whose 5xx messages may carry error text, and why. */
const EXEMPT: Record<string, string> = {
  'src/server/routes/admin.ts': 'admin-only screens (verifyAdminToken); the White-Label Law lets the admin see provider names and the detail is how they debug',
};

/** Lines that carry error text on purpose and are already safe. Exact substrings, each with its reason. */
const SAFE_LINES: Array<[string, string]> = [
  ["res.status(503).json({ code: err.code, error: err.message, retryable: true });", 'zipUpload: WorkspaceImportLeaseError — a message written for the user ("another import is running")'],
  ["return res.status(503).json({ error: availability.message, code: availability.code });", 'payment: cashfreePaymentsAvailability() returns curated, user-facing sentences'],
  ["detail: sanitizeDomainErrorDetail(err)", 'nbaiDomains: already sanitised by its own helper'],
  ["detail: sanitizeManagedDnsError(err)", 'nbaiDomains: already sanitised by its own helper'],
];

const RAW_ERROR_IN_5XX = /status\(5\d\d\)\.(json|send)\(.*(\b(err|e|error)\??\.message\b|String\((err|e|error)\))/;

function routeFiles(): string[] {
  const dir = 'src/server/routes';
  return [...readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => join(dir, f)), 'server.ts'];
}

describe('no 5xx response sends a raw server error to a user', () => {
  it('census: every 5xx with error text goes through the redactor', () => {
    const offenders: string[] = [];
    for (const file of routeFiles()) {
      if (EXEMPT[file]) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // a comment that quotes the old pattern is not a response
        if (!RAW_ERROR_IN_5XX.test(line)) return;
        if (/toSafeClientMessage\(|sendSafeError\(/.test(line)) return;
        if (SAFE_LINES.some(([s]) => line.includes(s))) return;
        offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, 'Use sendSafeError / toSafeClientMessage (src/server/lib/httpError.ts) for a 5xx').toEqual([]);
  });

  it('the redactor strips what leaked: links with tokens, keys and vendor names', () => {
    const raw = 'push failed: https://x-access-token:ghp_abcdefghijk@github.com/u/r.git — Anthropic API key sk-abcdefghijklmnop rejected';
    const safe = toSafeClientMessage(raw);
    expect(safe).not.toMatch(/ghp_|github\.com|sk-abcdefghijklmnop|Anthropic/);
    expect(safe).toMatch(/push failed/);
  });

  it('the reported sites now use the safe path', () => {
    const agent = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(agent).not.toMatch(/res\.status\(500\)\.json\(\{ error: err instanceof Error \? err\.message : String\(err\) \}\)/);
    expect(agent).toMatch(/sendSafeError\(res, 500, 'Could not load your conversations\.', err, 'agentv3 conversations list'\)/);
    expect(readFileSync('src/server/routes/preview.ts', 'utf8')).toMatch(/error: toSafeClientMessage\(err, 'Bundle failed'\)/);
  });
});
