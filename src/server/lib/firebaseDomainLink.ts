// Firebase custom-domain ↔ workspace link store (Slice 2). Persists which workspace a connected
// domain belongs to, so the deploy path knows whether to ALSO publish a build to the workspace's
// dedicated Firebase site (which the custom domain serves). Server-only (ADMIN-SDK binding — see
// serverDb.ts); the collection is `custom_domains`, reused from the earlier connect flow with an
// explicit `provider: 'firebase'` + `workspaceId`.
//
// Fail-open by design: a store hiccup must never crash a deploy or a connect. Read helpers return a
// safe default (false / []) on any error — the honest cost is a domain that serves the app only
// after the NEXT publish, never a broken build.

import { doc, setDoc, collection, query, where, getDocs, getServerDb as getDb } from './serverDb';

const COLLECTION = 'custom_domains';

/** A safe Firestore doc id for a hostname. */
function docId(domain: string): string {
  return domain.replace(/[^a-z0-9.-]/g, '_');
}

export interface DomainLink {
  domain: string;
  workspaceId: string;
  userId: string;
}

/** Record that `domain` is connected to `workspaceId` (owned by `userId`) via Firebase hosting. */
export async function linkWorkspaceDomain(link: DomainLink): Promise<void> {
  const db = getDb() as any;
  if (!db) return; // no db configured → nothing to persist (connect still returns DNS records)
  await setDoc(
    doc(db, COLLECTION, docId(link.domain)),
    {
      domain: link.domain,
      workspaceId: link.workspaceId,
      userId: link.userId,
      provider: 'firebase',
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}

/** The Firebase-connected domains for a workspace (empty on any error — fail-open). */
export async function firebaseDomainsForWorkspace(workspaceId: string): Promise<string[]> {
  try {
    const db = getDb() as any;
    if (!db) return [];
    const snap = await getDocs(
      query(
        collection(db, COLLECTION),
        where('workspaceId', '==', workspaceId),
        where('provider', '==', 'firebase'),
      ),
    );
    const out: string[] = [];
    snap.forEach((d: any) => {
      const domain = d.data()?.domain;
      if (typeof domain === 'string' && domain) out.push(domain);
    });
    return out;
  } catch {
    return [];
  }
}

/** True when the workspace has at least one Firebase-connected custom domain (fail-open → false). */
export async function workspaceHasFirebaseDomain(workspaceId: string): Promise<boolean> {
  return (await firebaseDomainsForWorkspace(workspaceId)).length > 0;
}
