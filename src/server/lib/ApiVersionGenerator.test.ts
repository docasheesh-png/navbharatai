import { describe, it, expect, afterAll } from 'vitest';

import { generateApiVersionIntegration, API_VERSION_LIB_SOURCE } from './ApiVersionGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateApiVersionIntegration (wiring)', () => {
  it('emits server/lib/apiVersion.ts, dependency-free', () => {
    const out = generateApiVersionIntegration();
    expect(Object.keys(out.files)).toContain('server/lib/apiVersion.ts');
    expect(out.dependencies).toEqual([]);
    expect(API_VERSION_LIB_SOURCE).toContain('export function apiVersion');
    expect(API_VERSION_LIB_SOURCE).toContain('Accept-Version');
    expect(API_VERSION_LIB_SOURCE).toContain('406');
  });
});

describe('emitted apiVersion middleware — behaviour', () => {
  const emitted = emitModule('apiversion', API_VERSION_LIB_SOURCE);
  afterAll(emitted.cleanup);

  interface Emitted {
    apiVersion(opts: { supported: string[]; header?: string; default?: string }): (req: { headers: Record<string, unknown>; apiVersion?: string }, res: unknown, next: () => void) => void;
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

  it('resolves the requested version from X-API-Version (accepts "v2" and "2")', async () => {
    const m = await load();
    for (const sent of ['v2', '2']) {
      const req = { headers: { 'x-api-version': sent } as Record<string, unknown> };
      const res = mockRes();
      let nexted = false;
      m.apiVersion({ supported: ['1', '2'] })(req, res, () => { nexted = true; });
      expect(nexted).toBe(true);
      expect(req.apiVersion).toBe('2');
      expect(res.headers['X-API-Version']).toBe('2');
    }
  });

  it('falls back to the default when no version header is sent', async () => {
    const m = await load();
    const req = { headers: {} as Record<string, unknown> };
    const res = mockRes();
    m.apiVersion({ supported: ['1', '2'], default: '1' })(req, res, () => {});
    expect(req.apiVersion).toBe('1');
  });

  it('reads the standard Accept-Version header as a fallback', async () => {
    const m = await load();
    const req = { headers: { 'accept-version': '2' } as Record<string, unknown> };
    const res = mockRes();
    m.apiVersion({ supported: ['1', '2'] })(req, res, () => {});
    expect(req.apiVersion).toBe('2');
  });

  it('rejects an unsupported version with 406 + the supported list', async () => {
    const m = await load();
    const req = { headers: { 'x-api-version': '9' } as Record<string, unknown> };
    const res = mockRes();
    let nexted = false;
    m.apiVersion({ supported: ['1', '2'] })(req, res, () => { nexted = true; });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(406);
    expect((res.body as { error: string; supported: string[] }).error).toBe('unsupported_api_version');
    expect((res.body as { supported: string[] }).supported).toEqual(['1', '2']);
    expect(res.headers['X-API-Version-Supported']).toBe('1, 2');
  });

  it('throws if no supported versions are configured (never silently allows anything)', async () => {
    const m = await load();
    expect(() => m.apiVersion({ supported: [] })).toThrow();
  });
});
