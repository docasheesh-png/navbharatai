// AgentV3 — prompt → framework detector (framework-honoring scaffold).
//
// ROOT CAUSE this closes (MelodyBox deep-test, 2026-07-18): AgentV3's new-build path never read the
// user's prompt to choose a framework. `framework` was set once from the client FrameworkPicker, which
// DEFAULTS to 'vite-react' — so an explicit "Vue 3 + Vite" prompt was scaffolded as REACT. The LLM
// builder then, obeying the prompt, wrote Vue files (App.vue, main.js, Pinia, Vue Router) on top of the
// React scaffold (main.tsx, App.tsx) → two entry points, a shared index.css, 6 unresolved imports,
// readiness 0/100, BUILD_FAILED. One wrong scaffold decision doomed the whole build.
//
// This maps an EXPLICITLY-named front-end framework in the prompt to its TemplateRegistry id, so the
// matching scaffold is written. It returns null when the prompt names no explicit framework — React
// then stays the default, so nothing changes for the common case. Pure & deterministic.
//
// Scope: front-end / meta-frameworks only (the class where a wrong React scaffold is catastrophic).
// Back-end-only ids (node-express/nestjs/django/…) are intentionally NOT matched here — AgentV3 is
// front-end-first and a "React + Express" app must keep its React scaffold; back-end wiring is added by
// the builder, not by swapping the whole scaffold. Every id returned is a real TemplateRegistry key.

interface FrameworkRule {
  id: string; // must be a TemplateRegistry id (TemplateRegistry.ts)
  re: RegExp;
}

// Order matters: a meta-framework is checked BEFORE the base library it builds on (SvelteKit before
// Svelte, Nuxt before Vue), so "Nuxt app" picks 'nuxt', not 'vue'.
const RULES: FrameworkRule[] = [
  { id: 'sveltekit', re: /\bsvelte\s?kit\b/i },
  { id: 'svelte', re: /\bsvelte(\.js|js|\s?[45])?\b/i },
  { id: 'nuxt', re: /\bnuxt(\.js|js|\s?[23])?\b/i },
  // Next.js — REQUIRE the "js" (bare "next" is a common English word and would false-positive).
  { id: 'nextjs', re: /\bnext\.?js\b|\bnextjs\b|\bnext\sjs\b/i },
  { id: 'remix', re: /\bremix(\.run|\srun)?\b/i },
  { id: 'angular', re: /\bangular(js|\s?\d+)?\b/i },
  { id: 'astro', re: /\bastro\b/i },
  // Preact — "preact" is not a common English word, so a bare match is safe. Checked before React so
  // "Preact app" never falls through to the React default.
  { id: 'preact', re: /\bpreact(\.js|js)?\b/i },
  // SolidJS — REQUIRE the "js"/".js" (bare "solid" is a common English word, e.g. "a solid app",
  // and would false-positive onto the Solid scaffold).
  { id: 'solid', re: /\bsolid\.?js\b|\bsolidjs\b|\bsolid\sjs\b/i },
  // Lit — NEVER match bare "lit" (a common English word, e.g. "a lit party app"). Only clean signals:
  // LitElement / lit-html / lit.dev, or an explicit "web component(s)" request (Lit is the default there).
  { id: 'lit', re: /\blit-?html\b|\blit-?element\b|\blit\.(?:js|dev)\b|\bweb\s?components?\b/i },
  // Vue — the base library, checked after Nuxt. Pinia / Vue Router are strong Vue-only signals.
  { id: 'vue', re: /\bvue(\.js|js|\s?[23])?\b|\bpinia\b|\bvue-?router\b/i },
];

/**
 * Detect an explicitly-requested front-end framework from a build prompt and return its
 * TemplateRegistry id, or null when the prompt names none (React stays the default). Pure.
 */
export function detectFrameworkFromPrompt(prompt: string): string | null {
  const p = typeof prompt === 'string' ? prompt : '';
  if (!p.trim()) return null;
  for (const { id, re } of RULES) {
    if (re.test(p)) return id;
  }
  return null;
}
