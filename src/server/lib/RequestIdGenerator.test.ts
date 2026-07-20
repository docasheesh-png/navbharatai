import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateRequestIdIntegration, REQUEST_ID_LIB_SOURCE } from './RequestIdGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateRequestIdIntegration (wiring)', () => {
  it('emits server/lib/requestId.ts, dependency-free', () => {
    const out = generateRequestIdIntegration();
    expect(Object.keys(out.files)).toContain('server/lib/requestId.ts');
    expect(out.dependencies).toEqual([]);
    expect(REQUEST_ID_LIB_SOURCE).toContain("from 'node:crypto'");
    expect(REQUEST_ID_LIB_SOURCE).toContain('export function requestId');
    expect(REQUEST_ID_LIB_SOURCE).toContain('X-Request-Id');
  });
});

describe('emitted requestId middleware — behaviour', () => {
  const artifact = join(here, `._reqid_emitted_${process.pid}.ts`);
  writeFileSync(artifact, REQUEST_ID_LIB_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  interface Emitted {
    requestId(opts?: Record<string, unknown>): (req: { headers: Record<string, unknown>; id?: string }, res: unknown, next: () => void) => void;
  }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }
  function mockRes() {
    return { headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v; } };
  }

  it('reuses a safe inbound id and echoes it on the response', async () => {
    const m = await load();
    const req = { headers: { 'x-request-id': 'trace-abc_123.4' } as Record<string, unknown> };
    const res = mockRes();
    let nexted = false;
    m.requestId()(req, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(req.id).toBe('trace-abc_123.4');
    expect(res.headers['X-Request-Id']).toBe('trace-abc_123.4');
  });

  it('ignores an unsafe inbound id and mints a fresh UUID', async () => {
    const m = await load();
    const req = { headers: { 'x-request-id': 'bad id with spaces & <script>' } as Record<string, unknown> };
    const res = mockRes();
    m.requestId()(req, res, () => {});
    expect(req.id).not.toBe('bad id with spaces & <script>');
    expect(req.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(res.headers['X-Request-Id']).toBe(req.id);
  });

  it('mints a fresh id (never trusts inbound) when trustInbound is false', async () => {
    const m = await load();
    const req = { headers: { 'x-request-id': 'client-supplied' } as Record<string, unknown> };
    const res = mockRes();
    m.requestId({ trustInbound: false })(req, res, () => {});
    expect(req.id).not.toBe('client-supplied');
    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('generates a fresh id when no header is present', async () => {
    const m = await load();
    const req = { headers: {} as Record<string, unknown> };
    const res = mockRes();
    m.requestId()(req, res, () => {});
    expect(typeof req.id).toBe('string');
    expect((req.id as string).length).toBeGreaterThan(0);
  });

  it('honours a custom header name and generator', async () => {
    const m = await load();
    const req = { headers: {} as Record<string, unknown> };
    const res = mockRes();
    m.requestId({ header: 'X-Correlation-Id', generate: () => 'fixed-id-1' })(req, res, () => {});
    expect(req.id).toBe('fixed-id-1');
    expect(res.headers['X-Correlation-Id']).toBe('fixed-id-1');
  });
});
