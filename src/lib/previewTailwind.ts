// WHICH TAILWIND, IF ANY, AN APP USES — decided once, for both in-browser renderers.
//
// The no-build preview cannot run PostCSS, so a Tailwind app renders unstyled unless a browser build of
// Tailwind compiles the utilities at runtime. Two generations exist and they are NOT interchangeable:
//
//   v3 — `@tailwind base; @tailwind components; @tailwind utilities;` plus a `tailwind.config.js`; the
//        Play CDN (`cdn.tailwindcss.com`) compiles it and reads an inline `tailwind.config = {…}`.
//   v4 — `@import "tailwindcss";` with `@theme { … }`, `@plugin`, `@custom-variant`, `@utility` in the
//        CSS and NO config file; only `@tailwindcss/browser` understands those directives. The Play CDN
//        treats `@import "tailwindcss"` as an unresolvable import and emits NOTHING — so a v4 app under
//        the v3 CDN is exactly as unstyled as one with no Tailwind at all.
//
// WHY THIS FILE EXISTS (admin 2026-09-28, the unstyled "secret calculator"): the server renderer looked
// only for the v3 directives, so every v4 app — the version this repository itself is on — was shown as
// raw HTML; and the client bundler (`src/lib/previewUtils.ts`) looked for nothing and loaded no Tailwind
// at all. One detector, imported by both, so they can never disagree about what an app needs.
//
// PURE and browser-safe: no Node imports, so it can be bundled into the client.

export type TailwindFlavour = 'v3' | 'v4';

/** Every directive that must reach the Tailwind compiler rather than a plain <style>. Source form, so the in-page loaders can embed it. */
export const TAILWIND_DIRECTIVE_RE_SOURCE = '@tailwind\\b|@apply\\b|@import\\s+["\']tailwindcss|@theme\\b|@plugin\\s|@custom-variant\\b|@utility\\b|@source\\s';
export const TAILWIND_DIRECTIVE_RE = new RegExp(TAILWIND_DIRECTIVE_RE_SOURCE);

/** The v4-only signals: any one of them means the Play CDN would compile nothing. */
const TAILWIND_V4_RE = /@import\s+["']tailwindcss(?:\/[^"']*)?["']|@theme\b|@plugin\s|@custom-variant\b|@utility\b|@source\s/;
const TAILWIND_V3_RE = /@tailwind\b|@apply\b/;
const TAILWIND_CONFIG_PATH_RE = /(^|\/)tailwind\.config\.[cm]?[jt]s$/;

