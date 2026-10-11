/**
 * Audit 2026-10-11 (F2's sibling class): a WRITE that accepts a claimed identity.
 *
 * Doctor AI keyed its patient memory by the body's `userId`. The same shape lived in three more places:
 *   • `/conversations/:id/duplicate` and `/conversations/:id/name` said "verified token, never a body-supplied
 *     id" — but `resolveReadIdentity` FALLS BACK to the body's `userId` when there is no token, so anyone who
 *     knew an account's uid could rename (GitHub repo included) or copy that account's apps;
 *   • the five build-queue routes used `assertWorkspaceOwner`, whose claimed-uid fallback exists so a token
 *     blip never breaks a running build — but a queued prompt BECOMES a build on its owner's wallet.
 * Reads keep the fallback (an older bundled app without a token still opens its history). Writes never do.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES_DIR = 'src/server/routes';
const routeFiles = readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts') && !/\.test\./.test(f)).map((f) => join(ROUTES_DIR, f));

/** Each route handler block: from one `app.<verb>(` to the next. */
function handlers(src: string): Array<{ verb: string; path: string; body: string }> {
  const re = /app\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;
  const hits = [...src.matchAll(re)];
  return hits.map((m, i) => ({ verb: m[1], path: m[2], body: src.slice(m.index ?? 0, hits[i + 1]?.index ?? src.length) }));
}

describe('a write never acts as a claimed user', () => {
  it('no mutating route reads its identity through the claimed-id fallback', () => {
    const offenders: string[] = [];
    for (const f of routeFiles) {
      for (const h of handlers(readFileSync(f, 'utf8'))) {
        if (h.verb === 'get') continue;
        if (/\bresolveReadIdentity\(/.test(h.body)) offenders.push(`${f} ${h.verb.toUpperCase()} ${h.path}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('duplicate and rename take the verified identity only', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    for (const path of ['/api/agentv3/conversations/:id/duplicate', '/api/agentv3/conversations/:id/name']) {
      const h = handlers(src).find((x) => x.path === path);
      expect(h, path).toBeTruthy();
      expect(h!.body).toMatch(/await resolveWriteIdentity\(req\)/);
    }
    // The write identity has no claimed fallback outside the test runner.
    const fn = src.slice(src.indexOf('export async function resolveWriteIdentity'), src.indexOf('export async function resolveReadIdentity'));
    expect(fn).toMatch(/verified \? \{ userId: verified\.uid, email: verified\.email \} : \{ userId: null, email: null \}/);
    expect(fn).not.toMatch(/req\.body|req\.query/);
  });

  it('every build-queue route requires the VERIFIED workspace owner', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const queue = handlers(src).filter((h) => h.path.startsWith('/api/agentv3/queue'));
    expect(queue.map((h) => h.path).sort()).toEqual(['/api/agentv3/queue', '/api/agentv3/queue/cancel', '/api/agentv3/queue/complete', '/api/agentv3/queue/enqueue', '/api/agentv3/queue/next']);
    for (const h of queue) {
      expect(h.body, h.path).toMatch(/assertVerifiedWorkspaceOwner\(req, workspaceId\)/);
      expect(h.body, h.path).not.toMatch(/[^d]assertWorkspaceOwner\(req/);
    }
  });
});
