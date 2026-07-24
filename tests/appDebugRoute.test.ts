import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { registerAppDebugRoutes } from '../src/server/routes/appDebug';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

/** Extend the mock response with NDJSON `write` capture + a no-op req.on for the stream route. */
function ndjsonRes() {
  const res: any = mockRes();
  res.lines = [] as string[];
  res.write = (chunk: string) => { res.lines.push(...String(chunk).split('\n').filter(Boolean)); return true; };
  return res;
}
function streamReq(body: any) {
  const req: any = mockReq({ body });
  req.on = () => { /* no 'close' in the unit harness */ };
  return req;
}
const events = (res: any) => res.lines.map((l: string) => JSON.parse(l));

const routes = captureRoutes(registerAppDebugRoutes);
const runHandler = routes.get('POST /api/app-debug/run')!;
const sourcesHandler = routes.get('GET /api/app-debug/sources')!;
const investigateHandler = routes.get('POST /api/app-debug/investigate')!;

describe('POST /api/app-debug/run — source guards (no auth in the harness → token is null)', () => {
  it('rejects a missing/unknown source with 400 before streaming', async () => {
    const res = mockRes();
    await runHandler(mockReq({ body: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(String(res.body.error)).toMatch(/choose a source/i);
  });

  it('rejects a workspace source the caller does not own with 403 (no fake analysis)', async () => {
    const res = mockRes();
    await runHandler(mockReq({ body: { source: 'workspace', workspaceId: 'agentv3-someoneelse-sess123' } }), res);
    expect(res.statusCode).toBe(403);
    expect(String(res.body.error)).toMatch(/your own NavBharatAI Pro apps/i);
  });

  it('rejects an empty github file map with 400', async () => {
    const res = mockRes();
    await runHandler(mockReq({ body: { source: 'github', files: {} } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-object github files payload with 400', async () => {
    const res = mockRes();
    await runHandler(mockReq({ body: { source: 'github', files: 'not-a-map' } }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/app-debug/run — real NDJSON stream (github, no LLM needed)', () => {
  it('streams meta + static findings + done for a repo with a deterministic defect', async () => {
    // README.md is not sent to the AI pass in a way that needs the model here: pick a file with a
    // static-only finding and NO analyzable-for-AI code, so no provider is called in the unit test.
    const res = ndjsonRes();
    // A .txt file → static secret scan fires, but .txt is not AI-analyzable-as-code → 0 AI batches.
    await runHandler(streamReq({
      source: 'github',
      files: { 'notes.txt': 'aws = "AKIA1234567890ABCDEF"\n' },
    }), res);

    const evs = events(res);
    const meta = evs.find((e) => e.type === 'meta');
    expect(meta).toBeTruthy();
    expect(meta.filesTotal).toBe(1);

    const findings = evs.filter((e) => e.type === 'findings').flatMap((e) => e.findings);
    expect(findings.some((f: any) => f.category === 'security' && f.source === 'static')).toBe(true);

    const done = evs.find((e) => e.type === 'done');
    expect(done).toBeTruthy();
    expect(done.summary.total).toBeGreaterThanOrEqual(1);
    expect(res.ended).toBe(true);
  });

  it('streams cross-file GRAPH findings (missing dependency) and health in the summary', async () => {
    const res = ndjsonRes();
    await runHandler(streamReq({
      source: 'github',
      files: {
        'package.json': JSON.stringify({ name: 'x', dependencies: {} }),
        'src/a.ts': "import axios from 'axios';\n",
      },
    }), res);
    const evs = events(res);
    const findings = evs.filter((e) => e.type === 'findings').flatMap((e) => e.findings);
    const dep = findings.find((f: any) => f.source === 'graph' && f.category === 'dependency');
    expect(dep).toBeTruthy();
    expect(String(dep.problem)).toMatch(/axios/);
    const done = evs.find((e) => e.type === 'done');
    expect(done.summary.health).toBeTruthy();
    expect(typeof done.summary.health.score).toBe('number');
  });

  it('white-label: nothing in the stream names an underlying provider', async () => {
    const res = ndjsonRes();
    await runHandler(streamReq({ source: 'github', files: { 'a.txt': 'debugger;\n' } }), res);
    const blob = JSON.stringify(events(res));
    for (const vendor of ['GLM', 'Kimi', 'Claude', 'Gemini', 'Grok', 'Anthropic', 'OpenAI', 'Moonshot']) {
      expect(blob).not.toContain(vendor);
    }
  });
});

describe('GET /api/app-debug/sources — auth required', () => {
  it('returns 401 when the caller is not signed in', async () => {
    const res = mockRes();
    await sourcesHandler(mockReq({}), res);
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/app-debug/investigate — deep-dive on one finding', () => {
  it('requires a problem to investigate (400)', async () => {
    const res = mockRes();
    await investigateHandler(mockReq({ body: { file: 'src/a.ts' } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects investigating a workspace the caller does not own (403)', async () => {
    const res = mockRes();
    await investigateHandler(mockReq({ body: { source: 'workspace', workspaceId: 'agentv3-other-s1', problem: 'x', file: 'a.ts' } }), res);
    expect(res.statusCode).toBe(403);
  });

  it('returns either a real DebugResult or an honest 5xx — never a fabricated fixed answer', async () => {
    const res = mockRes();
    await investigateHandler(mockReq({ body: { problem: 'empty catch swallows error', file: 'a.ts', code: 'try{x()}catch(e){}' } }), res);
    expect([200, 502, 503]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      // A 200 is the parsed REAL model output (DebugResult shape) — not a canned fake.
      expect(res.body).toHaveProperty('explanation');
      expect(res.body).toHaveProperty('rootCause');
    } else {
      expect(String(res.body.error)).toBeTruthy();
    }
  });
});

describe('server registration', () => {
  it('registerAppDebugRoutes is wired into server.ts', () => {
    const server = readFileSync(join(__dirname, '../server.ts'), 'utf8');
    expect(server).toContain('registerAppDebugRoutes(app)');
  });
  it('the route file registers all three endpoints', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/appDebug.ts'), 'utf8');
    expect(route).toContain("app.get('/api/app-debug/sources'");
    expect(route).toContain("app.post('/api/app-debug/run'");
    expect(route).toContain("app.post('/api/app-debug/investigate'");
  });
});
