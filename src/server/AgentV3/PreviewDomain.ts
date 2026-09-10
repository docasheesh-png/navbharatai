// AgentV3 — preview-domain mapping for v5.0-built apps (§12, admin 2026-06-24).
//
// v5.0-built apps are previewed under the platform's own E2B custom domain
// (mitrify.xyz) instead of the raw `*.e2b.app` host. E2B's custom domain is an
// ADDITIVE alias: the sandbox keeps running on the same infrastructure and the
// SDK's API endpoint is unchanged — we deliberately do NOT reconfigure the SDK
// connection `domain`, because that would also redirect `api.${domain}` and break
// sandbox creation. Only the user-facing host suffix is swapped.
//
// The swap is PURE and idempotent: a URL already on the custom domain, or any
// non-e2b host (localhost / *.example.dev in dev/CI), is returned unchanged.

// Default is the raw E2B host (`e2b.app`) — ALWAYS resolvable, so previews work out of
// the box. To serve previews under a custom domain (e.g. mitrify.xyz), set
// `E2B_PREVIEW_DOMAIN=mitrify.xyz` AND configure that domain as an E2B custom domain with
// a wildcard `*.mitrify.xyz` DNS record — otherwise the preview URL won't resolve.
const DEFAULT_PREVIEW_DOMAIN = 'e2b.app';

// Warn once at startup so the operator knows preview URLs are raw E2B subdomains and
// may not be user-friendly or stable across sandbox restarts.
if (process.env.NODE_ENV === 'production' && !process.env.E2B_PREVIEW_DOMAIN) {
  console.warn(
    '[AgentV3] E2B_PREVIEW_DOMAIN is not set — preview URLs will use raw *.e2b.app ' +
      'subdomains. Set E2B_PREVIEW_DOMAIN=<your-wildcard-domain> (e.g. mitrify.xyz) ' +
      'and configure E2B custom domain to serve stable, branded preview links.',
  );
}

/**
 * The configured preview domain for v5.0 apps. Override with `E2B_PREVIEW_DOMAIN`;
 * set it to `e2b.app` to disable the swap entirely (fall back to the raw host).
 */
export function previewDomain(): string {
  const v = (process.env.E2B_PREVIEW_DOMAIN || '').trim();
  return v || DEFAULT_PREVIEW_DOMAIN;
}

/**
 * Map a raw sandbox preview URL onto the configured preview domain: swap a
 * `*.e2b.app` host suffix to `*.<previewDomain>`, preserving the
 * `{port}-{sandboxId}` subdomain prefix that E2B custom domains keep. Every other
 * host (localhost, an already-custom host) is returned untouched. Pure.
 */
export function applyPreviewDomain(url: string, domain = previewDomain()): string {
  if (!url || domain === 'e2b.app') return url;
  return url.replace(/(:\/\/[^/]*?)\.e2b\.app(?=[:/]|$)/i, `$1.${domain}`);
}

/**
 * The URL **WE** should fetch when verifying a preview — always the direct sandbox host, never the
 * branded one.
 *
 * WHY THIS EXISTS (found auditing the branded-preview change before it was switched on, 2026-08-19).
 * `applyPreviewDomain` is applied at every point a preview URL is produced, and the same URL is then
 * handed to `browseUrl()` for the platform's own checks — the preview verify, the journey check, the
 * runtime-error capture, the design gate. Once the branded domain is live, every one of those checks
 * would travel from inside the sandbox, out to Cloudflare, through the Worker, and back to the very
 * sandbox it started in. Three costs, one of them serious:
 *
 *   1. 🔴 A Worker that is misconfigured, mid-deploy, or waiting on DNS would fail every VERIFICATION
 *      — so working builds would be reported as unverified. A cosmetic feature would be able to
 *      break the build pipeline, which is not a trade anyone would accept if asked plainly.
 *   2. Every check would spend Worker requests against the free tier for no user benefit.
 *   3. Every check would take an internet round trip instead of a local one.
 *
 * So the two needs are separated, because they were never the same need: the user gets the branded
 * URL, and we verify against the sandbox directly. The blast radius of a proxy problem shrinks from
 * "builds start failing" to "the link does not open in the browser", which is where it belongs.
 *
 * Idempotent: a URL that is already a direct host (or not a preview at all) is returned unchanged.
 * Pure.
 */
export function internalPreviewUrl(url: string, domain = previewDomain()): string {
  if (!url || domain === 'e2b.app') return url;
  // Only rewrite the `{port}-{sandboxId}` shape E2B actually serves — never a bare or nested host,
  // so an unrelated URL passing through here cannot be redirected somewhere it never pointed.
  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return url.replace(
    new RegExp(`(://\\d{1,5}-[a-z0-9]{6,64})\\.${escaped}(?=[:/]|$)`, 'i'),
    '$1.e2b.app',
  );
}

/**
 * A regex matching a preview URL for THIS deployment's sandbox host(s) — the raw `e2b.app` shape
 * always, plus whatever custom domain `applyPreviewDomain` currently swaps onto (so a build shown
 * under the branded host is caught too). Built fresh on every call, never a shared module-level
 * instance: a `g`-flagged RegExp carries `lastIndex` state between uses, and a stale value there
 * would silently skip matches on some calls and not others — a bug that would only show up
 * intermittently, exactly the kind redaction code cannot afford (see SecretRedactor.ts).
 *
 * Scoped to the exact `{port}-{sandboxId}.<host>` shape E2B actually serves (mirroring
 * `internalPreviewUrl`'s own pattern) rather than a bare host match, so an unrelated URL that merely
 * happens to end in the same domain can never be swept up by mistake.
 */
export function previewUrlPattern(domain = previewDomain()): RegExp {
  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hosts = domain === 'e2b.app' ? 'e2b\\.app' : `(?:e2b\\.app|${escaped})`;
  return new RegExp(`https?:\\/\\/\\d{1,5}-[a-z0-9]{6,64}\\.${hosts}(?::\\d{1,5})?(?:\\/[^\\s)\\]}"'<>]*)?`, 'gi');
}
