// AgentV3 — Simple Builder: "plan the files, then build each file in its OWN focused call".
//
// The single-call OneShot lane asks the model to emit an ENTIRE multi-file app in one response,
// which truncates past ~8k output tokens — so anything beyond a trivial app produced "no files" and
// dropped the build into the slow agentic loop. This lane (the user's own design) instead:
//   1. PLAN a file manifest — ONE cheap call returns the exact files + a one-line purpose each.
//   2. GENERATE each file in its OWN focused call, in parallel (bounded) — no token-limit truncation,
//      and higher per-file quality because each call has the full context budget for one file.
//   3. WRITE them all and start the preview.
// Best-effort: any failure (or too few files) returns ok:false so the caller FALLS BACK to the
// agentic loop — it can never make things worse, only make a multi-file build fast when it works.
//
// Side-effects (model call, file writes, preview) are INJECTED so the manifest/parse/prompt logic is
// fully unit-testable without a sandbox.

import { mapWithConcurrency, withTimeout } from './asyncUtils';
import { judgeRepair } from './repairAcceptance';
import { scaffoldRestores, protectBoilerplateInRepair, isScaffoldBoilerplate, SCAFFOLD_BOILERPLATE } from './scaffoldBoilerplate';
import { parseFileBlocks, type OneShotFile } from './OneShotBuilder';
import { contractDriftReport } from './ContractMap';
import { classifyBuildOutcome, type BuildOutcome } from './BuildOutcome';
import { reconcileImportExports, addMissingProjectImports, fixWrongSourceImports } from './ImportExportReconcile';
import { fileBudgetForPrompt, fileBudgetInstruction } from './fileBudget';
import { generateMissingCssModules } from './CssModuleGenerator';
import { missingViteEnvTypes } from './viteEnvTypes';
import { generateMissingBarrels } from './BarrelGenerator';
import { signatureContextEnabled, signatureDependencyContext } from './exportSurface';
import { reconcileLanguageExtensions } from './LanguageCoherence';
import { ensureHtmlEntryScript } from './HtmlEntryGuard';
import { wireOrphanPages } from './orphanPageWiring';
import { injectGlobalStylesheetImport } from './ProjectIntegrityChecks';
import { preambleCapMs, canFinishRemainingTiers, earlyBailReason, canFinishAfterPreamble, preambleBailReason } from './FastLaneBudget';

export interface SimpleFileSpec {
  path: string;
  /** One-line description of what this file contains — guides its focused generation call. */
  purpose: string;
}

const HEAVY_OR_UNSAFE = /^(node_modules|\.git|dist|build)\//;

/**
 * Parse the planner's file manifest. The planner is asked to emit one file per line as
 *   path/from/root.ext :: one-line purpose
 * Unsafe paths (absolute, traversal, node_modules) and obvious non-files are dropped. Pure + tested.
 */
export function parseFileManifest(text: string): SimpleFileSpec[] {
  const out: SimpleFileSpec[] = [];
  const seen = new Set<string>();
  for (const raw of (text || '').split('\n')) {
    // Strip a REAL list marker only — a bullet (`-`/`*`/`•`) or an ordinal (`1.`/`2)`) followed by
    // whitespace. The old greedy class `[-*\d.)\s]+` ate the START of legit paths: `2fa/verify.tsx`
    // lost its leading `2` → `fa/verify.tsx` (wrong folder), and `.env`/`.gitignore` lost the leading
    // `.` → then failed the extension test below and were DROPPED entirely.
    const line = raw.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, ''); // strip a list bullet/number marker
    if (!line || !line.includes('::')) continue;
    const [pathPart, ...rest] = line.split('::');
    const path = pathPart.trim().replace(/^["'`]|["'`]$/g, '');
    const purpose = rest.join('::').trim();
    if (!path || path.startsWith('/') || path.includes('..') || path.length > 300) continue;
    if (HEAVY_OR_UNSAFE.test(path) || !/\.[a-z0-9]{1,8}$/i.test(path)) continue; // must look like a file
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ path, purpose: purpose.slice(0, 300) });
  }
  // Fix 38a (Task-Manager report 2026-07-07): the old silent 40-file slice DROPPED the model's own
  // planned files — App.tsx imported 10 pages the cap had cut, three verify layers then lied "✓".
  // 60 bounds a runaway manifest; anything the model plans within it is BUILT, never silently dropped
  // (and the unresolved-local-imports verify below catches any remaining gap honestly).
  return out.slice(0, 60);
}

/**
 * Cheap CSS sanity: net brace imbalance of a stylesheet (comments stripped). A positive number means
 * unclosed block(s) — postcss/vite will refuse the whole file ("Unclosed block", the exact overlay
 * from the Task-Manager report) and the app renders unstyled/dead while tsc stays green (it never
 * reads CSS). Pure.
 */
export function cssBraceImbalance(css: string): number {
  const noComments = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  let open = 0, close = 0;
  for (const ch of noComments) {
    if (ch === '{') open++;
    else if (ch === '}') close++;
  }
  return open - close;
}

/**
 * LENS B — generation TIER for a file, so we build leaves before the files that consume them and can
 * feed each consumer the REAL generated source of its foundations (not a guess, and not only the
 * predicted contract — this also catches a producer that DEVIATED from the planned contract):
 *   0 = foundation: types, interfaces, models, constants, config, utils, lib, helpers, hooks,
 *       contexts, stores, services/api, and stylesheets (everyone imports these; low cross-deps).
 *   2 = shell: the entry (main/index), App, pages/routes/router, and *Page/*Screen/*View files
 *       (they compose the components below, so they generate LAST with the real component source).
 *   1 = everything else (leaf/mid components).
 * PURE + unit-testable. With only one effective tier present, the staged build collapses to today's
 * single parallel batch.
 */
