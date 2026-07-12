/**
 * T0-9 — /api/agentv3/stop and /api/agentv3/attach must match a running build by the VERIFIED identity
 * it was registered under, NEVER a claimed body.userId. Builds are keyed (perWorkspace OFF by default)
 * under the account uid, so trusting body.userId let a caller who knew a victim's uid STOP their build
 * (DoS) or ATTACH to stream its live transcript (cross-user leak). The client already sends its Bearer
 * token for exactly this — the server just has to honour it.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

process.env.VITEST = 'true';

let stopHandler: any;
let attachHandler: any;
let setRunningBuild: (key: string, rb: any) => void;

const prevEnabled = process.env.AGENTV3_ENABLED;
const prevAllow = process.env.AGENTV3_ALLOWLIST;

beforeAll(async () => {
  process.env.AGENTV3_ENABLED = 'true';   // isAgentV3GloballyEnabled()
  process.env.AGENTV3_ALLOWLIST = '';     // empty allowlist → isAgentV3Enabled true for anyone (public)
  const mod = await import('../src/server/routes/agentv3');
  setRunningBuild = mod.__setRunningBuildForTest;
  const routes = captureRoutes(mod.registerAgentV3Routes);
  stopHandler = routes.get('POST /api/agentv3/stop');
  attachHandler = routes.get('POST /api/agentv3/attach');
}, 30_000);

afterAll(() => {
  if (prevEnabled === undefined) delete process.env.AGENTV3_ENABLED; else process.env.AGENTV3_ENABLED = prevEnabled;
  if (prevAllow === undefined) delete process.env.AGENTV3_ALLOWLIST; else process.env.AGENTV3_ALLOWLIST = prevAllow;
});

/** A running build registered under the victim's account key. Fresh AbortController per test. */
function makeVictimBuild() {
  return { abort: new AbortController(), buffer: [], subscribers: new Set(), ended: false, startedTs: 1, workspaceId: undefined } as any;
}

describe('POST /api/agentv3/stop — matches build by VERIFIED uid, not claimed body.userId (T0-9)', () => {
  let victim: any;
  beforeEach(() => { victim = makeVictimBuild(); setRunningBuild('victim-uid', victim); });

  it('an UNVERIFIED caller claiming body.userId=victim-uid does NOT stop the victim build', async () => {
    const req = mockReq({ body: { userId: 'victim-uid', email: 'v@x.com', workspaceId: 'ws-attacker' } }); // no token
    const res = mockRes();
    await stopHandler(req, res);
    expect(res.body?.stopped).toBe(false);        // nothing in the caller's (anon) candidates
    expect(victim.abort.signal.aborted).toBe(false); // the victim's build was NOT aborted
  });

  it('the VERIFIED owner (x-test-verified-uid=victim-uid) DOES stop their own build', async () => {
    const req = mockReq({ body: { userId: 'victim-uid' }, headers: { 'x-test-verified-uid': 'victim-uid' } });
    const res = mockRes();
    await stopHandler(req, res);
    expect(res.body?.stopped).toBe(true);
    expect(victim.abort.signal.aborted).toBe(true);
  });
});

describe('POST /api/agentv3/attach — cannot stream another account\'s live build via a claimed uid (T0-9)', () => {
  beforeEach(() => { setRunningBuild('victim-uid', makeVictimBuild()); });

  it('an UNVERIFIED caller claiming body.userId=victim-uid gets 404 (no cross-user live stream)', async () => {
    const req = mockReq({ body: { userId: 'victim-uid', email: 'v@x.com' } }); // no token, no workspaceId
    const res = mockRes();
    await attachHandler(req, res);
    // The victim's build lives under 'victim-uid'; an unverified caller resolves to the anon bucket only,
    // so there is no running build to resume → 404 BEFORE any stream is opened.
    expect(res.statusCode).toBe(404);
  });
});
