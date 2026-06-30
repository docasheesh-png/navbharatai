import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProductTour, DEFAULT_TOUR_STEPS } from './ProductTour';

/** P-UX.4 — Product Tour. Static-render smoke + step-config sanity (pure). */

describe('ProductTour', () => {
  it('renders a subtle launcher button initially (not the overlay)', () => {
    const html = renderToStaticMarkup(<ProductTour />);
    expect(html).toContain('Take a quick product tour'); // aria-label
    expect(html).toContain('Tour');
    // Overlay (role=dialog) is not shown until the user starts the tour.
    expect(html).not.toContain('role="dialog"');
  });

  it('ships the 5 documented steps, each targeting a data-tour selector', () => {
    expect(DEFAULT_TOUR_STEPS).toHaveLength(5);
    const sels = DEFAULT_TOUR_STEPS.map((s) => s.selector);
    expect(sels).toEqual([
      '[data-tour="sidebar"]',
      '[data-tour="chat"]',
      '[data-tour="preview"]',
      '[data-tour="deploy"]',
      '[data-tour="billing"]',
    ]);
    // Every step has a title + body, and the v3/billing steps declare the view they live in.
    for (const s of DEFAULT_TOUR_STEPS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(0);
    }
    expect(DEFAULT_TOUR_STEPS.find((s) => s.selector.includes('chat'))?.view).toBe('nbi_pro_chat');
    expect(DEFAULT_TOUR_STEPS.find((s) => s.selector.includes('billing'))?.view).toBe('billing');
  });
});