export function generationTier(path: string): number {
  const p = path.toLowerCase();
  // Shell / entry / pages — generated last (they import the components + foundation).
  if (/(^|\/)(main|index)\.[jt]sx?$/.test(p) && !/(^|\/)components?\//.test(p)) return 2;
  if (/(^|\/)app\.[jt]sx?$/.test(p)) return 2;
  if (/(^|\/)(pages?|routes?|router)(\/|\.)/.test(p)) return 2;
  if (/(page|screen|view)\.[jt]sx?$/.test(p)) return 2;
  // Foundation — generated first.
  if (/\.css$/.test(p)) return 0;
  if (/\.d\.ts$/.test(p)) return 0;
  if (/(^|\/)(types?|interfaces?|models?|constants?|config|utils?|lib|helpers?|hooks?|contexts?|stores?|services?|api)(\/|\.)/.test(p)) return 0;
  if (/(^|\/)use[a-z0-9]/.test(p)) return 0; // useXxx hook files anywhere
  // Components and everything else.
  return 1;
}

/**
 * LENS B — render already-generated producer files as a prompt block so a consumer uses their EXACT
 * exported names / enum members / prop interfaces (capped per file to bound the prompt). PURE.
 */
export function dependencyContext(producers: OneShotFile[], perFileCap = 4000): string {
  const real = (producers || []).filter((f) => f && f.path && typeof f.content === 'string');
  if (real.length === 0) return '';
  const dump = real
    .map((f) => `<<<FILE ${f.path}>>>\n${f.content.slice(0, Math.max(0, perFileCap))}\n<<<ENDFILE>>>`)
    .join('\n\n');
  return [
    '',
    'ALREADY-WRITTEN FILES YOU CAN IMPORT — this is their REAL source. Use these EXACT exported names,',
    'enum members, types, function signatures, and component prop interfaces; import ONLY what is',
    'actually exported here. Do NOT invent or re-case names:',
    dump,
  ].join('\n');
}

/** System prompt for the manifest (planning) call. */
export function manifestSystemPrompt(framework: string): string {
  return [
    `You are an elite ${framework} engineer. Plan the COMPLETE file list for the app the user wants.`,
    '',
    'OUTPUT: one line per file, EXACTLY in this format (nothing else, no prose, no code):',
    '  relative/path/from/project/root.ext :: one concise sentence describing this file\'s contents',
    '',
    'RULES:',
    '- List EVERY source file the app needs (entry, components, styles, hooks, utils, config it must edit).',
    '- Edit/replace the scaffolded entry files (e.g. src/App.tsx, index.html) — do not nest a subfolder.',
    '- Keep it minimal but COMPLETE — no file the app references should be missing.',
    // SIZE DISCIPLINE (admin 2026-08-02): "minimal" alone is an adjective a weak model reads as optional —
    // a real build planned 50 files for an app needing ~12. The per-app NUMBER lives in the user prompt
    // (fileBudgetInstruction); this is the app-agnostic anti-pattern that produces most of the bloat.
    '- One file per REAL unit of the app. Never a separate file for a single tiny helper, type or constant —',
    '  co-locate it with its only user. Fewer, cohesive files beat many thin ones.',
    '- Do NOT list node_modules, lockfiles, or build output.',
    // The persuasion half of the boilerplate fix; SimpleBuilder drops these from the parsed plan
    // regardless, so a model that ignores this line still cannot overwrite them.
    `- These files are PROVIDED and already correct — do NOT list them, do not rewrite them: ${Object.keys(SCAFFOLD_BOILERPLATE).join(', ')}.`,
  ].join('\n');
}

export function manifestUserPrompt(prompt: string, scaffoldPaths: string[]): string {
  const scaffold = scaffoldPaths.length
    ? `Already scaffolded (edit/extend; root is the project root):\n${scaffoldPaths.slice(0, 60).map((p) => `  - ${p}`).join('\n')}`
    : 'The project starts empty — plan all files at the project root.';
  // The size ceiling is derived HERE, from the prompt this function already receives, so every caller of
  // the manifest lane inherits it automatically — there is no second path that can plan unbudgeted.
  const budget = fileBudgetInstruction(fileBudgetForPrompt(prompt));
  return `Plan the file list for this app:\n\n${prompt}\n\n${scaffold}\n\n${budget}\n\nOutput the file list now (one "path :: purpose" per line).`;
}

/** System prompt for a single-file generation call. */
export function fileSystemPrompt(framework: string): string {
  return [
    `You are an elite ${framework} engineer writing ONE file of a larger app.`,
    '',
    'OUTPUT FORMAT — emit EXACTLY one file, wrapped precisely like this and nothing else:',
    '<<<FILE relative/path.ext>>>',
    '...the full file content...',
    '<<<ENDFILE>>>',
    '',
    'RULES:',
    '- Output ONLY that one file block — no prose, no explanation, no markdown fences.',
    '- Write the COMPLETE, real file — no TODOs, no placeholders, no "..." stubs.',
    '- Match the imports/exports the rest of the app expects (you are given the full file list).',
    ...exportImportConvention(framework),
    ...DESIGN_CONTRACT,
  ].join('\n');
}

/**
 * A FIXED visual-design bar, injected into every per-file generation call (NotesNest autopsy
 * 2026-07-16: the delivered app was functionally complete but looked like raw HTML — "designer theek
 * se kaam nahi kar raha"). Cheap models default to bare markup unless the bar is explicit; this keeps
 * it compact (a few lines of tokens) and concrete so every file pulls toward the same polished look.
 */
export const DESIGN_CONTRACT: string[] = [
  '',
  'DESIGN QUALITY (the app must look professionally designed, not like raw HTML):',
  '- Layout: real structure (sidebar/panels/cards with borders+radius+padding), never bare stacked elements; use flex/grid with a consistent spacing scale (4/8/12/16/24px).',
  '- Style every interactive element: buttons/inputs get padding, border-radius, hover & focus-visible states — default browser widgets must never appear.',
  '- Theme via CSS variables on :root (background, text, muted, accent, card, border) so dark/light stays consistent; system-ui font stack; line-height ~1.5.',
  '- In components, use className with classes that REALLY exist in the global stylesheet (and add any class you use to it when you write that stylesheet).',
  '- Empty states, hover feedback and a clear visual hierarchy (one accent color, muted secondary text) — small details make it feel like a real product.',
];

/**
 * A FIXED export/import convention, injected into every per-file generation + repair prompt. Because
 * each file is generated in its OWN call, the model can't see another file's actual code — so without
 * a shared rule it guesses the export style and produces mismatches like `import useNotes from …`
 * against a NAMED `export function useNotes` (TS2613/TS2614), which the build then has to repair every
 * time. A single deterministic convention makes producers and consumers agree by construction.
 */
const REACT_CONVENTION: string[] = [
  'EXPORT/IMPORT CONVENTION — follow EXACTLY so every import matches the matching export across files:',
  '  • A React COMPONENT file (App, Button, NoteCard, Sidebar, pages, …) → `export default` the component,',
  '    and import it as DEFAULT: `import NoteCard from "./NoteCard"`.',
  '  • Hooks, utilities, types/interfaces, contexts, constants, stores → NAMED exports',
  '    (`export function useNotes`, `export const`, `export interface Note`), and import them NAMED:',
  '    `import { useNotes } from "../hooks/useNotes"`, `import { Note } from "../types/note"`.',
  '  • NEVER default-import something that is exported named, and NEVER named-import a default export.',
  '  • CSS Modules: `import styles from "./X.module.css"` (default). Plain CSS: `import "./X.css"`.',
  'PROP & TYPE CONTRACTS (these recur — get them right the FIRST time):',
  '  • When a parent renders a child, the props it passes MUST EXACTLY match the child component\'s',
  '    declared props (same NAMES and TYPES). Decide each component\'s props once and use the same on',
  '    both sides — e.g. if TaskCounter is `{ remaining, total }`, the parent passes `remaining`+`total`,',
  '    NOT `count`.',
  '  • In .ts/.tsx files, IMPORT the React types you reference — `import type { Dispatch, SetStateAction',
  '    } from "react"` — do NOT write the bare `React.` namespace (e.g. `React.Dispatch`) without an',
  '    `import React from "react"`. Hooks files are usually .ts (no JSX) so React is NOT auto-in-scope.',
  '  • `key` is React\'s special prop for list items only — NEVER add it to a component\'s props interface.',
];

// Vue 3 / Nuxt 3 — SFCs + auto-imports + Pinia. CargoPilot-sibling autopsy (ShopSphere, App #12):
// the React convention above was fed to a NUXT build, so the model wrote `export default` components,
// invented Nuxt modules (`useSupabaseClient`, `#auth`, `<Icon>`) and duplicate-imported the same type.
const VUE_CONVENTION: string[] = [
  'EXPORT/IMPORT CONVENTION (Vue 3 / Nuxt) — follow EXACTLY so files agree by construction:',
  '  • Components are Single-File Components (`.vue`) with `<script setup lang="ts">`. NEVER `export default`',
  '    a component, NEVER `import React`, NEVER JSX — use the SFC `<template>`.',
  '  • In NUXT, components in `components/`, composables in `composables/`, and Pinia stores are',
  '    AUTO-IMPORTED — do NOT write manual imports for them; use them directly (`<ProductCard />`,',
  '    `useCart()`, `useCartStore()`). In a plain Vite+Vue app import components by DEFAULT',
  '    (`import ProductCard from "@/components/ProductCard.vue"`) and use the `@/` alias.',
  '  • Utilities / types / interfaces → NAMED exports (`export function formatPrice`, `export interface',
  '    Product`); import them NAMED (Nuxt `~/`, Vite `@/`). Pinia store:',
  '    `export const useCartStore = defineStore("cart", () => { … })`; call it `useCartStore()`.',
  '  • DO NOT invent modules/composables that were not requested — no `useSupabaseClient`, `useI18n`,',
  '    `#auth`, `useSession`, `<Icon>` unless the app explicitly uses that module. For auth/session use the',
  '    app\'s OWN Nitro server routes (`server/api/**`) + a Pinia store, not a third-party auth module.',
  'PROP & TYPE CONTRACTS (get them right the FIRST time):',
  '  • `defineProps<{ … }>()` types must EXACTLY match what the parent passes (same names + types).',
  '  • Import each symbol/type EXACTLY ONCE — never import the same name (e.g. `OrderStatus`) on two',
  '    import lines, and never import a value AND its type name twice.',
];

// Svelte / SvelteKit — .svelte SFCs, `export let` props, $lib alias, writable stores.
const SVELTE_CONVENTION: string[] = [
  'EXPORT/IMPORT CONVENTION (Svelte / SvelteKit) — follow EXACTLY:',
  '  • Components are `.svelte` files; declare props with `export let name` (typed). NEVER `export default`',
  '    a component, NEVER `import React`, NEVER JSX.',
  '  • Import a component by DEFAULT WITH its extension: `import Card from "$lib/Card.svelte"`.',
  '  • Utilities / types / stores → NAMED exports; import from the `$lib` alias',
  '    (`import { formatDate } from "$lib/utils"`). Store: `export const cart = writable([])`; read it in',
  '    markup with the `$cart` auto-subscription.',
  'PROP & TYPE CONTRACTS: the props a parent passes MUST match the child\'s `export let` names + types.',
  '  Import each symbol/type EXACTLY ONCE.',
];

// Framework-neutral fallback (Angular, Solid, unknown) — the invariant without React/Vue specifics.
const GENERIC_CONVENTION: string[] = [
  'EXPORT/IMPORT CONVENTION — follow EXACTLY so every import matches its export across files:',
  '  • Use this framework\'s IDIOMATIC component + module style (do NOT assume React/JSX). Match the',
  '    producer\'s export style at every consumer: never default-import a named export or vice-versa.',
  '  • Utilities / types / stores → NAMED exports, imported named via the app\'s configured path alias.',
  '  • Do NOT invent packages/modules/helpers that were not requested. Import each symbol/type ONCE.',
];

/**
 * The export/import convention to inject, chosen by FRAMEWORK. The convention used to be React-only and
 * was fed verbatim to Vue/Nuxt and Svelte builds (ShopSphere autopsy 2026-07-19: a Nuxt app got told to
 * `export default` its components and `import React`), so producers and consumers drifted. Pure.
 */
export function exportImportConvention(framework: string): string[] {
  const fw = (framework || '').toLowerCase();
  if (/vue|nuxt/.test(fw)) return VUE_CONVENTION;
  if (/svelte/.test(fw)) return SVELTE_CONVENTION;
  if (/angular|solid|qwik|astro/.test(fw)) return GENERIC_CONVENTION;
  return REACT_CONVENTION; // react, vite-react, next, remix, gatsby, … (the default family)
}

/**
 * LENS A — SHARED CONTRACTS FIRST. The deepest cause of cross-file drift is that each file is
 * generated in its OWN isolated (parallel) call and only ever sees sibling PATHS + one-line
 * purposes — never the real exported symbol NAMES, enum members, type/interface shapes, util
 * signatures, or component prop interfaces of its siblings. So independent files invent divergent
 * names (`MediaType.YouTube` vs `YOUTUBE`), disagree on props (`url` vs `embedUrl`), import symbols
 * a util never exported (`extractVimeoEmbedUrl`), or reference an undefined type (`PlayerState`).
 *
 * The fix is to produce ONE shared "contract" artifact up front — the exact enums, types, util
 * signatures, and component prop interfaces — BEFORE the per-file fan-out, then inject that exact
 * contract into every per-file generation + repair prompt. Files can no longer invent divergent
 * names because they are handed the single source of truth. This is the contract's system/user
 * prompt; the contract TEXT itself is generated by the caller's `generate` (one extra cheap call)
 * and threaded through `fileUserPrompt` / `repairUserPrompt`.
 */
export function contractSystemPrompt(framework: string): string {
  return [
    `You are an elite ${framework} engineer designing the SHARED CONTRACT for a multi-file app`,
    'BEFORE any file is written. Each file will be generated in its own isolated call, so this',
    'contract is the ONLY way the files can agree on names and shapes. Be exact and exhaustive.',
    '',
    'OUTPUT: a single TypeScript code block (no prose, no fences) that declares EVERY cross-file',
    'symbol the app shares, so producers and consumers agree by construction. Include, as applicable:',
    '  • Every ENUM with its EXACT member names (decide casing ONCE — e.g. `enum MediaType { YouTube, Vimeo }`).',
    '  • Every shared TYPE / INTERFACE used by more than one file (e.g. `interface PlayerState { … }`).',
    '  • The EXACT signature of every shared util/helper (e.g. `export function extractEmbedUrl(url: string): string`).',
    '  • For EACH component, its props interface with EXACT prop names + types',
    '    (e.g. `interface PlayerProps { url: string; mediaType: MediaType }`).',
    '',
    'RULES:',
    '- These names are FROZEN. Files generated later MUST use these EXACT identifiers — no synonyms,',
    '  no re-casing, no renaming. If a symbol is not here, files must not assume it exists.',
    '- Real declarations only — no `// TODO`, no placeholder shapes. Keep it minimal but complete.',
    '- Output ONLY the declarations. No explanation, no markdown fences.',
  ].join('\n');
}

export function contractUserPrompt(prompt: string, manifest: SimpleFileSpec[]): string {
  const fileList = manifest.map((f) => `  - ${f.path}${f.purpose ? ` — ${f.purpose}` : ''}`).join('\n');
  return [
    `App being built:\n${prompt}`,
    '',
    `The complete file list:\n${fileList}`,
    '',
    'Design the shared contract (enums, shared types/interfaces, util signatures, and EACH',
    "component's props interface) now. Output only the TypeScript declarations.",
  ].join('\n');
}

/** Render the shared contract as the prompt block injected into every per-file + repair call. */
export function contractBlock(contract: string | undefined): string {
  const trimmed = (contract || '').trim();
  if (!trimmed) return '';
  return [
    '',
    'SHARED CONTRACT — these symbols are FROZEN and SHARED across files. Use these EXACT names,',
    'enum members, types, util signatures, and component prop interfaces. Do NOT rename, re-case,',
    'or invent variants; do NOT import a symbol that is not declared here:',
    '```ts',
    trimmed.slice(0, 12_000),
    '```',
  ].join('\n');
}

/**
 * Render an ADVISORY blueprint block for the AGENTIC architect (P-ARCH+.3). Unlike contractBlock —
 * which FREEZES the contract for the fast lane's isolated per-file calls — this is guidance the
 * architect may refine; it keeps ownership of the plan via update_todo. Reusing the proposed file
 * paths + shared symbol names is what avoids the mismatched-import / missing-file drift that breaks
 * large apps. Returns '' when there is no manifest. Pure.
 */
export function blueprintAdvisoryBlock(manifest: SimpleFileSpec[], contract?: string): string {
  if (!manifest || manifest.length === 0) return '';
  const fileList = manifest.map((f) => `  - ${f.path}${f.purpose ? ` — ${f.purpose}` : ''}`).join('\n');
  const parts = [
    'SUGGESTED BLUEPRINT (advisory) — a proposed file manifest and shared type/API contract to keep a',
    'larger app internally consistent. Treat it as a starting point you may refine as you build; you',
    'still own the plan (update_todo). It is NOT frozen — but reusing these exact file paths and shared',
    'symbol names avoids the mismatched-import / missing-file drift that breaks big apps.',
    '',
    `Proposed files:\n${fileList}`,
  ];
  const c = (contract || '').trim();
  if (c) {
    parts.push('', 'Proposed shared contract (types / enums / interfaces):', '```ts', c.slice(0, 12_000), '```');
  }
  return parts.join('\n');
}

export function fileUserPrompt(prompt: string, file: SimpleFileSpec, manifest: SimpleFileSpec[], contract?: string, deps?: string): string {
  const fileList = manifest.map((f) => `  - ${f.path}${f.purpose ? ` — ${f.purpose}` : ''}`).join('\n');
  return [
    `App being built:\n${prompt}`,
    '',
    `The app's complete file list (so your imports line up):\n${fileList}`,
    contractBlock(contract),
    deps || '',
    '',
    `Now write THIS file in full:\n  ${file.path}${file.purpose ? `\n  Purpose: ${file.purpose}` : ''}`,
    '',
    `Return ONLY the <<<FILE ${file.path}>>> … <<<ENDFILE>>> block.`,
  ].join('\n');
}

/**
 * GA-8 — ORDERED MULTI-STRATEGY REPAIR LADDER. Before this, every auto-repair attempt fired the
 * IDENTICAL prompt: if attempt 1's framing didn't unstick the model, attempt 2 (and the circuit-breaker
 * fires on byte-identical errors) just burned another model call + verify round on the same approach.
 * Now each attempt escalates to a DISTINCT strategy so a second/third try is a genuinely different push:
 *  1. `contract-full`      — today's behaviour EXACTLY (full files + shared contract). Byte-identical to
 *                            the pre-GA-8 prompt so attempt 1 never regresses.
 *  2. `focus-offenders`    — narrow the model to ONLY the files the compiler named, with a stricter
 *                            "rewrite these to satisfy the errors" instruction (stops it re-touching
 *                            already-correct files and diluting the fix).
 *  3. `contract-authority` — reframe the SHARED CONTRACT as the absolute source of truth: any file that
 *                            disagrees is WRONG and must be rewritten to match, even for larger changes.
 * The ladder is clamped, so attempts beyond the last strategy stay on `contract-authority`.
 */
export type RepairStrategy = 'contract-full' | 'focus-offenders' | 'contract-authority';

export const REPAIR_LADDER: readonly RepairStrategy[] = ['contract-full', 'focus-offenders', 'contract-authority'];

/** The strategy for a given 1-based repair attempt (clamped to the last rung). Pure. */
export function repairStrategyForAttempt(attempt: number): RepairStrategy {
  const i = Math.min(Math.max(attempt, 1), REPAIR_LADDER.length) - 1;
  return REPAIR_LADDER[i];
}

/**
 * The distinct source paths a compiler error blob names, restricted to files we actually generated.
 * tsc/eslint errors lead with `relative/path.ext(line,col): ...` or `relative/path.ext:line:col`; we
 * extract that leading path and keep only ones present in `known`. Pure; order follows first appearance.
 */
export function offendingFiles(errors: string, known: string[]): string[] {
  if (!errors || typeof errors !== 'string') return [];
  const knownSet = new Set(known);
  const seen = new Set<string>();
  const out: string[] = [];
  // Match a path-like token (has a slash or a dotted extension) immediately before `(l,c)` or `:l:c`.
  const re = /(^|\s)([\w./-]+\.[a-zA-Z]{1,5})(?=\s*[(:]\s*\d+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(errors)) !== null) {
    const p = m[2];
    if (knownSet.has(p) && !seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out;
}

/** System prompt for the auto-repair pass — fixes real compiler errors in files just generated. */
export function repairSystemPrompt(framework: string, strategy: RepairStrategy = 'contract-full'): string {
  const base = [
    `You are an elite ${framework} engineer FIXING compiler/build errors in an app you just wrote.`,
    '',
    'You are given the EXACT compiler errors and the current file contents. Output the CORRECTED files.',
    'OUTPUT FORMAT — emit each fixed file, each wrapped EXACTLY like this and nothing else:',
    '<<<FILE relative/path.ext>>>',
    '...the full corrected file content...',
    '<<<ENDFILE>>>',
    '',
    'RULES:',
    '- Output ONLY the files you actually change — each as a COMPLETE file block (no diffs, no prose).',
    '- Fix the ROOT cause. The most common bug is a contract mismatch between files generated separately',
    '  — e.g. a hook that does NOT return a value its consumer destructures. Make the producer and the',
    '  consumer AGREE (add the missing return fields, or stop using ones that do not exist).',
    '- Real, complete code — no TODOs, no placeholders. Keep changes minimal and consistent across files.',
  ];
  if (strategy === 'focus-offenders') {
    base.push(
      '- ESCALATION: the previous fix attempt did NOT clear these errors. Focus ONLY on the files the',
      '  compiler explicitly names below — rewrite each one in full so it strictly satisfies every error',
      '  against it. Do NOT touch files the compiler did not name; re-editing already-correct files is',
      '  what left the errors standing last time.',
    );
  } else if (strategy === 'contract-authority') {
    base.push(
      '- ESCALATION: earlier attempts failed. The SHARED CONTRACT is now the ABSOLUTE source of truth.',
      '  Any file that disagrees with it is WRONG — rewrite that file to match the contract exactly, even',
      '  if the change is large. Never bend the contract to a file; bend the file to the contract.',
    );
  }
  base.push(...exportImportConvention(framework));
  return base.join('\n');
}

export function repairUserPrompt(
  prompt: string,
  errors: string,
  files: OneShotFile[],
  contract?: string,
  strategy: RepairStrategy = 'contract-full',
): string {
  const dump = files.map((f) => `<<<FILE ${f.path}>>>\n${f.content}\n<<<ENDFILE>>>`).join('\n\n');
  const lines = [
    `App being built:\n${prompt}`,
    contractBlock(contract),
    '',
    `The build FAILED with these compiler errors:\n${errors.slice(0, 6000)}`,
    '',
    `Current files:\n${dump.slice(0, 60_000)}`,
    '',
  ];
  if (strategy === 'focus-offenders') {
    const offenders = offendingFiles(errors, files.map((f) => f.path));
    if (offenders.length) lines.push(`Rewrite ONLY these files the compiler named: ${offenders.join(', ')}.`, '');
  }
  lines.push(
    'Output ONLY the corrected <<<FILE …>>> blocks for the files you need to change. When two files',
    'disagree, the SHARED CONTRACT above is the source of truth — make both sides match it.',
  );
  return lines.join('\n');
}

/** Result of the real compile/build check run in the sandbox. */
export interface VerifyResult {
  ok: boolean;
  /** Compiler error text (empty when ok) — fed verbatim to the repair pass. */
  errors: string;
  /**
   * FALSE when the check could not EXECUTE at all (sandbox command threw/timed out) — distinct from
   * "ran and passed". The jungle-game report (2026-07-12) shipped a runtime ReferenceError behind a
   * "Build verified ✓" line because an infra failure was silently converted into ok:true; this flag
   * is what lets the caller stay honest ("shipped unverified") instead. Absent/undefined = ran.
   */
  ran?: boolean;
}

export interface SimpleBuildDeps {
  prompt: string;
  framework: string;
  scaffoldPaths: string[];
  /** ONE cheap text-generation call (Haiku/etc). Returns the raw model text. */
  generate: (system: string, user: string) => Promise<string>;
  /** Write the generated files (single batch). Throws on a hard failure. */
  writeFiles: (files: OneShotFile[]) => Promise<void>;
  /** Start the dev server + publish the preview. Best-effort. */
  startPreview?: () => Promise<void>;
  /**
   * A — Verify the generated app actually COMPILES (real tsc/build in the sandbox). When wired, the
   * build claims success ONLY if this passes ("Preview is EARNED"). A throw / infra failure is
   * treated as "could not verify" (non-blocking) so a flaky sandbox never causes a false fallback.
   */
  verify?: () => Promise<VerifyResult>;
  /**
   * A — Given the compiler errors + the current files, return CORRECTED files to write. Called only
   * when verify fails, up to `maxRepairs` times. A single isolated per-file generation often produces
   * a contract mismatch (hook vs consumer); this is what closes that gap automatically.
   */
  repair?: (errors: string, files: OneShotFile[], contract?: string, strategy?: RepairStrategy) => Promise<OneShotFile[]>;
  /** Max auto-repair attempts before handing off to the full builder (default 2). */
  maxRepairs?: number;
  /**
   * LENS A — SHARED CONTRACTS FIRST (default ON when `generate` is wired). When true, ONE extra
   * cheap call runs AFTER the manifest and BEFORE the per-file fan-out to design the app's shared
   * contract (exact enums, shared types/interfaces, util signatures, and each component's props
   * interface). That contract is then injected verbatim into every per-file generation + repair
   * prompt so independently-generated files agree on names/shapes by construction — eliminating
   * the enum-member / prop-name / undefined-type / missing-export drift that the bounded repair
   * loop could not reliably reconcile. Set false to restore the prior contract-free behavior.
   */
  shareContract?: boolean;
  /**
   * LENS B — generate files in dependency TIERS (foundation → components → shell) instead of one
   * all-parallel batch, feeding each tier the REAL generated source of the earlier tiers so consumers
   * use the actual exported names (catching even a producer that deviated from the predicted contract).
   * Default ON; set false (or env AGENTV3_DEP_ORDER=off) for a byte-identical fallback to the single batch.
   */
  depOrder?: boolean;
  log?: (msg: string) => void;
  /** Minimum files a real build must produce (default 2 — a real app is more than one file). */
  minFiles?: number;
  /** Max concurrent per-file generation calls (default 5). */
  concurrency?: number;
  /** Hard cap (ms) on the manifest + all per-file generation + writes (default 240 s). */
  overallTimeoutMs?: number;
  /** Hard cap (ms) on the PLAN step alone — the manifest + shared-contract calls (default 90 s). A single
   *  slow/storming provider call (KIMI timeout + GLM 429 retries) once ran the plan 247 s and blew the whole
   *  240 s budget → the fast lane always timed out and fell to the full builder. Bounding the plan lets the
   *  fast lane bail FAST (to the full builder, which recovered in ~26 s) instead of wasting the budget. */
  planTimeoutMs?: number;
  /** Hard cap (ms) on the best-effort preview (default 90 s). */
  previewTimeoutMs?: number;
  /**
   * STREAMING FIRST-PAINT (gated by the caller). Called ONCE with the fully-healed generated files
   * the instant they are final — after deterministic self-heal + write, but BEFORE the verify+repair
   * loop and the caller's install/dev-server boot (tens of seconds). The caller uses it to publish an
   * early in-browser preview so the user sees the real app much sooner. Fire-and-forget + best-effort:
   * a hook failure or slowness never affects or delays the build. Omit it (default) = today's behavior.
   */
  onFilesReady?: (files: OneShotFile[]) => void | Promise<void>;
  /**
   * Called the moment the file plan is parsed, with how many files it asked for.
   *
   * This is the first honest measurement of how big the app is. Everything before it — the ETA, the
   * file budget, the cost pre-flight — is derived from counting words in the prompt, which is how
   * "Make an VPN App" scored the minimum of every formula and promised ~3 min for an 18-minute build.
   * Fired BEFORE the `minFiles` bail, so a plan too small for this lane still reports its size.
   */
  onPlanned?: (plannedFiles: number) => void;
}

export interface SimpleBuildResult {
  ok: boolean;
  filesWritten: number;
  summary: string;
  reason?: string;
  /** Deterministic end-state classification (BUILD_SUCCESS / TYPECHECK_FAILED / BUILD_PARTIAL / …). */
  outcome?: BuildOutcome;
  /**
   * HANDOFF (StudySync autopsy 2026-07-16): on a TIMEOUT fallback, the paths of the completed files
   * that were SALVAGED into the workspace before handing off — so the full builder continues from
   * them (its own prior work) instead of rebuilding from an empty tree. Empty/undefined when nothing
   * was salvageable (or the failure wasn't a timeout).
   */
  salvagedPaths?: string[];
  /**
   * FALSE when the verify gate was wired but could not EXECUTE (sandbox infra failure) — the app
   * shipped UNVERIFIED, so the caller must NOT skip its own downstream gates. True = tsc really ran
   * and passed; undefined = verify was not wired at all.
   */
  typecheckRan?: boolean;
  /**
   * The ACTUAL compiler/verify error text that made the per-file build fail (after repairs) — so the
   * build report can show WHY the fast lane fell back to the full builder, not just the outcome code.
   * Deep-test App #2 (2026-07-13): the report said only "TYPECHECK_FAILED" with no error, so the real
   * cause (a plan↔contract mismatch) could not be mined. Capped; only set on the ok:false verify path.
   */
  verifyErrors?: string;
  /**
   * How many files this lane's MANIFEST planned, whether or not the lane went on to succeed. 0 when
   * the plan never produced one (the plan call failed, timed out, or returned nothing parseable).
   *
   * ROOT CAUSE this exists for (admin report 2026-08-12, the dukaan stock app): after this lane failed,
   * the caller ran the ONE-SHOT lane — whose entire stated purpose is "a TRIVIAL one-file app the
   * manifest skips" — even though this lane's manifest had just planned EIGHT files. The one-shot's
   * precondition was already disproven, and 150 seconds went into a single ~8k-token call that could
   * not have produced that app under any circumstances. The measurement existed; it just died with the
   * closure before the caller could see it.
   */
  plannedFiles?: number;
}

/**
 * Run the Simple Builder. STICKY SUCCESS: once the files are written the build is a success even if
 * the best-effort preview is slow. Returns ok:false (never throws) on any failure so the caller falls
 * back to the agentic loop.
 */
export async function runSimpleBuild(deps: SimpleBuildDeps): Promise<SimpleBuildResult> {
  const minFiles = deps.minFiles ?? 2;
  // Per-file generation concurrency. Raised 5 → 8 (SPEED): the per-file calls are independent within
  // a dependency tier, so more parallelism cuts each wave's wall-clock near-linearly. Env-tunable
  // (AGENTV3_FASTLANE_CONCURRENCY) so it can be dialed back if Anthropic 429s appear — genOne already
  // returns null on failure and the file is dropped, so the cap trades throughput vs rate-limit risk.
  const envConc = Number(process.env.AGENTV3_FASTLANE_CONCURRENCY);
  const concurrency = deps.concurrency ?? (Number.isFinite(envConc) && envConc > 0 ? Math.min(envConc, 16) : 8);
  // LENS A — shared contract is ON by default (only skipped when explicitly disabled). A failed /
  // empty contract call NEVER fails the build — it just falls back to the prior contract-free path.
  const shareContract = deps.shareContract !== false;
  let files: OneShotFile[];
  let contract = '';
  // ZOMBIE-WRITE KILL + SALVAGE (StudySync root cause, 2026-07-16). withTimeout only RACES — the
  // inner closure keeps running after a timeout. In the real failure the timed-out lane finished
  // generating minutes later and dumped its files into the workspace WHILE the full builder was
  // already building its own structure → two parallel module trees → 4 broken imports → dead app.
  //   • `lapsed` flips the moment the race is lost: in-flight genOne results are discarded, later
  //     genOne calls return immediately (no more token burn), and the closure's final writeFiles is
  //     refused — the zombie can never touch the workspace again.
  //   • `generatedSoFar` mirrors every completed file OUTSIDE the closure, so the catch can SALVAGE
  //     the finished work into the workspace ONCE, synchronously, BEFORE the full builder starts —
  //     it continues from real files instead of rebuilding from an empty tree.
  let lapsed = false;
  const generatedSoFar: OneShotFile[] = [];
  // How many files this lane's own manifest planned. Hoisted OUT of the closure for the same reason
  // `generatedSoFar` is: it is the lane's most valuable measurement of how big the app really is, and
  // on the failure path the closure's locals are gone before the caller can ask. See
  // `SimpleBuildResult.plannedFiles` for what the caller does with it.
  let plannedFiles = 0;
  try {
    files = await withTimeout((async () => {
      deps.log?.('Planning the file list…');
      // Bound the PLAN call: if it exceeds planTimeoutMs the fast lane bails NOW (→ full builder) instead
      // of one slow call running to the 240 s overall cap. `withTimeout` only races, so the underlying call
      // keeps running in the background, but the lane stops waiting on it.
      //
      // BUDGET ALLOCATION (admin report 858f6d7b): the plan and contract caps used to be INDEPENDENT, so
      // two 90s caps could consume 180s of a 240s lane and leave 60s to generate the whole app — which is
      // exactly what happened (plan 89s + contract 70s = 159s before file one). `preambleCapMs` derives
      // each cap from what the budget can still afford, so a slow plan shrinks the contract's cap instead
      // of compounding with it, and the file-generation phase keeps its reserved majority.
      const configuredPlanCap = deps.planTimeoutMs ?? 90_000;
      const overallMs = deps.overallTimeoutMs ?? 240_000;
      const laneStartedAt = Date.now();
      const manifestText = await withTimeout(
        deps.generate(manifestSystemPrompt(deps.framework), manifestUserPrompt(deps.prompt, deps.scaffoldPaths)),
        preambleCapMs(overallMs, 0, configuredPlanCap), 'simple-plan');
      // The plan call is a REAL model call on this build's REAL provider chain, and it is the only
      // latency measurement that exists before a single file is generated. See canFinishAfterPreamble.
      const planCallMs = Date.now() - laneStartedAt;
      // THE OTHER HALF OF THE SEVEN MINUTES (50/50 law). Restoring src/ErrorBoundary.tsx after the fact
      // is recovery; this is why it needed recovering. The manifest prompt hands the model the scaffold
      // list and says "edit/extend", so the plan can — and did — include a file we ship correct, and the
      // very FIRST generation pass overwrote it with a version missing the `extends React.Component`
      // clause. The prompt now says these are provided, and this filter means that instruction cannot be
      // ignored: a boilerplate path is dropped from the plan whatever the model answered.
      const planned = parseFileManifest(manifestText);
      const droppedBoilerplate = planned.filter((m) => isScaffoldBoilerplate(m.path)).map((m) => m.path);
      const manifest = droppedBoilerplate.length ? planned.filter((m) => !isScaffoldBoilerplate(m.path)) : planned;
      if (droppedBoilerplate.length) {
        deps.log?.(`Skipping ${droppedBoilerplate.length} file(s) NavBharatAI already provides — they are correct as shipped: ${droppedBoilerplate.join(', ')}.`);
      }
      // Recorded BEFORE the minFiles bail: a manifest too small to be worth this lane is exactly the
      // case the one-shot lane exists for, and it must still be able to see that number. Counted AFTER
      // the filter, because that is the number of files this build will actually write.
      plannedFiles = manifest.length;
      try { deps.onPlanned?.(manifest.length); } catch { /* an ETA hook must never affect a build */ }
      if (manifest.length < minFiles) throw new Error('manifest_too_small');
      // LENS A — design the SHARED CONTRACT once, up front, so the isolated per-file calls agree on
      // names/shapes by construction (best-effort + bounded: a failure/timeout here just leaves `contract`
      // empty, so a storming contract call can't eat the budget either).
      // The contract's cap is whatever the preamble share can still afford after the plan. A cap of 0
      // means the plan already spent the share — skip the contract rather than starve file generation.
      // Safe by design: the contract is best-effort (an empty one weakens per-file agreement, which the
      // deterministic import/export reconcilers below then repair; a starved build phase produces no app
      // at all).
      const contractCap = shareContract ? preambleCapMs(overallMs, Date.now() - laneStartedAt, configuredPlanCap) : 0;
      if (shareContract && contractCap > 0) {
        deps.log?.('Designing the shared types & component contract…');
        try {
          contract = (await withTimeout(deps.generate(contractSystemPrompt(deps.framework), contractUserPrompt(deps.prompt, manifest)), contractCap, 'simple-contract') || '').trim();
        } catch { contract = ''; }
      } else if (shareContract) {
        deps.log?.('⏭️ Skipping the shared-contract pass — planning used the time it needed, so the remaining budget goes to writing your files.');
      }
      deps.log?.(`Building ${manifest.length} file(s) — one focused pass each…`);
      // REAL per-file progress: the chat used to go silent between "Building N file(s)…" and "Built
      // your app…" while N individual model calls ran (each taking real time) — the only signal
      // during that gap was the time-based ETA heartbeat, which looks scripted/fake because it isn't
      // tied to actual work. `filesDone` only increments on a GENUINE successful generation (never on
      // a failed/skipped file), so each tick is a real, verifiable event — not a guess.
      let filesDone = 0;
      // Generate ONE file (its own call, returns one FILE block). `produced` is the real source of
      // earlier-tier files, injected so this file uses their EXACT exported names.
      const genOne = async (spec: SimpleFileSpec, produced: OneShotFile[]): Promise<OneShotFile | null> => {
        if (lapsed) return null; // the lane already timed out — stop burning tokens on files nobody will use
        try {
          // Fix 69 — feed consumers the producers' EXPORT SURFACE (exact names/shapes/signatures,
          // full-file scan so no export is truncation-hidden) instead of full bodies: same contract
          // information at a fraction of the input tokens. AGENTV3_SIGNATURE_CONTEXT=off restores
          // the old full-body dump verbatim.
          const depBlock = produced.length
            ? (signatureContextEnabled() ? signatureDependencyContext(produced) : dependencyContext(produced))
            : '';
          const text = await deps.generate(fileSystemPrompt(deps.framework), fileUserPrompt(deps.prompt, spec, manifest, contract, depBlock));
          if (lapsed) return null; // timed out while this call was in flight — discard, don't log
          const blocks = parseFileBlocks(text);
          const match = blocks.find((b) => b.path === spec.path) ?? blocks[0];
          if (!match) return null;
          filesDone += 1; // synchronous — safe even with concurrent genOne calls in flight
          deps.log?.(`✓ ${spec.path} (${filesDone}/${manifest.length})`);
          const file = { path: spec.path, content: match.content };
          generatedSoFar.push(file); // mirror outside the closure so a timeout can salvage finished work
          return file;
        } catch {
          return null; // a single file's call failing must not kill the whole build
        }
      };

      // LENS B — STAGED, dependency-ordered generation (default ON). Build foundation (tier 0) first,
      // then components (1), then the shell/entry (2); each tier runs in parallel internally and is
      // fed the REAL source of all earlier tiers. When depOrder is off, or only one tier is present,
      // this is exactly today's single parallel batch.
      const depOrder = deps.depOrder !== false;
      const tiers = depOrder ? [0, 1, 2] : [0];
      // ARITHMETICALLY DOOMED BEFORE FILE ONE (dukaan report 2026-08-12). The between-tiers check below
      // needs a COMPLETED tier to measure, so it cannot protect a lane whose FIRST tier never finishes —
      // which is precisely what a timing-out provider produces. That build's plan call took 86.6s; three
      // tiers at that latency need ~260s against a 240s budget, and the lane still sat for its full 240
      // seconds and produced nothing. Only the tiers that actually have files are counted, so a manifest
      // that happens to be single-tier is judged on the one stage it will really run.
      const populatedTiers = depOrder
        ? tiers.filter((t) => manifest.some((s) => generationTier(s.path) === t)).length
        : 1;
      if (!canFinishAfterPreamble({ preambleCallMs: planCallMs, tiers: populatedTiers, elapsedMs: Date.now() - laneStartedAt, overallMs })) {
        // No file has been generated yet, so there is nothing to salvage — this is the same handoff the
        // timeout was going to perform, minutes earlier and without burning the budget to reach it.
        throw new Error(`simple-build ${preambleBailReason({ preambleCallMs: planCallMs, tiers: populatedTiers, elapsedMs: Date.now() - laneStartedAt, overallMs })}`);
      }
      const written: OneShotFile[] = [];
      for (let ti = 0; ti < tiers.length; ti++) {
        const tier = tiers[ti];
        const specs = depOrder ? manifest.filter((s) => generationTier(s.path) === tier) : manifest;
        if (specs.length === 0) continue;
        const producedSoFar = [...written]; // real source of all earlier tiers (snapshot for this tier)
        const tierStartedAt = Date.now();
        const gen = await mapWithConcurrency(specs, concurrency, (spec) => genOne(spec, producedSoFar));
        for (const f of gen) if (f && f.content) written.push(f);
        // EARLY BAIL (admin report 858f6d7b). A tier costs as much as its slowest file, so once ONE tier's
        // real duration is known the rest is predictable. The reported build ground on to the full 240s to
        // produce 4 of 14 files — work the full builder then had to continue anyway. Bailing the moment the
        // arithmetic says we cannot finish hands off sooner and without a tier being killed mid-flight;
        // the catch below salvages exactly the same finished files. Never fires without a real measurement.
        const tiersRemaining = tiers.length - 1 - ti;
        const progress = { tiersRemaining, lastTierMs: Date.now() - tierStartedAt, elapsedMs: Date.now() - laneStartedAt, overallMs };
        if (!canFinishRemainingTiers(progress)) {
          if (written.length >= minFiles) break; // enough files to be a real app — finish this build honestly
          throw new Error(`simple-build ${earlyBailReason(progress)}`);
        }
      }
      if (written.length < minFiles) throw new Error('too_few_files_generated');
      // DETERMINISTIC IMPORT SELF-HEAL before the files are written/previewed (jungle-game report
      // 104f5b09 + fae70e42): (1) fix unambiguous named<->default import mismatches; (2) ADD a
      // forgotten shared-symbol import — a value used but never imported (e.g. Background.ts using
      // CANVAS_HEIGHT with only `import type { LayerConfig }`) shipped as a runtime ReferenceError that
      // CRASHED the preview, because the fast lane never ran tsc. Best-effort; only ever turns a broken
      // build into a working one. Kill switch: AGENTV3_IMPORT_RECONCILE=off.
      if (process.env.AGENTV3_IMPORT_RECONCILE !== 'off') {
        try {
          const before = Object.fromEntries(written.map((f) => [f.path, f.content]));
          const recd = await reconcileImportExports(before);
          const addd = await addMissingProjectImports(recd.files);
          // (3) re-point a NAMED import at the correct module when the symbol lives in exactly one OTHER
          // module (Kanban build 2026-07-13 — the wrong source file). Unique-owner only; never a guess.
          const wrong = await fixWrongSourceImports(addd.files);
          const changes = recd.fixes.length + addd.added.length + wrong.fixes.length;
          if (changes > 0) {
            for (const f of written) { const nc = wrong.files[f.path]; if (typeof nc === 'string') f.content = nc; }
            deps.log?.(`🔧 Auto-fixed ${changes} import issue(s) (wrong-kind, forgotten, or wrong-source) before preview.`);
          }
        } catch { /* best-effort — a failure just leaves the files as generated */ }
      }
      // DETERMINISTIC MISSING-MODULE GENERATION on the FAST LANE too (rule-3 sibling-hunt, Kanban autopsy
      // 2026-07-13): the agentic path already generates a missing *.module.css from the importer's `styles.X`
      // usage and a missing folder barrel from existing leaves — no LLM step. The fast lane (the SIMPLER,
      // more common apps) had the SAME gap, so wire the same two pure generators here. Best-effort; only ever
      // turns a broken build into a working one. Kill: AGENTV3_CSS_MODULE_GEN / AGENTV3_BARREL_GEN = off.
      try {
        const beforeGen = Object.fromEntries(written.map((f) => [f.path, f.content]));
        const created: Array<{ path: string; content: string }> = [];
        if (process.env.AGENTV3_CSS_MODULE_GEN !== 'off') {
          for (const s of generateMissingCssModules(beforeGen)) created.push({ path: s.path, content: s.content });
        }
        if (process.env.AGENTV3_BARREL_GEN !== 'off') {
          const withCss = { ...beforeGen, ...Object.fromEntries(created.map((c) => [c.path, c.content])) };
          for (const b of await generateMissingBarrels(withCss)) created.push({ path: b.path, content: b.content });
        }
        // VITE CLIENT TYPES — the same certainty as the stubs above, and it lands BEFORE this lane's own
        // tsc gate, so an app reading import.meta.env never spends a repair round on
        // "Property 'env' does not exist on type 'ImportMeta'". Types-only: zero runtime effect.
        if (process.env.AGENTV3_VITE_ENV_TYPES !== 'off') {
          const scaffoldSeen = Object.fromEntries((deps.scaffoldPaths ?? []).map((p) => [p, '']));
          const dts = missingViteEnvTypes({ ...scaffoldSeen, ...beforeGen, ...Object.fromEntries(created.map((c) => [c.path, c.content])) });
          if (dts) created.push(dts);
        }
        if (created.length > 0) {
          const have = new Set(written.map((f) => f.path));
          for (const c of created) if (!have.has(c.path)) written.push(c);
          deps.log?.(`🎨 Generated ${created.length} missing module(s) (stylesheets/barrels) deterministically from usage before preview.`);
        }
      } catch { /* best-effort — a failure just leaves the missing modules for the honest verify below */ }
      // DETERMINISTIC LANGUAGE-COHERENCE RECONCILE before write/preview (admin deep-test App #1,
      // 2026-07-13): the shared-contract phase always emits TypeScript, and the per-file generator can
      // paste that TS (enum/interface/import type/`: Type`) into a `.jsx` file — which esbuild cannot
      // parse ("Unexpected token, expected from"), triggering failed repairs → one-shot fallback →
      // orphaned broken files → a permanently broken preview, on the SIMPLEST app. Renaming such a file
      // to its `.tsx`/`.ts` sibling (Vite parses TS fine) makes it compile on the FIRST pass. Extension-
      // less imports resolve automatically; explicit refs (index.html `<script src>`) are rewritten.
      // Best-effort; only ever turns a would-be-broken build into a working one. Kill: AGENTV3_LANG_RECONCILE=off.
      if (process.env.AGENTV3_LANG_RECONCILE !== 'off') {
        try {
          const before = Object.fromEntries(written.map((f) => [f.path, f.content]));
          const lang = reconcileLanguageExtensions(before);
          if (lang.renames.length > 0) {
            written.length = 0;
            for (const [path, content] of Object.entries(lang.files)) written.push({ path, content });
            deps.log?.(`🔧 Renamed ${lang.renames.length} file(s) to a TypeScript extension (contained TS syntax in a JS file) so they compile.`);
          }
        } catch { /* best-effort — a failure just leaves the files as generated */ }
      }
      // DETERMINISTIC HTML-ENTRY GUARD before write/preview (admin deep-test clock re-run, 2026-07-13):
      // the per-file builder can let the model rewrite index.html and DROP the `<script src="/src/main…">`
      // that boots the app → a blank page (React never mounts). Now that JS builds ship on the fast path
      // (verify tsc-can't-run → ran:false), a per-file app MUST be guaranteed to boot — so re-attach the
      // entry script + `#root` mount when the HTML lost them. Best-effort. Kill: AGENTV3_HTML_ENTRY_GUARD=off.
      if (process.env.AGENTV3_HTML_ENTRY_GUARD !== 'off') {
        try {
          const before = Object.fromEntries(written.map((f) => [f.path, f.content]));
          const guarded = ensureHtmlEntryScript(before);
          if (guarded.injected) {
            for (const f of written) { const nc = guarded.files[f.path]; if (typeof nc === 'string') f.content = nc; }
            deps.log?.('🔧 Re-attached the entry script to index.html so the app actually boots.');
          }
        } catch { /* best-effort — a failure just leaves the HTML as generated */ }
      }
      // DETERMINISTIC ORPHAN-STYLESHEET GUARD before write/preview (NotesNest autopsy 2026-07-16): a
      // generated global stylesheet that NOTHING imports ships as a raw unstyled app — the compiler,
      // tsc and the preview all stay green, so only this wiring check catches it. Inject the entry-side
      // side-effect import (`import './index.css'`) when the sheet is orphaned. Best-effort.
      // Kill: AGENTV3_CSS_IMPORT_GUARD=off.
      if (process.env.AGENTV3_CSS_IMPORT_GUARD !== 'off') {
        try {
          const before = Object.fromEntries(written.map((f) => [f.path, f.content]));
          const wired = injectGlobalStylesheetImport(before);
          if (wired.injected.length > 0) {
            for (const f of written) { const nc = wired.files[f.path]; if (typeof nc === 'string') f.content = nc; }
            deps.log?.(`🎨 Wired ${wired.injected.length} orphaned global stylesheet(s) into the entry so the app is actually styled.`);
          }
        } catch { /* best-effort — a failure just leaves the files as generated */ }
      }
      // DETERMINISTIC ORPHAN-PAGE WIRING before write/preview (deep-test SaaS dashboard 6f87751d): the
      // builder wrote page components (AnalyticsPage/ApiKeysPage/AuditLogPage/…) but never imported or
      // routed them → the app cannot reach them and readiness flags "N created but never used" +
      // "Requested feature not found". Wire each orphaned page into the react-router <Routes> (an import
      // + a <Route>). Additive-only, idempotent, and a no-op the moment the router is ambiguous, so it can
      // never break a working router. Best-effort. Kill: AGENTV3_ORPHAN_PAGE_GUARD=off.
      if (process.env.AGENTV3_ORPHAN_PAGE_GUARD !== 'off') {
        try {
          const before = Object.fromEntries(written.map((f) => [f.path, f.content]));
          const wired = wireOrphanPages(before);
          if (wired.wired.length > 0) {
            for (const f of written) { const nc = wired.files[f.path]; if (typeof nc === 'string') f.content = nc; }
            deps.log?.(`🧭 Wired ${wired.wired.length} orphaned page(s) into the router so they are actually reachable.`);
          }
        } catch { /* best-effort — a failure just leaves the files as generated */ }
      }
      // ZOMBIE GUARD: if the race was already lost, this closure is an orphan — writing now would dump
      // a second module tree into a workspace the full builder is ALREADY building in (the StudySync
      // catastrophe). Refuse; the catch below has salvaged what was finished.
      if (lapsed) throw new Error('simple-build-cancelled');
      await deps.writeFiles(written);
      // STREAMING FIRST-PAINT (gated by the caller via onFilesReady). The files are final and in the
      // workspace, but the verify+repair loop and the caller's install/dev-server boot (tens of
      // seconds) still lie ahead. Hand the ready files to the caller NOW so it can publish an early
      // in-browser preview — the user sees their real app while the slow infra tax runs. Fire-and-
      // forget + best-effort: a hook throw or slowness can never affect or delay the build.
      if (deps.onFilesReady) {
        try { void Promise.resolve(deps.onFilesReady(written)).catch(() => {}); } catch { /* a hook failure never touches the build */ }
      }
      return written;
    })(), deps.overallTimeoutMs ?? 240_000, 'simple-build');
  } catch (e) {
    lapsed = true; // from this instant the orphaned closure can neither write files nor burn more tokens
    const reason = e instanceof Error ? e.message : String(e);
    // SALVAGE (timeout only): hand the full builder the files that DID finish, so it continues from
    // real work instead of an empty tree. Written once, synchronously, BEFORE the fallback returns —
    // there is no later writer (the zombie is dead), so the workspace the full builder first reads is
    // exactly the workspace it keeps. Best-effort with its own small timeout; salvage failure only
    // means the old empty-tree behavior.
    let salvagedPaths: string[] | undefined;
    // An EARLY BAIL is a budget exhaustion the lane saw coming, so it salvages exactly like a timeout —
    // otherwise predicting the timeout instead of waiting for it would silently DISCARD the finished
    // files the old path preserved, making the improvement a regression.
    if ((reason.includes('timed out') || reason.includes('stopped early')) && generatedSoFar.length > 0) {
      const salvage = [...generatedSoFar]; // snapshot — in-flight genOne pushes can't mutate mid-write
      try {
        await withTimeout(deps.writeFiles(salvage), 30_000, 'simple-build-salvage');
        salvagedPaths = salvage.map((f) => f.path);
        deps.log?.(`⏱️ The fast lane ran out of time — handing its ${salvage.length} finished file(s) to the full builder to complete.`);
      } catch { /* salvage is best-effort — on failure the full builder starts from the scaffold as before */ }
    }
    return {
      ok: false,
      filesWritten: salvagedPaths?.length ?? 0,
      summary: salvagedPaths?.length
        ? `Simple build timed out after generating ${salvagedPaths.length} file(s) — the full builder continues from them.`
        : 'Simple build could not produce the app — switching to the full builder.',
      reason,
      outcome: 'BUILD_FAILED',
      salvagedPaths,
      plannedFiles,
    };
  }

  deps.log?.(`Built your app — ${files.length} file(s), each generated individually.`);

  // A — VERIFY GATE + bounded AUTO-REPAIR. "Preview is EARNED": only claim success when the app
  // actually compiles. If verify is not wired (e.g. no sandbox), the prior sticky-success behavior
  // is kept unchanged. On a verify infra error we DON'T block (best-effort). If it still doesn't
  // compile after repairs, return ok:false so the caller falls through to the full agentic builder
  // (its own repair loop + readiness gate finish it) — never worse than today, never a fake success.
  let typecheckRan: boolean | undefined;
  if (deps.verify) {
    const maxRepairs = deps.maxRepairs ?? 2;
    const byPath = new Map(files.map((f) => [f.path, f] as const));
    // A verify THROW = the check never executed (sandbox infra failure) — record that honestly
    // (ran:false) instead of silently converting it into a pass. The jungle-game report (2026-07-12)
    // shipped a runtime ReferenceError behind "Build verified ✓" through exactly this silent catch.
    let verdict: VerifyResult = await deps.verify().catch(() => ({ ok: true, errors: '', ran: false }));
    let attempt = 0;
    // GA-8 circuit-breaker: the errors that prompted the CURRENT attempt. If a repair comes back with the
    // byte-identical error set, the model is stuck and every further attempt burns a model call + verify
    // round to fail the same way — hand off to the full builder now. Safe: only ever fires while the build
    // is ALREADY failing (!verdict.ok), so it can never turn a passing build into a failing one.
    // DETERMINISTIC FIRST — put back the boilerplate WE ship before spending a model call on it.
    //
    // The agentic lane has done this since 2026-08-12; THIS lane never did, and the two verify paths
    // drifted apart in silence. A real build (2026-08-23) whose preview was already rendering then spent
    // seven minutes and four tsc runs on src/ErrorBoundary.tsx here, in the lane without the guard,
    // while the other lane would have fixed it for free in one write. That is the duplicated-logic class
    // this repo keeps paying for; the restore now lives in both places, and `protectBoilerplateInRepair`
    // below means a repair cannot re-break it afterwards.
    //
    // Costs nothing on a healthy build: `scaffoldRestores` returns {} unless tsc actually blames one of
    // our own files, and the extra verify only runs when something was genuinely put back.
    if (!verdict.ok && process.env.AGENTV3_SCAFFOLD_RESTORE !== 'off') {
      try {
        const restores = scaffoldRestores(Object.fromEntries([...byPath].map(([p, f]) => [p, f.content])), verdict.errors);
        const restoreFiles = Object.entries(restores).map(([path, content]) => ({ path, content }));
        if (restoreFiles.length > 0) {
          await deps.writeFiles(restoreFiles);
          for (const f of restoreFiles) byPath.set(f.path, f);
          deps.log?.(`Put ${restoreFiles.length} NavBharatAI-provided file(s) back to their known-good version — no repair pass needed for those.`);
          verdict = await deps.verify().catch(() => ({ ok: true, errors: '', ran: false }));
        }
      } catch { /* a free restore is best-effort — fall through to the model repair below */ }
    }
    let promptingErrors = verdict.errors;
    while (!verdict.ok && attempt < maxRepairs && deps.repair) {
      attempt++;
      // GA-8: each attempt climbs the ordered strategy ladder so a retry is a genuinely DIFFERENT push
      // (contract-full → focus-offenders → contract-authority), not the identical prompt re-fired.
      const strategy = repairStrategyForAttempt(attempt);
      deps.log?.(`Found build errors — fixing them (attempt ${attempt}/${maxRepairs}, ${strategy})…`);
      // LENS C — prepend a COMPACT deterministic cross-file drift report so the precise mismatches
      // (missing exports, bad enum members) survive the repair prompt's error-slice truncation and the
      // repair model sees the full set. Best-effort, advisory; tsc verdict stays the hard gate.
      let repairErrors = verdict.errors;
      try {
        const drift = contractDriftReport(Object.fromEntries([...byPath].map(([p, f]) => [p, f.content])));
        if (drift) repairErrors = `${drift}\n\n${verdict.errors}`;
      } catch { /* drift report is best-effort — never blocks repair */ }
      let fixed: OneShotFile[] = [];
      try { fixed = await deps.repair(repairErrors, [...byPath.values()], contract, strategy); } catch { fixed = []; }
      fixed = fixed.filter((f) => f && f.path && f.content);
      if (!fixed.length) break;
      // PREVENTION BY CONSTRUCTION, not by persuasion. A repair aimed at a file we own and that has one
      // correct form is replaced with that form — the model may propose it, it cannot land it. This is
      // what stops the four-rewrites-of-the-same-file loop rather than merely recovering from it.
      {
        const guarded = protectBoilerplateInRepair(fixed);
        if (guarded.overridden.length > 0) {
          deps.log?.(`Kept ${guarded.overridden.length} NavBharatAI-provided file(s) at their known-good version instead of applying a rewrite: ${guarded.overridden.join(', ')}.`);
        }
        fixed = guarded.files as OneShotFile[];
      }
      // ACCEPTANCE TEST (real build report 2026-08-23: a repair took the app from 4 errors to 41 and was
      // kept, because the only brake here was byte-IDENTICAL errors and 41 is not identical to 4). A
      // repair is a HYPOTHESIS; snapshot what it is about to overwrite so a regression can be undone.
      // See repairAcceptance.ts for why "worse" is a strict error COUNT and nothing more.
      const priorVerdict = verdict;
      const priorContents: OneShotFile[] = [];
      const createdPaths: string[] = [];
      for (const f of fixed) {
        const prior = byPath.get(f.path);
        if (prior) priorContents.push({ path: prior.path, content: prior.content });
        else createdPaths.push(f.path);
      }
      for (const f of fixed) byPath.set(f.path, f);
      try { await deps.writeFiles(fixed); } catch { break; }
      verdict = await deps.verify().catch(() => ({ ok: true, errors: '', ran: false }));
      const judgement = judgeRepair({
        beforeErrors: priorVerdict.errors, afterErrors: verdict.errors,
        afterOk: verdict.ok, afterRan: verdict.ran, createdPaths,
      });
      if (judgement.action !== 'keep') {
        deps.log?.(judgement.reason);
        if (judgement.action === 'revert') {
          // Put the better version back in BOTH places — the in-memory map the next attempt reads from
          // and the sandbox the next verify runs against. A revert in one and not the other is how the
          // loop would go on reasoning about files that are no longer there.
          // Sandbox FIRST, then the map. If the write fails we bail with both still describing the
          // post-repair state — consistent with each other and with reality, rather than a map that
          // claims files the sandbox does not have.
          try { await deps.writeFiles(priorContents); } catch { break; }
          for (const f of priorContents) byPath.set(f.path, f);
          // Restore the verdict too. Without this the loop's own condition, and the next attempt's
          // prompt, would both still be reasoning from the worse compiler output we just discarded.
          verdict = priorVerdict;
          promptingErrors = priorVerdict.errors;
          continue; // the NEXT ladder rung gets a fresh try from the better state, not the damaged one
        }
        break; // 'keep-and-stop' — coherent but worse; never compound it with another attempt
      }
      // Circuit-breaker: the repair produced the identical compiler errors → zero progress, it's stuck.
      if (!verdict.ok && verdict.errors === promptingErrors) {
        deps.log?.('The same build errors remain after a repair attempt — handing to the full builder to finish it.');
        break;
      }
      promptingErrors = verdict.errors;
    }
    if (!verdict.ok) {
      deps.log?.('The app still has build errors — handing to the full builder to finish it.');
      return {
        ok: false, filesWritten: files.length, reason: 'verify_failed',
        summary: 'Built the files but the app did not compile cleanly — switching to the full builder to finish it.',
        outcome: classifyBuildOutcome({ filesWritten: files.length, typecheckOk: false }),
        plannedFiles,
        typecheckRan: verdict.ran !== false,
        // Capture the REAL compiler error (capped) so the build report can be mined for the true cause.
        verifyErrors: (verdict.errors || '').trim().slice(0, 2000) || undefined,
      };
    }
    files = [...byPath.values()];
    typecheckRan = verdict.ran !== false;
    if (typecheckRan) {
      deps.log?.('Build verified — the app compiles. ✓');
    } else {
      // NEVER print "verified ✓" for a check that did not happen (rule: no fake success). The files
      // are still delivered (sticky success), but the caller keeps its own downstream gates ON.
      deps.log?.('⚠️ The type-check could not run in the sandbox — shipping the files unverified; the build gate will still audit them.');
    }
  }

  // VERIFIED (or verify not wired) → success; the preview is a best-effort bonus.
  if (deps.startPreview) {
    try { await withTimeout(deps.startPreview(), deps.previewTimeoutMs ?? 90_000, 'simple-preview'); }
    catch { deps.log?.('Preview is still starting — your files are ready.'); }
  }
  // typecheckOk: true ONLY when the verify gate genuinely RAN and passed; null when verify wasn't
  // wired OR could not execute (an un-run check is "unknown", never a pass — no fake success).
  // previewOk is left unknown here — the route's preview self-check can upgrade BUILD_PARTIAL → BUILD_SUCCESS.
  const outcome = classifyBuildOutcome({ filesWritten: files.length, typecheckOk: deps.verify && typecheckRan ? true : null });
  return { ok: true, filesWritten: files.length, summary: `Built your app file-by-file — ${files.length} file(s).`, outcome, typecheckRan, plannedFiles };
}
