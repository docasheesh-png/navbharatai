/**
 * Cloudflare for SaaS helper — connects a user's own custom domain to the
 * platform via Cloudflare "custom hostnames". Given a hostname it creates the
 * custom hostname on our zone and returns the exact DNS records the user must
 * add at their registrar (a CNAME to our fallback origin + TXT validation),
 * after which Cloudflare auto-issues SSL and routes traffic to our origin.
 *
 * Config (Cloud Run env):
 *   CLOUDFLARE_API_TOKEN    — token with Zone:SSL and Certificates:Edit + Zone:Read
 *   CLOUDFLARE_ZONE_ID      — the SaaS zone (e.g. mitrify.xyz)
 *   CLOUDFLARE_FALLBACK_ORIGIN — hostname the customer CNAMEs to (the serving
 *                                origin). Defaults to `connect.<zone-name>`.
 *   CLOUDFLARE_SAAS_ZONE_NAME  — the zone's domain name (for the default target).
 */

const CF_API = 'https://api.cloudflare.com/client/v4';

function token(): string | undefined {
  return process.env.CLOUDFLARE_API_TOKEN;
}
function zoneId(): string | undefined {
  return process.env.CLOUDFLARE_ZONE_ID;
}

/** True when the Cloudflare for SaaS integration is configured. */
export function cloudflareConfigured(): boolean {
  return !!(token() && zoneId());
}

/** The hostname the customer must CNAME their domain to. */
export function fallbackOrigin(): string {
  const explicit = process.env.CLOUDFLARE_FALLBACK_ORIGIN;
  if (explicit) return explicit;
  const zoneName = process.env.CLOUDFLARE_SAAS_ZONE_NAME || 'mitrify.xyz';
  return `connect.${zoneName}`;
}

export interface DnsRecord {
  type: 'CNAME' | 'TXT';
  name: string;
  value: string;
  note?: string;
}

export interface CustomHostname {
  id: string;
  hostname: string;
  status: string;       // pending | active | ... (ownership/verification status)
  sslStatus: string;    // pending_validation | active | ...
  active: boolean;      // true when fully verified + SSL issued
  records: DnsRecord[]; // records the user must add at their registrar
}

async function cf(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!data || data.success !== true) {
    const msg = data?.errors?.[0]?.message || `Cloudflare API error (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return data.result;
}

/** Build the list of records the customer must add, from a custom-hostname result. */
function toRecords(r: any): DnsRecord[] {
  const records: DnsRecord[] = [
    { type: 'CNAME', name: r.hostname, value: fallbackOrigin(), note: 'Points your domain to NavBharatAI' },
  ];
  const ov = r.ownership_verification;
  if (ov && ov.type === 'txt' && ov.name && ov.value) {
    records.push({ type: 'TXT', name: ov.name, value: ov.value, note: 'Proves you own the domain' });
  }
  for (const v of r.ssl?.validation_records || []) {
    if (v.txt_name && v.txt_value) {
      records.push({ type: 'TXT', name: v.txt_name, value: v.txt_value, note: 'SSL certificate validation' });
    }
  }
  return records;
}

function normalize(r: any): CustomHostname {
  const sslStatus = r.ssl?.status || 'pending_validation';
  const status = r.status || 'pending';
  return {
    id: r.id,
    hostname: r.hostname,
    status,
    sslStatus,
    active: status === 'active' && sslStatus === 'active',
    records: toRecords(r),
  };
}

/** Create (or return the existing) custom hostname for a domain. */
export async function createCustomHostname(hostname: string): Promise<CustomHostname> {
  const existing = await getCustomHostname(hostname);
  if (existing) return existing;
  const result = await cf(`/zones/${zoneId()}/custom_hostnames`, {
    method: 'POST',
    body: JSON.stringify({
      hostname,
      ssl: { method: 'txt', type: 'dv', settings: { min_tls_version: '1.2' } },
    }),
  });
  return normalize(result);
}

/** Look up the current status of a custom hostname (null if not created yet). */
export async function getCustomHostname(hostname: string): Promise<CustomHostname | null> {
  const list = await cf(`/zones/${zoneId()}/custom_hostnames?hostname=${encodeURIComponent(hostname)}`);
  if (!Array.isArray(list) || list.length === 0) return null;
  return normalize(list[0]);
}
