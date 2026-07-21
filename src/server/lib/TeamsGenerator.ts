// Roadmap breadth — teams / workspaces starter (a packaged domain vertical).
//
// The multi-tenant membership layer every B2B SaaS needs: users belong to one or more WORKSPACES (teams/orgs),
// each with a per-workspace ROLE. The real feature is MEMBERSHIP INTEGRITY: a user can be a member of many
// workspaces with different roles at once, a workspace ALWAYS keeps at least one owner (you cannot remove or
// demote the last owner), and invites are SINGLE-USE (accepting an invite twice fails). This emits a
// dependency-free TeamService (node:crypto for invite tokens) + an Express router + a README. Real logic, not a
// stub — the last-owner + single-use-invite rules are unit-tested against the emitted code. Pure builder → the
// caller writes the files. Distinct from generate_rbac / generate_abac (permission MODEL, not tenancy/membership).

export const TEAMS_SERVICE_SOURCE = `import { randomBytes } from 'node:crypto';

// Teams / workspaces domain logic. The core guarantees: (1) a user can be a member of MANY workspaces, each
// with its own role; (2) a workspace ALWAYS has at least one owner — removing or demoting the last owner is
// rejected; and (3) invites are SINGLE-USE — an accepted (or revoked) invite token cannot be used again.
// In-memory here; swap the Maps for your database.

export type Role = 'owner' | 'admin' | 'member';
const ROLES: Role[] = ['owner', 'admin', 'member'];

export interface Workspace { id: string; name: string; createdAt: string }
export interface Member { userId: string; role: Role; joinedAt: string }
export interface Invite { token: string; workspaceId: string; email: string; role: Role; createdAt: string; acceptedBy: string | null }

let counter = 0;
function nextId(prefix: string, now: Date): string {
  counter += 1;
  return prefix + '_' + now.getTime().toString(36) + '_' + counter.toString(36);
}

export class TeamService {
  private workspaces = new Map<string, Workspace>();
  private members = new Map<string, Map<string, Member>>(); // workspaceId -> (userId -> Member)
  private invites = new Map<string, Invite>();               // token -> Invite

  /** Create a workspace. The creator becomes its first member with role 'owner'. */
  createWorkspace(ownerId: string, name: string, now: Date = new Date()): Workspace {
    const owner = String(ownerId ?? '').trim();
    if (!owner) throw new Error('ownerId is required');
    const label = String(name ?? '').trim();
    if (!label) throw new Error('name is required');
    const ws: Workspace = { id: nextId('ws', now), name: label, createdAt: now.toISOString() };
    this.workspaces.set(ws.id, ws);
    const m = new Map<string, Member>();
    m.set(owner, { userId: owner, role: 'owner', joinedAt: now.toISOString() });
    this.members.set(ws.id, m);
    return { ...ws };
  }

  private membersOf(workspaceId: string): Map<string, Member> {
    const m = this.members.get(String(workspaceId ?? '').trim());
    if (!m) throw new Error('workspace not found');
    return m;
  }

  private ownerCount(m: Map<string, Member>): number {
    let n = 0;
    for (const mem of m.values()) if (mem.role === 'owner') n += 1;
    return n;
  }

  /** Create a single-use invite for an email with a role. Returns the invite (share invite.token). */
  invite(workspaceId: string, email: string, role: Role = 'member', now: Date = new Date()): Invite {
    const m = this.membersOf(workspaceId);
    const mail = String(email ?? '').trim().toLowerCase();
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(mail)) throw new Error('a valid email is required');
    if (!ROLES.includes(role)) throw new Error('invalid role');
    void m;
    const invite: Invite = {
      token: randomBytes(18).toString('hex'),
      workspaceId: String(workspaceId).trim(),
      email: mail,
      role,
      createdAt: now.toISOString(),
      acceptedBy: null,
    };
    this.invites.set(invite.token, invite);
    return { ...invite };
  }

  /** Accept an invite as a user. Single-use — an already-accepted token is rejected. Returns the new membership. */
  acceptInvite(token: string, userId: string, now: Date = new Date()): Member {
    const invite = this.invites.get(String(token ?? '').trim());
    if (!invite) throw new Error('invite not found');
    if (invite.acceptedBy) throw new Error('invite already used');
    const user = String(userId ?? '').trim();
    if (!user) throw new Error('userId is required');
    const m = this.membersOf(invite.workspaceId);
    const member: Member = { userId: user, role: invite.role, joinedAt: now.toISOString() };
    m.set(user, member);            // joining an existing membership updates the role to the invited one
    invite.acceptedBy = user;       // consume the invite
    return { ...member };
  }

  /** Revoke an unused invite so its token can never be accepted. */
  revokeInvite(token: string): boolean {
    const invite = this.invites.get(String(token ?? '').trim());
    if (!invite || invite.acceptedBy) return false;
    invite.acceptedBy = '(revoked)';
    return true;
  }

  /** Change a member's role. Rejected if it would leave the workspace with zero owners. */
  setRole(workspaceId: string, userId: string, role: Role): Member {
    const m = this.membersOf(workspaceId);
    if (!ROLES.includes(role)) throw new Error('invalid role');
    const user = String(userId ?? '').trim();
    const member = m.get(user);
    if (!member) throw new Error('member not found');
    if (member.role === 'owner' && role !== 'owner' && this.ownerCount(m) === 1) {
      throw new Error('cannot demote the last owner');
    }
    member.role = role;
    return { ...member };
  }

  /** Remove a member. Rejected if it would remove the last owner. */
  removeMember(workspaceId: string, userId: string): boolean {
    const m = this.membersOf(workspaceId);
    const user = String(userId ?? '').trim();
    const member = m.get(user);
    if (!member) return false;
    if (member.role === 'owner' && this.ownerCount(m) === 1) {
      throw new Error('cannot remove the last owner');
    }
    return m.delete(user);
  }

  /** The members of a workspace. */
  membersList(workspaceId: string): Member[] {
    return [...this.membersOf(workspaceId).values()]
      .sort((a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt)))
      .map((m) => ({ ...m }));
  }

  /** Every workspace a user belongs to, with their role in each. */
  workspacesForUser(userId: string): Array<Workspace & { role: Role }> {
    const user = String(userId ?? '').trim();
    const out: Array<Workspace & { role: Role }> = [];
    for (const [wsId, m] of this.members.entries()) {
      const mem = m.get(user);
      const ws = this.workspaces.get(wsId);
      if (mem && ws) out.push({ ...ws, role: mem.role });
    }
    return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  /** A user's role in a workspace, or null if not a member. */
  roleOf(workspaceId: string, userId: string): Role | null {
    return this.members.get(String(workspaceId ?? '').trim())?.get(String(userId ?? '').trim())?.role ?? null;
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const teams = new TeamService();
`;

