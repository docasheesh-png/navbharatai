// Who a preview message is allowed to come from, and where a reply may go.
//
// A sandboxed app (and any other page open in the browser) can postMessage the
// parent. Listeners that repair, edit or answer must ignore every window that
// is not one of OUR preview frames. Outbound replies name an origin when we
// know it, and use '*' only for an opaque frame or for the preview door, whose
// 302 hides the final origin.

/** True only when the event was sent by one of the frames we embedded. */
export function isFromOurPreviewFrame(
  e: Pick<MessageEvent, 'source'>,
  frames: Array<Window | null | undefined>,
): boolean {
  return !!e.source && frames.some((w) => !!w && w === e.source);
}

/**
 * An absolute frame URL whose origin is the page itself. Firebase hosting
 * channels (`*.web.app`) and sandbox hosts are not. A relative path is not
 * absolute, so this returns false — the preview door is classified separately.
 */
export function frameUrlSharesPageOrigin(src: string | null | undefined, pageOrigin: string): boolean {
  if (!src || !pageOrigin) return false;
  try {
    return new URL(src).origin === pageOrigin;
  } catch {
    return false;
  }
}

/**
 * targetOrigin for a postMessage into a preview frame.
 *
 * - In-browser host on the configured preview origin → that origin.
 * - DEV same-origin srcDoc (local only) → the page origin.
 * - Opaque srcDoc → '*'. An opaque origin has no stable origin to name.
 * - Live frame loaded from an absolute URL on another host → that origin.
 * - Live frame whose src is our own origin: the preview door. It serves our
 *   static page and then 302s to the sandbox host, so the final origin is not
 *   visible on the iframe's src. '*' stays, on purpose.
 */
export function previewPostMessageTarget(input: {
  kind: 'inbrowser' | 'live';
  frameSrc?: string | null;
  previewSandboxUrl?: string | null;
  pageOrigin: string;
  devSameOriginSrcDoc?: boolean;
}): string {
  if (input.kind === 'inbrowser') {
    if (input.previewSandboxUrl) {
      try { return new URL(input.previewSandboxUrl).origin; } catch { /* not a URL */ }
    }
    if (input.devSameOriginSrcDoc && input.pageOrigin) return input.pageOrigin;
    return '*';
  }
  const src = input.frameSrc ?? '';
  if (!src) return '*';
  try {
    const origin = new URL(src, input.pageOrigin || 'https://localhost').origin;
    if (!input.pageOrigin || origin === input.pageOrigin) return '*';
    return origin;
  } catch {
    return '*';
  }
}
