// SSRF guard for the API Tester proxy (admin autopsy 2026-07-21). The proxy fetches a user-supplied
// URL server-side to bypass browser CORS — which, unguarded, is a classic SSRF hole: a user could
// point it at http://169.254.169.254/ (cloud metadata), http://localhost:.../admin, or a private
// 10.x/192.168.x host the server can reach but the internet can't. This module classifies hosts/IPs
// and refuses anything that isn't a public, internet-routable HTTP(S) target. The IP math is pure and
// unit-tested; `assertPublicHttpUrl` adds the async DNS resolution around it.

import dnsCallback, { promises as dns } from 'node:dns';
import net from 'node:net';
import { Agent, buildConnector } from 'undici';

/** Parse a dotted-quad IPv4 into its four octets, or null if not a valid IPv4 literal. Pure. */
function parseIpv4(ip: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as [number, number, number, number];
  if (parts.some((n) => n < 0 || n > 255)) return null;
  return parts;
}

/**
 * True when an IPv4 address is private, loopback, link-local, CGNAT, multicast, or otherwise not a
 * public internet target. Blocks the cloud metadata endpoint (169.254.169.254 ∈ 169.254/16). Pure.
 */
export function isBlockedIpv4(ip: string): boolean {
  const p = parseIpv4(ip);
  if (!p) return true; // not a clean IPv4 → treat as blocked (caller handles hostnames separately)
  const [a, b] = p;
  if (a === 0) return true;                        // 0.0.0.0/8 "this network"
  if (a === 10) return true;                       // 10.0.0.0/8 private
  if (a === 127) return true;                      // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true;         // 169.254.0.0/16 link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true;// 172.16.0.0/12 private
  if (a === 192 && b === 168) return true;         // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true;// 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0) return true;           // 192.0.0.0/24 IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true;                       // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.*
  return false;
}

/** True when an IPv6 address is loopback/unspecified/ULA/link-local, or maps to a blocked IPv4. Pure. */
export function isBlockedIpv6(ip: string): boolean {
  const s = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (s === '::1' || s === '::') return true;             // loopback / unspecified
  // IPv4-mapped/embedded (::ffff:a.b.c.d or ::a.b.c.d) → classify the embedded IPv4.
  const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (v4 && (s.startsWith('::ffff:') || s.startsWith('::'))) return isBlockedIpv4(v4[1]);
  const head = s.split(':')[0] ?? '';
  if (head.startsWith('fc') || head.startsWith('fd')) return true; // fc00::/7 unique-local
  if (head.startsWith('fe8') || head.startsWith('fe9') || head.startsWith('fea') || head.startsWith('feb')) return true; // fe80::/10 link-local
  return false;
}

/** Classify any IP literal (v4 or v6). Pure. */
export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedIpv4(ip);
  if (net.isIPv6(ip)) return isBlockedIpv6(ip);
  return true; // not a recognisable IP literal
}

/** Obvious never-allow hostnames (defence-in-depth on top of the resolved-IP check). Pure. */
export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (h === 'metadata.google.internal') return true;
  return false;
}

export interface UrlCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Validate that a user-supplied URL is a public HTTP(S) target safe to fetch server-side. Rejects
 * non-http(s) schemes, blocked hostnames, and any host whose DNS resolves (even partly) to a
 * private/loopback/link-local IP. Resolving + checking every A/AAAA record closes DNS-rebinding to a
 * private address. Never throws — returns { ok, reason }.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<UrlCheck> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'Invalid URL.' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: 'Only http and https URLs are allowed.' };
  }
  const host = u.hostname;
  if (isBlockedHostname(host)) {
    return { ok: false, reason: 'This host is not allowed.' };
  }
  // IP literal → classify directly.
  if (net.isIP(host)) {
    return isBlockedIp(host) ? { ok: false, reason: 'Private/reserved addresses are not allowed.' } : { ok: true };
  }
  // Hostname → resolve and require EVERY address to be public.
  let addrs: string[] = [];
  try {
    const results = await dns.lookup(host, { all: true });
    addrs = results.map((r) => r.address);
  } catch {
    return { ok: false, reason: 'Could not resolve the host.' };
  }
  if (addrs.length === 0) return { ok: false, reason: 'Could not resolve the host.' };
  for (const ip of addrs) {
    if (isBlockedIp(ip)) return { ok: false, reason: 'Host resolves to a private/reserved address.' };
  }
  return { ok: true };
}


