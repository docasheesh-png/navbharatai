import { describe, it, expect } from 'vitest';
import { buttonClasses, cardClasses, inputClasses } from '../src/components/ui/variants';

/** P-DESIGN.1 — UI primitive variant resolvers (pure). */

describe('variants — buttonClasses', () => {
  it('defaults to primary/md', () => {
    const c = buttonClasses();
    expect(c).toContain('bg-indigo-600'); // primary
    expect(c).toContain('px-3.5'); // md
    expect(c).toContain('disabled:opacity-40'); // base state
  });
  it('applies variant and size', () => {
    expect(buttonClasses('danger', 'lg')).toContain('bg-red-600');
    expect(buttonClasses('danger', 'lg')).toContain('px-5');
    expect(buttonClasses('ghost', 'sm')).toContain('bg-transparent');
    expect(buttonClasses('ghost', 'sm')).toContain('px-2.5');
  });
  it('falls back gracefully for an unknown variant/size', () => {
    // @ts-expect-error — exercising the runtime fallback
    expect(buttonClasses('bogus', 'huge')).toContain('bg-indigo-600');
  });
});


// badgeClasses was removed with the unused Badge component on 2026-08-24; cardClasses stays
// because two live panels (ProjectInsightsPanel, GalleryPanel) use the resolver directly even
// though Card.tsx itself went.
describe('variants — cardClasses / inputClasses', () => {
  it('card uses the shared surface token', () => {
    expect(cardClasses()).toContain('bg-[#161b22]');
    expect(cardClasses()).toContain('rounded-2xl');
  });
  it('input reflects validity', () => {
    expect(inputClasses(false)).toContain('border-zinc-700');
    expect(inputClasses(true)).toContain('border-red-500/60');
  });
});
