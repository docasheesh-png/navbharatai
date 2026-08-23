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

import { envKillSwitch } from './envFlag';

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
  if (envKillSwitch('AGENTV3_MANAGED_DNS')) return false;
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

interface CfDnsRecord { id: string; type: string; name: string; content: string; proxied?: boolean }

const stripQuotes = (s: string) => s.replace(/^"|"$/g, '');

/**
 * Is this TXT value one of OUR site-ownership tokens? PURE.
 *
 * The prefix is what makes the stale-token sweep above safe to scope: it is issued by us, the hosting
 * service requires at most one of them per domain, and nothing else in a user's zone looks like it.
 * Everything else — SPF, DKIM, another service's verification — is invisible to that sweep.
 */
export function isSiteToken(txtValue: string): boolean {
  return stripQuotes(String(txtValue ?? '')).trim().toLowerCase().startsWith('hosting-site=');
}

/**
 * Write the desired records into the zone by CONVERGING each type+name set we manage.
 *
 * ROOT CAUSE HARDENING (mitrify.in live walk, 2026-08-06): when a zone activates, Cloudflare
 * AUTO-IMPORTS the domain's old records — often PROXIED (orange cloud; the admin's dashboard
 * literally said "your traffic is proxying through Cloudflare"). A proxied record hides the real
 * value behind Cloudflare IPs, so the hosting service can never validate the domain — and the old
 * per-record logic had two holes: an identical-content record that was PROXIED was "same" and left
 * proxied, and a multi-value A set thrashed (each value replaced the same first record). Now, per
 * type+name:
 *   • non-TXT: the whole set converges to exactly the desired values, DNS-only — stale/proxied
 *     records are replaced or deleted, missing values created, proxied-but-right-content records
 *     re-written un-proxied.
 *   • TXT: desired values are added alongside (multiple TXT values are legal; the ownership/ACME
 *     challenge must not clobber unrelated TXT like SPF).
 * Records on names we were not asked about are never touched. Returns how many records were
 * created/updated/removed — an honest "0 changes" remains a valid, verifiable outcome.
 */
export async function applyRecords(zoneId: string, desired: DesiredRecord[]): Promise<number> {
  let changed = 0;
  const groups = new Map<string, ReturnType<typeof toCfRecordPayloads>>();
  for (const want of toCfRecordPayloads(desired)) {
    const key = `${want.type}|${want.name}`;
    const g = groups.get(key) ?? [];
    g.push(want);
    groups.set(key, g);
  }
  for (const group of groups.values()) {
    const { type, name } = group[0];
    const existing = (await cf<CfDnsRecord[]>(
      `/zones/${zoneId}/dns_records?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}&per_page=100`,
    )) ?? [];

    if (type === 'TXT') {
      for (const want of group) {
        const present = existing.some((r) => stripQuotes(r.content) === stripQuotes(want.content));
        if (present) continue;
        await cf(`/zones/${zoneId}/dns_records`, { method: 'POST', body: want });
        changed++;
      }
      /**
       * 🔒 REMOVE THE OWNERSHIP TOKENS THAT ARE NO LONGER OURS — the fix for a domain that could
       * never connect, no matter how long anyone waited.
       *
       * ROOT CAUSE (admin, three days on `mitrify.com`, and the hosting API said it outright):
       *
       *     "Custom Domain has multiple, conflicting ownership claims. There must be at most one TXT
       *      record with the `hosting-site=` prefix on the domain."
       *      ownership: conflict · host: active · SSL: active
       *
       * Host and certificate were both fine. Only ownership was stuck, and it was stuck FOREVER —
       * this is not a slow state that eventually resolves, it is a permanent refusal. Every time the
       * domain was connected from a different app, that app's site minted a new `hosting-site=` token
       * and the loop above ADDED it. Nothing ever took the old one away, so three connects left three
       * claims and the hosting service refused all of them. Waiting could never have fixed it.
       *
       * 🔒 WHY THIS IS SAFE, AND WHY THE WHOLE TXT BRANCH IS STILL ADD-ONLY. Converging TXT the way
       * the A-record branch below converges would be a data-loss bug: a domain's TXT records also
       * carry SPF, DKIM and other services' verifications, and deleting those would silently break
       * the user's EMAIL. So the sweep is scoped to the one prefix that is unambiguously ours and
       * that the hosting service itself requires to be unique. A record we did not issue is never
       * touched, and the token we still want is never removed.
       */
      const wantedTokens = new Set(group.map((w) => stripQuotes(w.content)).filter(isSiteToken));
      /**
       * ⚠️ SWEEP ONLY WHEN WE KNOW WHICH TOKEN IS THE LIVE ONE. An empty `wantedTokens` does NOT mean
       * "no token is wanted" — it usually means the hosting service has already ACCEPTED ownership and
       * stopped asking, so the token sitting in the zone is the one holding the domain up. Deleting it
       * then would tear down a working domain to fix a problem it does not have. So a group that
       * carries no site token sweeps nothing at all.
       */
      if (wantedTokens.size > 0) {
        for (const r of existing) {
          const content = stripQuotes(r.content);
          if (!isSiteToken(content) || wantedTokens.has(content)) continue;
          await cf(`/zones/${zoneId}/dns_records/${r.id}`, { method: 'DELETE' });
          changed++;
        }
      }
      continue;
    }

    // Non-TXT: converge to exactly the desired value set, all DNS-only (grey cloud).
    const wantedContents = new Set(group.map((w) => stripQuotes(w.content)));
    const good = existing.filter((r) => wantedContents.has(stripQuotes(r.content)) && r.proxied !== true);
    const goodContents = new Set(good.map((r) => stripQuotes(r.content)));
    const stale = existing.filter((r) => !good.includes(r)); // wrong content OR proxied
    const missing = group.filter((w) => !goodContents.has(stripQuotes(w.content)));

    // Replace stale records with missing values pairwise, then create/delete the remainder.
    let i = 0;
    for (; i < missing.length && i < stale.length; i++) {
      await cf(`/zones/${zoneId}/dns_records/${stale[i].id}`, { method: 'PUT', body: missing[i] });
      changed++;
    }
    for (; i < missing.length; i++) {
      await cf(`/zones/${zoneId}/dns_records`, { method: 'POST', body: missing[i] });
      changed++;
    }
    for (let j = missing.length; j < stale.length; j++) {
      await cf(`/zones/${zoneId}/dns_records/${stale[j].id}`, { method: 'DELETE' });
      changed++;
    }
  }
  return changed;
}

