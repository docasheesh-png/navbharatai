// Shared (client + server) framework detection + selection resolver — pure, dependency-free.
//
// ONE source of truth so the SERVER build route and the CLIENT pre-build conflict check never drift.
// ROOT CAUSE this closes (MelodyBox deep-test, 2026-07-18): AgentV3's new-build path never read the
// user's prompt to choose a framework, so an explicit "Vue 3" prompt was scaffolded as React → unresolved
// imports, readiness 0/100. Two phases of detection: (1) any front-end / meta framework wins first;
// (2) a pure back-end/API request (no browser-UI signal) picks its backend id. Every id is a real
// TemplateRegistry key. `resolveFrameworkSelection` adds the bidirectional-selection contract (admin
// 2026-07-20): settings pick vs chat text, and a CONFLICT verdict when they disagree so the UI can
// confirm before building the wrong stack.

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

// ── In-browser-preview capability (CrewHub screenshots 2026-07-20) ──────────────────────────────────
// The lightweight IN-BROWSER preview is a client-side bundler that expects a browser SPA entry
// (index.html → src/main). SSR / meta frameworks (Next.js, Nuxt, …) and pure BACKENDS have no such entry
// and MUST run on a real Node server — so the in-browser lane greeted a Next.js app with a scary
// "No React entry module found" error + a "Fix with AI" button, as if the (perfectly fine) app were
// broken. These frameworks render honestly with a "runs on the Live server" panel instead.
const SERVER_FRAMEWORK_LABELS: Record<string, string> = {
  nextjs: 'Next.js', nuxt: 'Nuxt', sveltekit: 'SvelteKit', remix: 'Remix', angular: 'Angular', astro: 'Astro',
  'node-express': 'Express', hono: 'Hono', nestjs: 'NestJS', fastify: 'Fastify',
  'python-fastapi': 'FastAPI', django: 'Django', flask: 'Flask', 'spring-boot': 'Spring Boot', go: 'Go',
};

/** Can this framework render in the lightweight IN-BROWSER preview (a client SPA), or does it NEED the
 *  Live server (SSR / meta framework / backend)? Pure. Unknown/empty → true (the SPA default). */
export function frameworkRunsInBrowser(framework?: string): boolean {
  return !(framework && Object.prototype.hasOwnProperty.call(SERVER_FRAMEWORK_LABELS, framework.toLowerCase()));
}

/** A friendly display name for a Live-server-only framework (for the honest preview panel). Pure. */
export function serverFrameworkLabel(framework?: string): string {
  return (framework && SERVER_FRAMEWORK_LABELS[framework.toLowerCase()]) || 'This';
}

/** The outcome of reconciling the two selection paths (settings pick + chat text). */
export type FrameworkResolution =
  | { status: 'ok'; framework: string }
  | { status: 'conflict'; picked: string; detected: string };

/**
 * Reconcile the two ways a user selects a framework (admin bidirectional law 2026-07-20):
 *   • SETTINGS pick (`explicit`) always wins over chat text — EXCEPT when the chat text names a DIFFERENT
 *     framework, in which case we return `conflict` so the UI can CONFIRM first (never silently build the
 *     wrong stack). Once the user has confirmed (`resolved`), the pick is honoured with no re-prompt.
 *   • CHAT text — when the pick was NOT explicit (the bare 'vite-react' default), an explicitly-named
 *     framework in the prompt is auto-selected.
 * Pure + unit-testable. `picked` defaults to 'vite-react' when absent.
 */
export function resolveFrameworkSelection(opts: {
  picked: string | undefined;
  explicit: boolean;
  prompt: string;
  resolved?: boolean;
}): FrameworkResolution {
  const picked = opts.picked || 'vite-react';
  const detected = detectFrameworkFromPrompt(opts.prompt);
  // CONFLICT: a deliberate pick AND the text names a different framework → ask before building.
  if (opts.explicit && !opts.resolved && detected && detected !== picked) {
    return { status: 'conflict', picked, detected };
  }
  if (opts.explicit) return { status: 'ok', framework: picked };
  // Not an explicit pick (brand-new default session): chat text may auto-select the framework.
  if (picked === 'vite-react' && detected) return { status: 'ok', framework: detected };
  return { status: 'ok', framework: picked };
}
