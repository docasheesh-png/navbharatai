// T2.7 (roadmap 2026-07-19) — Attribute-Based Access Control (ABAC) generator (Tier-2, enterprise).
//
// The audit's Security ❌ included "ABAC" (only rank-based RBAC existed). RBAC answers "what ROLE are you?";
// ABAC answers "given the SUBJECT, RESOURCE, ACTION and CONTEXT, are you allowed?" — e.g. "only the owner
// (or an admin) may edit THIS record". This emits a real, dependency-free policy layer that COMPLEMENTS
// generate_rbac:
//   • server/lib/abac.ts — a policy registry (each policy returns true to ALLOW; DENY by default) + a
//     can(policy, ctx) evaluator,
//   • server/middleware/authorize.ts — an Express guard that builds the context from the request and
//     enforces a named policy (401 unauthenticated, 403 denied).
// PURE builder → the caller writes the files. Real, complete code — no stubs (the real-features rule).

export interface AbacResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

/** Generate the ABAC policy layer. Pure — returns the files. Never throws. */
export function generateAbac(): AbacResult {
  const libFile = `// Attribute-Based Access Control. A policy is a pure predicate over the request context; it returns
// true to ALLOW. Access is DENIED by default (an unknown/missing policy => false), so a forgotten policy
// fails closed, never open.
export type AbacContext = {
  user: { id: string; role?: string; [key: string]: unknown } | null;
  resource?: Record<string, unknown>;
  action: string;
};

export type Policy = (ctx: AbacContext) => boolean;

// Define your app's policies here. These two are examples — edit/extend them.
export const policies: Record<string, Policy> = {
  // Anyone authenticated may read.
  'resource:read': (ctx) => !!ctx.user,
  // Only the resource's owner, or an admin, may modify it (ownership is an ATTRIBUTE — this is what RBAC
  // alone cannot express).
  'resource:write': (ctx) =>
    !!ctx.user && (ctx.user.role === 'admin' || ctx.user.id === ctx.resource?.ownerId),
};

export function can(policyName: string, ctx: AbacContext): boolean {
  const policy = policies[policyName];
  return typeof policy === 'function' ? policy(ctx) : false; // deny by default (fail closed)
}
`;

  const mwFile = `import type { Request, Response, NextFunction } from 'express';
import { can, type AbacContext } from '../lib/abac';

// Guard a route with a named ABAC policy. You build the context from the request (the authenticated user,
// the resource you loaded, and the action) — that is where the attributes come from. Pairs with
// generate_auth (req.user) and generate_rbac (req.user.role).
export function authorize(policyName: string, buildContext: (req: Request) => AbacContext) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ctx = buildContext(req);
    if (!ctx.user) { res.status(401).json({ error: 'Authentication required' }); return; }
    if (!can(policyName, ctx)) { res.status(403).json({ error: 'Forbidden by policy' }); return; }
    next();
  };
}
`;

  return {
    files: {
      'server/lib/abac.ts': libFile,
      'server/middleware/authorize.ts': mwFile,
    },
    dependencies: [],
    instructions:
      'Wired ABAC (attribute policies over your RBAC roles). Edit server/lib/abac.ts to define policies ' +
      '(each returns true to ALLOW; access is denied by default). Guard a route:\n' +
      "  router.patch('/:id', authorize('resource:write', (req) => ({ user: req.user, action: 'write', " +
      "resource: loadedRecord })), handler);\n" +
      'Use it alongside generate_rbac\'s requireRole for coarse role checks + fine-grained ownership/context ' +
      'rules that roles alone cannot express.',
  };
}
