import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdsPanel } from './AdsPanel';

/**
 * The Ads page's first paint, before the list has arrived (effects do not run in a static render). It must
 * promise exactly what the feature does, and it must NOT report a pending read as an empty list — "No ads
 * yet" over a read that has not finished would tell the admin nothing is running when something may be.
 */
describe('AdsPanel renders', () => {
  const html = renderToStaticMarkup(<AdsPanel headers={{ 'x-admin-token': 't', 'Content-Type': 'application/json' }} />);

  it('says what an ad is for, who never sees one, and that there is no outside network', () => {
    expect(html).toContain('your own products');
    expect(html).toContain('Paid accounts');
    expect(html).toContain('never see an ad');
    expect(html).toContain('Sponsored');
    expect(html).toContain('no outside ad network');
  });

  it('says a change is not instant', () => {
    expect(html).toContain('up to a minute');
  });

  it('offers a new ad, and a way to re-read', () => {
    expect(html).toContain('New ad');
    expect(html).toContain('Refresh the ads');
  });

  it('shows "Loading" — and NEITHER an empty-state nor a list — before the first read has finished', () => {
    expect(html).toContain('Loading ads');
    expect(html).not.toContain('No ads yet');
    expect(html).not.toContain('Turn off');
    expect(html).not.toContain('Could not load');
  });

  it('does not open the form until asked', () => {
    expect(html).not.toContain('Create ad');
    expect(html).not.toContain('Where it appears');
  });
});
