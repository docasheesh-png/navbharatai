// THE URL A <Route> SERVES, WITH ITS PARENTS JOINED (autopsy a106df77, 2026-10-01).
//
// 🔴 WHAT HAPPENED. The bill maker declared its screens the way React Router's own docs do — children of
// a layout route:
//     <Route path="/" element={<Shell />}>
//       <Route index element={<Dashboard />} />
//       <Route path="new" element={<NewBill />} />
//       <Route path="bills" element={<Bills />} />
// Two of our checks read only ABSOLUTE paths and threw the rest away, each with a comment saying a
// nested route "needs a parent to mean anything". So the page check found "no separate page routes"
// (the release gate stayed YELLOW for screens it never opened), and the journey for the New Bill form
// ran on `/`, where the form is not — "none of the form fields were present on the running page".
//
// 🔑 The parent is right there in the same file. This module walks the <Route> tree and joins it, once,
// for every reader. A path it cannot read (an expression, a template) is skipped, never guessed.
//
// PURE — no I/O. Never throws.
import { scanMarkup } from './jsxTags';
import { stripCommentsForMarkup } from './stripCodeComments';

export interface DeclaredRoute {
  /** The absolute URL path the route serves, parents joined: `/new`, `/admin/users`, `/`. */
  path: string;
  /** The <Route …> tag's own source text. */
  tag: string;
}

/** A path attribute's literal value: `path="new"`, `path='/x'`, `path={"x"}`. Null for an expression. */
function pathAttr(tag: string): string | null {
  const m = /(?<![-\w])path\s*=\s*(?:\{\s*)?(["'`])([^"'`$]*)\1/.exec(tag);
  return m ? m[2] : null;
}

/** Join a child path onto its parent the way React Router does: an absolute child stands alone. */
function join(parent: string, child: string): string {
  if (!child) return parent || '/';
  if (child.startsWith('/')) return child;
  const base = (parent || '/').replace(/\/+$/, '');
  return `${base}/${child}`.replace(/\/{2,}/g, '/');
}

/**
 * Every `<Route>` in a JSX source that serves a path, each with its absolute path. Index routes serve
 * their parent's path. A route whose own path, or any parent's, is not a string literal is left out.
 * PURE.
 */
export function declaredRoutes(source: string | null | undefined): DeclaredRoute[] {
  const src = String(source ?? '');
  if (!/<Route\b/.test(src)) return [];
  const text = stripCommentsForMarkup(src);
  type Event = { at: number; kind: 'open'; tag: string } | { at: number; kind: 'close' };
  const events: Event[] = [];
  for (const t of scanMarkup(src)) if (t.rawName === 'Route') events.push({ at: t.index, kind: 'open', tag: t.tag });
  for (const m of text.matchAll(/<\/\s*Route\s*>/g)) events.push({ at: m.index ?? 0, kind: 'close' });
  events.sort((a, b) => a.at - b.at);
  // Each open, non-self-closing <Route> on the stack: its absolute path, or null when unreadable.
  const stack: Array<string | null> = [];
  const out: DeclaredRoute[] = [];
  for (const e of events) {
    if (e.kind === 'close') { stack.pop(); continue; }
    const parent = stack.length ? stack[stack.length - 1] : '';
    const own = pathAttr(e.tag);
    const isIndex = /(?<![-\w])index(?![-\w])(?!\s*=\s*\{?\s*false)/.test(e.tag);
    const unreadable = parent === null || (own === null && /(?<![-\w])path\s*=/.test(e.tag));
    const abs = unreadable ? null : join(parent ?? '', own ?? '');
    if (abs !== null && (own !== null || isIndex)) out.push({ path: abs, tag: e.tag });
    if (!/\/\s*>$/.test(e.tag)) stack.push(abs);
  }
  return out;
}
