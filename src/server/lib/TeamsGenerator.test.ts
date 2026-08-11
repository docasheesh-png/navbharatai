import { describe, it, expect, afterAll } from 'vitest';

import { generateTeamsIntegration, TEAMS_SERVICE_SOURCE } from './TeamsGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateTeamsIntegration (wiring)', () => {
  it('emits the team service, routes and README', () => {
    const out = generateTeamsIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/teams/teamService.ts');
    expect(paths).toContain('server/teams/routes.ts');
    expect(paths).toContain('server/teams/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/teams/routes.ts']).toContain('export const teamRouter');
    expect(out.files['server/teams/routes.ts']).toContain('/invites');
  });
});

// Materialize + execute the emitted domain logic — the last-owner + single-use-invite rules are real business
// rules, verified against the actual emitted code.
describe('emitted TeamService — multi-workspace membership + last-owner + single-use invites (real logic)', () => {
  const emitted = emitModule('teams', TEAMS_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  type Role = 'owner' | 'admin' | 'member';
  interface Workspace { id: string; name: string; createdAt: string }
  interface Member { userId: string; role: Role; joinedAt: string }
  interface Invite { token: string; workspaceId: string; email: string; role: Role; createdAt: string; acceptedBy: string | null }
  interface Service {
    createWorkspace(ownerId: string, name: string, now?: Date): Workspace;
    invite(workspaceId: string, email: string, role?: Role, now?: Date): Invite;
    acceptInvite(token: string, userId: string, now?: Date): Member;
    revokeInvite(token: string): boolean;
    setRole(workspaceId: string, userId: string, role: Role): Member;
    removeMember(workspaceId: string, userId: string): boolean;
    membersList(workspaceId: string): Member[];
    workspacesForUser(userId: string): Array<Workspace & { role: Role }>;
    roleOf(workspaceId: string, userId: string): Role | null;
  }
  interface Emitted { TeamService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('creator is the owner; a user can belong to many workspaces with different roles', async () => {
    const { TeamService } = await load();
    const svc = new TeamService();
    const wsA = svc.createWorkspace('alice', 'Acme');
    expect(svc.roleOf(wsA.id, 'alice')).toBe('owner');
    const wsB = svc.createWorkspace('bob', 'Globex');
    const inv = svc.invite(wsB.id, 'alice@example.com', 'admin');
    svc.acceptInvite(inv.token, 'alice');
    // alice: owner of Acme, admin of Globex
    const aliceWs = svc.workspacesForUser('alice');
    expect(aliceWs.length).toBe(2);
    expect(aliceWs.find((w) => w.id === wsA.id)?.role).toBe('owner');
    expect(aliceWs.find((w) => w.id === wsB.id)?.role).toBe('admin');
  });

  it('THE INVARIANT: an invite is SINGLE-USE (accepting twice fails)', async () => {
    const { TeamService } = await load();
    const svc = new TeamService();
    const ws = svc.createWorkspace('owner', 'W');
    const inv = svc.invite(ws.id, 'new@example.com', 'member');
    expect(svc.acceptInvite(inv.token, 'user1').role).toBe('member');
    // the same token cannot be used again
    expect(() => svc.acceptInvite(inv.token, 'user2')).toThrow(/already used/);
    // a revoked invite can't be accepted either
    const inv2 = svc.invite(ws.id, 'x@example.com', 'member');
    expect(svc.revokeInvite(inv2.token)).toBe(true);
    expect(() => svc.acceptInvite(inv2.token, 'user3')).toThrow(/already used/);
    expect(() => svc.acceptInvite('bogus', 'u')).toThrow(/invite not found/);
  });

  it('THE INVARIANT: a workspace always keeps at least one owner (cannot demote/remove the last owner)', async () => {
    const { TeamService } = await load();
    const svc = new TeamService();
    const ws = svc.createWorkspace('alice', 'W');
    // cannot demote the only owner
    expect(() => svc.setRole(ws.id, 'alice', 'admin')).toThrow(/last owner/);
    // cannot remove the only owner
    expect(() => svc.removeMember(ws.id, 'alice')).toThrow(/last owner/);
    // promote a second owner, THEN the first can step down
    const inv = svc.invite(ws.id, 'bob@example.com', 'member');
    svc.acceptInvite(inv.token, 'bob');
    svc.setRole(ws.id, 'bob', 'owner');
    expect(svc.setRole(ws.id, 'alice', 'member').role).toBe('member'); // now allowed
    // and bob (now the last owner) is protected again
    expect(() => svc.removeMember(ws.id, 'bob')).toThrow(/last owner/);
  });

  it('setRole/removeMember validate the member and role', async () => {
    const { TeamService } = await load();
    const svc = new TeamService();
    const ws = svc.createWorkspace('alice', 'W');
    expect(() => svc.setRole(ws.id, 'ghost', 'admin')).toThrow(/member not found/);
    expect(() => svc.setRole(ws.id, 'alice', 'wizard' as Role)).toThrow(/invalid role/);
    expect(svc.removeMember(ws.id, 'ghost')).toBe(false); // no-op for a non-member
    expect(() => svc.invite('nope', 'a@b.com')).toThrow(/workspace not found/);
    expect(() => svc.invite(ws.id, 'not-an-email')).toThrow(/valid email/);
  });

  it('removing a non-last-owner member works and updates the member list', async () => {
    const { TeamService } = await load();
    const svc = new TeamService();
    const ws = svc.createWorkspace('alice', 'W');
    const inv = svc.invite(ws.id, 'bob@example.com', 'member');
    svc.acceptInvite(inv.token, 'bob');
    expect(svc.membersList(ws.id).map((m) => m.userId).sort()).toEqual(['alice', 'bob']);
    expect(svc.removeMember(ws.id, 'bob')).toBe(true);
    expect(svc.membersList(ws.id).map((m) => m.userId)).toEqual(['alice']);
    expect(svc.roleOf(ws.id, 'bob')).toBeNull();
  });
});
