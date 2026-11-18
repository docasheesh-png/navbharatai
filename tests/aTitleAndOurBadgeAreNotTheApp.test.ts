// Autopsy 05eb30ba (2026-11-18): an ESM link error stopped the whole module graph — `#root` empty, no canvas,
// nothing to press — and the render verdict still said RENDERED, because the `<title>` and our own "Made with
// NavBharatAI" badge gave the page more than five characters of text. The class: text the APP did not put on
// the page was counted as the app's content.
import { describe, expect, it } from 'vitest';
import { analyzePreviewHtml, appVisibleText } from '../src/server/AgentV3/PreviewVerify';
import { BADGE_HTML } from '../src/server/lib/madeWithBadge';

const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>Apex AWD — 400 km/h Racing</title>
<meta name="description" content="Two racing games"></head><body>${body}
<script type="module" src="/src/main.tsx"></script>${BADGE_HTML}</body></html>`;

describe('the title and our own badge are not the app', () => {
  it('the real shape: empty root + title + badge, painted in a browser → NOT rendered', () => {
    const v = analyzePreviewHtml(page('<div id="root"></div>'), { source: 'browser', painted: true });
    expect(v.rendered).toBe(false);
    expect(v.inconclusive).toBeFalsy();
    expect(v.problems.join(' ')).toMatch(/root element is empty/);
  });

  it('the same page that never painted is inconclusive — never "rendered"', () => {
    const v = analyzePreviewHtml(page('<div id="root"></div>'), { source: 'browser', painted: false });
    expect(v.rendered).toBe(false);
    expect(v.inconclusive).toBe(true);
  });

  it('a mounted app with the same title and badge still renders', () => {
    const v = analyzePreviewHtml(page('<div id="root"><main><h1>Performance Garage</h1><canvas></canvas></main></div>'), { source: 'browser', painted: true });
    expect(v.rendered).toBe(true);
  });

  it('a static page whose content sits outside #root still renders', () => {
    const v = analyzePreviewHtml(page('<header><h1>Welcome to the clinic</h1></header><div id="root"></div>'), { source: 'browser', painted: true });
    expect(v.rendered).toBe(true);
  });

  it('appVisibleText drops head, title, noscript and the badge', () => {
    expect(appVisibleText(page('<noscript>Enable JavaScript to run this app.</noscript><div id="root"></div>'))).toBe('');
  });
});
