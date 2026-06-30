import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Breadcrumb } from './Breadcrumb';

/** P-UX.5 — Breadcrumb (pure presentational). */

describe('Breadcrumb', () => {
  it('renders each crumb and marks the last as current', () => {
    const html = renderToStaticMarkup(
      <Breadcrumb items={[{ label: 'Firestore' }, { label: 'users', onClick: () => {} }, { label: 'doc-1' }]} />,
    );
    expect(html).toContain('Firestore');
    expect(html).toContain('users');
    expect(html).toContain('doc-1');
    expect(html).toContain('aria-current="page"'); // the last crumb
  });

  it('makes earlier crumbs with onClick interactive (button), last is not', () => {
    const html = renderToStaticMarkup(
      <Breadcrumb items={[{ label: 'a', onClick: () => {} }, { label: 'b', onClick: () => {} }]} />,
    );
    // exactly one <button> — the last crumb is never a button even with onClick
    expect((html.match(/<button/g) || []).length).toBe(1);
  });

  it('renders nothing for empty/whitespace items', () => {
    expect(renderToStaticMarkup(<Breadcrumb items={[]} />)).toBe('');
    expect(renderToStaticMarkup(<Breadcrumb items={[{ label: '' }]} />)).toBe('');
  });
});