export const TEAMS_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { teams, type Role } from './teamService';

// REST endpoints for teams / workspaces. Mount with: app.use('/api/workspaces', teamRouter).
// In production take the acting userId from the auth session and check roleOf() before mutating a workspace.
export const teamRouter = Router();

// Create a workspace (creator becomes owner). { ownerId, name }.
teamRouter.post('/', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { ownerId?: unknown; name?: unknown };
  try {
    return res.status(201).json(teams.createWorkspace(String(body.ownerId ?? ''), String(body.name ?? '')));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// A user's workspaces. ?user=<id>.
teamRouter.get('/', (req: Request, res: Response) => {
  const user = String(req.query.user ?? '').trim();
  if (!user) return res.status(400).json({ error: 'user is required' });
  return res.status(200).json(teams.workspacesForUser(user));
});

// Members of a workspace.
teamRouter.get('/:id/members', (req: Request, res: Response) => {
  try {
    return res.status(200).json(teams.membersList(req.params.id));
  } catch (err) {
    return res.status(404).json({ error: err instanceof Error ? err.message : 'workspace not found' });
  }
});

// Create an invite. { email, role? }.
teamRouter.post('/:id/invites', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { email?: unknown; role?: unknown };
  try {
    return res.status(201).json(teams.invite(req.params.id, String(body.email ?? ''), (body.role as Role) ?? 'member'));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    return res.status(message === 'workspace not found' ? 404 : 400).json({ error: message });
  }
});

// Accept an invite. { token, userId }.
teamRouter.post('/invites/accept', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { token?: unknown; userId?: unknown };
  try {
    return res.status(200).json(teams.acceptInvite(String(body.token ?? ''), String(body.userId ?? '')));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    return res.status(message === 'invite not found' ? 404 : 409).json({ error: message });
  }
});

