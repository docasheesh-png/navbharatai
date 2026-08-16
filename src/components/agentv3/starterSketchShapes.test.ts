import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { sketchFor, unmappedStarterIds, usedShapes } from './starterSketchShapes';
import { STARTER_TEMPLATES } from './starterTemplates';

/**
 * Starter layout sketches (ROADMAP #1 Phase 3.4).
 *
 * The point of these tests is the promise the feature makes. A screenshot of each template's output
 * would be the obvious thing to show and we do not have one — so this shows the SHAPE of the app and
 * says so. If the wording ever drifts to "preview" it becomes a claim about output we cannot back up.
 */
describe('every starter has a shape, and it is chosen not guessed', () => {
  it('covers every template in the library', () => {
    // A new template added without a shape would fall back to 'list' and silently mislabel itself.
    expect(unmappedStarterIds()).toEqual([]);
  });

  it('gives visually distinct shapes to templates that look nothing alike', () => {
    expect(sketchFor({ id: 'todo' })).toBe('list');
    expect(sketchFor({ id: 'saas-dashboard' })).toBe('dashboard');
    expect(sketchFor({ id: 'store' })).toBe('grid');
    expect(sketchFor({ id: 'kanban' })).toBe('board');
    expect(sketchFor({ id: 'calculator' })).toBe('keypad');
    expect(sketchFor({ id: 'social-feed' })).toBe('feed');
  });

  it('separates screen STRUCTURE from the category, because they disagree', () => {
    // Invoicing and a CRM are both "Business" and look nothing alike — which is exactly why the
    // shape is written per template instead of derived from the category.
    const invoicing = STARTER_TEMPLATES.find((t) => t.id === 'invoicing');
    const crm = STARTER_TEMPLATES.find((t) => t.id === 'crm');
    expect(invoicing?.category).toBe(crm?.category);
    expect(sketchFor({ id: 'invoicing' })).not.toBe(sketchFor({ id: 'crm' }));
  });

  it('falls back rather than throwing on an unknown id', () => {
    expect(sketchFor({ id: 'not-a-template' })).toBe('list');
    expect(sketchFor({ id: '' })).toBe('list');
  });
});

describe('no dead drawing code', () => {
  it('every shape the component can draw is used by at least one template', () => {
    const component = readFileSync(join(__dirname, 'StarterSketch.tsx'), 'utf8');
    const drawn = [...component.matchAll(/case '([a-z]+)':/g)].map((m) => m[1]);
    const used = usedShapes();
    for (const shape of drawn) {
      expect(used, `the component draws '${shape}' but no template uses it`).toContain(shape);
    }
  });
});

describe('the sketch never claims to be a screenshot', () => {
  const component = readFileSync(join(__dirname, 'StarterSketch.tsx'), 'utf8');
  const panel = readFileSync(join(__dirname, 'AgentV3Panel.tsx'), 'utf8');

  it('calls itself a layout sketch, in the words the user actually sees', () => {
    expect(component).toContain('Layout sketch');
  });

  it('never shows the user the word "preview" or "screenshot"', () => {
    // Either word turns a diagram into a claim about what the built app will look like. Checked
    // against the USER-VISIBLE strings only: the file's comments use both words precisely to explain
    // why this is not one, and that reasoning is the thing most worth keeping.
    const visible = [...component.matchAll(/title="([^"]*)"|>([^<>{}]+)</g)]
      .map((m) => (m[1] ?? m[2] ?? '').trim())
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    expect(visible).toContain('layout sketch');
    expect(visible).not.toMatch(/\bpreview\b|\bscreenshot\b/);
  });

  it('draws with plain elements — no image, so nothing can be a fake render', () => {
    expect(component).not.toMatch(/<img|background-image|url\(/);
  });

  it('is decoration beside a real label, so it is hidden from screen readers', () => {
    expect(component).toContain('aria-hidden');
    // The card still carries the template's name and category as text.
    expect(panel).toContain('{t.category}');
  });
});
