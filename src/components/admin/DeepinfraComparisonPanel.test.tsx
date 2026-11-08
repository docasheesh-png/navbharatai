import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DeepinfraComparisonPanel } from './DeepinfraComparisonPanel';
import { readFileSync } from 'node:fs';
describe('DeepInfra comparison admin panel', () => {
  it('starts without inference, a ready claim, fabricated measurements or exposed credentials', () => {
    const html = renderToStaticMarkup(<DeepinfraComparisonPanel adminToken="private-admin-session" />);
    expect(html).toContain('DeepInfra'); expect(html).toContain('same six small, synthetic checks');
    expect(html).toContain('not a full app-building benchmark'); expect(html).toContain('never switch your production model');
    expect(html).toContain('up to $2'); expect(html).toContain('Run paid comparison once'); expect(html).toContain('disabled');
    expect(html).not.toContain('private-admin-session'); expect(html).not.toContain('All checks attempted');
  });
  it('is available beside the existing Free Chat controls in the admin panel', () => {
    const source = readFileSync('src/components/AdminDashboard.tsx', 'utf8');
    expect(source).toContain('<DeepinfraComparisonPanel adminToken={adminToken} />');
  });
});
