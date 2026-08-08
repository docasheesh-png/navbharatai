// Legal & Trust document page (admin 2026-08-08: one page per document, buttons in Settings).
//
// The document BODIES (~45 KB) are dynamic-imported so they live in their own lazy chunk — a static
// import here put them in the app's main chunk and broke the CI bundle budget (653.5 KB > 650 KB).
// Readable typography over decoration: these pages exist to be actually read, including by lawyers
// and enterprise reviewers on desktop and by users on phones.

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { FileText, Loader2 } from 'lucide-react';
import type { LegalDoc } from '../../content/legal';

export function LegalDocPage({ docId }: { docId: string }) {
  const [doc, setDoc] = useState<LegalDoc | null | 'loading'>('loading');

  useEffect(() => {
    let alive = true;
    setDoc('loading');
    // The lazy chunk: bodies download only when someone actually opens a legal page.
    import('../../content/legal')
      .then((m) => { if (alive) setDoc(m.legalDocById(docId)); })
      .catch(() => { if (alive) setDoc(null); });
    return () => { alive = false; };
  }, [docId]);

  if (doc === 'loading') {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-[#8b949e]">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading document…
      </div>
    );
  }
  if (!doc) {
    // A wrong id is a wiring bug and a failed load is a network problem — say so honestly either way.
    return (
      <div className="p-6 text-sm text-[#8b949e]">
        This document could not be loaded. Check your connection and try again — or email
        info@navbharatai.com and mention "{docId}".
      </div>
    );
  }
  return (
    <div className="max-w-3xl">
      <div className="flex items-start gap-3 mb-1">
        <div className="p-2 bg-indigo-600/10 rounded-lg shrink-0 mt-0.5">
          <FileText className="w-4 h-4 text-indigo-400" />
        </div>
        <div>
          <h2 className="text-xl font-black text-white tracking-tight">{doc.title}</h2>
          <p className="text-[11px] text-[#8b949e] font-bold mt-0.5">{doc.subtitle}</p>
        </div>
      </div>

      {/* The document itself. `prose`-like styling by hand (no typography plugin in this app):
          generous line-height and spacing because these are long documents meant to be READ.
          Sizes in rem so the accessibility Text Size zoom applies here too. */}
      <div
        className="mt-5 text-[0.8125rem] leading-relaxed text-[#c9d1d9] space-y-3
          [&_h1]:text-lg [&_h1]:font-black [&_h1]:text-white [&_h1]:mt-2
          [&_h2]:text-[0.9375rem] [&_h2]:font-black [&_h2]:text-white [&_h2]:mt-6 [&_h2]:mb-1
          [&_h3]:text-[0.8125rem] [&_h3]:font-black [&_h3]:text-indigo-300 [&_h3]:mt-4
          [&_p]:my-2 [&_li]:my-1 [&_ul]:pl-5 [&_ul]:list-disc [&_ol]:pl-5 [&_ol]:list-decimal
          [&_strong]:text-white [&_a]:text-indigo-400 [&_a]:underline
          [&_blockquote]:border-l-2 [&_blockquote]:border-indigo-500/50 [&_blockquote]:pl-3 [&_blockquote]:text-[#8b949e]
          [&_hr]:border-white/10 [&_hr]:my-5
          [&_code]:text-[0.75rem] [&_code]:bg-white/5 [&_code]:px-1 [&_code]:rounded"
      >
        <ReactMarkdown>{doc.body}</ReactMarkdown>
      </div>

      <p className="mt-8 text-[10px] text-[#586069] leading-relaxed border-t border-white/5 pt-3">
        Questions about this document: info@navbharatai.com
      </p>
    </div>
  );
}
