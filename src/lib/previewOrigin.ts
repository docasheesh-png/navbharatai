// SECURITY Phase 4 (admin-approved 2026-07-07: "separate preview origin") — cross-origin isolation
// for the in-browser preview.
//
// THE VULN: the in-browser preview renders UNTRUSTED generated/imported app HTML in an
// `<iframe srcDoc>` with `allow-same-origin` — and because srcDoc inherits the PLATFORM's origin,
// that combination lets the previewed app read navbharatai.com's own localStorage (the Firebase auth
// token) and touch the parent DOM. `allow-same-origin` can't simply be dropped: the preview loads
// React via a dynamic ES-module `import()`, which an opaque origin blocks ("Missing dependency react").
//
// THE FIX: serve the preview from a SEPARATE origin (a subdomain the admin points at the app). Then
// `allow-same-origin` is safe — "same origin" is the PREVIEW origin, whose localStorage is empty, not
// the platform's — while the real https origin keeps `import()` working. The platform hands the built
// HTML to a tiny host page (`/preview-sandbox.html`) on that origin via postMessage; the host writes
// it into its own document, so the app runs entirely in the isolated origin.
//
// ENV-GATED + OFF BY DEFAULT: with `VITE_PREVIEW_ORIGIN` unset (today), the preview keeps its exact
// current same-origin srcDoc behaviour (zero change) — safe because the allowlist keeps the app to
// trusted admins. The admin enables real isolation by pointing a subdomain at the app and setting the
// env var. This module is the single source of truth for whether/where cross-origin preview is on.

/** Normalize a configured preview origin to a bare `scheme://host[:port]` (no trailing slash/path). */
export function normalizePreviewOrigin(raw: string | undefined | null): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Build the cross-origin sandbox-host URL the in-browser preview iframe loads, or null when
 * cross-origin preview is not configured (→ caller keeps the same-origin srcDoc path). The host page
 * is told the platform's origin via `?parent=` so it accepts the built-HTML message ONLY from us.
 * Pure + unit-tested. Returns null if the preview origin equals the parent origin (that would defeat
 * the whole isolation — never fall back to same-origin silently).
 */
export function buildPreviewSandboxUrl(previewOriginRaw: string | undefined | null, parentOrigin: string): string | null {
  const origin = normalizePreviewOrigin(previewOriginRaw);
  if (!origin) return null;
  if (!parentOrigin || origin === parentOrigin) return null; // not actually cross-origin → no isolation
  return `${origin}/preview-sandbox.html?parent=${encodeURIComponent(parentOrigin)}`;
}

/** The configured preview origin from the build env (Vite), or null. Thin wrapper over the pure helpers. */
export function configuredPreviewSandboxUrl(parentOrigin: string): string | null {
  let envOrigin: string | undefined;
  try {
    envOrigin = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_PREVIEW_ORIGIN;
  } catch {
    envOrigin = undefined;
  }
  return buildPreviewSandboxUrl(envOrigin, parentOrigin);
}

/** The message envelope the platform postMessages to the sandbox host with the built preview HTML. */
export const PREVIEW_HTML_MESSAGE = '__nbaiPreviewHtml' as const;
