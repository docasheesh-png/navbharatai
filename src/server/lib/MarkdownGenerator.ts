// U-4 (verified recipe modules) — Markdown → SAFE HTML rendering (marked + sanitize-html).
//
// Blogs, docs, comments, product descriptions, chat — a huge share of apps store Markdown and render it to
// HTML. The dangerous shortcut is `marked(md)` alone: Markdown allows raw HTML, so untrusted Markdown (a
// comment, a wiki edit) can inject `<script>`/`onerror=` and you have stored XSS. This recipe is SAFE BY
// CONSTRUCTION: renderMarkdown() renders with `marked` AND runs the output through `sanitize-html` in the
// same call, so there is no way to use it and forget to sanitize. Links are forced to safe protocols +
// rel="noopener"; a code-block/table subset is kept. PURE builder; correct and complete — no TODO stubs (the
// real-features rule). Unit-tested.

export interface MarkdownConfig {
  files: Record<string, string>;
  /** marked renders; sanitize-html makes the output XSS-safe. */
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const MARKDOWN_SERVER = `import { marked } from 'marked';
import sanitizeHtmlLib from 'sanitize-html';

// Render Markdown to SAFE HTML. It renders with marked and THEN sanitizes, in one step, so untrusted Markdown
// (a user comment, a wiki edit) can never inject <script>, event handlers or javascript: URLs — the output is
// safe to drop straight into the page. Keeps a rich-but-safe subset: headings, lists, tables, code blocks,
// blockquotes, images and links (links forced to safe protocols + rel="noopener noreferrer").
export function renderMarkdown(md: string): string {
  const rawHtml = marked.parse(String(md ?? ''), { async: false }) as string;
  return sanitizeHtmlLib(rawHtml, {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
      'b', 'i', 'strong', 'em', 'del', 'a', 'img', 'span',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title'],
      code: ['class'], // language-xxx for syntax highlighting
      span: ['class'],
      td: ['align'],
      th: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
    transformTags: {
      a: sanitizeHtmlLib.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
    },
  });
}
`;

const INSTRUCTIONS =
  'Markdown rendering wired at server/lib/markdown.ts (add the dependencies marked + sanitize-html). Import ' +
  'renderMarkdown(md) to turn stored Markdown into HTML for blog posts, docs, comments and product ' +
  'descriptions. It renders AND sanitizes in one call, so untrusted Markdown can NEVER inject <script> or an ' +
  'onerror handler — the returned HTML is safe to render directly (no separate sanitize step to forget). It ' +
  'keeps a rich subset (headings, lists, tables, code blocks, images, links) and forces links to safe ' +
  'protocols + rel="noopener". No API key needed.';

export function generateMarkdownIntegration(): MarkdownConfig {
  return {
    files: { 'server/lib/markdown.ts': MARKDOWN_SERVER },
    dependencies: [
      { name: 'marked', version: '^12.0.0' },
      { name: 'sanitize-html', version: '^2.13.0' },
    ],
    instructions: INSTRUCTIONS,
  };
}
