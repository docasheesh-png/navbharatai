/**
 * Hostinger direct DNS (Slice C; admin 2026-08-06: "not only GoDaddy, Hostinger bhi").
 *
 * Hostinger is not part of the Domain Connect ecosystem, but it has a public API with DNS zone
 * management (developers.hostinger.com), authorized by a personal API token the user creates in
 * hPanel. The flow here: the user pastes that token ONCE, we write the exact records the hosting
 * attach asked for into their Hostinger zone via their own account, and we THROW THE TOKEN AWAY —
 * it is used for the one call and never stored, logged, or echoed back (it is a credential to the
 * user's whole Hostinger account; holding it would be a liability, not a feature).
 *
 * HONEST STATUS — read before enabling: the endpoint shapes below follow Hostinger's public API as
 * of this build's knowledge and CANNOT be live-verified from the dev sandbox (egress blocked). That
 * is why the feature ships behind `AGENTV3_HOSTINGER_DNS=on` (default OFF) and why every failure
 * surfaces the API's own message: the FIRST live attempt either works or names exactly what to fix.
 * No fake success is possible — the outcome reported is the API's real answer.
 */

const HOSTINGER_API = 'https://developers.hostinger.com/api/dns/v1';

export function hostingerDnsEnabled(): boolean {
  return /^(on|true|1)$/i.test((process.env.AGENTV3_HOSTINGER_DNS || '').trim());
}

type HFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean; status: number; json(): Promise<unknown>;
}>;
let _fetchImpl: HFetch = fetch as unknown as HFetch;
/** Test seam. */
export function _setHostingerFetchForTests(f: HFetch | null): void {
  _fetchImpl = f ?? (fetch as unknown as HFetch);
}

/**
 * Map desired records into Hostinger's zone-update payload. Pure, exported for tests. Names are
 * RELATIVE in Hostinger zones ('@' for the apex); the attach hands back fully-qualified names, so
 * they are trimmed against the domain.
 */
export function toHostingerZone(
  domain: string,
  records: Array<{ type: string; name: string; value: string }>,
): Array<{ name: string; type: string; ttl: number; records: Array<{ content: string }> }> {
  const out = new Map<string, { name: string; type: string; ttl: number; records: Array<{ content: string }> }>();
  for (const r of records) {
    if (!r.type || !r.value) continue;
    const fq = (r.name || domain).replace(/\.$/, '');
    const rel = fq === domain ? '@' : fq.endsWith(`.${domain}`) ? fq.slice(0, -(domain.length + 1)) : fq;
    const key = `${r.type.toUpperCase()}|${rel}`;
    const entry = out.get(key) ?? { name: rel, type: r.type.toUpperCase(), ttl: 300, records: [] };
    entry.records.push({ content: r.value });
    out.set(key, entry);
  }
  return [...out.values()];
}

/**
 * Write the records into the user's Hostinger zone with THEIR token. `overwrite: false` — we add or
 * update only what we send; the rest of their zone (mail, everything) is left untouched. The token
 * is a parameter, never module state: nothing here can retain it.
 */
export async function applyHostingerRecords(
  apiToken: string,
  domain: string,
  records: Array<{ type: string; name: string; value: string }>,
): Promise<{ ok: boolean; error?: string }> {
  const zone = toHostingerZone(domain, records);
  if (zone.length === 0) return { ok: false, error: 'No records to apply yet — connect the domain first.' };
  try {
    const res = await _fetchImpl(`${HOSTINGER_API}/zones/${encodeURIComponent(domain)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ overwrite: false, zone }),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    return { ok: false, error: sanitizeHostingerError(data.message || data.error || `HTTP ${res.status}`, res.status) };
  } catch (e) {
    return { ok: false, error: sanitizeHostingerError(e instanceof Error ? e.message : String(e)) };
  }
}

/** Bounded, honest failure text. 401/403 get the one hint that actually helps (the token). */
export function sanitizeHostingerError(msg: string, status?: number): string {
  const base = status === 401 || status === 403
    ? 'The API token was not accepted — create a fresh token in hPanel (Account → API) and try again.'
    : msg;
  return String(base).slice(0, 240);
}
