// The free chat's desktop History button (admin 2026-09-23). The wiring and its place in the row are
// asserted in tests/freeChatHistoryAndTightComposer.test.ts; this file renders the component itself.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HistoryButton } from './HistoryButton';

describe('HistoryButton', () => {
  it('renders nothing when there is no opener — the phone, where the bottom bar carries History', () => {
    expect(renderToStaticMarkup(<HistoryButton onOpen={undefined} />)).toBe('');
  });

  it('renders a real, labelled button when there is one', () => {
    const html = renderToStaticMarkup(<HistoryButton onOpen={() => {}} />);
    expect(html).toContain('<button');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Open chat history"');
    expect(html).toContain('History');
  });

  it('is the same height as the Mode button and the message box, so the row lines up', () => {
    expect(renderToStaticMarkup(<HistoryButton onOpen={() => {}} />)).toContain('h-12');
  });
});
