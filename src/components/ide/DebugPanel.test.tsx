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

  it('ships NO run controls at all — not even disabled ones', () => {
    // It used to render Continue / Step over / Step into / Pause permanently disabled. That was honest
    // about live debugging not existing, but four greyed-out buttons still read as a BROKEN feature
    // rather than an unbuilt one — and since Debug became a footer tab they are the first thing a user
    // sees. The honest state is a sentence, not a row of controls nobody can press.
    const html = renderToStaticMarkup(
      <DebugPanel breakpoints={{}} onClose={noop} onJumpToBreakpoint={noop} onClearBreakpoint={noop} onClearAll={noop} />,
    );
    expect(html).not.toContain('disabled');
    expect(html).not.toContain('cursor-not-allowed');
    // …but it still SAYS so plainly, so nobody hunts for a stepper that does not exist.
    expect(html.toLowerCase()).toContain('not available yet');
    // The part that IS real stays real.
    expect(html.toLowerCase()).toContain('breakpoints');
  });
});
