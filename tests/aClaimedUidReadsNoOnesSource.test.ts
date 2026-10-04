// Forensic audit 2026-10-04 (P1) — a claimed userId never reads, deploys, restores or pushes anyone's app.
//
// `assertWorkspaceOwner` accepts the CLAIMED body/query userId when no token is sent, so a token-less
// request naming `agentv3-<victimUid>-<sid>` with `userId: <victimUid>` returned the victim's whole source
// tree (workspace-files) or deployed it with the victim's own keys (deploy-backend). Every surface that
// touches a user's source now takes the VERIFIED owner. The non-strict gate is a ratcheted allowlist.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

process.env.VITEST = 'true';
const prevEnabled = process.env.AGENTV3_ENABLED;
let routes: Map<string, any>;
beforeAll(async () => {
  process.env.AGENTV3_ENABLED = 'true';
  const mod = await import('../src/server/routes/agentv3');
  routes = captureRoutes(mod.registerAgentV3Routes);
}, 30_000);
afterAll(() => { if (prevEnabled === undefined) delete process.env.AGENTV3_ENABLED; else process.env.AGENTV3_ENABLED = prevEnabled; });

const VICTIM_WS = 'agentv3-victimUid123-11111111-1111-4111-8111-111111111111';

describe('a token-less request claiming the victim\'s uid gets nothing', () => {
  for (const route of ['POST /api/agentv3/workspace-files', 'POST /api/agentv3/deploy-backend', 'POST /api/agentv3/github/push-app', 'POST /api/agentv3/restore']) {
    it(route, async () => {
      const handler = routes.get(route);
      expect(handler, route).toBeTruthy();
      const res = mockRes();
      await handler(mockReq({ body: { workspaceId: VICTIM_WS, userId: 'victimUid123', email: 'v@x.com', checkpointId: 'c1', sha: 'abc1234' } }), res);
      expect([401, 403]).toContain(res.statusCode);
    });
  }
});

/** The automatic build-loop surfaces that may keep the claimed fallback — and nothing else. */
const NON_STRICT_ALLOWED = new Set([
  '/api/agentv3/preview-error', '/api/agentv3/preview-diagnose', '/api/agentv3/preview-health',
  '/api/agentv3/queue/enqueue', '/api/agentv3/queue', '/api/agentv3/queue/cancel', '/api/agentv3/queue/next', '/api/agentv3/queue/complete',
]);

describe('census: the non-strict owner gate is a closed list', () => {
  it('no route outside the build-loop allowlist uses assertWorkspaceOwner', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const starts = [...src.matchAll(/\n\s*app\.(?:get|post|put|patch|delete|all)\(\s*'([^']+)'/g)].map((m) => ({ at: m.index ?? 0, path: m[1] }));
    const offenders: string[] = [];
    starts.forEach((s, i) => {
      const block = src.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : src.length);
      if (/assertWorkspaceOwner\(/.test(block) && !NON_STRICT_ALLOWED.has(s.path)) offenders.push(s.path);
    });
    expect(offenders).toEqual([]);
  });
});
