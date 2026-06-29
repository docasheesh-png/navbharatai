import { describe, it, expect } from 'vitest';
import { buttonClasses, badgeClasses, cardClasses, inputClasses } from '../src/components/ui/variants';

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

describe('variants — badgeClasses', () => {
  it('maps each status to its colour', () => {
    expect(badgeClasses('success')).toContain('emerald');
    expect(badgeClasses('danger')).toContain('red');
    expect(badgeClasses('warning')).toContain('amber');
    expect(badgeClasses('info')).toContain('indigo');
    expect(badgeClasses()).toContain('text-[#c9d1d9]'); // neutral default
  });
});

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
