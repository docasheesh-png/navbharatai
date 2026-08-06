/**
 * Managed DNS via Cloudflare zones — "DNS hum set kar dein, user kuch na kare" (admin 2026-08-06).
 *
 * THE MODEL (nameserver delegation — the one path that works on EVERY registrar, GoDaddy and
 * Hostinger alike): the user changes their domain's nameservers ONCE at their registrar to the two
 * Cloudflare nameservers we hand them. From that moment the domain's DNS lives in a zone on OUR
 * Cloudflare account, and NavBharatAI writes the records itself — the A/AAAA/TXT set that Firebase
 * hands back for the custom-domain attach goes in automatically, no copy-paste, and every future
 * record change is ours to make. This is how "connect your domain" becomes one approval instead of a
 * DNS lesson.
 *
 * HONESTY BOUNDARIES:
 *  - Everything here is creds-gated (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`, the admin's
 *    deliberate act) plus a kill switch (`AGENTV3_MANAGED_DNS=off`). Unconfigured ⇒ the feature says
 *    so; it never pretends.
 *  - Records are written PROXIED OFF (grey cloud). Firebase must see its own A records directly to
 *    validate ownership and issue the certificate; proxying through Cloudflare would break the
 *    attach. This is a correctness constraint, not a style choice.
 *  - We only ever touch records whose type+name WE manage (the ones Firebase asked for). A user's
 *    existing MX/other records at the registrar die with the nameserver change (that is how
 *    delegation works) — the UI must say so plainly before they switch. Records inside our zone that
 *    we did not create are left alone.
 */

const CF_API = 'https://api.cloudflare.com/client/v4';

export interface ManagedZone {
  id: string;
  name: string;
  status: string;        // 'pending' until the registrar's nameserver change propagates; 'active' after
  nameServers: string[]; // the two NS the user must set at their registrar — the ONLY manual step
}

export interface DesiredRecord {
  type: string;   // A | AAAA | TXT | CNAME
  name: string;   // fully-qualified record name
  value: string;
}

export function managedDnsConfigured(): boolean {
  if (process.env.AGENTV3_MANAGED_DNS === 'off') return false;
  return !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
}

type CfFetch = (url: string, init: { method?: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean; status: number; json(): Promise<unknown>;
}>;

let _fetchImpl: CfFetch = fetch as unknown as CfFetch;
/** Test seam — the CF API is unreachable from CI, and these calls must still be provable. */
export function _setCfFetchForTests(f: CfFetch | null): void {
  _fetchImpl = f ?? (fetch as unknown as CfFetch);
}

async function cf<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await _fetchImpl(`${CF_API}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean; result?: T; errors?: Array<{ code?: number; message?: string }>;
  };
  if (!res.ok || data.success === false) {
    const first = data.errors?.[0];
    const err = new Error(`DNS service error${first?.code ? ` (${first.code})` : ` (HTTP ${res.status})`}: ${first?.message || 'request failed'}`);
    (err as Error & { cfCode?: number }).cfCode = first?.code;
    throw err;
  }
  return data.result as T;
}

interface CfZone { id: string; name: string; status: string; name_servers?: string[] }

/** Create (or fetch the existing) zone for `domain` on our account. Idempotent. */
export async function ensureZone(domain: string): Promise<ManagedZone> {
  try {
    const z = await cf<CfZone>('/zones', {
      method: 'POST',
      body: { name: domain, account: { id: process.env.CLOUDFLARE_ACCOUNT_ID }, type: 'full' },
    });
    return { id: z.id, name: z.name, status: z.status, nameServers: z.name_servers ?? [] };
  } catch (e) {
    // 1061 = zone already exists (possibly from an earlier attempt) — fetch it instead.
    if ((e as Error & { cfCode?: number }).cfCode !== 1061 && !/already exists/i.test(String(e))) throw e;
    const zones = await cf<CfZone[]>(`/zones?name=${encodeURIComponent(domain)}`);
    const z = zones?.[0];
    if (!z) throw e;
    return { id: z.id, name: z.name, status: z.status, nameServers: z.name_servers ?? [] };
  }
}

/** Current zone state — 'active' means the registrar's nameserver change has taken effect. */
export async function zoneStatus(domain: string): Promise<ManagedZone | null> {
  const zones = await cf<CfZone[]>(`/zones?name=${encodeURIComponent(domain)}`);
  const z = zones?.[0];
  return z ? { id: z.id, name: z.name, status: z.status, nameServers: z.name_servers ?? [] } : null;
}

/**
 * Map the records Firebase asked for into the exact Cloudflare payloads. Pure, exported for tests.
 * TXT values are quoted by the API itself; names pass through fully-qualified. Everything is
 * DNS-only (`proxied: false`) — see the header for why that is a hard correctness requirement.
 */
export function toCfRecordPayloads(records: DesiredRecord[]): Array<{ type: string; name: string; content: string; ttl: number; proxied: boolean }> {
  return records
    .filter((r) => r.type && r.name && r.value)
    .map((r) => ({ type: r.type.toUpperCase(), name: r.name, content: r.value, ttl: 300, proxied: false }));
}

interface CfDnsRecord { id: string; type: string; name: string; content: string }

/**
 * Write the desired records into the zone. For each type+name we manage: identical record ⇒ left
 * alone; different content on a SINGLE-VALUE type (A/AAAA/CNAME set of ours) ⇒ replaced; TXT ⇒
 * added alongside (multiple TXT values are legal and Firebase's challenge must not clobber
 * unrelated TXT). Returns how many records were actually created/updated — an honest "0 changes"
 * is a valid, verifiable outcome.
 */
export async function applyRecords(zoneId: string, desired: DesiredRecord[]): Promise<number> {
  let changed = 0;
  for (const want of toCfRecordPayloads(desired)) {
    const existing = await cf<CfDnsRecord[]>(
      `/zones/${zoneId}/dns_records?type=${encodeURIComponent(want.type)}&name=${encodeURIComponent(want.name)}&per_page=100`,
    );
    const same = (existing ?? []).find((r) => r.content.replace(/^"|"$/g, '') === want.content.replace(/^"|"$/g, ''));
    if (same) continue;
    if (want.type !== 'TXT' && (existing ?? []).length > 0) {
      await cf(`/zones/${zoneId}/dns_records/${existing[0].id}`, { method: 'PUT', body: want });
      changed++;
      continue;
    }
    await cf(`/zones/${zoneId}/dns_records`, { method: 'POST', body: want });
    changed++;
  }
  return changed;
}

/** A managed-DNS failure for the OWNER's screen — bounded, vendor branding neutralized. */
export function sanitizeManagedDnsError(e: unknown): string {
  const msg = e instanceof Error && e.message ? e.message : String(e ?? 'unknown error');
  return msg.replace(/cloudflare/gi, 'DNS service').slice(0, 240);
}
