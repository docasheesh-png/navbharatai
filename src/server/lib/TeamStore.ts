// P-COLLAB.1 — Durable Team Membership + Invite Lifecycle.
//
// Before this, team members + invites lived in the browser's localStorage and `routes/team.ts` only
// *recorded* an invite (audit log + a throwaway id) — so teams vanished on logout and an invite could
// never actually be accepted. This store makes both durable and gives invites a real token-based
// accept flow:
//
//   • `teams/{teamId}/members/{uid}`   — one doc per member  (uid, email, role, status, joinedAt).
//   • `teamInvites/{token}`            — one doc per invite   (token, teamId, email, role, status,
//                                        invitedBy, createdAt, expiresAt). Top-level so the accept
//                                        route can resolve a `/?join=<token>` link without knowing
//                                        the team id up front (the token IS the capability).
//
// A "team" is scoped to its owner's account, so `teamId === owner uid` — matching the existing
// per-account model. Pattern mirrors PromptAuditStore: firebase-admin, VITEST-skip, best-effort
// (never throws, never blocks a request). The pure builders/validators are unit-tested without I/O.
//
// Email delivery is intentionally NOT here: NavBharatAI has no SMTP/provider infra, so instead of
// faking a "sent" state the invite returns a real, copyable, resolvable link. Email can layer on top
// later without changing this data model.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import type { UserRole } from './authMiddleware';

const INVITES_COLLECTION = 'teamInvites';
const TEAMS_COLLECTION = 'teams';
const MEMBERS_SUBCOLLECTION = 'members';

/** Invites are valid for 14 days by default. */
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Cap how many members listMembers returns. */
const MAX_MEMBERS = 500;

export type InviteStatus = 'pending' | 'accepted' | 'revoked';
export type MemberStatus = 'active' | 'removed';

/** Roles an invite can grant. Owner is reserved for the account holder and is never invitable. */
export type InvitableRole = Exclude<UserRole, 'owner'>;

export interface InviteRecord {
  token: string;
  teamId: string;
  email: string;
  role: InvitableRole;
  status: InviteStatus;
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
}

export interface MemberRecord {
  uid: string;
  email: string;
  role: UserRole;
  status: MemberStatus;
  joinedAt: number;
}

let _db: admin.firestore.Firestore | null = null;

function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null;
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = getServerDb();
    return _db;
  } catch {
    return null;
  }
}

// ───────────────────────────── Pure logic (unit-tested, no I/O) ─────────────────────────────

/**
 * Normalise an arbitrary role string (from the UI, which uses 'Admin'/'Editor'/'Viewer', or an API
 * caller) into a canonical invitable role. Defaults to 'viewer' — the least-privileged role — so a
 * malformed or missing value never accidentally grants elevated access. 'owner' is not invitable and
 * collapses to 'admin'. Pure.
 */
export function normalizeInviteRole(role: unknown): InvitableRole {
  const r = String(role ?? '').trim().toLowerCase();
  if (r === 'admin') return 'admin';
  if (r === 'editor' || r === 'edit') return 'editor';
  if (r === 'billing_only' || r === 'billing') return 'billing_only';
  if (r === 'owner') return 'admin'; // owner is the account holder, never invitable → cap at admin
  return 'viewer';
}

/** Build a normalised, durable invite record. Pure — the caller supplies the token + clock. */
export function buildInviteRecord(input: {
  token: string;
  teamId: string;
  email: string;
  role?: unknown;
  invitedBy: string;
  now: number;
  ttlMs?: number;
}): InviteRecord {
  const now = Number.isFinite(input.now) && input.now > 0 ? input.now : 0;
  const ttl = Number.isFinite(input.ttlMs as number) && (input.ttlMs as number) > 0 ? (input.ttlMs as number) : INVITE_TTL_MS;
  return {
    token: String(input.token),
    teamId: String(input.teamId),
    email: String(input.email ?? '').trim().toLowerCase(),
    role: normalizeInviteRole(input.role),
    status: 'pending',
    invitedBy: String(input.invitedBy ?? ''),
    createdAt: now,
    expiresAt: now + ttl,
  };
}

/** Is an invite acceptable right now? (pending + not expired). Pure. */
export function isInviteAcceptable(invite: Pick<InviteRecord, 'status' | 'expiresAt'> | null | undefined, now: number): boolean {
  if (!invite) return false;
  if (invite.status !== 'pending') return false;
  if (typeof invite.expiresAt === 'number' && invite.expiresAt > 0 && now > invite.expiresAt) return false;
  return true;
}

/**
 * SECURITY (audit H2): may `requesterUid` manage `teamId`? A "team" is scoped to its owner's account
 * (`teamId === owner uid`), so the owner always may. Any OTHER caller must be an ACTIVE member of that
 * team whose role is `admin` (or `owner`). This is resource-scoped — it never trusts the caller's
 * GLOBAL role, which `getUserRole` defaults to 'owner' for role-less single-user accounts (that default
 * is correct for one's OWN account but must never grant cross-tenant team control). Pure + fail-closed.
 */
