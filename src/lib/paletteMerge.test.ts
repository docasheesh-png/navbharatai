import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isHexColor, normalizeHex, mergePalette, paletteSummary, type ColorToken } from './paletteMerge';

/**
 * Merging an AI palette into someone's existing design tokens.
 *
 * Every rule here protects work the user already has: their descriptions, their colours they did not
 * ask to change, and their app's CSS variables — which fail SILENTLY if a bad value reaches them.
 */

const base: ColorToken[] = [
  { name: 'primary', value: '#3b82f6', description: 'Buttons and links' },
  { name: 'accent', value: '#f59e0b', description: 'Highlights' },
];

describe('isHexColor / normalizeHex', () => {
  it('accepts the two forms a colour input and a CSS variable both understand', () => {
    expect(isHexColor('#abc')).toBe(true);
    expect(isHexColor('#AABBCC')).toBe(true);
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('  #AaBbCc ')).toBe('#aabbcc');
  });

  it('rejects everything else — a half-fixed colour is worse than none', () => {
    for (const bad of ['red', 'rgb(1,2,3)', '#12345', '#gggggg', '', null, undefined, 42, {}]) {
      expect(isHexColor(bad)).toBe(false);
      expect(normalizeHex(bad)).toBeNull();
    }
  });
});

describe('mergePalette — protects what the user already has', () => {
  it('updates a matching token and KEEPS its description', () => {
    // The user (or a previous build) wrote that description. A colour suggestion is not a reason to
    // lose it.
    const r = mergePalette(base, { primary: '#ff0000' });
    expect(r.tokens[0]).toEqual({ name: 'primary', value: '#ff0000', description: 'Buttons and links' });
    expect(r.updated).toEqual(['primary']);
  });

  it('matches by name case-insensitively, and keeps the ORIGINAL name', () => {
    const r = mergePalette(base, { Primary: '#ff0000' });
    expect(r.tokens[0].name).toBe('primary');
    expect(r.updated).toEqual(['primary']);
    expect(r.added).toEqual([]);
  });

  it('ADDS an unknown name rather than dropping half the answer', () => {
    const r = mergePalette(base, { surface: '#111111' });
    expect(r.added).toEqual(['surface']);
    expect(r.tokens.find((t) => t.name === 'surface')?.value).toBe('#111111');
  });

  it('REJECTS a malformed colour instead of writing it into a CSS variable', () => {
    // A `--color-x: not-a-colour` renders as nothing and fails silently in the user's real app.
    const r = mergePalette(base, { primary: 'cornflower', accent: '#00ff00' });
    expect(r.rejected).toEqual(['primary']);
    expect(r.tokens[0].value).toBe('#3b82f6'); // untouched
    expect(r.updated).toEqual(['accent']);
  });

  it('does not claim an update when the colour is already that value', () => {
    // Reporting "updated 1 colour" for a no-op teaches the user the message means nothing.
    expect(mergePalette(base, { primary: '#3B82F6' }).updated).toEqual([]);
  });

  it('never mutates the tokens it was given', () => {
    const before = JSON.parse(JSON.stringify(base));
    mergePalette(base, { primary: '#ff0000', surface: '#000000' });
    expect(base).toEqual(before);
  });

  it('an empty, null or junk palette changes nothing', () => {
    for (const p of [null, undefined, {}]) {
      const r = mergePalette(base, p);
      expect(r.tokens).toEqual(base);
      expect(r.updated).toEqual([]);
    }
  });

  it('an empty token list still accepts a palette — a fresh design system is not an error', () => {
    const r = mergePalette([], { primary: '#123456' });
    expect(r.added).toEqual(['primary']);
    expect(r.tokens).toHaveLength(1);
  });
});

describe('paletteSummary — says what really happened', () => {
  it('names the rejected colours rather than hiding a partial application', () => {
    const r = mergePalette(base, { primary: 'nope', accent: '#00ff00' });
    expect(paletteSummary(r)).toContain('1 could not be read');
    expect(paletteSummary(r)).toContain('Updated 1 colour');
  });

  it('says nothing changed when nothing changed', () => {
    expect(paletteSummary(mergePalette(base, { primary: '#3b82f6' }))).toContain('already match');
  });

  it('an all-rejected palette is reported as a failure, never as success', () => {
    const r = mergePalette(base, { primary: 'x', accent: 'y' });
    expect(paletteSummary(r)).toContain('No usable colours');
  });

  it('when colours DID change, it says they have not reached the app yet', () => {
    // The tokens live in this screen until the Export tab writes them into the real app, so this is
    // the moment a user could otherwise believe the change was saved. (The no-change branches say
    // nothing about saving, correctly — there is nothing to mistake for a save.)
    expect(paletteSummary(mergePalette(base, { primary: '#ff0000' }))).toContain('Nothing is saved to your app');
    expect(paletteSummary(mergePalette(base, { primary: '#3b82f6' }))).not.toContain('saved');
  });
});

/**
 * THE DOOR. `/api/design/palette` was live, authed and billed, and `DesignAdvisor.aiPalette` was
 * imported by exactly ONE file — the route itself. Same shape as the Render deploy engine nothing could
 * call (#2174). These lock the caller in place.
 */
describe('the Design System screen really calls the endpoint', () => {
  const screen = readFileSync(join(__dirname, '../components/ide/DesignSystem.tsx'), 'utf8');

  it('calls /api/design/palette through the shared authed fetch', () => {
    expect(screen).toContain("authedFetch('/api/design/palette'");
    expect(screen).not.toContain('getIdToken'); // auth lives in one place
  });

  it('merges through the tested helper rather than re-implementing the rules inline', () => {
    expect(screen).toContain('mergePalette(tokens.colors, data.palette.colors)');
    expect(screen).toContain('paletteSummary(merged)');
  });

  it('passes the SERVER\'s refusal through — an allowance or empty-wallet message names the next step', () => {
    expect(screen).toContain("data?.error ||");
  });

  it('a null palette is reported honestly, never as a silent no-op', () => {
    expect(screen).toContain('No palette came back this time');
  });

  it('the button cannot be fired twice or with an empty brand', () => {
    expect(screen).toContain('if (!description || paletteBusy) return;');
    expect(screen).toContain('disabled={paletteBusy || !brand.trim()}');
  });

  it('the spinner always stops, even when the call throws', () => {
    expect(screen).toContain('setPaletteBusy(false);');
    expect(screen).toContain('} finally {');
  });
});
