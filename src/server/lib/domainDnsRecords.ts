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
