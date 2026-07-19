import { describe, it, expect } from 'vitest';
import { generateRbac } from './RbacGenerator';

describe('generateRbac', () => {
  it('emits a roles module + a requireRole guard', () => {
    const out = generateRbac(['admin', 'editor', 'viewer']);
    expect(Object.keys(out.files).sort()).toEqual([
      'server/lib/roles.ts',
      'server/middleware/requireRole.ts',
    ]);
    expect(out.dependencies).toEqual([]); // dependency-free
  });

  it('ranks the roles highest → lowest (first role gets the top rank)', () => {
    const roles = generateRbac(['admin', 'editor', 'viewer']).files['server/lib/roles.ts'];
    expect(roles).toContain('export const ROLES = ["admin", "editor", "viewer"] as const;');
    expect(roles).toContain('"admin": 3,');
    expect(roles).toContain('"editor": 2,');
    expect(roles).toContain('"viewer": 1,');
    expect(roles).toContain('return RANK[userRole] >= RANK[required];');
  });

  it('the guard returns 401 unauthenticated and 403 for an insufficient role', () => {
    const guard = generateRbac(['admin', 'user']).files['server/middleware/requireRole.ts'];
    expect(guard).toContain("res.status(401).json({ error: 'Authentication required' })");
    expect(guard).toContain("res.status(403).json({ error: 'Forbidden — insufficient role' })");
    expect(guard).toContain('export function requireRole(required: Role)');
  });

  it('sanitizes role names and de-dupes; falls back to admin/user on empty', () => {
    const roles = generateRbac(['Super Admin', 'Super Admin', '  ']).files['server/lib/roles.ts'];
    expect(roles).toContain('"super_admin": 1,'); // one unique, sanitized role
    const fallback = generateRbac([]).files['server/lib/roles.ts'];
    expect(fallback).toContain('export const ROLES = ["admin", "user"] as const;');
  });

  it('never throws on malformed input', () => {
    // @ts-expect-error — malformed input must not throw
    expect(() => generateRbac(null)).not.toThrow();
    // @ts-expect-error — non-string members are ignored
    expect(() => generateRbac([1, {}, 'admin'])).not.toThrow();
  });
});
