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
