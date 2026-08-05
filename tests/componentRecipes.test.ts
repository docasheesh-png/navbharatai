import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Component recipes (ROADMAP #1 Phase 3.2).
 *
 * The screens every app needs — a data table, an empty state, a dashboard shell, a hero, pricing, an
 * auth card, loading skeletons, a dialog — used to be re-invented by the model on every build, badly
 * and differently each time. They are written once in the scaffold stylesheet, and the builder prompt
 * points at them by name. These tests exist because the two halves are useless apart: a kit nothing
 * knows about is dead CSS, and a prompt naming classes that do not exist ships broken markup.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const css = read('src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProviderContents.ts');
const prompt = read('src/server/AgentV3/systemPrompt.ts');

/** Every class the prompt tells the model to use. */
const RECIPE_CLASSES = [
  'nb-table-wrap', 'nb-table', 'nb-num',
  'nb-empty', 'nb-empty-icon', 'nb-empty-title', 'nb-empty-text',
  'nb-shell', 'nb-sidebar', 'nb-nav-item', 'nb-topbar', 'nb-main',
  'nb-stats', 'nb-stat', 'nb-stat-label', 'nb-stat-value',
  'nb-hero', 'nb-hero-sub', 'nb-hero-actions',
  'nb-pricing', 'nb-plan', 'nb-plan-featured', 'nb-plan-price', 'nb-plan-cta',
  'nb-auth', 'nb-auth-card', 'nb-auth-sub',
  'nb-skeleton',
  'nb-modal-backdrop', 'nb-modal', 'nb-modal-title', 'nb-modal-actions',
  'nb-toolbar', 'nb-spacer',
];

describe('the kit and the prompt cannot drift apart', () => {
  it('every class the prompt names actually exists in the stylesheet', () => {
    // A prompt naming a class that is not there ships markup with no styles — an unstyled app that
    // looks like a build failure to the user.
    for (const cls of RECIPE_CLASSES) {
      expect(css, `.${cls} missing from the scaffold stylesheet`).toContain(`.${cls}`);
    }
  });

  it('every recipe is named in the prompt, or the model will never reach for it', () => {
    // Dead CSS is worse than no CSS: it is weight in every app for a screen nothing builds.
    for (const cls of RECIPE_CLASSES) {
      expect(prompt, `.${cls} exists but the prompt never mentions it`).toContain(cls);
    }
  });
});

describe('names are prefixed so they can coexist with Tailwind', () => {
  it('no recipe claims a bare utility name Tailwind also defines', () => {
    // `class="table"` in Tailwind sets `display: table`; a plain `.table` here would silently fight
    // it in any app that uses both, and one of them would quietly lose.
    for (const bare of ['\n.table ', '\n.table{', '\n.hero ', '\n.shell ', '\n.modal ', '\n.empty ']) {
      expect(css).not.toContain(bare);
    }
  });

  it('every recipe class carries the nb- prefix', () => {
    expect(RECIPE_CLASSES.every((c) => c.startsWith('nb-'))).toBe(true);
  });
});

describe('the recipes are actually usable on a phone and in the dark', () => {
  it('the dashboard shell collapses instead of leaving a fixed sidebar on a 390px screen', () => {
    expect(css).toContain('@media (max-width: 820px)');
    expect(css).toMatch(/\.nb-shell \{ grid-template-columns: 1fr; \}/);
  });

  it('a wide table scrolls INSIDE its box, so the page never scrolls sideways', () => {
    // The usual mobile-table defect: the whole page slides under the user's thumb.
    const wrap = css.slice(css.indexOf('.nb-table-wrap'), css.indexOf('.nb-table-wrap') + 200);
    expect(wrap).toContain('overflow-x: auto');
  });

  it('nothing hardcodes a colour that would break dark mode', () => {
    // The palette is already theme-aware; a literal hex inside a recipe would ignore it. The modal
    // backdrop is the deliberate exception — a scrim is a fixed dim over the page in both themes.
    const start = css.indexOf('COMPONENT RECIPES');
    const block = css.slice(start, css.indexOf('.nb-stat-value'));
    const hexes = block.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexes).toEqual([]);
  });

  it('the shimmer stops for a reader who asked the system for less motion', () => {
    // The animation is decoration, not information, so honouring the preference costs nothing.
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/prefers-reduced-motion[\s\S]{0,120}\.nb-skeleton \{ animation: none; \}/);
  });
});

describe('the prompt says WHY, not just what — the part that changes model behaviour', () => {
  it('tells the model an empty state is required, and why a blank panel is a defect', () => {
    expect(prompt).toContain('a blank panel reads as BROKEN');
  });

  it('asks for skeletons shaped like the content instead of a bare spinner', () => {
    expect(prompt).toContain('NOT a bare spinner');
  });

  it('says to extend the kit rather than fall back to unstyled markup', () => {
    expect(prompt).toContain('never drop back to unstyled markup');
  });
});
