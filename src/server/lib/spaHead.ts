// PER-ROUTE <head> FOR THE SPA SHELL — SEO audit 2026-10-18.
//
// 🔴 WHAT WAS WRONG (measured on the live site). The SPA catch-all answers EVERY non-server path with
// the same index.html, and that file says `<link rel="canonical" href="https://navbharatai.com/">`.
// So:
//   • /store — App Mart, a real public page — told every search engine "I am a copy of the homepage",
//     which is an instruction not to index it;
//   • /anything-at-all answered 200 with the homepage and the homepage's canonical: an unlimited
//     supply of soft-404 duplicates.
//
// THE FIX, deliberately confined to the <head>: the body (the boot frame and the module script) is
// never touched, so the app boots byte-for-byte as before. Pages that are real public entry points
// get their own canonical / title / description; every other SPA path keeps working for a person but
// is marked `noindex, follow`, which is what a crawler should do with an app screen or a typo.
//
// spaHeadFor is PURE (string in, string out). readSpaShell is the one I/O helper, cached per process —
// index.html only changes on a deploy, which is a new process.

import fs from 'fs';
import path from 'path';
import { escapeHtml } from './legalMarkdown';

interface RouteHead { title: string; description: string; canonicalPath: string }

const APP_MART_HEAD: RouteHead = {
  title: 'App Mart — Apps & Games by NavBharatAI Creators',
  description:
    'Apps and games made by NavBharatAI creators. Tap one and it runs straight away in your browser — no account, nothing to download.',
  canonicalPath: '/store',
};

/** The public SPA entry points and their head. `null` = index the homepage head as-is. */
export function spaRouteHead(p: string): RouteHead | null | 'noindex' {
  const path = p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
  if (path === '' || path === '/') return null;
  if (path === '/store') return APP_MART_HEAD;
  // 🔒 ONE APP MART LISTING (/store/app/<id>) IS `noindex, follow` — with NO canonical of its own — until
  // a per-app server head exists (SEO verification 2026-10-18, P1-A). This server cannot tell a real
  // listing from a deleted or mistyped id without a Firestore read, so a self-canonical here made EVERY
  // id — `/store/app/does-not-exist-123` included — an indexable 200 with one shared title and the App
  // Mart description: an unlimited supply of soft-404s and near-duplicates. The share link still opens
  // the listing for a person (the body is untouched); `follow` keeps the links on it crawlable; and
  // /store itself stays the one indexable App Mart page. Listings are deliberately NOT in the sitemap.
  return 'noindex';
}

const setMeta = (html: string, re: RegExp, replacement: string) => (re.test(html) ? html.replace(re, replacement) : html);

/** Rewrite the shell's head for this path. PURE. Never throws: on any surprise it returns the shell. */
export function spaHeadFor(reqPath: string, shell: string, origin: string): string {
  try {
    const head = spaRouteHead(typeof reqPath === 'string' ? reqPath : '');
    if (head === null) return shell;
    if (head === 'noindex') {
      // A canonical pointing at the homepage on a noindex page is a contradiction — drop it.
      const out = shell.replace(/\s*<link rel="canonical"[^>]*>/i, '');
      return out.replace(/<\/head>/i, '    <meta name="robots" content="noindex, follow" />\n  </head>');
    }
    const url = escapeHtml(`${origin}${head.canonicalPath}`);
    const t = escapeHtml(head.title);
    const d = escapeHtml(head.description);
    let out = shell;
    out = setMeta(out, /<title>[^<]*<\/title>/i, `<title>${t}</title>`);
    out = setMeta(out, /<link rel="canonical" href="[^"]*"\s*\/?>/i, `<link rel="canonical" href="${url}" />`);
    out = setMeta(out, /<meta name="description" content="[^"]*"\s*\/?>/i, `<meta name="description" content="${d}" />`);
    out = setMeta(out, /<meta property="og:url" content="[^"]*"\s*\/?>/i, `<meta property="og:url" content="${url}" />`);
    out = setMeta(out, /<meta property="og:title" content="[^"]*"\s*\/?>/i, `<meta property="og:title" content="${t}" />`);
    out = setMeta(out, /<meta property="og:description" content="[^"]*"\s*\/?>/i, `<meta property="og:description" content="${d}" />`);
    out = setMeta(out, /<meta name="twitter:title" content="[^"]*"\s*\/?>/i, `<meta name="twitter:title" content="${t}" />`);
    out = setMeta(out, /<meta name="twitter:description" content="[^"]*"\s*\/?>/i, `<meta name="twitter:description" content="${d}" />`);
    // The homepage's WebSite/Organization graph belongs on the homepage only.
    out = out.replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/i, '');
    return out;
  } catch {
    return shell;
  }
}

let cached: { file: string; html: string } | null = null;

/** The built index.html, read once per process. `null` when it cannot be read (caller falls back). */
export function readSpaShell(distPath: string): string | null {
  const file = path.join(distPath, 'index.html');
  if (cached && cached.file === file) return cached.html;
  try {
    const html = fs.readFileSync(file, 'utf8');
    cached = { file, html };
    return html;
  } catch {
    return null;
  }
}
