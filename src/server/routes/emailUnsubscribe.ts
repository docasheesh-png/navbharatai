// The unsubscribe link in a notification email (lib/emailUnsubscribe.ts explains the whole design).
//
//   GET  /api/email/unsubscribe?u&c&t  → a page with an "Unsubscribe" button. Changes nothing: mail scanners
//                                        open links on their own, and a GET that unsubscribed would let them.
//   POST /api/email/unsubscribe?u&c&t  → does it. Accepts the page's form (action=unsubscribe|resubscribe) and
//                                        the RFC 8058 one-click POST a mail client sends (body
//                                        "List-Unsubscribe=One-Click"), which always means unsubscribe.
//
// No login: the HMAC in the link is the proof. The pages are plain server-rendered HTML so they work in any
// mail app's browser without loading the app.

// The form body (page button, or RFC 8058 one-click) is parsed by the shared formBodyParser — this route is
// listed in requestBodyLimits.ts SMALL_BODY_ROUTES with `form`, and routes never mount their own parser.
import type { Express, Request, Response } from 'express';
import {
  verifyUnsubscribeToken, unsubscribeSigningKey, setEmailPreference, mayEmail,
  EMAIL_CATEGORY_LABEL, type EmailCategory,
} from '../lib/emailUnsubscribe';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** One small, self-contained page. Every dynamic value is escaped. PURE. */
export function unsubscribePage(opts: { title: string; message: string; button?: { label: string; action: 'unsubscribe' | 'resubscribe'; query: string } }): string {
  const form = opts.button
    ? `<form method="post" action="/api/email/unsubscribe?${escapeHtml(opts.button.query)}">
  <input type="hidden" name="action" value="${opts.button.action}">
  <button type="submit">${escapeHtml(opts.button.label)}</button>
</form>`
    : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(opts.title)} — NavBharatAI</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f4f7;color:#1a1a2e;margin:0;padding:48px 16px}
main{max-width:440px;margin:0 auto;background:#fff;border:1px solid #e3e3ea;border-radius:16px;padding:28px}
h1{font-size:20px;margin:0 0 12px}p{font-size:15px;line-height:1.5;margin:0 0 20px;color:#44445a}
button{font:inherit;font-weight:700;background:#4f46e5;color:#fff;border:0;border-radius:10px;padding:12px 18px;cursor:pointer;width:100%}
a{color:#4f46e5}
</style></head>
<body><main><h1>${escapeHtml(opts.title)}</h1><p>${escapeHtml(opts.message)}</p>${form}
<p style="margin:20px 0 0;font-size:13px"><a href="/">Open NavBharatAI</a></p></main></body></html>`;
}

const INVALID = unsubscribePage({
  title: 'This link does not work',
  message: 'This unsubscribe link is incomplete or has been changed. Please use the link from the email itself.',
});

interface LinkParams { uid: string; category: EmailCategory; query: string }

/** The verified link parameters, or null. Reads the query string only — the form posts back to the same URL. */
function readLink(req: Request): LinkParams | null {
  const { u, c, t } = req.query as Record<string, unknown>;
  if (!verifyUnsubscribeToken(u, c, t, unsubscribeSigningKey())) return null;
  const uid = String(u);
  const category = c as EmailCategory;
  return { uid, category, query: new URLSearchParams({ u: uid, c: category, t: String(t) }).toString() };
}

function send(res: Response, status: number, html: string): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).type('html').send(html);
}

export function registerEmailUnsubscribeRoutes(app: Express): void {
  app.get('/api/email/unsubscribe', async (req: Request, res: Response) => {
    const link = readLink(req);
    if (!link) return send(res, 400, INVALID);
    const label = EMAIL_CATEGORY_LABEL[link.category];
    // Already stopped ⇒ say so and offer the way back, rather than a button that does nothing.
    const subscribed = await mayEmail(link.uid, link.category);
    return send(res, 200, subscribed
      ? unsubscribePage({ title: 'Unsubscribe from these emails?', message: `You will stop getting emails for ${label}. You will still see them in the app's notification bell.`, button: { label: 'Unsubscribe', action: 'unsubscribe', query: link.query } })
      : unsubscribePage({ title: 'You are unsubscribed', message: `You do not get emails for ${label}.`, button: { label: 'Subscribe again', action: 'resubscribe', query: link.query } }));
  });

  app.post('/api/email/unsubscribe', async (req: Request, res: Response) => {
    const link = readLink(req);
    if (!link) return send(res, 400, INVALID);
    const body = (req.body ?? {}) as Record<string, unknown>;
    // RFC 8058 one-click (`List-Unsubscribe=One-Click`) and the page's own button both mean unsubscribe;
    // only an explicit `action=resubscribe` turns the mail back on.
    const resubscribe = body.action === 'resubscribe' && body['List-Unsubscribe'] === undefined;
    const label = EMAIL_CATEGORY_LABEL[link.category];
    try {
      await setEmailPreference(link.uid, link.category, !resubscribe);
    } catch {
      return send(res, 503, unsubscribePage({ title: 'Please try again', message: 'Your choice could not be saved just now. Nothing was changed. Please try again in a moment.' }));
    }
    return send(res, 200, resubscribe
      ? unsubscribePage({ title: 'You are subscribed again', message: `You will get emails for ${label} again.`, button: { label: 'Unsubscribe', action: 'unsubscribe', query: link.query } })
      : unsubscribePage({ title: 'You are unsubscribed', message: `You will no longer get emails for ${label}. They still appear in the app's notification bell.`, button: { label: 'Subscribe again', action: 'resubscribe', query: link.query } }));
  });
}
