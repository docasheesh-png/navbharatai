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
  // Alpine.js — "alpine" is distinctive enough (rarely an app-domain word); match it + alpinejs.
  { id: 'alpine', re: /\balpine(\.js|js)?\b/i },
  // Vue — the base library, checked after Nuxt. Pinia / Vue Router are strong Vue-only signals.
  { id: 'vue', re: /\bvue(\.js|js|\s?[23])?\b|\bpinia\b|\bvue-?router\b/i },
];

// ── BACKEND-ONLY detection (bidirectional-selection upgrade, admin 2026-07-20) ──────────────────────
//
// The admin's requirement: "chahe user settings se framework select kare ya user chat me bol de … dono se
// apne aap select ho jaye". The frontend RULES above already make chat-selection work for front-end/meta
// frameworks. This second phase extends it to BACK-END frameworks so "build a Django REST API" typed in
// chat scaffolds Django — WITHOUT regressing the front-end-first design: a full-stack "React app with an
// Express backend" must KEEP its React scaffold (the builder adds the server), so backend detection fires
// ONLY when the prompt requests a pure backend/API with NO browser-UI signal at all.

/** Any signal that a browser UI is wanted → the app is front-end-first; keep the React/meta default and
 *  let the builder add the backend. Deliberately broad so a backend id is chosen only for a clearly
 *  UI-less request. (`react` is here because it is the DEFAULT, not a front-end RULE above.) */
const WEB_UI_SIGNAL =
  /\breact\b|\bfront[\s-]?end\b|\bu\.?i\.?\b|\buser interface\b|\bdashboard\b|\bweb\s?site\b|\bweb\s?app\b|\bweb\s?page\b|\blanding\s?page\b|\bspa\b|\bsingle[\s-]?page\b|\bcomponent\b|\btailwind\b|\bresponsive\b|\bhtml\b|\bcss\b|\bpage\b|\bscreen\b/i;

/** Back-end framework name → TemplateRegistry id. `go` requires an unambiguous signal (the bare word "go"
 *  is far too common in English) — `golang`, or `go` next to a server/api/backend/net-http token. */
const BACKEND_RULES: FrameworkRule[] = [
  { id: 'django', re: /\bdjango\b/i },
  { id: 'flask', re: /\bflask\b/i },
  { id: 'python-fastapi', re: /\bfast\s?api\b/i },
  { id: 'nestjs', re: /\bnest\.?js\b|\bnestjs\b/i },
  { id: 'fastify', re: /\bfastify\b/i },
  { id: 'hono', re: /\bhono\b/i },
  { id: 'spring-boot', re: /\bspring\s?boot\b/i },
  { id: 'node-express', re: /\bexpress(\.js|js)?\b/i },
  { id: 'go', re: /\bgolang\b|\bgo\b[\s-]*(?:lang|back-?end|server|api|micro-?service|net\/http|fiber|gin)\b|\b(?:back-?end|server|api|micro-?service)\b[\s-]*(?:in|with|using)?\s*\bgo\b/i },
];

/**
 * Detect a pure BACK-END framework request (no browser-UI signal). Returns the TemplateRegistry id, or
 * null when the prompt wants a UI (front-end-first) or names no backend framework. Pure.
 */
export function detectBackendOnlyFramework(prompt: string): string | null {
  const p = typeof prompt === 'string' ? prompt : '';
  if (!p.trim() || WEB_UI_SIGNAL.test(p)) return null;
  for (const { id, re } of BACKEND_RULES) {
    if (re.test(p)) return id;
  }
  return null;
}

/**
 * Detect an explicitly-requested framework from a build prompt and return its TemplateRegistry id, or
 * null when the prompt names none (React stays the default). Two phases: (1) any front-end / meta
 * framework wins first; (2) otherwise a pure back-end/API request (no UI signal) picks its backend id.
 * Pure.
 */
export function detectFrameworkFromPrompt(prompt: string): string | null {
  const p = typeof prompt === 'string' ? prompt : '';
  if (!p.trim()) return null;
  for (const { id, re } of RULES) {
    if (re.test(p)) return id;
  }
  return detectBackendOnlyFramework(p);
}

/**
 * Every TemplateRegistry id the detector can EVER return (front-end RULES + BACKEND_RULES). Exported so a
 * parity test can assert the detector never returns an id the engine can't scaffold, and that the client
 * FrameworkPicker offers a superset of what chat can select. Keeps the three sources of truth in sync.
 */
export const DETECTABLE_FRAMEWORK_IDS: readonly string[] = Array.from(
  new Set([...RULES, ...BACKEND_RULES].map((r) => r.id)),
);
