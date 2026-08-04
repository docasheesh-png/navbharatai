// T1.3 (roadmap 2026-07-19) — Role-Based Access Control generator (product-scaffold slice 1).
//
// The audit's Feature-Completeness ❌ included "Roles" — there was no recipe to give a generated app a
// real role hierarchy + route guards; it fell to the raw LLM. This recipe emits a complete, dependency-
// free RBAC layer for one app:
//   • server/lib/roles.ts — an ordered Role union (highest → lowest privilege), a rank map, and a
//     rank-aware hasRole(userRole, required) (a higher role satisfies a lower requirement).
//   • server/middleware/requireRole.ts — an Express guard: 401 when unauthenticated, 403 when the
//     user's role is below the required one. Pairs with generate_auth (which populates req.user.role)
//     and generate_crud's `protected` mutations.
// PURE builder → the caller writes the files. Real, complete code — no stubs (the real-features rule).

export interface RbacResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

/** A role name reduced to a safe TS string-literal value (letters/digits/_/-, lowercased). */
function cleanRole(r: string): string {
  return String(r || '').trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

/**
 * Generate an RBAC layer. `roles` is ordered HIGHEST → LOWEST privilege (e.g. ["admin","editor",
 * "viewer"]); the first role outranks the rest. Falls back to ["admin","user"] when none/empty.
 * Never throws.
 */
export function generateRbac(roles: string[]): RbacResult {
  const cleaned = (Array.isArray(roles) ? roles : []).map(cleanRole).filter(Boolean);
  const list = Array.from(new Set(cleaned.length ? cleaned : ['admin', 'user']));
  const n = list.length;
  // Highest privilege first → highest rank number. requireRole(r) allows r and anything above it.
  const rankEntries = list.map((r, i) => `  ${JSON.stringify(r)}: ${n - i},`).join('\n');
  const tuple = list.map((r) => JSON.stringify(r)).join(', ');
  const highest = list[0];

  const rolesFile = `// Role hierarchy — ordered HIGHEST → LOWEST privilege. A higher role satisfies a lower requirement.
export const ROLES = [${tuple}] as const;
export type Role = typeof ROLES[number];

// Higher number = more privileged.
const RANK: Record<Role, number> = {
${rankEntries}
};

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

// True when \`userRole\` is at least as privileged as \`required\` (e.g. an admin passes requireRole('editor')).
export function hasRole(userRole: string | undefined | null, required: Role): boolean {
  if (!userRole || !isRole(userRole)) return false;
  return RANK[userRole] >= RANK[required];
}
`;

  const guardFile = `import type { Request, Response, NextFunction } from 'express';
import { hasRole, type Role } from '../lib/roles';

// Guard a route for a MINIMUM role. req.user.role must be populated by your auth layer (generate_auth).
// 401 when there is no authenticated user; 403 when their role is below the requirement.
export function requireRole(required: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = (req as Request & { user?: { role?: string } }).user?.role;
    if (!role) { res.status(401).json({ error: 'Authentication required' }); return; }
    if (!hasRole(role, required)) { res.status(403).json({ error: 'Forbidden — insufficient role' }); return; }
    next();
  };
}
`;

  const instructions =
    `Wired an RBAC layer with roles [${list.join(' > ')}] (highest → lowest). Guard any route:\n` +
    `  import { requireRole } from './server/middleware/requireRole';\n` +
    `  app.get('/admin', requireRole('${highest}'), handler); // only '${highest}' (the top role) may enter\n` +
    `Your auth layer must set req.user.role (generate_auth does this from the token). ` +
    `A higher role automatically satisfies a lower requirement.`;

  return {
    files: {
      'server/lib/roles.ts': rolesFile,
      'server/middleware/requireRole.ts': guardFile,
    },
    dependencies: [],
    instructions,
  };
}