/**
 * WHAT IS ACTUALLY IN THE ZONE RIGHT NOW — the reading nothing in this product could take.
 *
 * 🔒 WHY THIS EXISTS (admin 2026-08-22, six hours of a domain not connecting). The screen could show
 * two things: what the hosting service is ASKING for, and what we REMEMBER showing. Neither is the
 * question people actually have, which is "are my records there or not?" — and with the domain's
 * nameservers delegated to us, the registrar's own DNS panel is inert, so the user cannot check
 * either. Their records sat in Hostinger's panel, which announced in its own words that it was
 * "Inactive", while everyone stared at a spinner.
 *
 * Worse, the one number we did print could not tell the two opposite cases apart: `applyRecords`
 * returns how many records it CHANGED, so "0 applied" means either "everything was already correct"
 * (success) or "there was nothing to write" (a real problem). Reading the zone back distinguishes
 * them with evidence instead of inference.
 *
 * Values come back unquoted so a TXT compares equal to what the user was told to add.
 */
export async function listZoneRecords(zoneId: string): Promise<Array<{ type: string; name: string; value: string; ttl: number; proxied: boolean }>> {
  const rows = (await cf<Array<CfDnsRecord & { ttl?: number }>>(`/zones/${zoneId}/dns_records?per_page=200`)) ?? [];
  return rows.map((r) => ({
    type: String(r.type ?? '').toUpperCase(),
    name: String(r.name ?? ''),
    value: stripQuotes(String(r.content ?? '')),
    ttl: typeof r.ttl === 'number' ? r.ttl : 0,
    proxied: r.proxied === true,
  }));
}

/**
 * Is every record the hosting service asked for genuinely present in the zone? PURE.
 *
 * 🔒 The comparison is on TYPE + NAME + VALUE, and a record that is present but PROXIED counts as
 * MISSING — an orange-cloud record answers with the CDN's own address, so the hosting service's
 * verification sweep sees the wrong value and waits forever while the zone looks correct to a human
 * reading it. That failure is invisible without saying so explicitly, which is why it is named here
 * rather than left to a reviewer's eye.
 */
export function missingFromZone(
  desired: readonly DesiredRecord[],
  inZone: ReadonlyArray<{ type: string; name: string; value: string; proxied?: boolean }>,
): DesiredRecord[] {
  const key = (t: string, n: string, v: string) => `${t.toUpperCase()}|${n.replace(/\.$/, '').toLowerCase()}|${stripQuotes(v)}`;
  const have = new Set(inZone.filter((r) => r.proxied !== true).map((r) => key(r.type, r.name, r.value)));
  return desired.filter((d) => d.type && d.name && d.value && !have.has(key(d.type, d.name, d.value)));
}

/** A managed-DNS failure for the OWNER's screen — bounded, vendor branding neutralized. */
export function sanitizeManagedDnsError(e: unknown): string {
  const msg = e instanceof Error && e.message ? e.message : String(e ?? 'unknown error');
  return msg.replace(/cloudflare/gi, 'DNS service').slice(0, 240);
}
