// linkify — turn the URLs an AI writes into REAL, clickable, safe links (admin 2026-08-25:
// "navbharatai website ke link provide nahi karwati hai … real/realtime working links provide karne
// layak banao, har ek ai ko").
//
// 🔒 THE BUG THIS CLOSES, and it is two bugs wearing one symptom. The Free chat has always rendered
// markdown, so a link there worked. But the Professionals chats (74 experts) and the v5 chat render
// their bubbles as `whitespace-pre-wrap` PLAIN TEXT — so a URL an expert wrote was DEAD TEXT the user
// could not tap. Doctor AI rendered markdown but with the default anchor, which navigates the app's
// own webview AWAY from NavBharatAI on a phone. So "the AI does not give links" was true on three of
// four surfaces no matter what the model wrote — which is why the prompt half alone would not have
// fixed it.
//
// 🔒 SAFETY IS THE WHOLE POINT OF DOING THIS ONCE. Text that becomes an anchor is text an AI (or a
// document it read) authored, so `javascript:`, `data:` and `vbscript:` URLs must never become
// clickable — that is a real XSS path, not a theoretical one. Exactly http/https is allowed, every
// link opens in a new tab, and `rel="noopener noreferrer"` stops the opened page from touching the
// tab that opened it. One implementation, so no surface can drift into an unsafe variant.
//
// The parser is PURE and exported, so every rule below is tested without a DOM.

import React from 'react';

export type LinkPart =
  | { kind: 'text'; value: string }
  | { kind: 'link'; href: string; label: string };

/**
 * Only these schemes may ever become an anchor. A bare `www.` host is upgraded to https rather than
 * left dead — users write it constantly and the alternative is an unclickable address.
 */
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}"'`]+/gi;

/**
 * Trailing punctuation belongs to the SENTENCE, not the URL: "see https://x.com/a." must not link
 * the full stop, and "(https://x.com/a)" must not swallow the bracket. Balanced closers inside the
 * URL are kept — Wikipedia titles legitimately end in ')'.
 */
export function trimUrlTail(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url.slice(-1);
    if ('.,;:!?'.includes(last)) { url = url.slice(0, -1); continue; }
    if (last === ')' && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) { url = url.slice(0, -1); continue; }
    if (last === ']' && (url.match(/\[/g)?.length ?? 0) < (url.match(/\]/g)?.length ?? 0)) { url = url.slice(0, -1); continue; }
    if (last === '"' || last === "'") { url = url.slice(0, -1); continue; }
    break;
  }
  return url;
}

/** True only for a URL we are willing to turn into a clickable anchor. PURE. */
export function isSafeHttpUrl(href: string): boolean {
  try {
    const u = new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Split plain text into text and link parts. Also understands markdown `[label](url)`, because the
 * models are told to cite sources in markdown and these surfaces do not render markdown — without
 * this, an expert's correct citation would show as raw `[IRCTC](https://…)` brackets. PURE.
 */
export function splitLinks(input: string): LinkPart[] {
  const text = String(input ?? '');
  if (!text) return [];
  const parts: LinkPart[] = [];
  let cursor = 0;

  // Markdown links first — otherwise the bare-URL pass would eat the URL out of the middle of one.
  const MD_RE = /\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)]+)\)/g;
  const mdRanges: Array<{ start: number; end: number; href: string; label: string }> = [];
  for (const m of text.matchAll(MD_RE)) {
    if (m.index === undefined) continue;
    mdRanges.push({ start: m.index, end: m.index + m[0].length, href: m[2], label: m[1] });
  }

  const pushText = (value: string) => {
    if (!value) return;
    const last = parts[parts.length - 1];
    if (last && last.kind === 'text') last.value += value;
    else parts.push({ kind: 'text', value });
  };

  const scanBare = (chunk: string) => {
    let at = 0;
    for (const m of chunk.matchAll(URL_RE)) {
      if (m.index === undefined) continue;
      const trimmed = trimUrlTail(m[0]);
      const href = trimmed.toLowerCase().startsWith('www.') ? `https://${trimmed}` : trimmed;
      pushText(chunk.slice(at, m.index));
      if (isSafeHttpUrl(href)) parts.push({ kind: 'link', href, label: trimmed });
      else pushText(trimmed);
      at = m.index + trimmed.length;
    }
    pushText(chunk.slice(at));
  };

  for (const r of mdRanges) {
    scanBare(text.slice(cursor, r.start));
    if (isSafeHttpUrl(r.href)) parts.push({ kind: 'link', href: r.href, label: r.label });
    else pushText(text.slice(r.start, r.end));
    cursor = r.end;
  }
  scanBare(text.slice(cursor));
  return parts;
}

/**
 * Render text with its URLs as real links. Drop-in for a `whitespace-pre-wrap` bubble: it emits plain
 * strings and anchors, nothing else, so existing layout and wrapping are unchanged.
 */
export function LinkedText({ text, linkClassName }: { text: string; linkClassName?: string }) {
  const parts = splitLinks(text);
  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'link' ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClassName ?? 'text-indigo-400 underline underline-offset-2 break-all hover:text-indigo-300'}
          >
            {p.label}
          </a>
        ) : (
          <React.Fragment key={i}>{p.value}</React.Fragment>
        ),
      )}
    </>
  );
}
