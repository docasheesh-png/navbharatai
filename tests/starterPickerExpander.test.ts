import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  STARTER_TEMPLATES, partitionStarters, pickerSections, startersByCategory,
} from '../src/components/agentv3/starterTemplates';

/**
 * "More templates" — the fix for the WALL, not for the count (admin 2026-09-12).
 *
 * I had proposed deleting two chips to shorten the picker and then argued against my own suggestion: the
 * problem was never that there are thirty-odd starters, it is that thirty-odd pills on a phone is eight
 * or nine lines of chips above the composer, and a wall is something a first-time user scrolls past
 * rather than chooses from. Deleting two turns nine lines into eight — no user feels that, and whoever
 * wanted the chip that went is simply worse off. A short first screen plus one expander fixes the wall
 * and keeps every capability.
 *
 * Which creates exactly one way for this to go wrong, and it is the thing every test here guards: a
 * chip that is in NEITHER half is silently unreachable, with no error and nothing on screen to notice.
 */
describe('pickerSections — collapsing can never hide a chip permanently', () => {
  for (const unlocked of [true, false]) {
    const label = unlocked ? 'an unlocked user' : 'a free user';
    const { tappable } = partitionStarters(unlocked);

    it(`${label}: initial + more is EXACTLY the tappable library, with nothing lost or duplicated`, () => {
      const { initial, more } = pickerSections(tappable);
      const all = initial.concat(more).map((t) => t.id);
      expect(all).toHaveLength(tappable.length);
      expect(new Set(all).size).toBe(tappable.length);
      expect(new Set(all)).toEqual(new Set(tappable.map((t) => t.id)));
    });

    it(`${label}: the first screen is short but never sparse`, () => {
      const { initial } = pickerSections(tappable, 12);
      expect(initial.length).toBe(Math.min(12, tappable.length));
    });

    it(`${label}: there is genuinely something behind the expander, or it would be a dead control`, () => {
      // If the library ever shrinks below the limit the button must not render — the panel already
      // guards on more.length, and this is the assertion that keeps the premise true.
      const { more } = pickerSections(tappable, 12);
      expect(more.length).toBeGreaterThan(0);
    });
  }

  it('a chip nobody remembered to mark `featured` lands in MORE, never nowhere', () => {
    // The realistic future mistake: someone adds a starter and forgets the flag. It must still be
    // reachable, which is why `more` is a complement rather than its own hand-written list.
    const extra = { id: 'zz-unmarked', label: 'Unmarked', icon: '🧪', category: 'Personal' as const, tier: 'simple' as const, prompt: 'x' };
    const { initial, more } = pickerSections(STARTER_TEMPLATES.concat([extra]), 12);
    expect(initial.concat(more).map((t) => t.id)).toContain('zz-unmarked');
    expect(more.map((t) => t.id)).toContain('zz-unmarked');
  });

  it('a featured chip beyond the limit is pushed into MORE rather than dropped', () => {
    const many = STARTER_TEMPLATES.map((t) => ({ ...t, featured: true }));
    const { initial, more } = pickerSections(many, 5);
    expect(initial).toHaveLength(5);
    expect(initial.length + more.length).toBe(many.length);
  });

  it('limit 0 is degenerate but still loses nothing', () => {
    const { initial, more } = pickerSections(STARTER_TEMPLATES, 0);
    expect(initial).toHaveLength(0);
    expect(more).toHaveLength(STARTER_TEMPLATES.length);
  });

  it('the first screen stays in category order, so related apps still sit together', () => {
    const { initial } = pickerSections(partitionStarters(true).tappable, 12);
    const featuredInOrder = startersByCategory(partitionStarters(true).tappable)
      .flatMap((g) => g.items).filter((t) => t.featured === true).slice(0, 12).map((t) => t.id);
    expect(initial.slice(0, featuredInOrder.length).map((t) => t.id)).toEqual(featuredInOrder);
  });
});

describe('the curation itself', () => {
  it('enough SIMPLE starters are featured that a free user s first screen is mostly curated', () => {
    // A free user only sees the `simple` half, so featuring only pro showcases would leave their first
    // screen entirely to the top-up path — i.e. to array order, which is the accident this avoids.
    const featuredSimple = STARTER_TEMPLATES.filter((t) => t.featured && t.tier === 'simple');
    expect(featuredSimple.length).toBeGreaterThanOrEqual(8);
  });

  it('no more than twelve are featured, or the expander hides curated chips instead of the long tail', () => {
    expect(STARTER_TEMPLATES.filter((t) => t.featured).length).toBeLessThanOrEqual(12);
  });

  it('every featured chip has a golden scaffold — the first screen is a first impression', async () => {
    const { GOLDEN_SCAFFOLDS } = await import('../src/server/AgentV3/goldenScaffolds/registry');
    const ids = GOLDEN_SCAFFOLDS.map((g) => g.id);
    for (const t of STARTER_TEMPLATES.filter((x) => x.featured)) expect(ids, t.id).toContain(t.id);
  });
});

describe('the panel is actually wired to it', () => {
  const panel = readFileSync(join(__dirname, '..', 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');

  it('renders the split, not the whole list', () => {
    expect(panel).toContain('pickerSections(starterTappable)');
    expect(panel).toContain('{starterShown.map((t) => (');
  });

  it('the expander exists, is collapsed by default, and names how many it is hiding', () => {
    expect(panel).toContain('const [startersExpanded, setStartersExpanded] = useState(false)');
    expect(panel).toContain("'More templates ('");
    expect(panel).toContain('aria-expanded={startersExpanded}');
  });

  it('the expander is hidden when there is nothing behind it', () => {
    expect(panel).toContain('{starterMore.length > 0 && (');
  });

  it('the LOCKED pro showcases are untouched by the expander — they are a separate row', () => {
    // Folding the upgrade carrot into "More templates" would bury the one surface that earns revenue.
    const at = panel.indexOf('Unlock with Pro');
    expect(at).toBeGreaterThan(-1);
    expect(panel.slice(at - 600, at)).not.toContain('startersExpanded');
  });
});
