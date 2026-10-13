// ONE MARKDOWN RENDERER FOR EVERY CHAT SURFACE (admin 2026-10-13, "chat wala ui aur ux ko claude jaisa").
//
// 🔴 WHAT IT REPLACES. Four surfaces each rendered ReactMarkdown themselves, with their own `components` and
// their own `prose prose-invert prose-xs …` wrapper — and the typography plugin those classes belong
// to was never installed, so the wrapper did nothing anywhere. Doctor AI's replies and the IDE mini
// chat's rendered as bare browser defaults; the free chat had its own 11px `.markdown-body`. The
// plugin list had already been centralised once (`lib/chatMarkdown.ts`, the line-break bug); this
// does the same for the renderer, so a reply looks the same whichever AI wrote it.
//
// Every link opens in a new tab and only when it is http(s) — the text is model-authored, and on the
// phone app a plain anchor would navigate the app's own webview away (admin 2026-08-25). Fenced code
// goes through the shared code block; tables, task lists and images get the one prose scale.
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { CHAT_MARKDOWN_PLUGINS } from '../../lib/chatMarkdown';
import { isSafeHttpUrl, openInRealBrowser } from '../../lib/linkify';
import { ChatCodeBlock } from './ChatCodeBlock';
import { CHAT_PROSE_CLASS } from './conversation';

/** `react-markdown` is typed as `any` here (declarations.d.ts), so the map carries its own loose shape. */
export type Components = Record<string, (props: any) => ReactNode>;

/** The shared `components` map — exported so a surface can extend it (a language picker, a card). */
export const CHAT_MARKDOWN_COMPONENTS: Components = {
  a: ({ node: _node, href, children, ...props }) => {
    const url = String(href ?? '');
    if (!isSafeHttpUrl(url)) return <>{children}</>;
    return (
      <a {...props} href={url} target="_blank" rel="noopener noreferrer" onClick={openInRealBrowser(url)}>
        {children}
      </a>
    );
  },
  code: ({ node: _node, className, children, ...props }) => {
    const isInline = !className;
    if (isInline) return <code {...props}>{children}</code>;
    const lang = (className || '').replace('language-', '');
    return <ChatCodeBlock lang={lang} code={String(children).replace(/\n$/, '')} />;
  },
  // The fenced block above draws its own frame, so the wrapping <pre> is not rendered twice.
  pre: ({ children }) => <>{children}</>,
  table: ({ node: _node, children, ...props }) => (
    <div className="my-3 overflow-x-auto rounded-xl border border-line">
      <table {...props} className="my-0">{children}</table>
    </div>
  ),
  // GFM task lists: a checkbox that reports, never one that edits the model's words.
  input: ({ node: _node, ...props }) => <input {...props} disabled className="mr-1.5 align-middle accent-[var(--accent)] cursor-default" />,
  img: ({ node: _node, src, alt, ...props }) => (
    <img
      {...props}
      src={src}
      alt={alt || ''}
      loading="lazy"
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
    />
  ),
};

export interface ChatMarkdownProps {
  text: string;
  className?: string;
  /** Extra or overriding components for one surface; the shared ones stay unless overridden. */
  components?: Components;
}

export function ChatMarkdown({ text, className, components }: ChatMarkdownProps) {
  return (
    <div className={`${CHAT_PROSE_CLASS} ${className ?? ''}`}>
      <ReactMarkdown remarkPlugins={CHAT_MARKDOWN_PLUGINS} components={components ? { ...CHAT_MARKDOWN_COMPONENTS, ...components } : CHAT_MARKDOWN_COMPONENTS}>
        {text || ''}
      </ReactMarkdown>
    </div>
  );
}