/**
 * A fetch for a URL a USER supplied (forensic audit 2026-10-04): the address is vetted first
 * (`assertPublicHttpUrl`), redirects are refused (a redirect is an unvetted second hop), and a refused
 * URL comes back as an honest 403-shaped response rather than an exception. The bot flow's API nodes
 * used to call the global fetch directly — a bot owner could point one at the cloud metadata server.
 */
export async function guardedPublicFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> {
  const check = await assertPublicHttpUrl(url);
  if (!check.ok) return { ok: false, status: 403, text: async () => check.reason ?? 'blocked' };
  const r = await fetch(url, publicOnlyInit({ ...init, redirect: 'error' }));
  return { ok: r.ok, status: r.status, text: () => r.text() };
}

/** The error a refused connection carries, so a caller can tell "blocked" from "unreachable". */
export const SSRF_BLOCKED_CODE = 'ESSRFBLOCKED';

function blocked(host: string): Error {
  return Object.assign(new Error(`${host} resolves to a private/reserved address`), { code: SSRF_BLOCKED_CODE });
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address?: string | Array<{ address: string; family: number }>, family?: number) => void;
type LookupFn = (hostname: string, options: Record<string, unknown>, callback: LookupCallback) => void;

/**
 * A DNS lookup for the CONNECTION itself that refuses a private, loopback, link-local or metadata
 * address. PURE over the injected resolver (tests rebind a name between two lookups).
 *
 * 🔴 WHY THE CHECK HAS TO LIVE HERE (forensic audit 2026-10-04, Q-617). `assertPublicHttpUrl` resolves a
 * name and vets the answer — and then `fetch` resolves the name AGAIN to connect. A DNS server that
 * answers "public" the first time and "169.254.169.254" the second (DNS rebinding, a 0-second TTL) walks
 * straight past the check. Vetting the address the socket is about to use closes that window: there is
 * no second answer, because this IS the answer the connection uses.
 */
export function publicOnlyLookup(resolve: LookupFn = dnsCallback.lookup as unknown as LookupFn): LookupFn {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = Array.isArray(addresses) ? addresses : [];
      if (list.length === 0) return callback(Object.assign(new Error(`could not resolve ${hostname}`), { code: 'ENOTFOUND' }));
      if (list.some((a) => isBlockedIp(a.address))) return callback(blocked(hostname));
      if (options && (options as { all?: boolean }).all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  };
}

/**
 * The dispatcher every fetch of a USER-SUPPLIED address goes through. Each connection — the first hop
 * and every redirect hop — is vetted at connect time: a name through `publicOnlyLookup`, an IP literal
 * (which Node connects to without any lookup) directly.
 */
function publicOnlyConnector() {
  const connect = buildConnector({ lookup: publicOnlyLookup() } as Parameters<typeof buildConnector>[0]);
  return (opts: Parameters<typeof connect>[0], callback: Parameters<typeof connect>[1]) => {
    const host = String(opts.hostname || '').replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isBlockedIp(host)) return callback(blocked(host), null);
    return connect(opts, callback);
  };
}

export const publicOnlyDispatcher = new Agent({ connect: publicOnlyConnector() });

/**
 * `init` for a fetch of a user-supplied address: the same options, sent through `publicOnlyDispatcher`.
 * The one place that knows the global fetch accepts a `dispatcher` its DOM types do not declare.
 */
export function publicOnlyInit(init: RequestInit): RequestInit {
  return { ...init, dispatcher: publicOnlyDispatcher } as RequestInit;
}
