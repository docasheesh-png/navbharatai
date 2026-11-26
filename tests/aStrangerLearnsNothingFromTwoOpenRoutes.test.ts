/**
 * Security audit 2026-11-21, finding 5 — two small leaks:
 *   1. `GET /api/agentv3/status?userId=X` answered `buildRunning` for ANY uid X, so a stranger could ask
 *      "is this account building right now?" about anyone.
 *   2. `GET /api/analytics/{builds,slo,reliability,build-optimizer}` served the platform's build numbers to
 *      anyone on the internet, signed in or not.
 *
 * The class: "an answer about an account (or the business) is given to a caller who has not proved who they
 * are". Locked by running the real analytics chain and by source guards on the status route and its callers.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { registerBuildAnalyticsRoutes } from '../src/server/routes/buildAnalytics';
import { mockReq, mockRes } from './helpers/routeTestUtils';

type Handler = (req: any, res: any, next?: () => void) => unknown;

/** Like captureRoutes, but keeps the middleware so the real chain runs. */
function captureChains(register: (app: any) => void): Map<string, Handler[]> {
  const routes = new Map<string, Handler[]>();
  const app = { get: (path: string, ...h: Handler[]) => routes.set(`GET ${path}`, h), post: () => {}, use: () => {} };
  register(app);
  return routes;
}

async function run(chain: Handler[], req: any, res: any): Promise<void> {
  let i = 0;
  const next = async (): Promise<void> => { const h = chain[i++]; if (h) await h(req, res, next); };
  await next();
}

describe('build analytics require a signed-in caller', () => {
  const routes = captureChains(registerBuildAnalyticsRoutes);
  for (const path of ['builds', 'slo', 'reliability', 'build-optimizer']) {
    it(`/api/analytics/${path} refuses a caller with no token`, async () => {
      const chain = routes.get(`GET /api/analytics/${path}`)!;
      expect(chain.length).toBeGreaterThan(1);
      const res = mockRes();
      await run(chain, mockReq({ query: { limit: '5' } }), res);
      expect(res.statusCode).toBe(401);
    });
  }
  it('every screen that shows them sends its token', () => {
    const analytics = readFileSync('src/components/ide/AppAnalytics.tsx', 'utf8');
    for (const path of ['builds', 'build-optimizer', 'reliability']) {
      expect(analytics).toContain(`fetch('/api/analytics/${path}?limit=100', { headers: await authJsonHeaders() })`);
    }
    expect(readFileSync('src/components/panels/ProjectInsightsPanel.tsx', 'utf8')).toContain("fetch('/api/analytics/slo?limit=100', { headers: await authJsonHeaders() })");
  });
});

describe('the account-wide build answer is only for the verified caller', () => {
  const agent = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  const start = agent.indexOf("app.get('/api/agentv3/status'");
  const route = agent.slice(start, agent.indexOf('app.get(', start + 10));
  it('buildRunning comes from the verified identity, and is false with no token', () => {
    expect(route).toMatch(/const buildOwnerUid = \(await verifiedIdentity\(req\)\)\?\.uid \?\? null;/);
    expect(route).toMatch(/const buildRunning = buildOwnerUid\s*\?/);
    expect(route).toMatch(/:\s*false;/);
    // The claimed `?userId` must not decide it any more.
    expect(route).not.toMatch(/countActiveBuildsForUser\(runningBuilds\.values\(\), userId\)/);
  });
  it('the app callers that read buildRunning send their token', () => {
    const panel = readFileSync('src/components/agentv3/AgentV3Panel.tsx', 'utf8');
    const hook = readFileSync('src/hooks/useAgentV3Build.ts', 'utf8');
    const tokenless = [...panel.matchAll(/fetch\(`\/api\/agentv3\/status[^`]*`(\)|, \{(?![^}]*headers)[^}]*\}\))/g), ...hook.matchAll(/fetch\(`\/api\/agentv3\/status[^`]*`(\)|, \{(?![^}]*headers)[^}]*\}\))/g)];
    expect(tokenless.map((m) => m[0])).toEqual([]);
  });
});
