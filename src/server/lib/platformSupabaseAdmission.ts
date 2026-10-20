// Serialize paid project creation across workers. A lost acknowledgement NEVER expires into a
// second purchase: an operator reconciles the provider project and wallet before clearing a hold.
import { randomUUID, createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { SUPABASE_API } from './supabaseProvision';

export function platformSupabaseDefault(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NAVBHARAT_SUPABASE_DEFAULT === 'on';
}

export function approvedProjectLimit(env: NodeJS.ProcessEnv = process.env): number | null {
  if (env.NAVBHARAT_SUPABASE_PRODUCTION_APPROVED !== 'on') return null;
  const raw = env.NAVBHARAT_SUPABASE_MAX_PROJECTS ?? '';
  if (!/^[1-9]\d{0,2}$/.test(raw)) return null;
  return Number(raw);
}

/** Count ALL projects in the selected org, including paused ones. This is a project cap, not an
 * invoice cap. Refuse malformed/incomplete responses rather than treating them as an empty org. */
export async function organizationProjectCount(token: string, orgId: string, fetchImpl = globalThis.fetch): Promise<number> {
  const response = await fetchImpl(`${SUPABASE_API}/v1/projects`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Project capacity could not be verified.');
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || rows.some((r) => !r || typeof r.id !== 'string' || typeof r.organization_id !== 'string')) {
    throw new Error('Project capacity response was incomplete.');
  }
  return rows.filter((r) => r.organization_id === orgId).length;
}

export function platformAppLabel(workspaceId: string, label = ''): string {
  return `App ${createHash('sha256').update(workspaceId).digest('hex').slice(0, 12)} ${label}`;
}

export interface PlatformAdmission {
  /** Only call after delivery+wallet are confirmed, confirmed cleanup, or before any create. */
  release(): Promise<void>;
  /** Record the provider reference for reconciliation. No credentials or raw user IDs stored. */
  noteProject(projectRef: string): Promise<void>;
}

export async function acquirePlatformAdmission(
  db: Firestore | null,
  input: { orgId: string; workspaceId: string },
): Promise<PlatformAdmission | null> {
  if (!db) return null;
  const ref = db.collection('platform_settings').doc(`supabase_creation_${input.orgId}`);
  const nonce = randomUUID();
  const appHash = createHash('sha256').update(input.workspaceId).digest('hex');
  try {
    const acquired = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return false;
      tx.set(ref, { nonce, appHash, startedAt: new Date().toISOString(), state: 'reconciliation-required-if-interrupted' });
      return true;
    });
    if (!acquired) return null;
  } catch {
    // A commit may have landed. Never start a provider request on an ambiguous acquisition.
    return null;
  }
  return {
    release: async () => {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.data()?.nonce !== nonce) throw new Error('Provisioning hold ownership changed.');
        tx.delete(ref);
      });
    },
    noteProject: async (projectRef) => {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.data()?.nonce !== nonce) throw new Error('Provisioning hold ownership changed.');
        tx.update(ref, { projectRef });
      });
    },
  };
}
