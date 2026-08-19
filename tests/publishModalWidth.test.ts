import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Admin 2026-08-19: *"publish button press karne par jo tab khulta hai, woh mobile phone jaisa feel de
 * raha hai — bas isko desktop jaisa kar do agar user desktop par hai to; phone par hai to phone jaisa
 * (already theek hai)."*
 *
 * The Publish dialog was capped at `max-w-lg` (512px) at EVERY breakpoint, so a 1920px desktop got a
 * phone-width dialog: four content-rich cards squeezed into two narrow columns, labels wrapping, and
 * vertical scrolling for content that had room to sit side by side.
 *
 * A CSS class is not worth a rendering test, but the INTENT is worth pinning — the failure mode here
 * is somebody "tidying" the class list back to a single width and nobody noticing until a screenshot.
 */
const src = readFileSync(join(__dirname, '..', 'src/components/agentv3/HostingChooser.tsx'), 'utf8');

describe('the Publish dialog is desktop-sized on desktop', () => {
  it('widens at lg, instead of staying phone-width everywhere', () => {
    expect(src).toContain('max-w-lg lg:max-w-4xl');
  });

  it('KEEPS the phone width — the admin said phone was already right', () => {
    // The fix must be additive. Replacing the base width would have "fixed" desktop by breaking the
    // one surface that was not broken.
    expect(src).toMatch(/className="w-full max-w-lg lg:/);
  });

  it('still caps its height, so a long list scrolls inside the dialog and not the page', () => {
    expect(src).toContain('max-h-[85vh]');
  });

  it('the cards still go two-up once there is room for them', () => {
    // Width alone does nothing if the grid stays single-column.
    expect(src).toContain('sm:grid-cols-2');
  });
});
