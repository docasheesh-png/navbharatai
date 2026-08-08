// Legal & Trust document page (admin 2026-08-08: one page per document, buttons in Settings).
// Renders any document from the ONE legal registry (src/content/legal) — so a new document needs a
// registry entry and nothing else here. Readable typography over decoration: these pages exist to be
// actually read, including by lawyers and enterprise reviewers on desktop and by users on phones.

import ReactMarkdown from 'react-markdown';
import { FileText } from 'lucide-react';
import { legalDocById } from '../../content/legal';

export function LegalDocPage({ docId }: { docId: string }) {
  const doc = legalDocById(docId);
  if (!doc) {
    // A wrong id is a wiring bug, not a user error — say so honestly instead of a blank screen.
    return (
      <div className="p-6 text-sm text-[#8b949e]">
        This document could not be found. Please email info@navbharatai.com and mention "{docId}".
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
          generous line-height and spacing because these are long documents meant to be READ. */}
      <div
        className="mt-5 text-[13px] leading-relaxed text-[#c9d1d9] space-y-3
          [&_h1]:text-lg [&_h1]:font-black [&_h1]:text-white [&_h1]:mt-2
          [&_h2]:text-[15px] [&_h2]:font-black [&_h2]:text-white [&_h2]:mt-6 [&_h2]:mb-1
          [&_h3]:text-[13px] [&_h3]:font-black [&_h3]:text-indigo-300 [&_h3]:mt-4
          [&_p]:my-2 [&_li]:my-1 [&_ul]:pl-5 [&_ul]:list-disc [&_ol]:pl-5 [&_ol]:list-decimal
          [&_strong]:text-white [&_a]:text-indigo-400 [&_a]:underline
          [&_blockquote]:border-l-2 [&_blockquote]:border-indigo-500/50 [&_blockquote]:pl-3 [&_blockquote]:text-[#8b949e]
          [&_hr]:border-white/10 [&_hr]:my-5
          [&_code]:text-[12px] [&_code]:bg-white/5 [&_code]:px-1 [&_code]:rounded"
      >
        <ReactMarkdown>{doc.body}</ReactMarkdown>
      </div>

      <p className="mt-8 text-[10px] text-[#586069] leading-relaxed border-t border-white/5 pt-3">
        Questions about this document: info@navbharatai.com
      </p>
    </div>
  );
}
