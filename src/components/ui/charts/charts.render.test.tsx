import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Donut } from './Donut';
import { BarChart } from './BarChart';
import { Sparkline } from './Sparkline';

/** P-DESIGN.4 — chart components render to valid SVG (static markup, no DOM). */

describe('chart components render', () => {
  it('Donut renders circles for each non-zero slice + centre content', () => {
    const html = renderToStaticMarkup(
      <Donut slices={[{ value: 3, color: '#10b981' }, { value: 1, color: '#ef4444' }]} center={<span>75%</span>} />,
    );
    expect(html).toContain('<svg');
    expect(html).toContain('stroke="#10b981"');
    expect(html).toContain('stroke="#ef4444"');
    expect(html).toContain('75%');
  });
  it('BarChart renders one rect per value', () => {
    const html = renderToStaticMarkup(<BarChart values={[1, 2, 3]} />);
    expect((html.match(/<rect/g) || []).length).toBe(3);
  });
  it('Sparkline renders a polyline; nothing for empty', () => {
    expect(renderToStaticMarkup(<Sparkline values={[1, 2, 3]} />)).toContain('<polyline');
    expect(renderToStaticMarkup(<Sparkline values={[]} />)).toBe('');
  });
});
