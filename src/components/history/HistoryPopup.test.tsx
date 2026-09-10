// The History popup CONTAINER. What matters here is that it is a container and stays one.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { renderToStaticMarkup } from 'react-dom/server';
import { HistoryPopup } from './HistoryPopup';

const src = readFileSync(join(__dirname, 'HistoryPopup.tsx'), 'utf8');
const appSrc = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8');

describe('HistoryPopup renders as an overlay, not a screen', () => {
  const html = renderToStaticMarkup(<HistoryPopup user={null} onClose={() => {}} />);

  it('is a real modal dialog a screen reader can announce and escape', () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Close history');
  });

  it('lies OVER the chat and never grows into a full page', () => {
    // The whole point of the request: you glance at the list and you are still in your conversation.
    expect(html).toContain('fixed inset-0');
    // 80% is still the design's height — it just moved from a raw `max-h-[80vh]` into the shared
    // clamp, so it can never exceed the room actually left once the app's tab bar is reserved
    // (admin 2026-09-06: the bar was covering the bottom of sheets like this one). See
    // tests/sheetOverlayGeometry.test.ts for the reservation itself.
    expect(html).toContain('--nb-sheet-cap:80dvh');
    expect(html).toContain('nb-sheet-partial');
  });

  it('reserves the app\'s own tab bar, which used to cover its bottom rows', () => {
    // z-130 is BELOW the nav's z-150, so without this the bar painted over the sheet — and the
    // sheet's scroll ended underneath it, so scrolling to the bottom did not help.
    expect(html).toContain('nb-sheet-overlay-flush');
  });

  it('renders the list itself, not an error, when signed out', () => {
    // HistoryView handles the signed-out state; the popup must not crash rendering it.
    expect(html.length).toBeGreaterThan(200);
  });
});

describe('it stays a container — the list and its tags are NOT reimplemented here', () => {
  it('delegates to the existing HistoryView', () => {
    expect(src).toContain("import { HistoryView }");
    expect(src).toContain('<HistoryView');
  });

  it('asks HistoryView for the merged, tagged Free list', () => {
    // The mode tag the admin asked for (Free / Doctor AI / each professional) already shipped on
    // 2026-08-25 in HistoryView, behind `includeProfessionals`. If this prop is ever dropped the
    // popup silently loses every tag while still rendering a perfectly good-looking list.
    expect(src).toContain('includeProfessionals');
    expect(src).toContain('initialFilter="free"');
  });

  it('carries no row-rendering or tag logic of its own', () => {
    // A second list would be a second set of bugs, and would drift the moment either side changed.
    expect(src).not.toContain('profName');
    expect(src).not.toContain('modeTag');
  });
});

describe('the two ways this breaks silently', () => {
  it('closes itself after a row is opened', () => {
    // Without this the chosen conversation loads UNDERNEATH a list still covering it: the user taps,
    // something happens, and they are looking at the same list.
    expect(src).toContain('closeAfter');
    expect(src).toContain('onRestoreSession={closeAfter(onRestoreSession)}');
    expect(src).toContain('onOpenProfessional={closeAfter(onOpenProfessional)}');
  });

  it('App.tsx gates the popup behind the SAME sign-in check as the tab', () => {
    // History is sign-in-only. The popup bypasses toggleTab (that is the point), so it must call the
    // shared gate rather than carry a second copy of the rule that can drift out of agreement.
    expect(appSrc).toContain('historySurfaceFor');
    expect(appSrc).toContain('<HistoryPopup');
    const btn = appSrc.slice(appSrc.indexOf('historySurfaceFor(activeView as string)'));
    expect(btn.slice(0, 900)).toContain("authGateDecision('history'");
  });

  it('App.tsx dismisses the popup when the view changes', () => {
    // A popup left hanging over the next screen is worse than one that never opened.
    expect(appSrc).toContain('useEffect(() => { setHistoryPopupOpen(false); }, [activeView]);');
  });
});
