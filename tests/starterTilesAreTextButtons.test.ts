import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { startersByCategory, partitionStarters, STARTER_TEMPLATES } from '../src/components/agentv3/starterTemplates';

/**
 * ⚠️ THE COLD-START HELPER WAS PRODUCING THE COLD STARE IT EXISTS TO PREVENT (admin 2026-09-12).
 *
 * *"in tiles se user confused hota hai, ki sayad kuch load ho raha hai. in tiles ko hatao, bas simple
 * text button rahne do"* — with a screenshot of the empty-chat picker.
 *
 * Each starter was a CARD carrying a layout sketch: a few grey and indigo bars standing for "a list",
 * "a dashboard with a sidebar". The reasoning behind it was sound — a row of identical grey chips
 * cannot tell a to-do app from a CRM — and the outcome was not, because grey bars stacked in a card
 * ARE the universal visual language for a skeleton loader. On an empty chat, the one moment the picker
 * shows, a first-time user read the whole grid as "still loading" and waited instead of tapping.
 *
 * The replacement does not simply revert to the flat row the sketch was invented to fix: the starters
 * are grouped by category and keep their emoji, so a person hunting for a shop app still finds it —
 * by words, not by bars that imitate a spinner.
 */
const panel = readFileSync(join(__dirname, '..', 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');

describe('the starter picker is text buttons, not loading-shaped tiles', () => {
  it('the sketch component and its shape table are gone from the repo', () => {
    // Left in place they would be dead code that a later session could re-wire, reintroducing the bug.
    for (const f of ['src/components/agentv3/StarterSketch.tsx', 'src/components/agentv3/starterSketchShapes.ts']) {
      expect(existsSync(join(__dirname, '..', f))).toBe(false);
    }
  });

  it('nothing renders a sketch any more', () => {
    expect(panel).not.toContain('StarterSketch');
    expect(panel).not.toContain('starterSketchShapes');
  });

  it('starters render as pill buttons, not bordered cards stacked over a graphic', () => {
    const at = panel.indexOf('Or start from a template');
    expect(at).toBeGreaterThan(-1);
    const block = panel.slice(at, at + 2600);
    expect(block).toContain('rounded-full');       // a pill reads as a button
    expect(block).not.toContain('rounded-xl');     // the card shape is gone
    expect(block).toContain('{t.label}');
  });

  it('carries NOTHING but an emoji and the name — no caption, no category line, no description', () => {
    // Anything that is not the app's name gives the eye something to wait for, which is the whole bug.
    const at = panel.indexOf('Or start from a template');
    const block = panel.slice(at, at + 2800);
    const btn = block.slice(block.indexOf('<button'), block.indexOf('</button>'));
    expect(btn).toContain('{t.icon}');
    expect(btn).toContain('{t.label}');
    expect(btn).not.toContain('{t.category}');
  });

  it('still orders by category, so related apps sit together without a heading costing a pixel', () => {
    // The half the sketch got RIGHT: a flat row of identical chips makes a to-do app and a CRM look alike.
    const at = panel.indexOf('Or start from a template');
    const block = panel.slice(at, at + 2800);
    expect(block).toContain('startersByCategory(starterTappable).flatMap');
  });
});

describe('the label is button text, not a title', () => {
  it('every label is short enough to read as a button', () => {
    // "Stopwatch & timer" in a pill reads as a sentence; "Stopwatch" reads as something to press.
    for (const t of STARTER_TEMPLATES) {
      expect(t.label.length, `${t.id} label too long: ${t.label}`).toBeLessThanOrEqual(13);
      expect(t.label.split(/\s+/).length, `${t.id} has too many words: ${t.label}`).toBeLessThanOrEqual(2);
    }
  });

  it('no two starters share a label, or the picker shows the same button twice', () => {
    const labels = STARTER_TEMPLATES.map((t) => t.label.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('the RICH prompt is untouched — only the button text got shorter', () => {
    // Shortening the prompt would make the builds thinner, which is the opposite of the point.
    for (const t of STARTER_TEMPLATES) expect(t.prompt.length, t.id).toBeGreaterThan(120);
  });
});

describe('the grouping helper it now uses', () => {
  it('covers every tappable starter, losing none', () => {
    const { tappable } = partitionStarters(true);
    const grouped = startersByCategory(tappable).flatMap((g) => g.items);
    expect(grouped).toHaveLength(tappable.length);
    expect(new Set(grouped.map((t) => t.id))).toEqual(new Set(tappable.map((t) => t.id)));
  });

  it('emits no empty group — a free user sees headings only for categories they can actually use', () => {
    const { tappable } = partitionStarters(false);
    const groups = startersByCategory(tappable);
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) expect(g.items.length).toBeGreaterThan(0);
  });

  it('every starter carries an emoji, so a pill is never bare text', () => {
    for (const t of STARTER_TEMPLATES) expect(t.icon.trim().length).toBeGreaterThan(0);
  });
});
