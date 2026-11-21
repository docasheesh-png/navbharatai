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
