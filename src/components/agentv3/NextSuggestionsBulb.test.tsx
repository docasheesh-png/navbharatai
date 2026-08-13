import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextSuggestionsBulb } from './NextSuggestionsBulb';

// The bulb must add NOTHING to the UI until there is something to suggest — no clutter below the composer.
// (A static render never runs the fetch effect, so suggestions stays empty → the component returns null.)
describe('NextSuggestionsBulb — invisible until it has ideas', () => {
  it('renders nothing when there are no suggestions yet', () => {
    const html = renderToStaticMarkup(
      <NextSuggestionsBulb workspaceId="agentv3-u1-s1" ready={false} onPick={() => {}} />,
    );
    expect(html).toBe('');
  });

  it('renders nothing when not ready or no workspace (never fetches on its own)', () => {
    expect(renderToStaticMarkup(<NextSuggestionsBulb ready onPick={() => {}} />)).toBe('');
    expect(renderToStaticMarkup(<NextSuggestionsBulb workspaceId="" ready onPick={() => {}} />)).toBe('');
  });
});
