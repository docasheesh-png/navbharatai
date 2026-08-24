import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from './Button';
import { Input, Select } from './Input';
import { Skeleton, SkeletonText, SkeletonCard, SkeletonList, SkeletonGrid, SkeletonTree } from './Skeleton';

/**
 * P-TQA.2 — Visual / structural regression for the shared UI primitives.
 *
 * Renders each primitive to STATIC HTML with `react-dom/server` (already a dependency — no Playwright,
 * no browser, no flakiness) and snapshots the markup. A CSS-class / structure / variant change that
 * unit tests don't catch will flip the snapshot, so a visual regression is surfaced in the normal CI.
 * Deterministic: the rendered class strings come from the single-source-of-truth variant resolvers.
 * Update intentionally with `vitest -u` when a visual change is deliberate.
 */
describe('UI primitives — visual/structural regression (static markup snapshots)', () => {
  it('Button variants × sizes', () => {
    const html = (['primary', 'secondary', 'ghost', 'danger'] as const)
      .flatMap((variant) => (['sm', 'md', 'lg'] as const).map((size) =>
        renderToStaticMarkup(<Button variant={variant} size={size}>Click</Button>)))
      .join('\n');
    expect(html).toMatchSnapshot();
  });



  it('Input + Select (valid + invalid)', () => {
    const html = [
      renderToStaticMarkup(<Input placeholder="name" />),
      renderToStaticMarkup(<Input invalid placeholder="bad" />),
      renderToStaticMarkup(<Select><option>a</option></Select>),
    ].join('\n');
    expect(html).toMatchSnapshot();
  });



  it('Skeleton family', () => {
    const html = [
      renderToStaticMarkup(<Skeleton className="h-4 w-20" />),
      renderToStaticMarkup(<SkeletonText lines={2} />),
      renderToStaticMarkup(<SkeletonCard />),
      renderToStaticMarkup(<SkeletonList count={2} />),
      renderToStaticMarkup(<SkeletonGrid count={2} />),
      renderToStaticMarkup(<SkeletonTree rows={3} />),
    ].join('\n');
    expect(html).toMatchSnapshot();
  });
});
