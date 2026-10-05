/**
 * WHICH ENTRY OF X-Forwarded-For IS THE REAL CLIENT? (queue Q-154)
 *
 * `server.ts` used to set `trust proxy` to `true`, so `req.ip` was the LEFT-most X-Forwarded-For entry — a
 * value the caller can write themselves — and every anonymous rate-limit bucket was keyed on it. The right
 * setting is a hop COUNT (how many proxies in front of us append to the header). #3538 (the forensic audit,
 * 2026-10-04) set it to `TRUSTED_PROXY_HOPS` = 1 — Google's front end and nothing else — by reasoning from
 * the hosting path. A wrong count is worse than `true` (it keys every anonymous user to one shared proxy
 * address), so the count is also MEASURED: an admin opens one URL through the real hosting path, and this
 * shows where their own address sits in the chain, what `req.ip` would be under each count, and which count
 * is live. If their own address is at `hops: 1`, the setting is right; if not, `TRUSTED_PROXY_HOPS` is the
 * one place to change. Only the admin's own request is shown; nothing is logged. PURE.
 *
 * 🔒 This module READS the header and DECIDES nothing. `clientAddress.ts` is the one place that decides the
 * caller's address (`tests/aCallerCannotChooseItsOwnAddress.test.ts` keeps every other hand read out, and
 * lists this file as the measurement of that decision, not a second one).
 */
import { TRUSTED_PROXY_HOPS } from './clientAddress';

export interface HopReport {
  /** The X-Forwarded-For entries, left to right, as received. */
  forwardedFor: string[];
  /** The socket peer — the proxy that connected to this server. */
  remoteAddress: string;
  /** What `req.ip` would be for each hop count 1..N (Express: the entry `count` from the right of [...xff, peer]). */
  ipByHopCount: Array<{ hops: number; ip: string }>;
  /** The hop count the server is running with today (`TRUSTED_PROXY_HOPS`). */
  trustedHops: number;
  /** Read this: find your own public address in `ipByHopCount`; that `hops` is the value to set. */
  howToRead: string;
  /**
   * The answer itself, for the admin card (2026-10-05: an admin cannot open this route from the address bar —
   * it needs the admin token header — and should not have to look up their own IP either). In the ADMIN'S
   * OWN request nothing is forged, so the LEFT-most forwarded entry is their own address, and its position
   * from the right is the hop count the server should trust. `null` when the request carried no forwarded
   * chain at all (it did not come through the hosting path).
   */
  yourAddress: string | null;
  measuredHops: number | null;
  verdict: 'correct' | 'mismatch' | 'no-proxy';
}

export function hopReport(xff: string | string[] | undefined, remoteAddress: string | undefined): HopReport {
  const raw = Array.isArray(xff) ? xff.join(',') : String(xff ?? '');
  const forwardedFor = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  const chain = [...forwardedFor, String(remoteAddress ?? '')].filter(Boolean);
  const ipByHopCount: Array<{ hops: number; ip: string }> = [];
  for (let hops = 1; hops < chain.length; hops++) ipByHopCount.push({ hops, ip: chain[chain.length - 1 - hops] });
  const measuredHops = forwardedFor.length > 0 ? chain.length - 1 : null;
  return {
    forwardedFor,
    remoteAddress: String(remoteAddress ?? ''),
    yourAddress: forwardedFor[0] ?? null,
    measuredHops,
    verdict: measuredHops === null ? 'no-proxy' : measuredHops === TRUSTED_PROXY_HOPS ? 'correct' : 'mismatch',
    ipByHopCount,
    trustedHops: TRUSTED_PROXY_HOPS,
    howToRead: `Find YOUR OWN public IP address (search "what is my ip") in ipByHopCount. The server runs with trust proxy = ${TRUSTED_PROXY_HOPS} today; if your address is at hops ${TRUSTED_PROXY_HOPS} the setting is right, otherwise its hops is the number to set (TRUSTED_PROXY_HOPS in clientAddress.ts). If it appears nowhere, the request did not pass through the normal hosting path.`,
  };
}

/** The report for a live request — the ONE read of the raw header outside `clientAddress.ts`, and it decides nothing. */
export function hopReportFor(req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }): HopReport {
  return hopReport(req.headers['x-forwarded-for'], req.socket?.remoteAddress);
}
