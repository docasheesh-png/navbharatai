// The `web_fetch` tool's engine (ROADMAP §8A item A3) — read ONE user-supplied URL and hand the model
// back readable text.
//
// WHY IT EXISTS: v5 could already SEARCH the web (`web_search` → titles + snippets) and SCREENSHOT a page
// (`screenshot` → an image), but it could not READ one. So when a user said "build it like the API on this
// docs page" and pasted a link, the engine had two bad options: guess from a 200-character snippet, or
// look at a picture of the text. Reading the page is the obvious third, and it was missing.
//
// 🔒 THIS IS A SERVER-SIDE FETCHER OF A URL A USER CHOSE, which is the textbook SSRF shape: our server can
// reach things the internet cannot (cloud metadata at 169.254.169.254, 10.x/192.168.x hosts, localhost
// admin ports). Every defence below is load-bearing — do not relax one because a fetch failed.

import { assertPublicHttpUrl } from '../lib/ssrfGuard';

/** Hard ceiling on what we will pull down, before extraction. 2 MB of HTML is already a huge page. */
export const WEB_FETCH_MAX_BYTES = 2 * 1024 * 1024;
/** Wall-clock budget for the whole request. A build must never stall on someone else's slow server. */
export const WEB_FETCH_TIMEOUT_MS = 15_000;
/** How much extracted text the model receives. Beyond this the tail is dropped and SAID to be dropped. */
export const WEB_FETCH_MAX_CHARS = 30_000;

export interface WebFetchResult {
  ok: boolean;
  /** Extracted, model-readable text (empty when !ok). */
  text: string;
  /** Honest one-line reason when !ok — surfaced to the model so it can decide what to do next. */
  reason?: string;
  status?: number;
  contentType?: string;
  /** True when the page was longer than WEB_FETCH_MAX_CHARS and the tail was dropped. */
  truncated?: boolean;
}

/**
 * Strip HTML to readable text. Deliberately a small, dependency-free extractor rather than a DOM parse:
 * the model does not need perfect structure, it needs the words — and adding a parser to the server for
 * this would be a large dependency on a hot path.
 *
 * `<script>`/`<style>`/`<noscript>`/`<svg>` bodies are removed FIRST (their content is code, not prose,
 * and a minified bundle would otherwise swamp the real text and eat the whole character budget). Pure.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    // Block-level tags become newlines so headings/paragraphs/list items don't run together.
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n').map((l) => l.trim()).join('\n')
    .trim();
}

/** True for a content type we can turn into useful text. Anything else is refused, not guessed at. Pure. */
export function isReadableContentType(ct: string | null | undefined): boolean {
  const t = String(ct ?? '').toLowerCase();
  if (!t) return true; // no header — try it; the extractor degrades safely on binary-ish input
  return /^(?:text\/|application\/(?:json|xml|xhtml\+xml|javascript|x-ndjson)|application\/[\w.+-]*\+json)/.test(t);
}

/** Cap the text and say so, rather than silently handing the model half a page as if it were whole. Pure. */
export function capText(text: string, maxChars = WEB_FETCH_MAX_CHARS): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

/**
 * Fetch one URL and return readable text. Never throws — every failure comes back as
 * `{ ok: false, reason }` so the model gets an honest sentence instead of a stack trace.
 *
 * THE DEFENCES, and why each one is there:
 *  1. `assertPublicHttpUrl` — scheme check + hostname denylist + resolve EVERY A/AAAA record and require
 *     all of them public. Shared with the API-tester proxy (one implementation, not a second copy).
 *  2. `redirect: 'error'` — a public URL is allowed to 302 to `http://169.254.169.254/`, which would walk
 *     straight past defence 1. Following redirects safely would mean re-validating each hop; refusing them
 *     is the honest, simple answer, and the reason string tells the model to pass the final URL instead.
 *  3. Size cap enforced WHILE STREAMING, not from `content-length` — a lying or absent header must not be
 *     able to pull 500 MB into the server's memory.
 *  4. Timeout via AbortController — a slow server must not hold a build's step open.
 *  5. No credentials, no cookies, and the caller's headers are never forwarded.
 *
 * ⚠️ RESIDUAL RISK, stated rather than papered over: between defence 1's DNS lookup and the actual
 * connection, a hostile DNS server can answer differently (classic DNS rebinding), and closing that hole
 * properly needs a custom connect-time IP check (a dispatcher/agent that validates the socket's peer
 * address). The timeout, the redirect refusal and the response cap bound the damage; a full fix is a
 * separate, larger change and should not be claimed here.
 */
