// U-4 (verified recipe modules) — URL slug generator (dependency-free, Unicode-aware).
//
// Blogs, product pages, docs and profiles all need a clean, stable URL slug ("My First Post!" →
// "my-first-post"). The naive `.replace(/[^a-z0-9]/g, '-')` throws away ALL non-Latin text — for a
// Hindi/Indic app that means a Devanagari title collapses to an empty slug. This recipe ships a real
// Unicode-aware slugifier: it keeps letters and numbers of ANY script (so "नमस्ते दुनिया" stays a real slug),
// lowercases, folds accents (café → cafe), turns every run of separators into a single hyphen, and trims —
// plus a collision-safe uniqueSlug() for when two titles clash. No dependency (native Intl/normalize), no
// env keys. PURE builder; correct and complete — no TODO stubs (the real-features rule). Unit-tested.

export interface SlugConfig {
  files: Record<string, string>;
  instructions: string;
}

const SLUG_SERVER = `// Turn any title into a clean, URL-safe slug. Unicode-aware: keeps letters/numbers of any script
// (Latin, Devanagari, …) so non-English titles produce a real slug instead of an empty string. Latin
// accents are folded (café → cafe); everything else is lowercased, and every run of spaces/punctuation
// becomes a single hyphen, with leading/trailing hyphens trimmed.
export function slugify(input: string, opts?: { maxLength?: number }): string {
  const maxLength = opts?.maxLength ?? 80;
  const slug = input
    .normalize('NFKD')
    // strip combining accent marks left behind by NFKD (so Latin letters de-accent), keep other scripts intact
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    // Replace anything that is NOT a Unicode letter, number, or COMBINING MARK with a hyphen. Keeping
    // marks (\\p{M}) is essential for Indic scripts: Devanagari matras/viramas (नमस्ते) are marks, not
    // letters — dropping them would shatter every syllable. Latin accents were already folded above, so
    // keeping \\p{M} here does not re-introduce them.
    .replace(/[^\\p{L}\\p{N}\\p{M}]+/gu, '-')
    // collapse repeats and trim edge hyphens
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, maxLength).replace(/-+$/g, '');
}

// Produce a slug guaranteed not to collide with ones you already have. Pass a set/array of taken slugs
// (e.g. from your DB); if the base is taken it appends -2, -3, … until it is free.
export function uniqueSlug(input: string, taken: Iterable<string>, opts?: { maxLength?: number }): string {
  const used = taken instanceof Set ? taken : new Set(taken);
  const base = slugify(input, opts) || 'item';
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(base + '-' + n)) n++;
  return base + '-' + n;
}
`;

const INSTRUCTIONS =
  'URL slug generation wired at server/lib/slug.ts (no dependency — native Unicode normalize). Import ' +
  'slugify(title) to turn a title into a clean URL-safe slug for blog posts, product pages, docs and ' +
  'profiles. It is Unicode-aware, so Hindi/Indic titles (e.g. "नमस्ते दुनिया") produce a real slug instead of ' +
  'an empty string, and Latin accents are folded (café → cafe). Use uniqueSlug(title, existingSlugs) to avoid ' +
  'collisions when two titles clash (it appends -2, -3, …). No API key needed.';

export function generateSlugIntegration(): SlugConfig {
  return {
    files: { 'server/lib/slug.ts': SLUG_SERVER },
    instructions: INSTRUCTIONS,
  };
}
