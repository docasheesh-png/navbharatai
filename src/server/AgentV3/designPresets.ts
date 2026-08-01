// AgentV3 — curated design palettes (M2-S2.2, design system).
//
// A weak/cheap model, left to itself, either reuses the one scaffold accent (every app looks the same)
// or picks clashing colours. This module gives the build a small set of hand-tuned, WCAG-AA-checked
// palettes and a pure domain→palette picker, so a FRESH build gets a professional colour scheme that
// FITS the app's domain (a hospital reads calm teal, a restaurant warm amber, a bank deep green) instead
// of always-indigo or a random guess. Injected into the build prompt as an advisory block — the model
// may use it verbatim in :root or design its own with equal contrast. Pure + unit-tested; never throws.

export interface DesignPalette {
  /** Human name (for the prompt block + telemetry). */
  name: string;
  /** Saturated brand hue — the primary/CTA colour. */
  accent: string;
  /** A darker accent for hover. */
  accentHover: string;
  /** Text colour ON the accent (almost always white). */
  accentFg: string;
  /** A very light accent tint for soft backgrounds. */
  accentSoft: string;
}

/** Six professional, contrast-checked palettes. accentFg is white everywhere (all accents are dark enough). */
export const DESIGN_PALETTES: readonly DesignPalette[] = [
  { name: 'Indigo',  accent: '#4f46e5', accentHover: '#4338ca', accentFg: '#ffffff', accentSoft: '#eef0ff' },
  { name: 'Teal',    accent: '#0d9488', accentHover: '#0f766e', accentFg: '#ffffff', accentSoft: '#e6fffb' },
  { name: 'Emerald', accent: '#059669', accentHover: '#047857', accentFg: '#ffffff', accentSoft: '#e7fbf1' },
  { name: 'Violet',  accent: '#7c3aed', accentHover: '#6d28d9', accentFg: '#ffffff', accentSoft: '#f3ecff' },
  { name: 'Amber',   accent: '#d97706', accentHover: '#b45309', accentFg: '#ffffff', accentSoft: '#fff3e0' },
  { name: 'Sky',     accent: '#0284c7', accentHover: '#0369a1', accentFg: '#ffffff', accentSoft: '#e6f4ff' },
] as const;

const byName = (n: string): DesignPalette => DESIGN_PALETTES.find((p) => p.name === n) ?? DESIGN_PALETTES[0];

/**
 * Domain → palette. Each entry is a keyword list (matched case-insensitively against the prompt) mapped
 * to the palette a designer would reach for in that domain. First match wins; no match → Indigo (a safe,
 * universally-professional default). Ordered most-specific first so e.g. "food" beats a generic match.
 */
const DOMAIN_RULES: ReadonlyArray<{ keywords: RegExp; palette: string }> = [
  { keywords: /\b(hospital|clinic|health|medical|doctor|patient|pharma|dental|wellness|therapy)\b/i, palette: 'Teal' },
  { keywords: /\b(bank|finance|fintech|invest|trading|wallet|payment|accounting|loan|budget|expense)\b/i, palette: 'Emerald' },
  { keywords: /\b(restaurant|food|cafe|menu|kitchen|recipe|dining|bakery|delivery|grocery)\b/i, palette: 'Amber' },
  { keywords: /\b(school|college|course|learn|education|study|student|teacher|exam|tutor|quiz)\b/i, palette: 'Sky' },
  { keywords: /\b(shop|store|ecommerce|e-commerce|cart|product|retail|marketplace|fashion|boutique)\b/i, palette: 'Violet' },
  { keywords: /\b(social|chat|community|feed|post|message|forum|network|dating)\b/i, palette: 'Indigo' },
  { keywords: /\b(travel|hotel|booking|flight|trip|tour|holiday)\b/i, palette: 'Sky' },
];

/** Pick the palette that best fits the app described by `prompt`. Pure; Indigo default on no match. */
export function pickPaletteForPrompt(prompt: string | undefined | null): DesignPalette {
  const text = String(prompt ?? '');
  for (const rule of DOMAIN_RULES) if (rule.keywords.test(text)) return byName(rule.palette);
  return byName('Indigo');
}

/**
 * The advisory prompt block that hands the build a domain-fit palette. Concise — it gives the exact
 * accent hexes and tells the model to use them in :root (alongside the neutral bg/fg/card the scaffold
 * already defines) or design its own with equal contrast. Pure.
 */
export function palettePromptBlock(palette: DesignPalette): string {
  return [
    `🎨 SUGGESTED PALETTE for this app — "${palette.name}" (professional, WCAG-AA contrast). Use these`,
    `accent variables in :root (keep the scaffold's neutral --bg/--fg/--card/--border), or design your own`,
    `with equal contrast — but the accent MUST be a real saturated hue, never grey:`,
    `  --accent: ${palette.accent}; --accent-hover: ${palette.accentHover}; --accent-fg: ${palette.accentFg}; --accent-soft: ${palette.accentSoft};`,
  ].join('\n');
}
