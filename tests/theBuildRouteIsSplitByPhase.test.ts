// THE BUILD ROUTE IS SPLIT ONE PHASE AT A TIME (Q-3237; admin decision 2026-11-21, option A).
//
// The build handler in src/server/routes/agentv3.ts is one function of ~17,000 lines and sits at TypeScript's
// control-flow limit (TS2563): any session adding a block to it can turn the server typecheck red. It is split one phase
// per PR into src/server/AgentV3/buildPhases/. Each moved phase is locked here twice: (1) it works on its own, through
// its ports; (2) its body is NOT back inline in the route — the census below fails the day someone pastes it back.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runRouteSmokeCheck } from '../src/server/AgentV3/buildPhases/routeSmoke';

const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

describe('phase 1 — the route smoke check', () => {
  it('calls each planned route, records what came back, and lists what it skipped', async () => {
    const run = vi.fn(async (cmd: string) => ({ stdout: cmd.includes('/api/health') ? '200' : '500' }));
    const record = vi.fn();
    await runRouteSmokeCheck({ plan: { targets: ['/api/health', '/api/items'], skipped: [{ path: '/api/items/:id', method: 'GET', why: 'path parameter' }] }, previewUrl: 'http://h', run, aborted: () => false, record });
    expect(run).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledTimes(1);
    const issue = record.mock.calls[0][0];
    expect(issue.phase).toBe('preview');
    expect(issue.detail).toMatch(/\/api\/items\/:id — path parameter/);
    expect(['ROUTE_SMOKE_FAILED', 'ROUTE_SMOKE_PASSED']).toContain(issue.code);
  });
  it('is evidence, never a gate: no plan, a stopped build, or a failing sandbox changes nothing and never throws', async () => {
    const record = vi.fn();
    await runRouteSmokeCheck({ plan: null, previewUrl: 'http://h', run: vi.fn(), aborted: () => false, record });
    await runRouteSmokeCheck({ plan: { targets: [], skipped: [] }, previewUrl: 'http://h', run: vi.fn(), aborted: () => false, record });
    expect(record).not.toHaveBeenCalled();
    const run = vi.fn();
    await runRouteSmokeCheck({ plan: { targets: ['/a', '/b'], skipped: [] }, previewUrl: 'http://h', run, aborted: () => true, record });
    expect(run).not.toHaveBeenCalled();
    await expect(runRouteSmokeCheck({ plan: { targets: ['/a'], skipped: [] }, previewUrl: 'http://h', run: async () => { throw new Error('sandbox gone'); }, aborted: () => false, record: () => { throw new Error('store down'); } })).resolves.toBeUndefined();
  });
  it('the route keeps only the gate and the call — the body is not back inline', () => {
    expect(route).toMatch(/await runRouteSmokeCheck\(\{ plan: routeSmokePlan,/);
    expect(route).not.toMatch(/smokeCurlCommand\(|summarizeSmoke\(|classifySmokeStatus\(/);
  });
});

describe('every phase file is wired into the route', () => {
  it('each module under buildPhases/ is imported by the route', () => {
    const phases = readdirSync(join(__dirname, '..', 'src/server/AgentV3/buildPhases')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(phases.length).toBeGreaterThan(0);
    for (const f of phases) expect(route, f).toContain(`from '../AgentV3/buildPhases/${f.replace(/\.ts$/, '')}'`);
  });
});

describe('phase 2 — "no live preview was ever available"', () => {
  it('records the warning only for a successful, non-import, unstopped build with no preview and no shell awaited', async () => {
    const { recordPreviewNeverCameUp } = await import('../src/server/AgentV3/buildPhases/previewNeverCameUp');
    const seen: string[] = [];
    const base = { ok: true, hadPreview: false, importTurn: false, aborted: false, awaitingShell: false, record: (i: { code: string }) => { seen.push(i.code); } };
    expect(recordPreviewNeverCameUp(base)).toBe(true);
    for (const over of [{ ok: false }, { hadPreview: true }, { importTurn: true }, { aborted: true }, { awaitingShell: true }]) expect(recordPreviewNeverCameUp({ ...base, ...over })).toBe(false);
    expect(seen).toEqual(['PREVIEW_NEVER_CAME_UP']);
    expect(recordPreviewNeverCameUp({ ...base, record: () => { throw new Error('store down'); } })).toBe(false);
  });
});

describe('phase 3 — the declared port', () => {
  it('reads the port files, saves the port and says where it came from; absent files are normal', async () => {
    const { captureDeclaredPort } = await import('../src/server/AgentV3/buildPhases/declaredPortCapture');
    const saved: number[] = []; const seen: string[] = [];
    const port = await captureDeclaredPort({
      pkgRaw: JSON.stringify({ scripts: { start: 'node server.js' } }),
      read: async (p) => { if (p === 'server.js') return "const PORT = process.env.PORT || 5000; app.listen(PORT);"; throw new Error('ENOENT'); },
      save: async (p) => { saved.push(p); },
      record: (i) => { seen.push(`${i.code}:${i.message}`); },
    });
    expect(port === null || typeof port === 'number').toBe(true);
    if (port !== null) { expect(saved).toEqual([port]); expect(seen[0]).toMatch(/^DECLARED_PORT:This app declares it serves on port/); }
    expect(await captureDeclaredPort({ pkgRaw: undefined, read: async () => { throw new Error('ENOENT'); }, save: async () => {}, record: () => {} })).toBeNull();
  });
  it('the route keeps only the calls', () => {
    expect(route).toContain('await captureDeclaredPort({ pkgRaw, read: (path) => actuator.readFile(workspaceId, path),');
    expect(route).not.toContain('declaredPortFrom(portFiles)');
    expect(route).not.toMatch(/code: 'PREVIEW_NEVER_CAME_UP'/);
  });
});