export async function webFetchUrl(rawUrl: string): Promise<WebFetchResult> {
  const check = await assertPublicHttpUrl(rawUrl);
  if (!check.ok) return { ok: false, text: '', reason: check.reason ?? 'This URL is not allowed.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(rawUrl, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'user-agent': 'NavBharatAI/1.0 (+https://navbharatai.com)', accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' },
    });

    const contentType = res.headers.get('content-type');
    if (!res.ok) {
      return { ok: false, text: '', status: res.status, contentType: contentType ?? undefined, reason: `The site returned HTTP ${res.status}.` };
    }
    if (!isReadableContentType(contentType)) {
      return { ok: false, text: '', status: res.status, contentType: contentType ?? undefined, reason: `That URL is ${contentType} — not text this tool can read. Use the screenshot tool for an image, or link to a text/HTML page.` };
    }

    const raw = await readCapped(res, WEB_FETCH_MAX_BYTES);
    const looksHtml = /html|xml/i.test(String(contentType ?? '')) || /^\s*<(?:!doctype|html)\b/i.test(raw);
    const extracted = looksHtml ? htmlToText(raw) : raw.trim();
    if (!extracted) {
      return { ok: false, text: '', status: res.status, contentType: contentType ?? undefined, reason: 'The page loaded but contained no readable text (it may render entirely with JavaScript — try the screenshot tool).' };
    }
    const { text, truncated } = capText(extracted);
    return { ok: true, text, status: res.status, contentType: contentType ?? undefined, truncated };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/abort/i.test(msg)) return { ok: false, text: '', reason: `The site did not respond within ${Math.round(WEB_FETCH_TIMEOUT_MS / 1000)}s.` };
    // fetch() rejects on a redirect when redirect:'error' — say what to do about it, not just what broke.
    if (/redirect/i.test(msg)) return { ok: false, text: '', reason: 'That URL redirects elsewhere, which is refused for safety. Pass the final URL directly.' };
    return { ok: false, text: '', reason: `Could not fetch that URL: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a response body, stopping at `maxBytes`. Streams so an oversized or length-lying body can never be
 * fully buffered. Falls back to `res.text()` only when the body is not a stream (some fetch polyfills).
 */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const body = res.body as ReadableStream<Uint8Array> | null | undefined;
  if (!body || typeof body.getReader !== 'function') {
    const t = await res.text();
    return t.length > maxBytes ? t.slice(0, maxBytes) : t;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      total += value.byteLength;
      if (total >= maxBytes) break; // cap reached — keep what we have, stop pulling
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  const merged = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { merged.set(c, at); at += c.byteLength; }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged.subarray(0, maxBytes));
}

/** Format a result as the string the tool returns to the model. Pure, so the wording is test-locked. */
export function formatWebFetchResult(url: string, r: WebFetchResult): string {
  if (!r.ok) throw new Error(r.reason ?? 'Could not fetch that URL.');
  const head = `Fetched ${url}${r.status ? ` (HTTP ${r.status})` : ''}:`;
  const tail = r.truncated ? `\n\n[Truncated at ${WEB_FETCH_MAX_CHARS} characters — this is the start of the page, not all of it.]` : '';
  return `${head}\n\n${r.text}${tail}`;
}
