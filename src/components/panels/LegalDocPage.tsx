// Legal & Trust document page (admin 2026-08-08: one page per document, buttons in Settings).
//
// The document BODIES (~45 KB) are dynamic-imported so they live in their own lazy chunk — a static
// import here put them in the app's main chunk and broke the CI bundle budget (653.5 KB > 650 KB).
// Readable typography over decoration: these pages exist to be actually read, including by lawyers
// and enterprise reviewers on desktop and by users on phones.

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import { FileText, Loader2 } from 'lucide-react';
import type { LegalDoc } from '../../content/legal';
import { openLegalLink } from '../../lib/legalLinks';
import { openExternalUrl } from '../../lib/mobileNative';

/**
 * How a link INSIDE a legal document behaves (admin 2026-09-23: "crash jaisa feel ho raha").
 *
 * The documents link to each other with relative paths — `[Refund policy](/refund)` — and a plain
 * anchor for one of those reloaded the whole mobile app, because in the bundled app `/refund` means
 * `https://localhost/refund`. `openLegalLink` resolves it to the app's own Legal page, or to the
 * real site for a page only the server has. Any other web link goes to the browser through
 * `openExternalUrl` (the system browser in the app, a new tab on the web) instead of replacing the app.
 * `mailto:` and anything else keep the browser's own behaviour.
 */
export const legalMarkdownComponents: ComponentProps<typeof ReactMarkdown>['components'] = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        if (openLegalLink(href)) { e.preventDefault(); return; }
        if (href && /^https?:/i.test(href)) { e.preventDefault(); openExternalUrl(href); }
      }}
    >
      {children}
    </a>
  ),
};

export function LegalDocPage({ docId }: { docId: string }) {
  const [doc, setDoc] = useState<LegalDoc | null | 'loading'>('loading');
  const topRef = useRef<HTMLDivElement>(null);

  // A link from one document to another swaps the document in place, so the reader must land at the
  // TOP of the new one, not at the scroll position they had reached in the old one.
  useEffect(() => {
    if (doc && doc !== 'loading') topRef.current?.scrollIntoView?.({ block: 'start' });
  }, [doc]);

  useEffect(() => {
    let alive = true;
    setDoc('loading');
    // The lazy chunk: bodies download only when someone actually opens a legal page.
    import('../../content/legal')
      .then(async (m) => {
        if (!alive) return;
        const found = m.legalDocById(docId);
        /**
         * GRIEVANCE IS THE ONE DOCUMENT WITH LIVE DETAILS IN IT — the officer's real name and
         * contact, which are deployment configuration rather than source. The registry carries the
         * unconfigured fallback, so this page asks the server for the published details and builds
         * the SAME words with them. Without this, the in-app page would name the role while the
         * public /grievance URL named the person: one compliance page saying two things.
         *
         * A failed fetch keeps the fallback, which is honest and still gives a working address —
         * never a blank page, and never an invented name.
         */
        if (found && docId === 'legal_grievance') {
          try {
            const r = await fetch('/api/public-config');
            const cfg = r.ok ? await r.json() : null;
            if (cfg?.grievance) {
              const g = await import('../../content/legal/grievance');
              const body = g.grievanceDoc(g.grievanceOfficerFrom(cfg.grievance));
              if (alive) setDoc({ ...found, body });
              return;
            }
          } catch { /* keep the fallback body — see the note above */ }
        }
        setDoc(found);
      })
      .catch(() => { if (alive) setDoc(null); });
    return () => { alive = false; };
  }, [docId]);

  if (doc === 'loading') {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading document…
      </div>
    );
  }
  if (!doc) {
    // A wrong id is a wiring bug and a failed load is a network problem — say so honestly either way.
    return (
      <div className="p-6 text-sm text-muted">
        This document could not be loaded. Check your connection and try again — or email
        info@navbharatai.com and mention "{docId}".
      </div>
    );
  }
  return (
    <div className="max-w-3xl" ref={topRef}>
      <div className="flex items-start gap-3 mb-1">
        <div className="p-2 bg-indigo-600/10 rounded-lg shrink-0 mt-0.5">
          <FileText className="w-4 h-4 text-accent-text" />
        </div>
        <div>
          <h2 className="text-xl font-black text-ink tracking-tight">{doc.title}</h2>
          <p className="text-[11px] text-muted font-bold mt-0.5">{doc.subtitle}</p>
        </div>
      </div>

      {/* The document itself. `prose`-like styling by hand (no typography plugin in this app):
          generous line-height and spacing because these are long documents meant to be READ.
          Sizes in rem so the accessibility Text Size zoom applies here too. */}
      <div
        className="nb-selectable mt-5 text-[0.8125rem] leading-relaxed text-body space-y-3
          [&_h1]:text-lg [&_h1]:font-black [&_h1]:text-ink [&_h1]:mt-2
          [&_h2]:text-[0.9375rem] [&_h2]:font-black [&_h2]:text-ink [&_h2]:mt-6 [&_h2]:mb-1
          [&_h3]:text-[0.8125rem] [&_h3]:font-black [&_h3]:text-accent-text [&_h3]:mt-4
          [&_p]:my-2 [&_li]:my-1 [&_ul]:pl-5 [&_ul]:list-disc [&_ol]:pl-5 [&_ol]:list-decimal
          [&_strong]:text-ink [&_a]:text-accent-text [&_a]:underline
          [&_blockquote]:border-l-2 [&_blockquote]:border-indigo-500/50 [&_blockquote]:pl-3 [&_blockquote]:text-muted
          [&_hr]:border-line [&_hr]:my-5
          [&_code]:text-[0.75rem] [&_code]:bg-raised [&_code]:px-1 [&_code]:rounded"
      >
        <ReactMarkdown components={legalMarkdownComponents}>{doc.body}</ReactMarkdown>
      </div>

      <p className="mt-8 text-[10px] text-faint leading-relaxed border-t border-line pt-3">
        Questions about this document: info@navbharatai.com
      </p>
    </div>
  );
}
