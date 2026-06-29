import { describe, it, expect } from 'vitest';
import { isRoleAllowed, ROLE_RANK, type UserRole } from '../src/server/lib/authMiddleware';

/**
 * P-SEC.1 — RBAC access-decision logic.
 * owner/admin are superusers (always allowed); other roles must be explicitly listed.
 */
describe('RBAC (P-SEC.1) — isRoleAllowed', () => {
  it('owner and admin are superusers — allowed for anything', () => {
    expect(isRoleAllowed('owner', [])).toBe(true);
    expect(isRoleAllowed('admin', [])).toBe(true);
    expect(isRoleAllowed('owner', ['viewer'])).toBe(true);
    expect(isRoleAllowed('admin', ['billing_only'])).toBe(true);
  });

  it('a listed role is allowed', () => {
    expect(isRoleAllowed('editor', ['editor', 'owner'])).toBe(true);
    expect(isRoleAllowed('billing_only', ['billing_only'])).toBe(true);
    expect(isRoleAllowed('viewer', ['viewer', 'editor'])).toBe(true);
  });

  it('an unlisted non-superuser role is denied', () => {
    expect(isRoleAllowed('viewer', ['editor'])).toBe(false);
    expect(isRoleAllowed('editor', ['viewer'])).toBe(false);
    expect(isRoleAllowed('billing_only', ['editor', 'viewer'])).toBe(false);
    expect(isRoleAllowed('viewer', [])).toBe(false);
  });

  it('role ranks order privilege correctly (owner highest)', () => {
    const order: UserRole[] = ['viewer', 'editor', 'admin', 'owner'];
    for (let i = 1; i < order.length; i++) {
      expect(ROLE_RANK[order[i]]).toBeGreaterThan(ROLE_RANK[order[i - 1]]);
    }
    // billing_only is a low-rank side grant
    expect(ROLE_RANK.billing_only).toBeLessThan(ROLE_RANK.editor);
  });
});
