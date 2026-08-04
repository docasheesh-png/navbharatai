import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// The admin asked: "user ki API safe rahengi? encrypted hai na?" These tests lock the two privacy
// guarantees so a future edit can't silently regress them:
//  1. The API Tester never persists a secret-bearing header (Authorization/Cookie/api-key) to
//     localStorage history — a saved request must not leave a token in plaintext on disk.
//  2. The server proxy is stateless: it never logs or stores the user's URL/headers/body/token, and
//     attaches none of NavBharatAI's own credentials (a plain, transient outbound fetch over TLS).

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('API Tester — client never stores secrets to localStorage', () => {
  const src = read('src/components/ide/APITester.tsx');
  it('strips sensitive headers before writing history', () => {
    expect(src).toContain('stripSensitiveHeaders');
    expect(src).toContain('headers: stripSensitiveHeaders(cfg.headers)');
    expect(src).toMatch(/SENSITIVE_HEADER_RE\s*=\s*\/\^\(authorization\|cookie/i);
  });
  it('the dedicated Bearer auth token is not part of the saved request shape', () => {
    // addToHistory saves { name, method, url, headers, body } — the `authToken` state is never included.
    expect(src).toContain("addToHistory({ name: saveName || finalUrl, method, url: finalUrl, headers, body })");
    expect(src).not.toMatch(/addToHistory\([^)]*authToken/);
  });
});

describe('API Tester proxy — stateless, logs/stores nothing, no NavBharatAI credentials', () => {
  const proxy = read('src/server/routes/devtoolsProxy.ts');
  it('never logs the request (no console.* in the handler)', () => {
    expect(proxy).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });
  it('does not persist the request anywhere (no store/db/audit write)', () => {
    expect(proxy).not.toMatch(/\.set\(|\.save\(|\.insert\(|audit\(|Store\.|firestore|getDb\(/);
  });
  it('drops cookies and never attaches credentials on the outbound fetch', () => {
    expect(proxy).toContain("'cookie'"); // cookie is in the blocked request-header set
    expect(proxy).not.toMatch(/credentials:\s*'include'/);
  });
});
