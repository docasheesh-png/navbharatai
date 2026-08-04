// SSRF guard for the API Tester proxy (admin autopsy 2026-07-21). The proxy fetches a user-supplied
// URL server-side to bypass browser CORS — which, unguarded, is a classic SSRF hole: a user could
// point it at http://169.254.169.254/ (cloud metadata), http://localhost:.../admin, or a private
// 10.x/192.168.x host the server can reach but the internet can't. This module classifies hosts/IPs
// and refuses anything that isn't a public, internet-routable HTTP(S) target. The IP math is pure and
// unit-tested; `assertPublicHttpUrl` adds the async DNS resolution around it.

import { promises as dns } from 'node:dns';
import net from 'node:net';

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
