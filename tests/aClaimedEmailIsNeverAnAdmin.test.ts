// Forensic audit 2026-10-04 (P0) — an email in a request body never makes anyone an admin.
//
// POST /api/agentv3/host-app and /host-usage read `resolveReadIdentity`, which returns the BODY's email
// when no token is sent. `isReportAdmin(email)` then made a token-less caller who typed the admin's
// address an admin: the plan and server caps were skipped and a container was deployed on NavBharatAI's
// own cloud bill. Both routes now take the verified identity or refuse; a census keeps every admin
// decision in agentv3.ts off the claimed-identity path.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { isReportAdmin } from '../src/server/routes/agentv3';

process.env.VITEST = 'true';
const prevEnabled = process.env.AGENTV3_ENABLED;
let routes: Map<string, any>;

beforeAll(async () => {
  process.env.AGENTV3_ENABLED = 'true';
  const mod = await import('../src/server/routes/agentv3');
  routes = captureRoutes(mod.registerAgentV3Routes);
}, 30_000);
afterAll(() => { if (prevEnabled === undefined) delete process.env.AGENTV3_ENABLED; else process.env.AGENTV3_ENABLED = prevEnabled; });

/** An address the allowlist really treats as an admin (whatever it is configured to). */
function anAdminAddress(): string {
  for (const e of ['aashishcpmt09@gmail.com', 'admin@navbharatai.com']) if (isReportAdmin(e)) return e;
  return 'aashishcpmt09@gmail.com';
}

describe('a token-less request claiming the admin\'s email is refused', () => {
  // `/host-app` and `/host-usage` were DELETED on 2026-10-06 (no caller; see serverPublish.ts). The door this
  // block tested on them must stay shut: neither route exists, and the one remaining server-publish path takes
  // admin from the verified token only (pinned in tests/hostApp.test.ts and publishRoute.test.ts).
  it('the two admin-gated hosting routes no longer exist', () => {
    expect(routes.get('POST /api/agentv3/host-app')).toBeUndefined();
    expect(routes.get('POST /api/agentv3/host-usage')).toBeUndefined();
  });

  it('the server publish never reads the claimed email for its admin decision', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(src).toContain('hostIsAdmin = isReportAdmin(identityGrantEmail(identity));');
    expect(src).not.toMatch(/hostIsAdmin = isReportAdmin\((req\.body|email)/);
    void anAdminAddress; void mockReq; void mockRes;
  });
});

describe('census: no admin decision in agentv3.ts reads a claimed identity', () => {
  it('a route handler that calls isReportAdmin(...) never takes its identity from resolveReadIdentity', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const starts = [...src.matchAll(/\n\s*app\.(?:get|post|put|patch|delete|all)\(\s*'([^']+)'/g)].map((m) => ({ at: m.index ?? 0, path: m[1] }));
    const offenders: string[] = [];
    starts.forEach((s, i) => {
      const block = src.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : src.length);
      if (/isReportAdmin\(/.test(block) && /resolveReadIdentity\(/.test(block)) offenders.push(s.path);
    });
    expect(offenders).toEqual([]);
  });
});
