// Point a user's own domain at the Render service that actually RUNS their app (admin 2026-09-04).
//
// 🔴 THE ROOT CAUSE THIS EXISTS TO CLOSE. mitrify.com sat behind Firebase's "Site Not Found" for a
// month while the connect screen read `ownership: active · host: active · SSL: active`. Nothing was
// wrong with the DNS; the domain was simply attached to the wrong place. A fullstack ship-whole app
// cannot be served by static hosting — the publish route refuses it, correctly — so its Firebase site
// never receives a release, and Firebase answers "Site Not Found" for a site with no release, forever.
// Meanwhile `renderDeploy.ts` contained no custom-domain code at all, so even a perfect backend deploy
// never moved the domain to the one host that CAN serve the app.
//
// ⇒ The domain was attached to a place that structurally could not serve the app, and nothing in the
// product could move it. This module is the missing half: attach the domain to the Render service, and
// say exactly which DNS records make it resolve.
//
// Pure request-builders + record planning, in the same shape as renderDeploy.ts, so every rule here is
// unit-testable without a network.

const RENDER_API_BASE = 'https://api.render.com/v1';

export interface RenderRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

function renderHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

/** Build the "add this custom domain to this service" request. Pure + tested. */
export function buildAddCustomDomainRequest(apiKey: string, serviceId: string, domain: string): RenderRequest {
  return {
    url: `${RENDER_API_BASE}/services/${encodeURIComponent(serviceId)}/custom-domains`,
    method: 'POST',
    headers: renderHeaders(apiKey),
    body: JSON.stringify({ name: domain.trim().toLowerCase() }),
  };
}

/** Build the "what custom domains does this service already have" request. Pure + tested. */
export function buildListCustomDomainsRequest(apiKey: string, serviceId: string): RenderRequest {
  return {
    url: `${RENDER_API_BASE}/services/${encodeURIComponent(serviceId)}/custom-domains?limit=100`,
    method: 'GET',
    headers: renderHeaders(apiKey),
  };
}

/**
 * The hostname Render serves a service on (`<name>.onrender.com`), taken from the service's own URL.
 *
 * Derived from what the API returned rather than assembled from the service NAME — Render appends a
 * suffix when a name is taken, so `name + '.onrender.com'` is a guess that is wrong exactly when it
 * matters. Returns '' when there is no usable URL, and '' is a refusal: see planRenderDnsRecords.
 */
