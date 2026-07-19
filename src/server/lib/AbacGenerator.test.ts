import { describe, it, expect } from 'vitest';
import { generateAbac } from './AbacGenerator';

describe('generateAbac', () => {
  it('emits a policy library + an authorize middleware (dependency-free)', () => {
    const out = generateAbac();
    expect(Object.keys(out.files).sort()).toEqual([
      'server/lib/abac.ts',
      'server/middleware/authorize.ts',
    ]);
    expect(out.dependencies).toEqual([]);
  });

  it('denies by default (fail closed) and expresses ownership as an attribute', () => {
    const lib = generateAbac().files['server/lib/abac.ts'];
    expect(lib).toContain('return typeof policy === \'function\' ? policy(ctx) : false; // deny by default (fail closed)');
    expect(lib).toContain('ctx.user.id === ctx.resource?.ownerId'); // ownership attribute, what RBAC can't do
  });

  it('the middleware returns 401 unauthenticated and 403 when denied by policy', () => {
    const mw = generateAbac().files['server/middleware/authorize.ts'];
    expect(mw).toContain("res.status(401).json({ error: 'Authentication required' })");
    expect(mw).toContain("res.status(403).json({ error: 'Forbidden by policy' })");
    expect(mw).toContain('export function authorize(policyName: string');
  });
});
