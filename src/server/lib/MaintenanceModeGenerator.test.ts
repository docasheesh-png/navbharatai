import { describe, it, expect, afterAll } from 'vitest';

import { generateMaintenanceIntegration, MAINTENANCE_LIB_SOURCE } from './MaintenanceModeGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateMaintenanceIntegration (wiring)', () => {
  it('emits server/lib/maintenance.ts, dependency-free, with the MAINTENANCE_MODE env key', () => {
    const out = generateMaintenanceIntegration();
    expect(Object.keys(out.files)).toContain('server/lib/maintenance.ts');
    expect(out.dependencies).toEqual([]);
    expect(out.envKeys).toContain('MAINTENANCE_MODE');
    expect(MAINTENANCE_LIB_SOURCE).toContain('export function maintenanceMiddleware');
    expect(MAINTENANCE_LIB_SOURCE).toContain('export function setMaintenance');
    expect(MAINTENANCE_LIB_SOURCE).toContain('503');
    expect(MAINTENANCE_LIB_SOURCE).toContain('Retry-After');
  });
});

// Materialize and EXECUTE the exact emitted middleware against mock req/res, proving real behaviour
// (express is a type-only import, erased at runtime, so no dependency is needed to run it).
describe('emitted maintenance middleware — behaviour', () => {
  const emitted = emitModule('maintenance', MAINTENANCE_LIB_SOURCE);
  afterAll(emitted.cleanup);

  interface Emitted {
    isMaintenance(): boolean;
    setMaintenance(on: boolean): void;
    maintenanceMiddleware(opts?: Record<string, unknown>): (req: unknown, res: unknown, next: () => void) => void;
  }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  function mockRes() {
    return {
      statusCode: 0,
      headers: {} as Record<string, string>,
      body: undefined as unknown,
      setHeader(k: string, v: string) { this.headers[k] = v; },
      status(c: number) { this.statusCode = c; return this; },
      json(b: unknown) { this.body = b; return this; },
    };
  }

  it('passes requests through when maintenance is OFF', async () => {
    const m = await load();
    m.setMaintenance(false);
    let nexted = false;
    const res = mockRes();
    m.maintenanceMiddleware()({ path: '/api/users', headers: {} }, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(res.statusCode).toBe(0);
  });

  it('returns 503 + Retry-After when maintenance is ON', async () => {
    const m = await load();
    m.setMaintenance(true);
    let nexted = false;
    const res = mockRes();
    m.maintenanceMiddleware({ retryAfterSeconds: 120 })({ path: '/api/users', headers: {} }, res, () => { nexted = true; });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('120');
    expect((res.body as { error: string }).error).toBe('maintenance');
    m.setMaintenance(false);
  });

  it('always lets health checks through, even during maintenance', async () => {
    const m = await load();
    m.setMaintenance(true);
    for (const path of ['/health', '/healthz', '/readyz']) {
      let nexted = false;
      const res = mockRes();
      m.maintenanceMiddleware()({ path, headers: {} }, res, () => { nexted = true; });
      expect(nexted).toBe(true);
      expect(res.statusCode).toBe(0);
    }
    m.setMaintenance(false);
  });

  it('honours a bypass header+token for operator verification', async () => {
    const m = await load();
    m.setMaintenance(true);
    const mw = m.maintenanceMiddleware({ bypassHeader: 'x-maint-bypass', bypassToken: 'secret123' });

    let bypassed = false;
    const okRes = mockRes();
    mw({ path: '/api/x', headers: { 'x-maint-bypass': 'secret123' } }, okRes, () => { bypassed = true; });
    expect(bypassed).toBe(true);

    let blocked = true;
    const badRes = mockRes();
    mw({ path: '/api/x', headers: { 'x-maint-bypass': 'wrong' } }, badRes, () => { blocked = false; });
    expect(blocked).toBe(true);
    expect(badRes.statusCode).toBe(503);
    m.setMaintenance(false);
  });

  it('setMaintenance toggles isMaintenance', async () => {
    const m = await load();
    m.setMaintenance(true);
    expect(m.isMaintenance()).toBe(true);
    m.setMaintenance(false);
    expect(m.isMaintenance()).toBe(false);
  });
});
