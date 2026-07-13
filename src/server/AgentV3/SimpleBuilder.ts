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
import { parseFileBlocks, type OneShotFile } from './OneShotBuilder';
import { contractDriftReport } from './ContractMap';
import { classifyBuildOutcome, type BuildOutcome } from './BuildOutcome';
import { reconcileImportExports, addMissingProjectImports } from './ImportExportReconcile';
import { reconcileLanguageExtensions } from './LanguageCoherence';

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
    '- Do NOT list node_modules, lockfiles, or build output.',
  ].join('\n');
}

export function manifestUserPrompt(prompt: string, scaffoldPaths: string[]): string {
  const scaffold = scaffoldPaths.length
    ? `Already scaffolded (edit/extend; root is the project root):\n${scaffoldPaths.slice(0, 60).map((p) => `  - ${p}`).join('\n')}`
    : 'The project starts empty — plan all files at the project root.';
  return `Plan the file list for this app:\n\n${prompt}\n\n${scaffold}\n\nOutput the file list now (one "path :: purpose" per line).`;
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
    ...EXPORT_IMPORT_CONVENTION,
  ].join('\n');
}

/**
 * A FIXED export/import convention, injected into every per-file generation + repair prompt. Because
 * each file is generated in its OWN call, the model can't see another file's actual code — so without
 * a shared rule it guesses the export style and produces mismatches like `import useNotes from …`
 * against a NAMED `export function useNotes` (TS2613/TS2614), which the build then has to repair every
 * time. A single deterministic convention makes producers and consumers agree by construction.
 */
const EXPORT_IMPORT_CONVENTION: string[] = [
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

/** System prompt for the auto-repair pass — fixes real compiler errors in files just generated. */
export function repairSystemPrompt(framework: string): string {
  return [
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
    ...EXPORT_IMPORT_CONVENTION,
  ].join('\n');
}

export function repairUserPrompt(prompt: string, errors: string, files: OneShotFile[], contract?: string): string {
  const dump = files.map((f) => `<<<FILE ${f.path}>>>\n${f.content}\n<<<ENDFILE>>>`).join('\n\n');
  return [
    `App being built:\n${prompt}`,
    contractBlock(contract),
    '',
    `The build FAILED with these compiler errors:\n${errors.slice(0, 6000)}`,
    '',
    `Current files:\n${dump.slice(0, 60_000)}`,
    '',
    'Output ONLY the corrected <<<FILE …>>> blocks for the files you need to change. When two files',
    'disagree, the SHARED CONTRACT above is the source of truth — make both sides match it.',
  ].join('\n');
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
  repair?: (errors: string, files: OneShotFile[], contract?: string) => Promise<OneShotFile[]>;
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
  /** Hard cap (ms) on the best-effort preview (default 90 s). */
  previewTimeoutMs?: number;
}

export interface SimpleBuildResult {
  ok: boolean;
  filesWritten: number;
  summary: string;
  reason?: string;
  /** Deterministic end-state classification (BUILD_SUCCESS / TYPECHECK_FAILED / BUILD_PARTIAL / …). */
  outcome?: BuildOutcome;
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
  try {
    files = await withTimeout((async () => {
      deps.log?.('Planning the file list…');
      const manifestText = await deps.generate(manifestSystemPrompt(deps.framework), manifestUserPrompt(deps.prompt, deps.scaffoldPaths));
      const manifest = parseFileManifest(manifestText);
      if (manifest.length < minFiles) throw new Error('manifest_too_small');
      // LENS A — design the SHARED CONTRACT once, up front, so the isolated per-file calls agree on
      // names/shapes by construction (best-effort: a failure here just leaves `contract` empty).
      if (shareContract) {
        deps.log?.('Designing the shared types & component contract…');
        try {
          contract = (await deps.generate(contractSystemPrompt(deps.framework), contractUserPrompt(deps.prompt, manifest)) || '').trim();
        } catch { contract = ''; }
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
        try {
          const depBlock = produced.length ? dependencyContext(produced) : '';
          const text = await deps.generate(fileSystemPrompt(deps.framework), fileUserPrompt(deps.prompt, spec, manifest, contract, depBlock));
          const blocks = parseFileBlocks(text);
          const match = blocks.find((b) => b.path === spec.path) ?? blocks[0];
          if (!match) return null;
          filesDone += 1; // synchronous — safe even with concurrent genOne calls in flight
          deps.log?.(`✓ ${spec.path} (${filesDone}/${manifest.length})`);
          return { path: spec.path, content: match.content };
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
      const written: OneShotFile[] = [];
      for (const tier of tiers) {
        const specs = depOrder ? manifest.filter((s) => generationTier(s.path) === tier) : manifest;
        if (specs.length === 0) continue;
        const producedSoFar = [...written]; // real source of all earlier tiers (snapshot for this tier)
        const gen = await mapWithConcurrency(specs, concurrency, (spec) => genOne(spec, producedSoFar));
        for (const f of gen) if (f && f.content) written.push(f);
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
          const changes = recd.fixes.length + addd.added.length;
          if (changes > 0) {
            for (const f of written) { const nc = addd.files[f.path]; if (typeof nc === 'string') f.content = nc; }
            deps.log?.(`🔧 Auto-fixed ${changes} import issue(s) (wrong-kind or forgotten import) before preview.`);
          }
        } catch { /* best-effort — a failure just leaves the files as generated */ }
      }
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
      await deps.writeFiles(written);
      return written;
    })(), deps.overallTimeoutMs ?? 240_000, 'simple-build');
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, filesWritten: 0, summary: 'Simple build could not produce the app — switching to the full builder.', reason, outcome: 'BUILD_FAILED' };
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
    let promptingErrors = verdict.errors;
    while (!verdict.ok && attempt < maxRepairs && deps.repair) {
      attempt++;
      deps.log?.(`Found build errors — fixing them (attempt ${attempt}/${maxRepairs})…`);
      // LENS C — prepend a COMPACT deterministic cross-file drift report so the precise mismatches
      // (missing exports, bad enum members) survive the repair prompt's error-slice truncation and the
      // repair model sees the full set. Best-effort, advisory; tsc verdict stays the hard gate.
      let repairErrors = verdict.errors;
      try {
        const drift = contractDriftReport(Object.fromEntries([...byPath].map(([p, f]) => [p, f.content])));
        if (drift) repairErrors = `${drift}\n\n${verdict.errors}`;
      } catch { /* drift report is best-effort — never blocks repair */ }
      let fixed: OneShotFile[] = [];
      try { fixed = await deps.repair(repairErrors, [...byPath.values()], contract); } catch { fixed = []; }
      fixed = fixed.filter((f) => f && f.path && f.content);
      if (!fixed.length) break;
      for (const f of fixed) byPath.set(f.path, f);
      try { await deps.writeFiles(fixed); } catch { break; }
      verdict = await deps.verify().catch(() => ({ ok: true, errors: '', ran: false }));
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
  return { ok: true, filesWritten: files.length, summary: `Built your app file-by-file — ${files.length} file(s).`, outcome, typecheckRan };
}
