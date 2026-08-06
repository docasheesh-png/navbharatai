/**
 * Domain Connect — the one-click DNS setup protocol (Slice B; admin 2026-08-06: "sab banao").
 *
 * How the real protocol works (domainconnect.org): a registrar that supports it publishes a TXT
 * record `_domainconnect.<domain>` naming its settings API. From there we learn the registrar's
 * sync-flow UX URL and send the user to an APPLY link for OUR template — they log in at their
 * registrar, tap Approve once, and the registrar writes the records itself. This is exactly the
 * "automatic setup with GoDaddy" flow the big builders offer.
 *
 * THE HONEST BOUNDARY, stated up front: the apply link only works after OUR TEMPLATE IS REGISTERED
 * with each registrar (an external submission/approval — for GoDaddy, via the shared Domain Connect
 * template registry). Until the admin completes that, the feature stays behind
 * `AGENTV3_DOMAIN_CONNECT=on` and the UI simply does not offer the button — never a button that 404s
 * at GoDaddy. Discovery itself is real today and is also how we honestly say "your registrar
 * supports one-click" vs "use the other methods".
 *
 * Hostinger: does NOT appear in the Domain Connect ecosystem (training knowledge) — Hostinger users
 * take the nameserver-delegation path (Slice A) or the Hostinger API path (Slice C).
 */

import { promises as dns } from 'dns';

export interface DomainConnectSettings {
  providerName?: string;
  urlSyncUX?: string;
}

export interface DomainConnectCheck {
  supported: boolean;
  providerName?: string;
  applyUrl?: string;
  reason?: string; // honest, user-facing reason when unsupported
}

export function domainConnectEnabled(): boolean {
  return /^(on|true|1)$/i.test((process.env.AGENTV3_DOMAIN_CONNECT || '').trim());
}

/** Our template identity — meaningful only once registered with the registrar's template registry. */
export function templateIds(): { providerId: string; serviceId: string } {
  return {
    providerId: (process.env.DOMAIN_CONNECT_PROVIDER_ID || 'navbharatai.com').trim(),
    serviceId: (process.env.DOMAIN_CONNECT_SERVICE_ID || 'hosting').trim(),
  };
}

type TxtResolver = (name: string) => Promise<string[][]>;
type JsonFetch = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
let _resolveTxt: TxtResolver = (n) => dns.resolveTxt(n);
let _fetchImpl: JsonFetch = fetch as unknown as JsonFetch;
/** Test seams — CI has neither live DNS nor registrar endpoints. */
export function _setDomainConnectDepsForTests(deps: { resolveTxt?: TxtResolver | null; fetchImpl?: JsonFetch | null }): void {
  _resolveTxt = deps.resolveTxt ?? ((n) => dns.resolveTxt(n));
  _fetchImpl = deps.fetchImpl ?? (fetch as unknown as JsonFetch);
}

/** Discover the registrar's Domain Connect settings endpoint for `domain` (null = unsupported). */
export async function discoverSettings(domain: string): Promise<DomainConnectSettings | null> {
  let host: string | null = null;
  try {
    const txt = await _resolveTxt(`_domainconnect.${domain}`);
    host = txt.flat().map((s) => s.trim()).find((s) => /^[a-z0-9.-]+(\/[a-z0-9./_-]*)?$/i.test(s)) ?? null;
  } catch { return null; } // NXDOMAIN and friends — the registrar simply does not support the protocol
  if (!host) return null;
  try {
    const res = await _fetchImpl(`https://${host.replace(/\/$/, '')}/${domain}/settings`);
    if (!res.ok) return null;
    const s = (await res.json()) as DomainConnectSettings;
    return s && typeof s === 'object' ? s : null;
  } catch { return null; }
}

/**
 * The registrar's APPLY link for our template, carrying the records as template variables. Pure,
 * exported for tests. Variable names (a1/a2/aaaa1/aaaa2/txt1/txt2) are OUR template's contract —
 * the registered template must declare exactly these.
 */
export function buildApplyUrl(
  urlSyncUX: string,
  domain: string,
  records: Array<{ type: string; value: string }>,
): string {
  const { providerId, serviceId } = templateIds();
  const params = new URLSearchParams({ domain });
  let a = 0, aaaa = 0, txt = 0;
  for (const r of records) {
    const t = (r.type || '').toUpperCase();
    if (t === 'A' && a < 2) params.set(`a${++a}`, r.value);
    else if (t === 'AAAA' && aaaa < 2) params.set(`aaaa${++aaaa}`, r.value);
    else if (t === 'TXT' && txt < 2) params.set(`txt${++txt}`, r.value);
  }
  return `${urlSyncUX.replace(/\/$/, '')}/v2/domainTemplates/providers/${encodeURIComponent(providerId)}/services/${encodeURIComponent(serviceId)}/apply?${params.toString()}`;
}

/** Full check: is one-click available for this domain, and where does the button go? */
export async function checkDomainConnect(
  domain: string,
  records: Array<{ type: string; value: string }>,
): Promise<DomainConnectCheck> {
  if (!domainConnectEnabled()) {
    return { supported: false, reason: 'One-click setup is not enabled on this server yet.' };
  }
  const settings = await discoverSettings(domain);
  if (!settings?.urlSyncUX) {
    return { supported: false, reason: 'Your domain provider does not support one-click setup — use automatic (nameservers) or the manual records.' };
  }
  return {
    supported: true,
    providerName: settings.providerName,
    applyUrl: buildApplyUrl(settings.urlSyncUX, domain, records),
  };
}