// Change a member's role. { role }. 409 if it would leave no owner.
teamRouter.patch('/:id/members/:userId', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { role?: unknown };
  try {
    return res.status(200).json(teams.setRole(req.params.id, req.params.userId, (body.role as Role)));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    if (message === 'workspace not found' || message === 'member not found') return res.status(404).json({ error: message });
    return res.status(message.includes('last owner') ? 409 : 400).json({ error: message });
  }
});

// Remove a member. 409 if it would remove the last owner.
teamRouter.delete('/:id/members/:userId', (req: Request, res: Response) => {
  try {
    if (!teams.removeMember(req.params.id, req.params.userId)) return res.status(404).json({ error: 'member not found' });
    return res.status(204).send();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    return res.status(message.includes('last owner') ? 409 : 400).json({ error: message });
  }
});
`;

const TEAMS_README = `# Teams / workspaces

A real multi-tenant membership backend — the teams/orgs/workspaces layer every B2B SaaS needs. The core
guarantees: a user can belong to **many workspaces** with a per-workspace **role** (owner | admin | member), a
workspace **always keeps at least one owner** (you can't remove or demote the last owner), and invites are
**single-use** (an accepted or revoked token can't be reused). Files:

- \`teamService.ts\` — the domain logic (\`TeamService\` + a \`teams\` singleton). Uses \`node:crypto\` for invite
  tokens. In-memory; swap the Maps for your DB.
- \`routes.ts\` — REST endpoints. Mount:

\`\`\`ts
import { teamRouter } from './server/teams/routes';
app.use('/api/workspaces', teamRouter);
\`\`\`

Endpoints (take the acting userId from the auth session; check \`roleOf()\` before mutating):
- \`POST   /api/workspaces\` \`{ ownerId, name }\` → create (creator becomes owner).
- \`GET    /api/workspaces?user=<id>\` → the user's workspaces + their role in each.
- \`GET    /api/workspaces/:id/members\` → members.
- \`POST   /api/workspaces/:id/invites\` \`{ email, role? }\` → single-use invite (share \`token\`).
- \`POST   /api/workspaces/invites/accept\` \`{ token, userId }\` → join (**409** if already used).
- \`PATCH  /api/workspaces/:id/members/:userId\` \`{ role }\` → change role (**409** if it leaves no owner).
- \`DELETE /api/workspaces/:id/members/:userId\` → remove (**409** if it removes the last owner).

Distinct from \`generate_rbac\` / \`generate_abac\` (a permission MODEL, not tenancy/membership). Pair those with
this to check what a role may DO.
`;

export interface TeamsConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Teams / workspaces starter wired under server/teams/ (dependency-free domain logic using node:crypto + an ' +
  'Express router). The real guarantee is MEMBERSHIP INTEGRITY: a user can be a member of MANY workspaces each ' +
  'with a per-workspace role (owner|admin|member); createWorkspace() makes the creator an owner; invite() makes ' +
  'a SINGLE-USE token; acceptInvite() joins and consumes the token (accepting twice → "invite already used"); ' +
  'setRole()/removeMember() enforce that a workspace ALWAYS keeps at least one owner (demoting/removing the last ' +
  'owner is rejected); workspacesForUser() and roleOf() query. routes.ts exposes POST /api/workspaces, GET ' +
  '/api/workspaces (?user=), GET /api/workspaces/:id/members, POST /api/workspaces/:id/invites, POST ' +
  '/api/workspaces/invites/accept, PATCH/DELETE /api/workspaces/:id/members/:userId. Mount at ' +
  'app.use("/api/workspaces", teamRouter); check roleOf() before mutating in production. Distinct from ' +
  'generate_rbac/generate_abac (a permission MODEL) — pair them to check what a role may DO. In-memory by ' +
  'default — swap the Maps for your DB.';

export function generateTeamsIntegration(): TeamsConfig {
  return {
    files: {
      'server/teams/teamService.ts': TEAMS_SERVICE_SOURCE,
      'server/teams/routes.ts': TEAMS_ROUTES_SOURCE,
      'server/teams/README.md': TEAMS_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
