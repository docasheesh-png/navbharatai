import { describe, it, expect } from 'vitest';
import { buildApiSpec, NAVBHARAT_API_ROUTES } from './apiContract';

describe('buildApiSpec', () => {
  const spec = buildApiSpec();

  it('is a valid OpenAPI 3.0.3 document', () => {
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('NavBharatAI Platform API');
    expect(spec.info.version).toBe('1.0.0');
    expect(typeof spec.info.description).toBe('string');
  });

  it('has a non-empty paths object', () => {
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
    // One path entry per unique URL — routes sharing a URL (GET/PUT/DELETE /api/profile) collapse to one.
    const uniquePaths = new Set(NAVBHARAT_API_ROUTES.map((r) => r.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')));
    expect(Object.keys(spec.paths).length).toBe(uniquePaths.size);
  });

  it('documents the right-to-be-forgotten DELETE /api/profile endpoint with its confirm body', () => {
    const del = spec.paths['/api/profile']?.delete as any;
    expect(del).toBeTruthy();
    expect(del.requestBody.content['application/json'].schema.required).toContain('confirm');
    expect(del.responses['401']).toBeTruthy();
  });

  it('converts Express :params to OpenAPI {params} and marks them required', () => {
    const wallet = spec.paths['/api/wallet/{userId}']?.get as any;
    expect(wallet).toBeTruthy();
    const p = wallet.parameters.find((x: any) => x.name === 'userId');
    expect(p.in).toBe('path');
    expect(p.required).toBe(true);
  });

  it('exposes the machine-readable export + docs surface', () => {
    expect(spec.paths['/api/openapi.json']).toBeUndefined(); // the spec does not document itself
    expect(spec.paths['/api/export/build-history']?.get).toBeTruthy();
    expect(spec.paths['/api/health']?.get).toBeTruthy();
  });
});
