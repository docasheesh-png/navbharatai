/**
 * NO REAL SECRET IS COMMITTED (security audit 2026-11-21, point 24: "secret scanning in CI — could not find any").
 *
 * Every tracked text file is scanned with the SAME high-severity credential rules the built-app scanner uses
 * (SecurityAnalysis.ts: provider tokens, AWS keys, private keys, credentials in URLs / connection strings, hardcoded
 * auth headers and secrets). No new tool and no new dependency: it runs inside the normal test step on every PR.
 *
 * It is a RATCHET. The findings present on 2026-11-26 were each read by hand and are synthetic test fixtures, docs, the
 * scanner's own message, or local development defaults — none is a real key. They live in
 * tests/fixtures/secretScanBaseline.json with a reason, keyed by file + rule + a hash of the line, so editing such a line
 * re-opens it. Anything NEW fails: remove the secret (and rotate it — a pushed key is leaked), or, only when it is
 * genuinely not a secret, add it to the baseline with the reason.
 *
 * ⚠️ This reads the CURRENT tree, not git history. Keys already in history are revoked at the provider (queue row Q-611).
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { scanSecurity } from '../src/server/AgentV3/SecurityAnalysis';

const RULES = new Set([
  'hardcoded-provider-token', 'aws-access-key', 'private-key', 'hardcoded-secret',
  'connection-string-credentials', 'url-embedded-credentials', 'hardcoded-auth-header',
]);
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml|env|sh|md|html|toml|plist|xml|gradle|properties|txt)$/i;
const BASELINE_PATH = 'tests/fixtures/secretScanBaseline.json';

/** `file|rule|hash(line)` — the identity of one finding. PURE. */
export function findingKey(file: string, rule: string, line: string): string {
  return `${file}|${rule}|${createHash('sha256').update(line.trim()).digest('hex').slice(0, 16)}`;
}

function currentFindings(): string[] {
  const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter((f) => f && TEXT.test(f) && f !== BASELINE_PATH);
  const keys: string[] = [];
  for (const f of files) {
    let src = '';
    try { if (statSync(f).size > 2_000_000) continue; src = readFileSync(f, 'utf8'); } catch { continue; }
    const lines = src.split(/\r?\n/);
    for (const x of scanSecurity(f, src)) {
      if (!RULES.has(x.rule) || x.severity !== 'high') continue;
      keys.push(findingKey(f, x.rule, lines[x.line - 1] ?? ''));
    }
  }
  return [...new Set(keys)].sort();
}

describe('no real secret is committed', () => {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Record<string, string>;
  const found = currentFindings();

  it('every credential-shaped line in the tree is a reviewed non-secret', () => {
    const fresh = found.filter((k) => !(k in baseline));
    expect(fresh, 'A credential-shaped value was committed. Remove it and rotate it; only a genuine non-secret goes in ' + BASELINE_PATH + ' with a reason.').toEqual([]);
  });
  it('the baseline only shrinks — a reviewed line that is gone leaves it', () => {
    const stale = Object.keys(baseline).filter((k) => !found.includes(k));
    expect(stale, 'Remove these from ' + BASELINE_PATH).toEqual([]);
  });
  it('every baseline entry says why it is not a secret', () => {
    for (const [k, why] of Object.entries(baseline)) expect(why.length, k).toBeGreaterThan(20);
  });
  it('the key changes when the line changes (an edited line is re-reviewed)', () => {
    expect(findingKey('a.ts', 'aws-access-key', 'x')).not.toBe(findingKey('a.ts', 'aws-access-key', 'y'));
    expect(findingKey('a.ts', 'aws-access-key', '  x ')).toBe(findingKey('a.ts', 'aws-access-key', 'x'));
  });
});
