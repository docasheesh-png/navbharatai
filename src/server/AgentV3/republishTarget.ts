/**
 * A second "Publish on NavBharatAI" must update the page we already handed out.
 *
 * 🔴 THE BUG (2026-11-17). The first publish of a game stored one public URL (the Firebase channel's
 * branded host, or `a-<hash>.<domain>`). The next publish — after an edit — could take the OTHER
 * path: bucket-only publishing returns early with a brand-new `a-` host and never writes the previous
 * one, and a failed mirror used to delete that previous copy and fall through to a freshly created
 * channel. The button then celebrated a new address while the link people already had kept serving
 * the first version.
 *
 * The address is the product. Same workspace, same live URL, new bytes behind it. A first publish
 * (nothing live yet) is unchanged — that is `{ kind: 'none' }`.
 */
import { bucketOnlySubdomain, isBucketOnlySubdomain, isSnapshotSubdomain } from './bucketOnlyPublish';

export type RepublishPlan =
  | { kind: 'none' }
  | { kind: 'bucket'; url: string; sub: string }
  /** `viaEdge` — the URL is on the branded domain, so the Worker serves whatever the bucket holds
   *  for `sub`. A raw `*.web.app` URL is NOT behind that Worker; only a Firebase release updates it. */
  | { kind: 'channel'; url: string; sub: string; viaEdge: boolean };

function hostnameOf(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Where a republish of this workspace must land. Pure.
 *
 * Pins only a host this workspace actually owns. A snapshot (`s-`), another app's bucket name, or a
 * URL we cannot parse is `{ kind: 'none' }` — inventing a pin would publish over the wrong site.
 */
export function planRepublish(opts: {
  workspaceId: string;
  priorUrl: string | null | undefined;
  /** Branded published-app domain, no leading dot. Empty when unset. */
  domain: string;
  /** Firebase project id, the left half of `<site>--<sub>.web.app`. */
  site: string;
}): RepublishPlan {
  const url = String(opts.priorUrl ?? '').trim();
  const host = hostnameOf(url);
  if (!host) return { kind: 'none' };

  const domain = String(opts.domain ?? '').trim().replace(/^\.+|\.+$/g, '').toLowerCase();
  const site = String(opts.site ?? '').trim().toLowerCase();
  const ownBucket = bucketOnlySubdomain(opts.workspaceId);

  const ownBucketPlan = (sub: string): RepublishPlan | null =>
    (sub === ownBucket && isBucketOnlySubdomain(sub) ? { kind: 'bucket', url, sub } : null);

  if (domain && (host === `${ownBucket}.${domain}`)) {
    return { kind: 'bucket', url, sub: ownBucket };
  }

  if (domain && host.endsWith(`.${domain}`)) {
    const sub = host.slice(0, -(domain.length + 1));
    if (!sub || sub.includes('.') || !/^[a-z0-9-]+$/.test(sub)) return { kind: 'none' };
    const bucket = ownBucketPlan(sub);
    if (bucket) return bucket;
    if (isSnapshotSubdomain(sub) || isBucketOnlySubdomain(sub)) return { kind: 'none' };
    return { kind: 'channel', url, sub, viaEdge: true };
  }

  const prefix = site ? `${site}--` : '';
  if (prefix && host.endsWith('.web.app') && host.startsWith(prefix)) {
    const sub = host.slice(prefix.length, -'.web.app'.length);
    if (!/^[a-z0-9-]+$/.test(sub)) return { kind: 'none' };
    const bucket = ownBucketPlan(sub);
    if (bucket) return bucket;
    if (isSnapshotSubdomain(sub)) return { kind: 'none' };
    return { kind: 'channel', url, sub, viaEdge: false };
  }

  return { kind: 'none' };
}
