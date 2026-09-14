// The button, actually rendered — string assertions cannot see invalid HTML or a missing count.

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoadMore } from './LoadMore';
import type { PagedList } from '../../hooks/usePagedList';

const list = (over: Partial<PagedList<unknown>> = {}): PagedList<unknown> => ({
  visible: Array.from({ length: 12 }, (_, i) => i),
  hasMore: true, remaining: 4988, total: 5000,
  loadMore: () => {}, showAll: () => {}, reset: () => {}, ...over,
});

describe('LoadMore', () => {
  it('tells the reader what a press will do AND where they are', () => {
    const html = renderToStaticMarkup(<LoadMore list={list()} label="users" />);
    expect(html).toContain('Load 12 more');
    expect(html).toContain('Showing 12 of 5,000 users');   // Indian grouping
    expect(html).toContain('Show all 5,000');
  });

  it('renders NOTHING when the list is complete', () => {
    expect(renderToStaticMarkup(<LoadMore list={list({ hasMore: false, remaining: 0 })} />)).toBe('');
  });

  it('offers only what is actually left — never "load 12 more" above 4 rows', () => {
    const html = renderToStaticMarkup(<LoadMore list={list({ remaining: 4, total: 16 })} />);
    expect(html).toContain('Load 4 more');
    expect(html).toContain('Showing 12 of 16');
  });

  it('🔴 inside a table it is a ROW, not a div — a div in <tbody> is hoisted out by the browser', () => {
    const html = renderToStaticMarkup(<LoadMore list={list()} label="codes" colSpan={6} />);
    expect(html.startsWith('<tr>')).toBe(true);
    // React's server renderer emits the JSX spelling; the DOM normalises it. Asserted
    // case-insensitively so this pins the STRUCTURE (a real <tr><td> row) rather than a renderer detail.
    expect(html.toLowerCase()).toContain('colspan="6"');
  });

  it('and outside one it is a plain div', () => {
    expect(renderToStaticMarkup(<LoadMore list={list()} />).startsWith('<div')).toBe(true);
  });

  it('"Show all" can be withheld where the full list would be enormous', () => {
    const html = renderToStaticMarkup(<LoadMore list={list()} allowShowAll={false} />);
    expect(html).not.toContain('Show all');
    expect(html).toContain('Load 12 more');
  });

  it('the button says out loud how many are hidden, for a screen reader', () => {
    expect(renderToStaticMarkup(<LoadMore list={list()} label="apps" />))
      .toContain('aria-label="Load 12 more apps. 4,988 still hidden."');
  });
});
