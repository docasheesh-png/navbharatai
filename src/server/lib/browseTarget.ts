// WHERE THE SANDBOX BROWSER IS ALLOWED TO GO.
//
// WHY (admin 2026-08-04): "hamara navbharatai pro koi real world website open kare, aur preview me
// dikhe? live browser ke jaisa?" — yes, and the machinery already existed: the E2B sandbox runs a real
// Chromium via Playwright, and `browser_action` / `screenshot` pass their URL straight through. What was
// missing was (a) v5 knowing it may visit the real web at all, and (b) any opinion about WHERE it may go.
//
// (b) is this file. Handing an LLM a real browser with an unrestricted address bar is an SSRF primitive:
// a prompt-injected page, or a confused model, can navigate to a cloud metadata endpoint
// (169.254.169.254, metadata.google.internal) and read instance credentials, or probe private LAN
// services. The sandbox is E2B's infrastructure rather than ours, which bounds the blast radius — but
// "someone else's credentials" is not an acceptable answer, and the guard costs almost nothing.
//
// THE ONE THING THIS MUST NOT DO IS BREAK WHAT ALREADY WORKS. The existing, valuable use of these tools
// is screenshotting the user's OWN dev server at http://localhost:5173 — a loopback address. So this is
// deliberately NOT a blanket private-address block: loopback stays allowed and is classified separately,
// only the genuinely dangerous ranges are refused, and everything else is the new public-web capability.
//
// Pure and total: same input, same answer, no I/O, never throws.

export type BrowseTargetKind =
  /** The sandbox's own dev server / preview — the long-standing use, unchanged. */
  | 'sandbox'
  /** A real site on the public internet — the new capability. */
  | 'public'
  /** Refused: an address that exists to be reached from inside infrastructure, not browsed. */
  | 'blocked';

export interface BrowseTarget {
  kind: BrowseTargetKind;
  /** The normalized absolute URL, when it parsed at all. */
  url?: string;
  /** For 'blocked', a reason written for the MODEL to read and act on. */
  reason?: string;
}

/** Hosts that are the sandbox talking to itself. Allowed — this is the preview/dev-server path. */
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0)$/i;

/**
 * Cloud metadata services. These hand out instance credentials to anything that asks from inside the
 * machine, so they are the single highest-value SSRF target and are refused by name as well as by range.
 */
const METADATA_HOST = /^(metadata\.google\.internal|metadata|instance-data)$/i;

/** A dotted IPv4 literal, or null when the host is a name. */
function ipv4Parts(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

/**
 * True for an IPv4 address that only exists inside infrastructure: link-local (which includes every
 * cloud's 169.254.169.254 metadata endpoint), private LAN, carrier-grade NAT, and the reserved blocks.
 * Loopback is deliberately NOT here — it is classified as 'sandbox' by the caller first.
 */
export function isInfrastructureIpv4(parts: readonly number[]): boolean {
  const [a, b] = parts;
  if (a === 169 && b === 254) return true;              // link-local + ALL cloud metadata
  if (a === 10) return true;                            // private
  if (a === 172 && b >= 16 && b <= 31) return true;     // private
  if (a === 192 && b === 168) return true;              // private
  if (a === 100 && b >= 64 && b <= 127) return true;    // carrier-grade NAT
  if (a === 0 || a >= 224) return true;                 // reserved / multicast / broadcast
  return false;
}

/** IPv6 forms that are loopback, link-local or unique-local. */
function isInfrastructureIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h.includes(':')) return false;
  return /^fe[89ab]/.test(h)      // link-local
    || /^f[cd]/.test(h)           // unique-local
    || h === '::' || h === '::1'; // unspecified / loopback (loopback handled earlier)
}

/**
 * Decide where a browse request is pointed.
 *
 * Anything that is not plainly http(s) is refused rather than guessed at: `file://` would read the
 * sandbox filesystem and `data:` / `javascript:` are script-execution vectors, and none of them are what
 * "open a website" means.
 */
export function classifyBrowseTarget(raw: unknown): BrowseTarget {
  const input = typeof raw === 'string' ? raw.trim() : '';
  if (!input) return { kind: 'blocked', reason: 'No address was given.' };

  // A bare "zomato.com" is what a person types; treat it as https rather than refusing on a technicality.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;

  let parsed: URL;
  try { parsed = new URL(candidate); } catch { return { kind: 'blocked', reason: `"${input}" is not a valid web address.` }; }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { kind: 'blocked', reason: `Only http:// and https:// addresses can be opened — "${parsed.protocol}" cannot.` };
  }

  const host = parsed.hostname;
  if (LOOPBACK.test(host)) return { kind: 'sandbox', url: parsed.toString() };

  if (METADATA_HOST.test(host)) {
    return { kind: 'blocked', reason: 'That address is an internal infrastructure service, not a website. Open a real public site instead.' };
  }

  const v4 = ipv4Parts(host);
  if (v4 && isInfrastructureIpv4(v4)) {
    return { kind: 'blocked', reason: 'That address is on a private or internal network, not the public web. Open a real public site instead.' };
  }
  if (isInfrastructureIpv6(host)) {
    return { kind: 'blocked', reason: 'That address is on a private or internal network, not the public web. Open a real public site instead.' };
  }

  // A hostname with no dot cannot be a public site (`http://router`, `http://redis`) — it can only
  // resolve to something on the local network.
  if (!v4 && !host.includes('.') && !host.includes(':')) {
    return { kind: 'blocked', reason: `"${host}" is not a public website address. Use a full domain, e.g. https://example.com.` };
  }

  return { kind: 'public', url: parsed.toString() };
}

/** True when the sandbox browser may open this address at all (its own preview, or the public web). */
export function isBrowsableUrl(raw: unknown): boolean {
  return classifyBrowseTarget(raw).kind !== 'blocked';
}
