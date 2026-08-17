import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * THE HEADER STACK MAY NOT GROW BACK, AND SHRINKING IT MAY NOT COST A CONTROL.
 *
 * Admin report 2026-08-17: on a phone the v5 preview gave roughly the top quarter of the screen to
 * three stacked header rows before the app itself got a pixel. Two of those rows were merged and the
 * rest were tightened.
 *
 * Compaction is the easy half. The half that silently goes wrong is what gets lost on the way: a
 * control that only rendered inside the row that was removed, or an honest cost marker that got
 * "shortened" out of existence on the exact screen size where it matters most. These pin both.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const panel = read('src/components/agentv3/AgentV3Panel.tsx');
const preview = read('src/components/agentv3/PreviewSurface.tsx');

/** The phone-only workspace header row: title + live progress + close, all on one line. */
const mobileHeader = (() => {
  const start = panel.indexOf('<div className="sm:hidden shrink-0 flex items-center gap-2 px-3 py-1');
  expect(start, 'the phone workspace header row is gone — did a refactor drop it?').toBeGreaterThan(-1);
  return panel.slice(start, panel.indexOf('</div>', panel.indexOf('Close workspace', start)) + 6);
})();

describe('the phone preview header is one row, not two', () => {
  it('puts the tab title, the live progress and the close button in a single row', () => {
    expect(mobileHeader).toContain('{tab}');
    expect(mobileHeader).toContain('WorkingIndicator');
    expect(mobileHeader).toContain('Close workspace');
  });

  it('keeps the desktop layout on its own row, untouched', () => {
    // The two-row layout was never the problem on a wide screen; only the phone was rewritten.
    expect(panel).toContain('<div className="hidden sm:flex shrink-0 items-center justify-between gap-2 px-3 py-1.5');
  });
});

describe('compaction did not cost the user a control', () => {
  it('the close button renders even when NOTHING is building', () => {
    // The strip this row absorbed was gated on `running || state.activity.length > 0`. If the close
    // button inherits that gate, a user who opens the workspace on an idle session has no way back to
    // chat — the row simply does not exist. So the gate must sit on the INDICATOR, never on the row.
    const gate = mobileHeader.indexOf('running || state.activity.length');
    const close = mobileHeader.indexOf('Close workspace');
    expect(gate, 'the progress indicator should still be conditional').toBeGreaterThan(-1);
    expect(close, 'the close button must not be inside the activity gate').toBeGreaterThan(gate);
    // …and the row itself opens before the gate, i.e. the gate cannot be wrapping it.
    expect(mobileHeader.indexOf('{tab}')).toBeLessThan(gate);
  });

  it('the close button is reachable by assistive tech, not just by sight', () => {
    expect(mobileHeader).toContain('aria-label="Close workspace"');
  });
});

describe('the honest cost marker survives every screen size', () => {
  it('the Paid tag on the Live-server toggle is never hidden at a breakpoint', () => {
    // "Live server" is shortened to "Live" on a phone to stop the toolbar wrapping. The Paid tag must
    // NOT be shortened away with it: the note next to it is dismissible, so this badge is the only
    // permanently visible statement that the live preview spends the user's credits. Hiding it on the
    // smallest screen would hide it from the users most likely to be surprised by a bill.
    const btn = preview.slice(preview.indexOf("onClick={() => setMode('live')}"));
    const tag = btn.indexOf('LIVE_SERVER_PAID_TAG');
    expect(tag).toBeGreaterThan(-1);
    const span = btn.lastIndexOf('<span', tag);
    expect(btn.slice(span, tag)).not.toMatch(/\bhidden\b/);
  });

  it('only the word "server" is dropped on a phone — the button still says Live', () => {
    const btn = preview.slice(preview.indexOf("onClick={() => setMode('live')}"), preview.indexOf('</button>', preview.indexOf("onClick={() => setMode('live')}")));
    expect(btn).toContain('Live<span className="hidden sm:inline">&nbsp;server</span>');
  });
});

describe('the product title no longer wraps to two lines on a phone', () => {
  it('shows a short title on small screens and the full one from lg up', () => {
    // The wrap cost more height than every padding value in that header combined. "NavBharatAI" is
    // already on the bar directly above, so the short form loses nothing the user cannot see.
    expect(panel).toContain('<span className="lg:hidden">Pro v5.0</span>');
    expect(panel).toContain('<span className="hidden lg:inline">NavBharatAI Pro v5.0</span>');
    expect(panel).toContain('font-semibold whitespace-nowrap');
  });

  it('the top header row is tighter on a phone and unchanged on desktop', () => {
    expect(panel).toContain('pt-1.5 pb-1.5 sm:pt-3 sm:pb-2');
  });
});
