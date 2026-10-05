// Serving HTML that a USER wrote, from NavBharatAI's own origin — the one way it is allowed.
//
// 🔴 WHY (forensic audit 2026-10-04). `GET /pwa/:id` (any signed-in account could save the HTML) and
// `GET /preview/:id` (anyone, no account) sent a user's HTML as an ordinary page on navbharatai.com. A
// page on our origin is US to the browser: its script reads the visitor's Firebase session from storage,
// the GitHub token the app keeps in localStorage, and calls our API as them. One link was an account
// takeover — the admin's included.
//
// `Content-Security-Policy: sandbox` WITHOUT `allow-same-origin` makes the browser run the page in an
// opaque, unique origin even when it is opened directly in a tab: its scripts still run (the app works),
// but it can reach none of navbharatai.com's storage, cookies or same-origin APIs. This replaces the main
// app's CSP for these responses on purpose — the page is not part of the main app.
//
// What it costs: an opaque origin cannot register a service worker, so a /pwa page is no longer
// installable. Nothing in the app creates /pwa pages any more; existing links keep rendering.
// The complete fix — user content on its own registrable domain — is recorded in PROGRESS.md.

import type { Response } from 'express';

export const UNTRUSTED_HTML_CSP = 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads';

export function sendUntrustedHtml(res: Response, html: string, status = 200): void {
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', UNTRUSTED_HTML_CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.send(html);
}
