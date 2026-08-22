// Stable DNS-record view for the "connect my website" flow (admin report 2026-08-19:
// "DNS record bhulne nahi chahiye" — the records NavBharatAI gave, that I added at Hostinger,
// were all different when I came back 4-5 hours later).
//
// ROOT CAUSE. The records shown were derived LIVE from Firebase's custom-domain object every time,
// and `customDomainRecords` returns only the records Firebase still wants ADDED. As a domain moves
// through its lifecycle — ownership TXT satisfied, then an ACME cert-challenge TXT required — the
// pending set genuinely changes, so a record the user already added silently DISAPPEARS from the page
// (it's satisfied) and a new one APPEARS. To a non-technical user that reads as "everything changed
// and my work was wasted", and there is no signal that the records they entered are now verified.
//
// THE FIX has two halves, and this module is the pure half (fully unit-tested, no I/O):
//   1. The route PERSISTS every record it ever showed (see firebaseDomainLink's record store), so a
//      record is never forgotten even after Firebase stops reporting it as pending.
//   2. `mergeStableRecords` unions the persisted records with the currently-pending set and tags each
//      one: `done: true`  = the user already added it and Firebase has accepted it (show a ✓),
//          `done: false` = still needs adding at the registrar (show a ⏳).
// The result is a STABLE list: records only ever get ADDED to it, never swapped out, and each carries
// an honest live status. Pending records are ordered first so "what's left to do" is at the top.

export interface StableDnsRecord {
  type: string;   // 'A' | 'AAAA' | 'TXT' | 'CNAME'
  name: string;   // the host/record name (the domain, or a challenge subdomain)
  value: string;  // the record value (an IP, a TXT token, …)
  note?: string;  // a short human hint of what the record is for
  /** True when this record is no longer in the pending set — i.e. already added and accepted. */
  done: boolean;
}

interface RecordLike {
  type?: unknown;
  name?: unknown;
  value?: unknown;
  note?: unknown;
}

/** Normalised identity of a record. DNS is case-insensitive on type/name; the value is compared as-is
 *  (a TXT token is case-sensitive, and an IP has no case). Trailing dots are trimmed so `foo.com` and
 *  `foo.com.` are one record. Pure. */
export function dnsRecordKey(r: { type?: unknown; name?: unknown; value?: unknown }): string {
  const type = String(r.type ?? '').trim().toUpperCase();
  const name = String(r.name ?? '').trim().toLowerCase().replace(/\.$/, '');
  const value = String(r.value ?? '').trim();
  return `${type}|${name}|${value}`;
}

/** A clean, deduped record (drops entries missing type/name/value). Pure. */
function sanitize(r: RecordLike): { type: string; name: string; value: string; note?: string } | null {
  const type = String(r.type ?? '').trim();
  const name = String(r.name ?? '').trim().replace(/\.$/, '');
  const value = String(r.value ?? '').trim();
  if (!type || !name || !value) return null;
  const note = typeof r.note === 'string' && r.note.trim() ? r.note.trim() : undefined;
  return { type, name, value, ...(note ? { note } : {}) };
}

/** Dedupe a record list by identity, keeping the first occurrence (and its note). Pure. */
export function dedupeRecords(records: readonly RecordLike[]): { type: string; name: string; value: string; note?: string }[] {
  const seen = new Set<string>();
  const out: { type: string; name: string; value: string; note?: string }[] = [];
  for (const raw of records) {
    const r = sanitize(raw);
    if (!r) continue;
    const key = dnsRecordKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Merge the persisted records with the currently-pending set into ONE stable list.
 *
 * - Every record from either source appears exactly once (deduped by identity).
 * - `done` is true when the record is NOT in the current pending set (added & accepted), false when it
 *   still needs adding.
 * - Pending records are listed first (what's left to do), then the accepted ✓ records.
 *
 * Pure — the route does the persistence and passes both lists in.
 */
/**
 * ANOTHER APP'S OWNERSHIP TOKEN — the record that must never appear on this app's screen.
 *
 * 🔒 ROOT CAUSE (admin screenshot 2026-08-22). The record store is keyed by DOMAIN alone and merges
 * forever, but the records themselves belong to a (domain, SITE) pair: every app gets its own
 * Firebase site, and each site demands its own `hosting-site=<siteId>` TXT. Connect one domain from
 * three apps and all three tokens pool under one key — which is exactly what `mitrify.com` showed:
 *
 *     hosting-site=nbai-37038f98f790b362308d   ← this app's, correctly listed as still needed
 *     hosting-site=nbai-709e5932ecaaf74b9c63   ← another app's, shown and badged "Verified"
 *     hosting-site=nbai-dd4fe67881426b5f258a   ← another app's, shown and badged "Verified"
 *
 * The admin dutifully added all of them at their registrar. Two of the five records they were told to
 * add could never do anything for the app they were looking at.
 *
 * 🔒 WHY THIS IS A FILTER AND NOT A MIGRATION. The token is literally `hosting-site=` + the site id
 * (`siteIdForWorkspace`), so "belongs to another app" is an EXACT string comparison, never a guess.
 * That means the pollution can be corrected on READ, at zero risk: nothing stored is deleted, no
 * document is rewritten, and a domain that is working today keeps working. Re-keying the store would
 * mean migrating live customer records to fix a display bug — a much larger blast radius for the same
 * user-visible result. The store stays as it is; what we SHOW is now scoped correctly.
 *
 * A record that is not a site token, or a token we cannot parse, is always KEPT — this only ever
 * removes something it can positively identify as another app's. PURE.
 */
export const SITE_TOKEN_PREFIX = 'hosting-site=';

export function isForeignSiteToken(value: unknown, currentSiteId: string): boolean {
  const v = String(value ?? '').trim().replace(/^"|"$/g, '');
  if (!v.toLowerCase().startsWith(SITE_TOKEN_PREFIX)) return false;   // not a site token — keep
  const site = v.slice(SITE_TOKEN_PREFIX.length).trim();
  if (!site) return false;                                            // unparseable — keep
  // No current site id ⇒ we cannot tell whose it is, so we keep everything. Guessing here would hide
  // the ONE record the user actually needs.
  if (!currentSiteId) return false;
  return site.toLowerCase() !== currentSiteId.trim().toLowerCase();
}

/** Drop only the ownership tokens that provably belong to a DIFFERENT app. PURE. */
export function dropForeignSiteTokens<T extends RecordLike>(records: readonly T[], currentSiteId: string): T[] {
  return records.filter((r) => !isForeignSiteToken(r?.value, currentSiteId));
}

export function mergeStableRecords(
  stored: readonly RecordLike[],
  pending: readonly RecordLike[],
): StableDnsRecord[] {
  const pendingKeys = new Set(dedupeRecords(pending).map((r) => dnsRecordKey(r)));
  // Union: pending records first (so a brand-new pending record the store hasn't seen yet still shows),
  // then the stored ones. Dedupe keeps the first occurrence, so a record present in both keeps its
  // pending-source note and single entry.
  const union = dedupeRecords([...pending, ...stored]);
  const tagged: StableDnsRecord[] = union.map((r) => ({ ...r, done: !pendingKeys.has(dnsRecordKey(r)) }));
  // Pending (⏳) first, accepted (✓) after — the user sees remaining work at the top. Stable within
  // each group (preserves the union order above).
  return [...tagged.filter((r) => !r.done), ...tagged.filter((r) => r.done)];
}
