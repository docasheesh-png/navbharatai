import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DebugPanel } from './DebugPanel';

/** P-DEV.3 — DebugPanel static-render smoke. */

const noop = () => {};

describe('DebugPanel', () => {
  it('lists real breakpoints (file:line)', () => {
    const html = renderToStaticMarkup(
      <DebugPanel breakpoints={{ 'src/App.tsx': [12, 40] }} onClose={noop} onJumpToBreakpoint={noop} onClearBreakpoint={noop} onClearAll={noop} />,
    );
    expect(html).toContain('App.tsx');
    expect(html).toContain(':12');
    expect(html).toContain('Debugger');
  });

  it('shows an honest empty state when there are no breakpoints', () => {
    const html = renderToStaticMarkup(
      <DebugPanel breakpoints={{}} onClose={noop} onJumpToBreakpoint={noop} onClearBreakpoint={noop} onClearAll={noop} />,
    );
    expect(html).toContain('No breakpoints yet');
  });

  it('renders the run controls as disabled (no fake stepping)', () => {
    const html = renderToStaticMarkup(
      <DebugPanel breakpoints={{}} onClose={noop} onJumpToBreakpoint={noop} onClearBreakpoint={noop} onClearAll={noop} />,
    );
    expect(html).toContain('disabled');
    expect(html.toLowerCase()).toContain('live pause coming soon');
  });
});
