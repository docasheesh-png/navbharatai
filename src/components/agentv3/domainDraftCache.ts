// THE DOMAIN PAGE REMEMBERS ITSELF, ON THE DEVICE (admin 2026-08-22).
//
// THE REPORT: "connect your own domain ke baad jo page open hota hai — jahan domain name fill karna
// hota hai, DNS record milte hai, copy karte hai — is page ko user ke device me bhi save karo, jisse
// yeh jaldi se khul jaye. Abhi lagta hai 'sab gayab ho gaya'."
//
// WHY IT LOOKED THAT WAY. The page did restore itself — from the SERVER, one round trip after mount.
// So every reopen paints an empty form first and fills it in a moment later. Nothing was lost, but for
// that moment the screen says the thing the user fears, and on a cold start or a bad connection the
// moment is long. "We have not fetched yet" was being rendered exactly like "there is nothing here" —
// the same conflation this codebase has been finding all week, in a new place.
//
// 🔒 THE ONE DESIGN DECISION THAT MATTERS, and it is not the caching. A DNS page holds two very
// different kinds of thing, and treating them alike is how a cache starts lying:
//
//   • WHAT TO TYPE — the domain, and the records to copy into the registrar. These do not change on
//     their own. Showing them instantly from the device is simply correct, and it is the whole of what
//     the admin asked for: the copying work is right there, immediately.
//
//   • WHETHER IT WORKED — verified / active / serving. These are live facts about the internet, and a
//     remembered "✓ verified" is exactly the stale-artifact trap: the badge would be REAL, and it
//     would be a badge from yesterday. Someone would read "connected" off a screen while their site
//     was down.
//
// So the cache restores the first kind at once and NEVER restores the second as confirmed: the live
// states come back marked unconfirmed until the server answers. The page is instant, and it never
// tells you something works because it used to.
//
// PURE — the store and the clock are injected, so every rule here is unit-testable and none of it
// needs a browser.

/** What is worth keeping on the device between visits. Deliberately small. */
export interface DomainDraft {
  /** What the user typed, cleaned. */
  domain: string;
  /** The records to copy — the actual work of this page. */
  records: unknown[];
  /** Nameservers for the managed-DNS path, when that is the route in use. */
  nameServers?: string[];
  /** Epoch ms this was saved. */
  savedAt: number;
}

/** The narrow slice of `localStorage` this needs. Injected so tests need no browser. */
export interface DraftStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** One key per workspace: two apps being connected must never show each other's domain. */
export function draftKey(workspaceId: string): string {
  return `nbai:domain-draft:${String(workspaceId || '').trim()}`;
}

/**
 * How long a remembered draft is still worth showing.
 *
 * Generous on purpose — 30 days. What it restores is "what to type", which does not go stale the way
 * a verification does, and a user who comes back a fortnight later to finish a half-done DNS change is
 * precisely the person this is for. The live states are never restored as confirmed, so age cannot
 * turn into a false claim; it can only turn into a slightly old set of records, which the refresh
 * corrects within a second.
 */
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Cap on what is written, so a pathological response cannot fill a user's storage. */
const MAX_RECORDS = 40;

/** Read the saved draft, or null when there is none / it is unusable / it has aged out. */
export function readDomainDraft(store: DraftStore | null | undefined, workspaceId: string, now: number): DomainDraft | null {
  if (!store || !workspaceId) return null;
  try {
    const raw = store.getItem(draftKey(workspaceId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<DomainDraft>;
    const domain = String(d?.domain ?? '').trim();
    const savedAt = Number(d?.savedAt);
    if (!domain || !Number.isFinite(savedAt)) return null;
    if (now - savedAt > DRAFT_TTL_MS) {
      store.removeItem(draftKey(workspaceId));
      return null;
    }
    return {
      domain,
      records: Array.isArray(d.records) ? d.records.slice(0, MAX_RECORDS) : [],
      nameServers: Array.isArray(d.nameServers) ? d.nameServers.filter((n): n is string => typeof n === 'string') : undefined,
      savedAt,
    };
  } catch {
    // Corrupt or unreadable — behave exactly as if nothing was saved. A broken cache must never be
    // worse than no cache.
    return null;
  }
}

/**
 * Save what this page would need to open instantly next time.
 *
 * Refuses to write a draft with no domain: an empty entry would make the next visit restore a blank
 * form and look identical to the bug this exists to fix.
 */
export function writeDomainDraft(
  store: DraftStore | null | undefined,
  workspaceId: string,
  draft: { domain: string; records?: unknown[]; nameServers?: string[] },
  now: number,
): boolean {
  if (!store || !workspaceId) return false;
  const domain = String(draft?.domain ?? '').trim();
  if (!domain) return false;
  try {
    const payload: DomainDraft = {
      domain,
      records: Array.isArray(draft.records) ? draft.records.slice(0, MAX_RECORDS) : [],
      ...(draft.nameServers?.length ? { nameServers: draft.nameServers.slice(0, 10) } : {}),
      savedAt: now,
    };
    store.setItem(draftKey(workspaceId), JSON.stringify(payload));
    return true;
  } catch {
    // Private mode, or storage full. The page still works from the server exactly as before.
    return false;
  }
}

/** Forget this workspace's draft — used when the domain is disconnected, so the next visit is clean. */
export function clearDomainDraft(store: DraftStore | null | undefined, workspaceId: string): void {
  try { store?.removeItem(draftKey(workspaceId)); } catch { /* nothing to do */ }
}

/**
 * What the page should say about the copy it is showing before the server has answered.
 *
 * 🔒 It never says "connected" or "verified" from a remembered draft. It says where the information
 * came from and that the live check is running, which is the truthful version of the same reassurance
 * — and it is the reassurance the admin actually asked for: your work is still here.
 */
export function draftNotice(hasDraft: boolean, confirmed: boolean): string | null {
  if (!hasDraft || confirmed) return null;
  return 'Showing what you saved on this device — checking the live status now.';
}