export function canManageTeam(input: { requesterUid: string | null | undefined; teamId: string; members: MemberRecord[] }): boolean {
  const { requesterUid, teamId, members } = input;
  if (!requesterUid || !teamId) return false;
  if (requesterUid === teamId) return true; // team owner — teamId IS the owner's uid
  return (members || []).some(
    (m) => m.uid === requesterUid && m.status !== 'removed' && (m.role === 'admin' || m.role === 'owner'),
  );
}

/** Build a member record from an accepted invite. Pure. */
export function buildMemberRecord(input: { uid: string; email: string; role: UserRole; now: number }): MemberRecord {
  return {
    uid: String(input.uid),
    email: String(input.email ?? '').trim().toLowerCase(),
    role: input.role,
    status: 'active',
    joinedAt: Number.isFinite(input.now) && input.now > 0 ? input.now : 0,
  };
}

// ───────────────────────────── Firestore adapters (best-effort, never throw) ─────────────────────────────

/** Persist an invite. Best-effort — returns whether it was written (false when Firestore is off). */
export async function saveInvite(invite: InviteRecord): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    await db.collection(INVITES_COLLECTION).doc(invite.token).set(invite, { merge: true });
    return true;
  } catch {
    return false;
  }
}

/** Resolve an invite by token. Returns null when missing/unreadable. */
export async function getInvite(token: string): Promise<InviteRecord | null> {
  if (!token) return null;
  const db = getDb();
  if (!db) return null;
  try {
    const snap = await db.collection(INVITES_COLLECTION).doc(token).get();
    if (!snap.exists) return null;
    const data = snap.data() as Partial<InviteRecord> | undefined;
    if (!data || !data.token) return null;
    return {
      token: String(data.token),
      teamId: String(data.teamId ?? ''),
      email: String(data.email ?? ''),
      role: normalizeInviteRole(data.role),
      status: (data.status as InviteStatus) ?? 'pending',
      invitedBy: String(data.invitedBy ?? ''),
      createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
      expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : 0,
    };
  } catch {
    return null;
  }
}

/** Mark an invite as accepted (or revoked). Best-effort. */
export async function setInviteStatus(token: string, status: InviteStatus): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.collection(INVITES_COLLECTION).doc(token).set({ status }, { merge: true });
  } catch {
    /* best-effort */
  }
}

/** Add (or update) a team member. Best-effort — returns whether it was written. */
export async function addMember(teamId: string, member: MemberRecord): Promise<boolean> {
  const db = getDb();
  if (!db || !teamId || !member.uid) return false;
  try {
    await db.collection(TEAMS_COLLECTION).doc(teamId).collection(MEMBERS_SUBCOLLECTION).doc(member.uid).set(member, { merge: true });
    return true;
  } catch {
    return false;
  }
}

/** Mark a member removed (soft-delete keeps the audit trail). Best-effort. */
export async function removeMember(teamId: string, uid: string): Promise<void> {
  const db = getDb();
  if (!db || !teamId || !uid) return;
  try {
    await db.collection(TEAMS_COLLECTION).doc(teamId).collection(MEMBERS_SUBCOLLECTION).doc(uid).set({ status: 'removed' }, { merge: true });
  } catch {
    /* best-effort */
  }
}

/** Update a member's role in the team. Best-effort. */
export async function updateMemberRole(teamId: string, uid: string, role: InvitableRole): Promise<void> {
  const db = getDb();
  if (!db || !teamId || !uid) return;
  try {
    await db.collection(TEAMS_COLLECTION).doc(teamId).collection(MEMBERS_SUBCOLLECTION).doc(uid).set({ role }, { merge: true });
  } catch {
    /* best-effort */
  }
}

/** List a team's active members (newest first). Never throws. */
export async function listMembers(teamId: string): Promise<MemberRecord[]> {
  if (!teamId) return [];
  const db = getDb();
  if (!db) return [];
  try {
    const snap = await db
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .collection(MEMBERS_SUBCOLLECTION)
      .orderBy('joinedAt', 'desc')
      .limit(MAX_MEMBERS)
      .get();
    const out: MemberRecord[] = [];
    for (const d of snap.docs) {
      const data = d.data() as Partial<MemberRecord> | undefined;
      if (data && data.uid && data.status !== 'removed') {
        out.push({
          uid: String(data.uid),
          email: String(data.email ?? ''),
          role: (data.role as UserRole) ?? 'viewer',
          status: (data.status as MemberStatus) ?? 'active',
          joinedAt: typeof data.joinedAt === 'number' ? data.joinedAt : 0,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}
