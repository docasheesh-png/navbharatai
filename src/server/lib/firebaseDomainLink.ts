// Firebase custom-domain ↔ workspace link store (Slice 2). Persists which workspace a connected
// domain belongs to, so the deploy path knows whether to ALSO publish a build to the workspace's
// dedicated Firebase site (which the custom domain serves). Server-only (ADMIN-SDK binding — see
// serverDb.ts); the collection is `custom_domains`, reused from the earlier connect flow with an
// explicit `provider: 'firebase'` + `workspaceId`.
//
// Fail-open by design: a store hiccup must never crash a deploy or a connect. Read helpers return a
// safe default (false / []) on any error — the honest cost is a domain that serves the app only
// after the NEXT publish, never a broken build.

import { doc, getDoc, setDoc, collection, query, where, getDocs, getServerDb as getDb } from './serverDb';
import { dedupeRecords } from './domainDnsRecords';

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

export interface DomainLinkRecord extends DomainLink {
  /** Set while the domain is detached for a lapsed plan ('plan_lapsed'); null/absent = serving. */
  suspended?: string | null;
}

/** ALL of a user's Firebase-connected domain links (empty on any error — fail-open). */
export async function firebaseDomainLinksForUser(userId: string): Promise<DomainLinkRecord[]> {
  try {
    const db = getDb() as any;
    if (!db || !userId) return [];
    const snap = await getDocs(
      query(collection(db, COLLECTION), where('userId', '==', userId), where('provider', '==', 'firebase')),
    );
    const out: DomainLinkRecord[] = [];
    snap.forEach((d: any) => {
      const data = d.data() as DomainLinkRecord;
      if (typeof data?.domain === 'string' && data.domain && typeof data?.workspaceId === 'string') out.push(data);
    });
    return out;
  } catch {
    return [];
  }
}

/** Mark a domain link suspended (plan lapse) or clear the suspension (renewal). Best-effort. */
export async function setDomainSuspended(domain: string, reason: string | null): Promise<void> {
  try {
    const db = getDb() as any;
    if (!db) return;
    await setDoc(doc(db, COLLECTION, docId(domain)), { suspended: reason, updatedAt: Date.now() }, { merge: true });
  } catch { /* best-effort — the hosting-side detach is the enforcement; this is bookkeeping */ }
}

/**
 * The Firebase-connected domains for a workspace, or NULL when we could not ask.
 *
 * 🔒 WHY THE NULL EXISTS (admin 2026-08-24, "yeh theek se deploy ho hi nahi raha hai"). The fail-open
 * wrapper below collapses "this workspace has no domain" and "the lookup failed" into the same empty
 * array — and the publish path used that array to decide whether to deploy to the user's own domain.
 * So a Firestore hiccup read as "nothing to publish to", the domain deploy was skipped, and the user
 * was told their app was live while their domain kept serving an error page, with no trace anywhere.
 * A caller that must be honest about which of the two happened needs them to be different values.
 */
export async function firebaseDomainsForWorkspaceStrict(workspaceId: string): Promise<string[] | null> {
  try {
    const db = getDb() as any;
    if (!db) return null;   // no database handle is "could not ask", never "no domains"
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
    return null;
  }
}

/**
 * The Firebase-connected domains for a workspace (empty on any error — fail-open).
 *
 * Kept for the callers whose behaviour on an unreadable lookup should genuinely be "carry on as if
 * there were none". Anything that PUBLISHES should use the strict form above instead.
 */
export async function firebaseDomainsForWorkspace(workspaceId: string): Promise<string[]> {
  return (await firebaseDomainsForWorkspaceStrict(workspaceId)) ?? [];
}

/** True when the workspace has at least one Firebase-connected custom domain (fail-open → false). */
export async function workspaceHasFirebaseDomain(workspaceId: string): Promise<boolean> {
  return (await firebaseDomainsForWorkspace(workspaceId)).length > 0;
}

// ── DNS record memory (admin 2026-08-19: "DNS record bhulne nahi chahiye") ──────────────────────
//
// The records NavBharatAI shows are derived live from Firebase and only list what is STILL pending, so
// a record the user already added silently vanishes once Firebase accepts it — reading as "everything
// changed". We remember every record we ever showed, so the flow can display a STABLE list (added ✓ +
// still-needed ⏳) that only grows. Best-effort like the rest of this store — a hiccup just means the
// screen falls back to the live pending set, never a broken flow.

export interface RememberedDnsRecord { type: string; name: string; value: string; note?: string; }

/** Union `records` into `custom_domains/{domain}.dnsRecords`, so a record is never forgotten once shown. */
export async function rememberDomainDnsRecords(domain: string, records: readonly RememberedDnsRecord[]): Promise<void> {
  try {
    const db = getDb() as any;
    if (!db || !domain || !records.length) return;
    const ref = doc(db, COLLECTION, docId(domain));
    const snap = await getDoc(ref);
    const existing = (snap.exists() ? (snap.data() as any)?.dnsRecords : []) as RememberedDnsRecord[] | undefined;
    const merged = dedupeRecords([...(Array.isArray(existing) ? existing : []), ...records]);
    await setDoc(ref, { dnsRecords: merged, updatedAt: Date.now() }, { merge: true });
  } catch { /* best-effort — the live pending set is still shown if this fails */ }
}

/** The records ever shown for a domain (empty on any error — fail-open to the live set). */
export async function getStoredDomainDnsRecords(domain: string): Promise<RememberedDnsRecord[]> {
  try {
    const db = getDb() as any;
    if (!db || !domain) return [];
    const snap = await getDoc(doc(db, COLLECTION, docId(domain)));
    const recs = snap.exists() ? (snap.data() as any)?.dnsRecords : [];
    return Array.isArray(recs) ? dedupeRecords(recs) : [];
  } catch {
    return [];
  }
}