export function renderServiceHost(serviceUrl: string | null | undefined): string {
  const raw = String(serviceUrl ?? '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return u.hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Is this the zone apex (`mitrify.com`) rather than a subdomain (`www.mitrify.com`)? Pure. */
export function isApexDomain(domain: string): boolean {
  const parts = String(domain ?? '').trim().toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  return parts.length === 2;
}

export interface PlannedDnsRecord {
  type: 'CNAME';
  /** The record name as our DNS layer expects it — the full host, apex included. */
  name: string;
  value: string;
}

/**
 * The DNS records that make `domain` resolve to a Render service.
 *
 * 🔒 CNAME AT THE APEX, DELIBERATELY — AND NOT AN A RECORD TO A HARDCODED IP.
 *
 * Render's documented apex recipe is an A record pointing at their anycast address. Writing that would
 * bake a third-party IP into our source: the moment Render changes it, every domain we ever wrote goes
 * dark at once, with nothing failing on our side to reveal it. That is precisely the stale-hardcoded-
 * value class this codebase has been burned by before (retired model ids in five files).
 *
 * We only reach here for domains whose DNS WE manage, in Cloudflare, and Cloudflare flattens a CNAME
 * at the zone apex automatically — resolving it to whatever address Render currently answers with, on
 * every lookup. So the same CNAME serves apex and subdomain alike, there is no address to go stale,
 * and Render can renumber freely without touching us.
 *
 * 🔒 NO HOST ⇒ NO RECORDS. An empty list means "we could not establish where to point", and the caller
 * must treat it as a refusal. Writing a record to a guessed host would take a domain that shows an
 * honest error page and point it at something that does not exist.
 */
export function planRenderDnsRecords(domain: string, serviceUrl: string | null | undefined): PlannedDnsRecord[] {
  const host = renderServiceHost(serviceUrl);
  const name = String(domain ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!host || !name) return [];
  return [{ type: 'CNAME', name, value: host }];
}

/** One custom domain as Render reports it, narrowed to what we use. */
export interface RenderCustomDomain {
  id: string;
  name: string;
  verificationStatus: string;
}

/** Normalise a raw custom-domain item (`{ customDomain: {...} }` or the object itself). Pure. */
export function parseRenderCustomDomain(raw: any): RenderCustomDomain | null {
  const d = raw && typeof raw === 'object' ? (raw.customDomain ?? raw) : null;
  if (!d || typeof d.name !== 'string' || !d.name.trim()) return null;
  return {
    id: typeof d.id === 'string' ? d.id : '',
    name: d.name.trim().toLowerCase(),
    verificationStatus: typeof d.verificationStatus === 'string' ? d.verificationStatus : '',
  };
}

/** Is `domain` already on this service? Case-insensitive; a trailing dot never makes a new domain. */
export function alreadyAttached(domains: readonly RenderCustomDomain[], domain: string): boolean {
  const want = String(domain ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!want) return false;
  return domains.some((d) => d.name.replace(/\.$/, '') === want);
}

export type AttachRenderDomainResult =
  | { ok: true; alreadyThere: boolean; records: PlannedDnsRecord[] }
  | { ok: false; reason: 'not-configured' | 'no-service' | 'no-host' | 'api-error'; message: string };

/**
 * Attach `domain` to the Render service that runs this app, and return the DNS records that make it
 * resolve. IDEMPOTENT: a domain already on the service is a success (`alreadyThere`), never an error —
 * pressing Connect twice must not turn a working setup into a failure.
 *
 * Never throws. Every branch returns a reason the caller can show a user verbatim.
 */
export async function attachRenderCustomDomain(
  opts: { apiKey: string; serviceId: string; serviceUrl?: string | null; domain: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AttachRenderDomainResult> {
  const apiKey = String(opts.apiKey ?? '').trim();
  if (!apiKey) {
    return { ok: false, reason: 'not-configured', message: 'No backend-hosting key is configured, so the domain cannot be pointed at your app yet.' };
  }
  if (!String(opts.serviceId ?? '').trim()) {
    return { ok: false, reason: 'no-service', message: 'This app has not been deployed to a backend host yet, so there is nothing for the domain to point at. Deploy the backend first.' };
  }
  // Established BEFORE the write: a domain attached to a service we cannot address would leave the
  // user with a Render-side domain and no DNS, which looks connected and serves nothing.
  const records = planRenderDnsRecords(opts.domain, opts.serviceUrl);
  if (records.length === 0) {
    return { ok: false, reason: 'no-host', message: 'We could not read your backend\'s address from the host, so we did not change any DNS. Try again in a moment.' };
  }
  try {
    const list = buildListCustomDomainsRequest(apiKey, opts.serviceId);
    const listRes = await fetchImpl(list.url, { method: list.method, headers: list.headers });
    if (listRes.ok) {
      const json = await listRes.json().catch(() => null);
      const existing = (Array.isArray(json) ? json : [])
        .map(parseRenderCustomDomain)
        .filter((d): d is RenderCustomDomain => d !== null);
      if (alreadyAttached(existing, opts.domain)) {
        return { ok: true, alreadyThere: true, records };
      }
    }
    const add = buildAddCustomDomainRequest(apiKey, opts.serviceId, opts.domain);
    const res = await fetchImpl(add.url, { method: add.method, headers: add.headers, body: add.body });
    // 409 = the host already has it (a race with the listing above, or another service). Treated as
    // attached rather than failed: the records below are what the user actually needs either way.
    if (res.ok || res.status === 409) {
      return { ok: true, alreadyThere: res.status === 409, records };
    }
    return {
      ok: false,
      reason: 'api-error',
      message: `Your backend host refused the domain (HTTP ${res.status}). Nothing was changed.`,
    };
  } catch (e) {
    return {
      ok: false,
      reason: 'api-error',
      message: `Could not reach your backend host: ${e instanceof Error ? e.message : String(e)}. Nothing was changed.`,
    };
  }
}
