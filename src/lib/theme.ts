/**
 * The theme system's one vocabulary (theme replacement, PR B — admin 2026-09-18).
 *
 * THREE themes, not five. The 2026-09-18 audit (72 screens × 5 themes, every text node measured)
 * found Comfort failing on 84 of 84 screens and Dim adding nothing Dark did not already do — two
 * more palettes to keep readable, with no reader they served. So: Light, Dark, and High contrast.
 * A saved `dim` becomes `dark` and a saved `comfort` becomes `light` (`normalizeThemeMode`), so a
 * returning user lands on the nearest theme rather than on a value nothing recognises.
 *
 * WHAT IS DELIBERATELY GONE: `getThemeClasses`. It handed every caller a bag of hardcoded colour
 * literals per theme (`bg-[#0d1117]`, `text-[#657b83]`, …) — the exact class of literal that
 * `tests/themeTokensOnly.test.ts` now ratchets to zero. Colour comes from the semantic tokens
 * (`bg-surface`, `text-body`, `bg-card`, `border-line`, …) that `index.css` maps per
 * `html[data-theme]`; a component needs no JavaScript to know which theme it is in.
 */
export type ThemeMode = 'light' | 'dark' | 'contrast';

export const THEME_MODES: { label: string; value: ThemeMode }[] = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
  { label: 'High contrast', value: 'contrast' },
];

/** The two retired themes and the theme each one's users are carried to. */
export const LEGACY_THEME_MAP: Readonly<Record<string, ThemeMode>> = {
  dim: 'dark',      // a second dark palette — Dark is what it was for
  comfort: 'light', // a cream light palette — Light is what it was for
};

export function isThemeMode(v: unknown): v is ThemeMode {
  return v === 'light' || v === 'dark' || v === 'contrast';
}

/**
 * Turn whatever storage holds into a live theme, or `null` when it holds nothing usable.
 * Legacy names map to their successor; anything else (an empty string, a typo, a value from a
 * build that never existed) is `null`, so the caller falls back to the system preference rather
 * than stamping `data-theme="sepia"` on the document and getting the default palette by accident.
 */
export function normalizeThemeMode(raw: string | null | undefined): ThemeMode | null {
  if (!raw) return null;
  const v = raw.trim();
  if (isThemeMode(v)) return v;
  return LEGACY_THEME_MAP[v] ?? null;
}