/** `"^4.1.14"`, `"4"`, `"~4.0.0"`, `">=4"` → 4; a range we cannot read → null (never a guess). */
function majorOf(range: unknown): number | null {
  if (typeof range !== 'string') return null;
  const m = range.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Which Tailwind this file map needs compiled, or null when it uses none.
 *
 * The CSS decides first, because it is what the compiler will be handed: v4 directives anywhere ⇒ v4
 * (a v4 stylesheet may still carry `@apply`, so v3 signals never override a v4 one). With no directive
 * at all, a declared dependency decides — `@tailwindcss/vite` or `tailwindcss` at major 4 ⇒ v4, a
 * `tailwind.config.*` file or `tailwindcss` below 4 ⇒ v3 — because an app can carry Tailwind entirely
 * as `className` utilities with the directives in a file the map does not hold.
 */
export function detectTailwindFlavour(files: Record<string, string>): TailwindFlavour | null {
  const paths = Object.keys(files || {}).filter((p) => !p.includes('node_modules'));
  const cssTexts = paths.filter((p) => /\.(css|scss|sass|less|pcss)$/i.test(p)).map((p) => String(files[p] ?? ''));
  if (cssTexts.some((t) => TAILWIND_V4_RE.test(t))) return 'v4';
  const v3Css = cssTexts.some((t) => TAILWIND_V3_RE.test(t));
  let depMajor: number | null = null;
  let viteV4 = false;
  const pkgPath = paths.find((p) => /(^|\/)package\.json$/.test(p) && !p.includes('/'));
  const pkgText = pkgPath ? files[pkgPath] : files['package.json'];
  if (typeof pkgText === 'string') {
    try {
      const pkg = JSON.parse(pkgText) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      viteV4 = '@tailwindcss/vite' in deps || '@tailwindcss/postcss' in deps;
      depMajor = majorOf(deps.tailwindcss);
    } catch { /* an unreadable manifest decides nothing */ }
  }
  if (v3Css) return 'v3';
  if (viteV4 || depMajor === 4) return 'v4';
  if (paths.some((p) => TAILWIND_CONFIG_PATH_RE.test(p))) return 'v3';
  if (depMajor != null && depMajor < 4) return 'v3';
  return null;
}

/** The runtime compiler for each generation — the v3 Play CDN and the v4 browser build. */
export const TAILWIND_V3_CDN = 'https://cdn.tailwindcss.com';
export const TAILWIND_V4_CDN = 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4';

/**
 * shadcn/ui DESIGN-TOKEN CONTRACT for the v3 Play CDN (admin 2026-07-17 — "border/colour error kabhi
 * wapas na aaye"). The Play CDN does NOT read the project's tailwind.config.js, so a stylesheet using
 * shadcn utilities — `@apply border-border`, `bg-background`, `text-foreground` — failed to compile with
 * "The `border-border` class does not exist" and the whole preview died. The standard shadcn token set
 * is registered in an INLINE config (so every such utility EXISTS) with default CSS variables (so the
 * colours render even when the app forgot its `:root`; the app's own `:root`, injected after, wins).
 * Harmless for a non-shadcn app — the extra tokens are simply unused.
 *
 * v4 has no `tailwind.config`: shadcn on v4 declares its tokens in the CSS itself (`@theme inline`), so
 * nothing is injected there and the browser build reads the app's own declarations.
 */
export const SHADCN_TW_CONFIG =
  "tailwind.config={darkMode:['class'],theme:{extend:{colors:{" +
  "border:'hsl(var(--border))',input:'hsl(var(--input))',ring:'hsl(var(--ring))'," +
  "background:'hsl(var(--background))',foreground:'hsl(var(--foreground))'," +
  "primary:{DEFAULT:'hsl(var(--primary))',foreground:'hsl(var(--primary-foreground))'}," +
  "secondary:{DEFAULT:'hsl(var(--secondary))',foreground:'hsl(var(--secondary-foreground))'}," +
  "destructive:{DEFAULT:'hsl(var(--destructive))',foreground:'hsl(var(--destructive-foreground))'}," +
  "muted:{DEFAULT:'hsl(var(--muted))',foreground:'hsl(var(--muted-foreground))'}," +
  "accent:{DEFAULT:'hsl(var(--accent))',foreground:'hsl(var(--accent-foreground))'}," +
  "popover:{DEFAULT:'hsl(var(--popover))',foreground:'hsl(var(--popover-foreground))'}," +
  "card:{DEFAULT:'hsl(var(--card))',foreground:'hsl(var(--card-foreground))'}}," +
  "borderRadius:{lg:'var(--radius)',md:'calc(var(--radius) - 2px)',sm:'calc(var(--radius) - 4px)'}}}};";

// ⚠️ These two constants are the USER'S app's defaults, painted inside their preview — never NavBharatAI's
// own UI — so the theme ratchet (tests/themeTokensOnly.test.ts) carries a one-literal baseline for this
// file (the same "the user's colours are not ours" rule as MultiPageBuilder). Do not add UI colour here.
export const SHADCN_CSS_VARS =
  ':root{--background:0 0% 100%;--foreground:222.2 84% 4.9%;--card:0 0% 100%;--card-foreground:222.2 84% 4.9%;' +
  '--popover:0 0% 100%;--popover-foreground:222.2 84% 4.9%;--primary:222.2 47.4% 11.2%;--primary-foreground:210 40% 98%;' +
  '--secondary:210 40% 96.1%;--secondary-foreground:222.2 47.4% 11.2%;--muted:210 40% 96.1%;--muted-foreground:215.4 16.3% 46.9%;' +
  '--accent:210 40% 96.1%;--accent-foreground:222.2 47.4% 11.2%;--destructive:0 84.2% 60.2%;--destructive-foreground:210 40% 98%;' +
  '--border:214.3 31.8% 91.4%;--input:214.3 31.8% 91.4%;--ring:222.2 84% 4.9%;--radius:0.5rem}';

/** The <head> tags that load the right compiler — '' when the app uses no Tailwind. */
export function tailwindHeadTags(flavour: TailwindFlavour | null): string {
  if (flavour === 'v3') return `<script src="${TAILWIND_V3_CDN}"></script>\n<script>${SHADCN_TW_CONFIG}</script>`;
  if (flavour === 'v4') return `<script src="${TAILWIND_V4_CDN}"></script>`;
  return '';
}

/** The project CSS as the compiler block should carry it — the shadcn defaults precede a v3 app's own CSS. */
export function tailwindStyleBody(flavour: TailwindFlavour | null, css: string): string {
  return flavour === 'v3' ? `${SHADCN_CSS_VARS}\n${css}` : css;
}
