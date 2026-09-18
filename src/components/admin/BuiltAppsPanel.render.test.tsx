import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuiltAppsPanel } from './BuiltAppsPanel';

/**
 * The panel's first paint, before any page has arrived (effects do not run in a static render). It
 * must promise exactly what it does — every user's built app, twelve at a time, a preview per row —
 * and it must NOT claim a count it has not read.
 */
describe('BuiltAppsPanel renders', () => {
  const html = renderToStaticMarkup(
    <BuiltAppsPanel
      headers={{ 'x-admin-token': 't', 'Content-Type': 'application/json' }}
      openAccount={() => {}}
      toast={() => {}}
      onModerate={() => {}}
      moderated={null}
    />,
  );

  it('names what it lists and how it pages', () => {
    expect(html).toContain('Built apps');
    expect(html).toContain('published or not');
    expect(html).toContain('12 at a time');
  });

  it('explains the three actions, and that a preview never wakes the owner&#x27;s machine', () => {
    expect(html).toContain('Preview');
    expect(html).toContain('Unpublish');
    expect(html).toContain('Ban');
    expect(html).toContain('without waking its owner');
  });

  it('shows NO count and NO empty-state before the first page has been read', () => {
    // "0 loaded" or "No built apps yet" before a read would report a failed or pending read as an
    // empty registry — the moderation screen's worst lie.
    expect(html).not.toContain('loaded');
    expect(html).not.toContain('No built apps yet');
  });

  it('offers the search and the state filter from the first frame', () => {
    expect(html).toContain('App id, owner uid or link');
    expect(html).toContain('All built apps');
    expect(html).toContain('Live only');
    expect(html).toContain('Banned');
  });
});
