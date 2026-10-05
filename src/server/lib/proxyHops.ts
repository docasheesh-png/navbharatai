/**
 * WHICH ENTRY OF X-Forwarded-For IS THE REAL CLIENT? (queue Q-154)
 *
 * `server.ts` sets `trust proxy` to `true`, so `req.ip` is the LEFT-most X-Forwarded-For entry — a value the
 * caller can write themselves — and every anonymous rate-limit bucket is keyed on it. The right setting is a
 * hop COUNT (how many proxies in front of us append to the header), and a wrong count is worse than today: it
 * would key every anonymous user to one shared proxy address. So the count is MEASURED, not guessed: an admin
 * opens one URL through the real hosting path, and this shows where their own address sits in the chain and
 * what `req.ip` would be under each count. Only the admin's own request is shown; nothing is logged. PURE.
 */

export interface HopReport {
  /** The X-Forwarded-For entries, left to right, as received. */
  forwardedFor: string[];
  /** The socket peer — the proxy that connected to this server. */
  remoteAddress: string;
  /** What `req.ip` would be for each hop count 1..N (Express: the entry `count` from the right of [...xff, peer]). */
  ipByHopCount: Array<{ hops: number; ip: string }>;
  /** Read this: find your own public address in `ipByHopCount`; that `hops` is the value to set. */
  howToRead: string;
}

export function hopReport(xff: string | string[] | undefined, remoteAddress: string | undefined): HopReport {
  const raw = Array.isArray(xff) ? xff.join(',') : String(xff ?? '');
  const forwardedFor = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  const chain = [...forwardedFor, String(remoteAddress ?? '')].filter(Boolean);
  const ipByHopCount: Array<{ hops: number; ip: string }> = [];
  for (let hops = 1; hops < chain.length; hops++) ipByHopCount.push({ hops, ip: chain[chain.length - 1 - hops] });
  return {
    forwardedFor,
    remoteAddress: String(remoteAddress ?? ''),
    ipByHopCount,
    howToRead: 'Find YOUR OWN public IP address (search "what is my ip") in ipByHopCount. Its `hops` is the number to set as trust proxy. If it appears nowhere, the request did not pass through the normal hosting path.',
  };
}
