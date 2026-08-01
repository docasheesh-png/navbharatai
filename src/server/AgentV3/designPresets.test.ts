import { describe, it, expect } from 'vitest';
import { DESIGN_PALETTES, pickPaletteForPrompt, palettePromptBlock } from './designPresets';

const HEX = /^#[0-9a-fA-F]{6}$/;

describe('DESIGN_PALETTES — all valid, saturated (never grey), white accent text', () => {
  it('every palette has valid 6-digit hexes and a white accent foreground', () => {
    expect(DESIGN_PALETTES.length).toBeGreaterThanOrEqual(5);
    for (const p of DESIGN_PALETTES) {
      for (const v of [p.accent, p.accentHover, p.accentFg, p.accentSoft]) expect(v, `${p.name}:${v}`).toMatch(HEX);
      expect(p.accentFg.toLowerCase()).toBe('#ffffff');
      // Not grey/black: the accent's R/G/B are not all near-equal (a real hue).
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(p.accent.slice(i, i + 2), 16));
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      expect(spread, `${p.name} must be a saturated hue`).toBeGreaterThan(30);
    }
  });
});

describe('pickPaletteForPrompt — domain → fitting palette', () => {
  it('maps real domain prompts to the designer choice', () => {
    expect(pickPaletteForPrompt('build a hospital management app').name).toBe('Teal');
    expect(pickPaletteForPrompt('a personal finance / budgeting app').name).toBe('Emerald');
    expect(pickPaletteForPrompt('restaurant menu and food delivery').name).toBe('Amber');
    expect(pickPaletteForPrompt('an online course / education platform').name).toBe('Sky');
    expect(pickPaletteForPrompt('an ecommerce store with a cart').name).toBe('Violet');
  });
  it('defaults to Indigo for a generic or empty prompt', () => {
    expect(pickPaletteForPrompt('a simple app').name).toBe('Indigo');
    expect(pickPaletteForPrompt('').name).toBe('Indigo');
    expect(pickPaletteForPrompt(undefined).name).toBe('Indigo');
    expect(pickPaletteForPrompt(null).name).toBe('Indigo');
  });
});

describe('palettePromptBlock — advisory block carries the exact accent hexes', () => {
  it('names the palette and gives the CSS accent variables', () => {
    const block = palettePromptBlock(pickPaletteForPrompt('hospital app'));
    expect(block).toContain('Teal');
    expect(block).toContain('--accent: #0d9488');
    expect(block).toContain('--accent-hover:');
    expect(block).toMatch(/WCAG/i);
  });
});
