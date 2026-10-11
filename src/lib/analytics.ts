// 12.2 — Lightweight analytics event tracker (PostHog-style, no 3rd-party lib)

import { hasAnalyticsConsent } from './consent';
import { forwardToMetaPixel } from './metaPixel';

export function trackEvent(event: string, props?: Record<string, unknown>) {
  if (!import.meta.env.PROD) return;
  // P-UX.1 — GDPR/DPDP: do not fire non-essential analytics until the user has consented.
  if (!hasAnalyticsConsent()) return;
  try {
    // 🔒 NO PERSON IN THE EVENT (admin 2026-10-11, Q-783). This used to send the signed-in `userId` and a
    // per-tab session id with every event. The server stores neither any more (it keeps the day rollup,
    // which holds no person), so collecting them at all is exactly what data minimisation forbids.
    fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, props, ts: Date.now() }),
    }).catch(() => {});
  } catch {}

  // Mirror the few genuine CONVERSION events onward to the Meta advertising pixel, so a
  // Facebook/Instagram campaign can be optimised for registrations and purchases instead of for raw
  // link clicks. Done HERE, at the one function every product event already passes through, rather
  // than by adding fbq() calls beside each one — the same single-choke-point reasoning as the
  // provider anonymiser. forwardToMetaPixel() owns the allowlist (most events forward NOTHING) and
  // is inert until the pixel has genuinely loaded, so this line is a no-op for almost every call.
  //
  // Separately wrapped: an advertising pixel must never be able to break product telemetry.
  try { forwardToMetaPixel(event, props); } catch { /* never let measurement break the product */ }
}
