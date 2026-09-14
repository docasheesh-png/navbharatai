// THE "LOAD MORE" BUTTON — one component, so every list in NavBharatAI ends the same way.
//
// 🔒 IT ALWAYS SAYS HOW MANY ARE LEFT. "Load more" alone is a mystery button: the reader cannot tell
// whether one row follows or four thousand, so they either press it twenty times or give up and
// assume the list ended. "Load 12 more (4,319 left)" answers both questions before the press, and
// costs nothing — the number is already in hand.
//
// ⚠️ It renders NOTHING when there is nothing more to show. A greyed-out "Load more" under a
// complete list is the commonest version of this control and it makes a finished list look broken.

import React from 'react';
import type { PagedList } from '../../hooks/usePagedList';

export interface LoadMoreProps {
  /** The value from `usePagedList`. */
  list: PagedList<unknown>;
  /** Plural noun for the rows — "users", "apps", "builds". Shown in the count. */
  label?: string;
  /** Offer "Show all" beside it. Default true; turn it off where the full list would be enormous. */
  allowShowAll?: boolean;
  /** Extra classes for the wrapper. */
  className?: string;
  /**
   * Set this when the list is table ROWS, and pass the table's column count.
   *
   * 🔴 WITHOUT IT THIS COMPONENT PRODUCES INVALID HTML INSIDE A TABLE, and it did on its first
   * draft: a `<div>` placed directly inside `<tbody>` is hoisted out of the table by the browser, so
   * the button renders in the wrong place and React logs a validateDOMNesting warning. With it, the
   * control is a proper `<tr><td colSpan=N>` and sits under the last row where it belongs.
   */
  colSpan?: number;
}

/** Group an integer with Indian digit grouping — 4,31,900 reads right to this app's users. */
function grouped(n: number): string {
  try { return n.toLocaleString('en-IN'); } catch { return String(n); }
}

export const LoadMore: React.FC<LoadMoreProps> = ({ list, label, allowShowAll = true, className, colSpan }) => {
  if (!list.hasMore) return null;
  const noun = label ? ' ' + label : '';
  const step = Math.min(list.remaining, Math.max(1, list.visible.length || 12));
  const body = (
    <div
      className={className || 'nb-load-more'}
      style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', padding: '12px 0', flexWrap: 'wrap' }}
    >
      <button
        type="button"
        onClick={list.loadMore}
        aria-label={`Load ${grouped(step)} more${noun}. ${grouped(list.remaining)} still hidden.`}
        style={{
          padding: '8px 18px', borderRadius: 999, cursor: 'pointer',
          border: '1px solid var(--nb-border, #d0d5dd)', background: 'var(--nb-surface, #fff)',
          color: 'inherit', fontSize: 13, fontWeight: 600,
        }}
      >
        Load {grouped(step)} more
      </button>
      <span style={{ fontSize: 12, opacity: 0.7 }}>
        Showing {grouped(list.total - list.remaining)} of {grouped(list.total)}{noun}
      </span>
      {allowShowAll && (
        <button
          type="button"
          onClick={list.showAll}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, textDecoration: 'underline', opacity: 0.75, color: 'inherit' }}
        >
          Show all {grouped(list.total)}
        </button>
      )}
    </div>
  );
  return colSpan ? <tr><td colSpan={colSpan}>{body}</td></tr> : body;
};

export default LoadMore;
