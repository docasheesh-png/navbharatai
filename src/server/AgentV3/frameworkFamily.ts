// AgentV3 — framework family classification for the ANALYSIS layer.
//
// The React Rules-of-Hooks / JSX-component / undefined-hook analyzers are React-SPECIFIC: they treat any
// `useX()` call as a React hook and any `<Tag>` as JSX. Run against a Vue/Nuxt or Svelte app they produce
// FALSE positives — ShopSphere (App #12, Nuxt) had its `useFetch`/`useProducts` COMPOSABLES flagged as
// "React Rules-of-Hooks violations" and an AUTO-IMPORTED composable flagged as "hook never imported",
// which became readiness BLOCKERS that failed an otherwise-correct build. This gate keeps those analyzers
// scoped to the frameworks they are actually about.

/**
 * True only for React-FAMILY frameworks, where React Rules-of-Hooks / JSX-component / undefined-hook
 * analysis is meaningful. Vue/Nuxt/Svelte/Angular/Solid/Qwik/Astro apps are NOT React — their `useX`
 * composables and `.vue`/`.svelte` components must never be linted by the React analyzers. Preact IS
 * React-like (its hooks follow the Rules of Hooks) → true. Default true for react/vite-react/next/remix/
 * gatsby/cra and unknown (React has always been the default family). PURE.
 */
export function isReactFamilyFramework(framework: string | undefined): boolean {
  const fw = (framework || '').toLowerCase();
  if (/vue|nuxt|svelte|angular|solid|qwik|astro/.test(fw)) return false;
  return true; // react, vite-react, next(js), remix, gatsby, preact, cra, unknown → React family
}
