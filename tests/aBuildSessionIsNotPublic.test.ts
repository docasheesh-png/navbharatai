/**
 * THE LEGACY BUILD-SESSION READ IS NOT PUBLIC EITHER (production-hardening pass, 2026-10-19).
 *
 * `GET /api/build-session/:sessionId` returns a saved build's whole `files` map. It had no
 * authentication — the same "the session id is the capability" model Q-780 closed on the three
 * build-history routes in the same file (see aBuildHistoryIsNotPublic.test.ts), on an id `App.tsx`
 * mints as `pro-${Date.now()}`. It now passes the same rule, and the client asks only when signed in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '..');
// Line comments stripped so a prose mention cannot satisfy a code assertion.
const code = (rel: string) => readFileSync(join(root, rel), 'utf8').replace(/(^|[^:])\/\/.*$/gm, '$1');

function routeBody(src: string, route: string): string {
  const start = src.indexOf(`app.get('${route}'`);
  expect(start, route).toBeGreaterThan(-1);
  const next = src.indexOf('app.', src.indexOf('\n', start) + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

describe('GET /api/build-session/:sessionId', () => {
  const body = routeBody(code('src/server/routes/build.ts'), '/api/build-session/:sessionId');

  it('🔒 checks ownership with the Q-780 rule BEFORE reading the store', () => {
    const check = body.indexOf('mayTouchBuildHistory(await verifyFirebaseToken(req), sessionId, countWorkspaceFiles)');
    const refuse = body.indexOf('if (!access.allowed) return res.status(refusalStatus(access.reason)).json({ error: refusalMessage(access.reason) })');
    const load = body.indexOf('proBuildSessionStore.load(access.workspaceId)');
    expect(check).toBeGreaterThan(-1);
    expect(refuse).toBeGreaterThan(check);
    expect(load).toBeGreaterThan(refuse);
  });

  it('every route in build.ts that reads a session\'s files or history is owner-checked', () => {
    const src = code('src/server/routes/build.ts');
    for (const route of ['/api/build-session/:sessionId', '/api/build-history/:sessionId', '/api/build-history/:sessionId/:versionId']) {
      expect(routeBody(src, route), route).toContain('mayTouchBuildHistory(');
    }
  });
});

describe('the client', () => {
  it('sends the signed-in user\'s token', () => {
    const svc = code('src/services/buildService.ts');
    expect(svc).toMatch(/fetch\(`\/api\/build-session\/\$\{encodeURIComponent\(sessionId\)\}`, \{ headers: await authedHeaders\(\) \}\)/);
  });

  it('asks only once a user is signed in, and only once — no refused request for every visitor', () => {
    const app = code('src/App.tsx');
    const at = app.indexOf('fetchBuildSession(currentProSessionId)');
    expect(at).toBeGreaterThan(-1);
    const effect = app.slice(app.lastIndexOf('useEffect(() => {', at), app.indexOf('}, [', at) + 20);
    expect(effect).toMatch(/if \(!user\?\.uid \|\| buildSessionRestoreTried\.current\) return;/);
    expect(effect).toContain('}, [user?.uid]);');
  });
});
