// AgentV3 — deterministic guard: a Vite app that reads `import.meta.env` must declare Vite's client types.
//
// ROOT CAUSE (admin report 2026-08-12, the dukaan stock app). The build ran `tsc --noEmit` FOUR times
// across 106 seconds, and every failing round carried the same line:
//
//     src/api/client.ts(1,29): error TS2339: Property 'env' does not exist on type 'ImportMeta'.
//
// `import.meta.env` is the ONLY way a Vite app reads its configuration, and TypeScript does not know
// about it until something in the project references `vite/client`. In a `npm create vite` project that
// something is a single generated line in `src/vite-env.d.ts`:
//
//     /// <reference types="vite/client" />
//
// That file was not in the shipped app's manifest. Our own scaffolds DO write it (goldenScaffolds/base,
// project/Scaffold) — so this is what a build looks like when the scaffold's copy never survived to the
// project the agent ended up type-checking. The agent then had to DISCOVER the problem from a compiler
// error, guess at it, and re-run the whole type-check to find out whether the guess worked.
//
// This is the wrong kind of work to spend a model on. The condition is mechanical (source says
// `import.meta.env`, no file references `vite/client`), the fix is a fixed string, and a
// types-only triple-slash directive has ZERO runtime effect — it cannot change what the app does, only
// what the compiler knows. So it is repaired by construction, before a repair round is ever spent.

/** The file Vite's own scaffold generates, and its exact contents. */
export const VITE_ENV_DTS_PATH = 'src/vite-env.d.ts';
export const VITE_ENV_DTS_CONTENT = '/// <reference types="vite/client" />\n';

/** Reads `import.meta.env` — the usage that needs the types. */
const USES_IMPORT_META_ENV = /\bimport\s*\.\s*meta\s*\.\s*env\b/;
/** Any existing declaration of Vite's client types, in a d.ts OR a tsconfig `types` array. */
const DECLARES_VITE_CLIENT = /vite\/client/;

const SOURCE_RE = /\.(tsx?|jsx?|mts|cts|mjs|cjs|vue|svelte)$/i;
const SKIP_RE = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)/i;

/**
 * Does this project read `import.meta.env` without declaring Vite's client types?
 *
 * Returns the file to write, or null when there is nothing to do. PURE — the caller performs the write,
 * so this stays testable without a sandbox and cannot surprise a caller that only wants to ask.
 *
 * Conservative by construction, in three ways that each prevent a false positive:
 *  - it fires ONLY when `import.meta.env` genuinely appears in a source file (never on a plain app);
 *  - ANY mention of `vite/client` anywhere in the project counts as declared — a d.ts under another
 *    name, a tsconfig `"types": ["vite/client"]`, an env.d.ts — so a project that solved this its own
 *    way is left completely alone;
 *  - it never overwrites an existing `src/vite-env.d.ts`, whatever that file happens to contain.
 */
export function missingViteEnvTypes(
  files: Readonly<Record<string, string>>,
): { path: string; content: string } | null {
  if (!files || typeof files !== 'object') return null;
  const entries = Object.entries(files).filter(([p]) => typeof p === 'string' && !SKIP_RE.test(p));
  // Already solved, by any means the project chose. Checked across EVERY file (not just sources) so a
  // tsconfig's `"types": ["vite/client"]` counts exactly as much as a d.ts does.
  if (entries.some(([, c]) => typeof c === 'string' && DECLARES_VITE_CLIENT.test(c))) return null;
  if (Object.prototype.hasOwnProperty.call(files, VITE_ENV_DTS_PATH)) return null;
  const uses = entries.some(([p, c]) => SOURCE_RE.test(p) && typeof c === 'string' && USES_IMPORT_META_ENV.test(c));
  if (!uses) return null;
  return { path: VITE_ENV_DTS_PATH, content: VITE_ENV_DTS_CONTENT };
}

/** The honest one-line report entry. Names the cost that was avoided, not just the action taken. */
export function viteEnvTypesNote(): string {
  return `The app reads import.meta.env but nothing declared Vite's client types, so TypeScript reported "Property 'env' does not exist on type 'ImportMeta'". Wrote ${VITE_ENV_DTS_PATH} — a types-only declaration with no runtime effect — instead of spending a repair round discovering it from a compiler error.`;
}
