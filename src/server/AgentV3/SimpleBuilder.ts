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

import { dropShadowingEntries } from './entryShadow';
import { NO_EVAL_RULE, BUILD_WHAT_WAS_ASKED_RULE, NO_FAKED_RESULT_RULE, STABLE_SNAPSHOT_RULE, NO_FAKE_RESULTS_RULE, CORS_RULE, SEED_PASSWORD_RULE, NO_FAKE_FEATURE_RULE } from './noEvalRule';
import { posix } from 'node:path';
import { mapWithConcurrency, withTimeout } from './asyncUtils';
import { deadlineFromBudget, isReasoningRungHandoff } from './turnDeadline';
import { judgeRepair } from './repairAcceptance';
import { scaffoldRestores, protectBoilerplateInRepair, planProvidedFiles } from './scaffoldBoilerplate';
import { parseFileBlocks, type OneShotFile } from './OneShotBuilder';
import { isProjectConfigPath, existingFileBlock } from './existingConfig';
import { contractDriftReport } from './ContractMap';
import { classifyBuildOutcome, type BuildOutcome } from './BuildOutcome';
import { reconcileImportExports, addMissingProjectImports, fixWrongSourceImports, fixTypeOnlyValueImports } from './ImportExportReconcile';
import { parseTscErrors, endgameDeterministicPass, endgameRepairEnabled, ensureReactValueImport } from './EndgameRepair';
import { tscErrorCauses, tscCauseNote } from './tscErrorCause';
import type { FastLanePhases } from './fastLanePhases';
import { fileBudgetForPrompt, fileBudgetInstruction } from './fileBudget';
import { generateMissingCssModules } from './CssModuleGenerator';
import { missingViteEnvTypes } from './viteEnvTypes';
import { generateMissingBarrels } from './BarrelGenerator';
import { signatureContextEnabled, signatureDependencyContext } from './exportSurface';
import { classNamesUsedBy } from './CssConsistency';
import { BUILD_STOPPED_MESSAGE, BuildStoppedError, isBuildStoppedError, throwIfStopped } from './stopSignal';
import { reconcileLanguageExtensions } from './LanguageCoherence';
import { ensureHtmlEntryScript } from './HtmlEntryGuard';
import { wireOrphanPages } from './orphanPageWiring';
import { injectGlobalStylesheetImport, dedupeStylesheetImports } from './ProjectIntegrityChecks';
import { frameworkShipsDesignKit } from './designKitReach';
import { kitClasses } from './kitRestore';
import { preambleCapMs, canFinishRemainingTiers, earlyBailReason, canFinishAfterPreamble, canAffordSharedContract, preambleBailReason } from './FastLaneBudget';


/**
 * What a stopped lane tells the user. PURE. "The files finished so far are saved" was said whatever the
 * count, including when the stop came before file one (autopsy 31254f9a, beside a summary that rightly
 * said "Nothing had been written yet").
 */
export function stoppedLaneSummary(filesSaved: number): string {
  return filesSaved > 0
    ? `Stopped, as asked — the ${filesSaved} file(s) finished so far are saved.`
    : 'Stopped, as asked — no file had been written yet.';
}

export interface SimpleFileSpec {
  path: string;
  /** One-line description of what this file contains — guides its focused generation call. */
  purpose: string;
}

const HEAVY_OR_UNSAFE = /^(node_modules|\.git|dist|build)\//;

/** The lane's budget for an ordinary request — unchanged since 2026-07. */
export const FAST_LANE_BUDGET_MS = 240_000;
/**
 * The lane's budget for a COMPLEX request (admin-approved 2026-09-24, autopsy 3ab93068).
 *
 * 480 s, from that build's own measured phases on the rung complex builds open on: plan 40 s + a
 * contract given its full 90 s cap + three dependency tiers at ~100 s each ≈ 430 s, with headroom. The
 * 240 s budget cannot hold that at all — which is why its contract was cut and its repair ran 419 s.
 * Tunable without a deploy (`AGENTV3_FASTLANE_COMPLEX_SECONDS`, 240–900); an unreadable value falls back
 * to the default, never to "no limit".
 */
export const FAST_LANE_COMPLEX_BUDGET_MS = 480_000;
export function fastLaneBudgetMs(complex: boolean, env: NodeJS.ProcessEnv = process.env): number {
  if (!complex) return FAST_LANE_BUDGET_MS;
  const raw = String(env.AGENTV3_FASTLANE_COMPLEX_SECONDS ?? '').trim();
  const n = raw === '' ? NaN : Number(raw);
  if (!Number.isFinite(n)) return FAST_LANE_COMPLEX_BUDGET_MS;
  return Math.min(900, Math.max(240, Math.round(n))) * 1000;
}

/**
 * The app's ROOT COMPONENT — the file `main.tsx` mounts. Every other file is only reachable through it.
 */
const APP_ENTRY_RE = /^(src\/)?App\.[jt]sx?$/;
/** The mount point itself (`src/main.tsx`, `index.jsx` …), which may render the app without an App file. */
const MOUNT_ENTRY_RE = /^(src\/)?(main|index)\.[jt]sx?$/;
/**
 * A Next.js App Router page — the ONLY root a Next.js app has. There is no `main.tsx` to mount anything:
 * a plan that writes `src/main.tsx` for a Next.js app has written a file nothing runs (autopsy b47c56d8).
 */
const NEXT_PAGE_ENTRY_RE = /^(src\/)?app\/page\.[jt]sx?$/;

/** Does `path` render the app, given which starter the workspace holds? */
function isRootFor(path: string, starterEntryPath: string | undefined): boolean {
  if (starterEntryPath && NEXT_PAGE_ENTRY_RE.test(starterEntryPath)) return path === starterEntryPath;
  return APP_ENTRY_RE.test(path) || MOUNT_ENTRY_RE.test(path) || NEXT_PAGE_ENTRY_RE.test(path);
}

/**
 * 🔴 AN APP WHOSE ROOT WAS NEVER WRITTEN IS THE STARTER, HOWEVER MANY OTHER FILES EXIST
 * (autopsy 3ab93068, 2026-09-23).
 *
 * If the plan names neither a root component nor a mount point while the workspace still holds the
 * starter entry, every generated component would be written and then never shown — the page stays
 * "Hello World". The plan is repaired here, deterministically, so the entry is generated like any other
 * file: one more focused call, instead of a whole build that delivers nothing. Returns the manifest
 * unchanged when the plan already has a root (or when there is no starter to replace). PURE.
 */
export function ensureEntryPlanned(manifest: SimpleFileSpec[], starterEntryPath: string | undefined): { manifest: SimpleFileSpec[]; injected: string | null } {
  if (!starterEntryPath) return { manifest, injected: null };
  const hasRoot = manifest.some((m) => isRootFor(m.path, starterEntryPath));
  if (hasRoot) return { manifest, injected: null };
  return {
    manifest: [...manifest, { path: starterEntryPath, purpose: 'Root component that renders the whole app (replaces the starter page) by composing the components above' }],
    injected: starterEntryPath,
  };
}

/**
 * The planned root-component files that were NOT generated. Non-empty means the files built so far are
 * not connected to anything a user can see, so the lane must not call itself finished — it hands its
 * finished files to the full builder instead (the existing "stopped early" salvage). PURE.
 */
export function unwrittenEntries(manifest: SimpleFileSpec[], writtenPaths: Iterable<string>): string[] {
  const written = new Set(writtenPaths);
  return manifest.map((m) => m.path).filter((p) => (APP_ENTRY_RE.test(p) || NEXT_PAGE_ENTRY_RE.test(p)) && !written.has(p));
}

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
 * A scaffold file the PLANNER ITSELF says it will not change is not a file to write (autopsy d798ddd3).
 *
 * 🔴 Planning "Calculator app", the model listed eleven files and marked six of them in its own words —
 * `index.html :: HTML entry point (provided)`, `package.json :: … (provided)`, the three tsconfigs. They were
 * counted as the plan: the shared-contract pass was asked to design a contract for package.json and the
 * tsconfigs, and `ONESHOT_SKIPPED` said "the file plan had already found 9 files" for an app whose real
 * work was two. Only a path that IS in the scaffold and whose purpose says it is unchanged is dropped — a
 * planner that means to edit a scaffold file says what the edit is, and keeps it. PURE.
 */
const UNCHANGED_PURPOSE_RE = /\((?:provided|unchanged|existing|already (?:provided|scaffolded|exists|correct)|no changes?(?: needed| required)?|as[- ]is|keep as[- ]is)\)|\b(?:unchanged|no changes? (?:needed|required)|keep(?:s)? (?:it )?as[- ]is|already (?:provided|scaffolded|correct)(?: as shipped)?)\b/i;
export function dropUnchangedScaffold(
  manifest: SimpleFileSpec[],
  scaffoldPaths: readonly string[] = [],
): { kept: SimpleFileSpec[]; dropped: string[] } {
  const scaffold = new Set(scaffoldPaths);
  const dropped: string[] = [];
  const kept = manifest.filter((m) => {
    const unchanged = scaffold.has(m.path) && UNCHANGED_PURPOSE_RE.test(m.purpose || '');
    if (unchanged) dropped.push(m.path);
    return !unchanged;
  });
  return { kept, dropped };
}

/**
 * A plan with at most ONE module besides the entry has nothing for a shared contract to agree on
 * (autopsy d798ddd3). The calculator's real plan was `src/App.tsx` and a stylesheet; the contract pass —
 * a whole model call — was spent designing "shared types" for one component, crawled for 15 s and ended
 * the lane. A contract exists so isolated per-file calls agree on names; one module agrees with itself.
 * The entry (`main.tsx`/`index.tsx`) only renders the root component, which the scaffold already does. PURE.
 */
const ENTRY_MODULE_RE = /(?:^|\/)(?:main|index)\.(?:tsx?|jsx?)$/i;
const SOURCE_MODULE_RE = /\.(?:tsx?|jsx?|mjs|cjs|vue|svelte)$/i;
export function contractHasNothingToShare(manifest: readonly SimpleFileSpec[]): boolean {
  const modules = manifest.filter((m) => SOURCE_MODULE_RE.test(m.path) && !/\.d\.ts$/i.test(m.path) && !ENTRY_MODULE_RE.test(m.path));
  return modules.length <= 1;
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
 *   3 = stylesheets (STYLESHEET_TIER) — after the shell, so they style the class names the screens chose.
 * PURE + unit-testable. With only one effective tier present, the staged build collapses to today's
 * single parallel batch.
 */
/** The last generation stage: stylesheets, after every file whose class names they must style. */
export const STYLESHEET_TIER = 3;

/** A stylesheet the fast lane writes as ordinary CSS (a CSS module is keyed by `styles.x`, not class names). */
export function isStylesheetPath(path: string): boolean {
  return /\.(css|scss|sass|less|styl)$/i.test(path);
}

/**
 * How many generation stages the lane MUST run to produce an app: every populated tier except the
 * stylesheet stage, which the lane may skip when out of time (the app renders without it, and the
 * verify gate's class check then asks for the rules). Never less than one. PURE.
 */
export function requiredStageCount(paths: readonly string[]): number {
  const tiers = new Set(paths.map((p) => generationTier(p)).filter((t) => t !== STYLESHEET_TIER));
  return Math.max(1, tiers.size);
}

/**
 * The block a STYLESHEET's generation call is given instead of the components' export signatures:
 * the exact class names the already-written screens put on elements. An export surface drops JSX
 * bodies, so it carries no className at all — the stylesheet was styling classes it had to guess.
 * Empty when there is nothing to style. PURE.
 */
export function stylesheetClassContext(produced: readonly OneShotFile[], framework?: string | null): string {
  const used = classNamesUsedBy(Object.fromEntries(produced.map((f) => [f.path, f.content])));
  if (used.length === 0) return '';
  // 🎨 A kit class the screens use is ALREADY styled — by the kit, in this project. Listing it with
  // "style EVERY one" had this call write a second, weaker rule for `.card` and `.btn-primary` that sat
  // after the kit and overrode it: the designed look undone by the file meant to add to it.
  const kit = frameworkShipsDesignKit(framework) ? kitClasses() : new Set<string>();
  const classes = used.filter((c) => !kit.has(c));
  const fromKit = used.filter((c) => kit.has(c));
  const lines = [''];
  if (classes.length > 0) {
    lines.push(
      'CLASS NAMES THE SCREENS ALREADY USE — these files are written and will not change. Style EVERY one',
      'of these exact class names with a real rule (same spelling, same case); do not rename them and do',
      'not invent different ones. Add element and state rules as the design needs:',
      classes.map((c) => `.${c}`).join(', '),
    );
  }
  if (fromKit.length > 0) {
    lines.push(
      "ALREADY STYLED by the project's design kit — do NOT write rules for these, and do not remove the kit:",
      fromKit.map((c) => `.${c}`).join(', '),
    );
  }
  return lines.join('\n');
}

export function generationTier(path: string): number {
  const p = path.toLowerCase();
  // Shell / entry / pages — generated last (they import the components + foundation).
  if (/(^|\/)(main|index)\.[jt]sx?$/.test(p) && !/(^|\/)components?\//.test(p)) return 2;
  if (/(^|\/)app\.[jt]sx?$/.test(p)) return 2;
  if (/(^|\/)(pages?|routes?|router)(\/|\.)/.test(p)) return 2;
  if (/(page|screen|view)\.[jt]sx?$/.test(p)) return 2;
  /**
   * 🔴 A STYLESHEET IS GENERATED **LAST**, NOT FIRST (autopsy `f152c1ab`, 2026-09-20).
   *
   * It used to `return 0` — the FOUNDATION wave, before everything. What that cost, measured: a
   * 7-file app whose tier 0 held exactly ONE file, `src/App.css`. It took **137 seconds of a 240
   * second budget**, the lane bailed with *"2 stage(s) left would need about 468s"*, and the only
   * thing salvaged from a 3.7-minute build was a **10 KB stylesheet for an app that did not exist**.
   * The user stopped the build 2.5 seconds later.
   *
   * 🔑 THE DEPENDENCY ARGUMENT RUNS THE OTHER WAY, and that is the real defect. Tier 0 exists so
   * later tiers can be handed the REAL source of what they import (`dependencyContext`) — exact
   * exported names, enum members, prop types. **A stylesheet exports none of those.** What it
   * actually needs is the opposite: the class names the COMPONENTS chose, which only exist once the
   * components are written. Generating CSS first forced the model to INVENT class names that every
   * later file then had to match — backwards, and exactly how a 10 KB stylesheet gets written for an
   * app nobody has built yet.
   *
   * 🔒 AND IT IS THE MOST DEFERRABLE FILE IN ANY APP. A build cut short after the components renders
   * — plainly, but it renders. A build cut short after the stylesheet renders NOTHING. Under a
   * budget the order must put the stylesheet last, and now does: in the reported build this alone
   * takes the lane from THREE stages to TWO, so the first wave produces both real components
   * instead of one stylesheet.
   *
   * ⚠️ Stated as a CLASS rather than one extension: `.scss` / `.sass` / `.less` / `.styl` were
   * already landing in tier 1 by fall-through, and the same argument applies to every one of them —
   * a stylesheet follows the markup it styles, whatever its syntax. A CSS MODULE follows it too: a
   * component referencing `styles.card` is the thing that decides `.card` exists.
   *
   * 🔴 AND "LAST" MUST MEAN AFTER THE SHELL, NOT BESIDE IT (autopsy 2720e553, 2026-09-27). The line
   * below used to return 2 — the SHELL's tier — so in any app whose screens live in `App.tsx` (most
   * small apps) the stylesheet was generated CONCURRENTLY with the only file that uses its classes.
   * A secret-calculator build did exactly that: `src/index.css` invented one set of class names,
   * `src/App.tsx` chose another, the class check failed, and three repair rounds spent 494 s — 61% of
   * the lane — rewriting the stylesheet three different ways. The last one left `{ }`.
   * It is its own final stage now, and is handed the exact class names the screens use
   * (`stylesheetClassContext`). That stage is DEFERRABLE: the budget projection does not count it
   * (`requiredStageCount`), and a lane out of time stops before it with the app written.
   */
  if (isStylesheetPath(p)) return STYLESHEET_TIER;
  // Foundation — generated first.
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
/**
 * The boilerplate files this workspace ACTUALLY holds. `SCAFFOLD_BOILERPLATE` is the Vite scaffold's; a
 * Next.js workspace has no `src/ErrorBoundary.tsx`, so telling its planner the file is "provided" — and
 * dropping it from the plan — promised a file that did not exist (autopsy b47c56d8). An empty listing
 * (we could not look) keeps the old behaviour.
 */
export function providedBoilerplate(scaffoldPaths: readonly string[] = []): string[] {
  // The error boundary plus the starter's compiler files (autopsy 70e030bb) — one list, scaffoldBoilerplate.ts.
  return planProvidedFiles(scaffoldPaths);
}

/** Where the app's entry lives, in words the planner can act on. */
function entryFilesHint(framework: string): string {
  return /next/i.test(framework)
    ? 'the App Router entry app/page.tsx (and app/layout.tsx when the shell changes) — a Next.js app has NO src/main.tsx and NO index.html; a component nothing imports from app/ is never shown'
    : 'e.g. src/App.tsx, index.html';
}

export function manifestSystemPrompt(framework: string, scaffoldPaths?: readonly string[]): string {
  const provided = providedBoilerplate(scaffoldPaths);
  return [
    `You are an elite ${framework} engineer. Plan the COMPLETE file list for the app the user wants.`,
    '',
    'OUTPUT: one line per file, EXACTLY in this format (nothing else, no prose, no code):',
    '  relative/path/from/project/root.ext :: one concise sentence describing this file\'s contents',
    '',
    'RULES:',
    '- List EVERY source file the app needs (entry, components, styles, hooks, utils, config it must edit).',
    `- Edit/replace the scaffolded entry files (${entryFilesHint(framework)}) — do not nest a subfolder.`,
    '- Keep it minimal but COMPLETE — no file the app references should be missing.',
    // SIZE DISCIPLINE (admin 2026-08-02): "minimal" alone is an adjective a weak model reads as optional —
    // a real build planned 50 files for an app needing ~12. The per-app NUMBER lives in the user prompt
    // (fileBudgetInstruction); this is the app-agnostic anti-pattern that produces most of the bloat.
    '- One file per REAL unit of the app. Never a separate file for a single tiny helper, type or constant —',
    '  co-locate it with its only user. Fewer, cohesive files beat many thin ones.',
    '- Do NOT list node_modules, lockfiles, or build output.',
    // The persuasion half of the boilerplate fix; SimpleBuilder drops these from the parsed plan
    // regardless, so a model that ignores this line still cannot overwrite them.
    ...(provided.length ? [`- These files are PROVIDED and already correct — do NOT list them, do not rewrite them: ${provided.join(', ')}.`] : []),
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
    '- Never generate simulated/mock data about OTHER people (nearby shops, other users, followers, drivers) and present it as real — showing other people\'s data needs a shared online database. Example entries shown for layout must be labelled on screen as examples.',
    '- Match the imports/exports the rest of the app expects (you are given the full file list).',
    NO_EVAL_RULE,
    NO_FAKE_RESULTS_RULE,
    BUILD_WHAT_WAS_ASKED_RULE,
    NO_FAKED_RESULT_RULE,
    STABLE_SNAPSHOT_RULE,
    CORS_RULE,
    SEED_PASSWORD_RULE,
    NO_FAKE_FEATURE_RULE,
    ...webPlatformRule(framework),
    ...exportImportConvention(framework),
    ...designContractFor(framework),
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
 * 🎨 THE KIT, BY NAME (admin 2026-09-30: "app/game ek dam simple se html bante hai — na koi design, na
 * sundarta, na animations"). Rendered in a real browser, a screen built from the kit's classes looked
 * designed and the SAME screen built from class names the model invented (`.app`, `.todo-list`) looked
 * like raw HTML — because nothing styled those names. DESIGN_CONTRACT asked for good design and never
 * said the design already exists, so every file invented its own. Only given where the scaffold really
 * ships the kit (`frameworkShipsDesignKit`) — a kit class with no CSS behind it is worse than none.
 */
export const DESIGN_KIT_VOCABULARY: string[] = [
  '',
  "THE PROJECT'S GLOBAL STYLESHEET ALREADY IS A DESIGN KIT — build the screens from its classes instead of",
  'inventing class names nobody styles (an invented, unstyled class is exactly what makes an app look like',
  'plain HTML). Bare <button>, <input>, <table> and lists are already styled; reach for these first:',
  '- Page: `.container` (centred, padded) with `.stack` / `.row` for spacing; an <h1> and a `.muted` subtitle.',
  '- Surfaces: `.card` (items of a list as `.card` rows); `.nb-table-wrap` > `table.nb-table`; `.nb-stats` > `.nb-stat` (+ `-label` / `-value`); `.nb-hero`, `.nb-auth-card`, `.nb-modal`.',
  '- Controls: `button.btn-primary` for the main action; a plain <button> is already a tinted secondary; `.btn-ghost`; a filter or view switch is `.nb-tabs` > `button.nb-tab` with aria-selected="true" on the chosen one; each field in `.field` with a <label>.',
  '- States: `.nb-empty` (+ `-icon` / `-title` / `-text`) for anything that can be empty; `.nb-skeleton` while loading; `.nb-toast` for "Saved"/"Copied".',
  '- Motion: `.nb-rise` on a panel that appears; `.nb-stagger` on a list so its items arrive one by one.',
  '- SHOP / menu / catalogue: `.nb-header` with `.nb-brand`, an `input.nb-search` and `.nb-header-actions`; categories as `.nb-chips` > `button.nb-chip` (`.active` on the chosen one); products in `.nb-grid` > `.nb-product` (`.nb-product-img`, `h3.nb-product-title`, `.nb-price-row` > `.nb-price` + `.nb-mrp` (struck through) + `.nb-discount`, then `button.btn-primary.nb-product-cta`); `.nb-qty` for − 1 +; `.nb-cart-bar` fixed at the bottom; `.nb-footer`.',
  '- A link that acts as a button (`<a class="btn-primary">`) gets the full button shape — no need to restyle it.',
  '- Chat: `.nb-chat` holding `.nb-msg nb-msg-user` / `.nb-msg nb-msg-bot`, with `.nb-composer` at the bottom.',
  '- GAMES: the stage is `.nb-game`; start/pause/game-over screens are `.nb-game-screen` with `h1.nb-game-title` and REAL `<button class="nb-game-btn">` (`nb-game-btn nb-game-btn-secondary` for a second choice) — never a clickable <div>; the score and health sit in `.nb-game-hud` as `.nb-game-stat` and `.nb-game-bar` > `.nb-game-bar-fill` (style="--value: 0.6"); on phones add `.nb-game-pad` > `.nb-game-keys` > `button.nb-game-key`.',
  "- Your own stylesheet ADDS to the kit (your own classes, your own --accent); do not restyle or remove the kit's classes.",
];

/** The design block a per-file call is given: the bar, plus the kit by name where the scaffold has it. PURE. */
export function designContractFor(framework: string | null | undefined): string[] {
  return frameworkShipsDesignKit(framework) ? [...DESIGN_CONTRACT, ...DESIGN_KIT_VOCABULARY] : DESIGN_CONTRACT;
}

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
  '  • STYLING: ONE global stylesheet (the manifest\'s `src/index.css` or `src/App.css`, imported once from',
  '    main/App with `import "./index.css"`) holds every class the screens use — components use',
  '    `className="card"` with names that stylesheet defines. Use CSS Modules (`import styles from',
  '    "./X.module.css"`) ONLY when the existing project already does; never introduce them into an app',
  '    that styles itself with a global stylesheet.',
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
/**
 * A web app's files may not be written for a PHONE framework (autopsy 33812996). One isolated per-file
 * call in a vite-react Circle to Search app wrote `src/utils/safeImage.ts` against `react-native`
 * (`ImageSourcePropType`, `Image as RNImage`) — a package the app does not have and a browser cannot
 * run. The call sees only its own file, so the platform is said to it. React Native / Expo projects get
 * nothing. PURE.
 */
export function webPlatformRule(framework: string): string[] {
  const fw = (framework || '').toLowerCase();
  if (!fw || /react-?native|expo/.test(fw)) return [];
  return ['- This is a WEB app that runs in a browser: never import react-native or react-native-* packages — use HTML elements (<img>, <div>, <button>) instead.'];
}

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
    // Autopsy 6ae30b33: `data.ts` exported `MOCK_GK_QUESTIONS` while both hooks, written at the same
    // time, imported `gkQuestions` — a value nobody had named, so each file guessed.
    '  • The EXACT name and type of every shared CONSTANT another file imports (seed data, option lists,',
    '    config maps), declared as `export declare const gkQuestions: GKQuestion[];`.',
    '  • For EACH component, its props interface with EXACT prop names + types',
    '    (e.g. `interface PlayerProps { url: string; mediaType: MediaType }`).',
    '',
    'RULES:',
    '- These names are FROZEN. Files generated later MUST use these EXACT identifiers — no synonyms,',
    '  no re-casing, no renaming. If a symbol is not here, files must not assume it exists.',
    '- Real declarations only — no `// TODO`, no placeholder shapes. Keep it minimal but complete.',
    // Autopsy 121c2431: the contract named its data type `StationaryItem` beside a planned component
    // file `StationaryItem.tsx`; that file then imported the type and declared a component of the same
    // name, and the collision was one of the errors the build never got past.
    '- NO NAME MAY BE BOTH A TYPE AND A COMPONENT. A component file `Foo.tsx` exports a component named',
    '  `Foo`, so no type, interface or enum here may be named after any component in the file list —',
    '  name the data type for what it IS (e.g. `StationeryRecord` for the data, `StationeryItem` for the card).',
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

/**
 * Render the shared contract as the prompt block injected into every per-file + repair call.
 *
 * With `at`, the contract is ALSO a real file at `at.path` (see `contractModule`), and the block says
 * so — with the exact import specifier from `at.from` when that is known — so the isolated per-file
 * call has somewhere to import the shared symbols from instead of a paragraph to guess a path for.
 */
/**
 * An enum is a VALUE (autopsy f496c75b, 2026-09-30). The contract declares enums, and the per-file
 * convention asks for `import type` on types, so `useInput.ts` imported the `InputAction` enum type-only
 * and read its members: TS1361 on every line, re-quoted by the write-time typecheck for seven minutes.
 */
export const ENUM_IMPORT_RULE = 'An ENUM (or a const, function or class) is a VALUE: import it with a plain `import { Name }`, never `import type` — a type-only import of an enum fails to compile the moment a member is read.';

/**
 * The fast lane's deterministic import fixes, in one place (autopsy 6cd698cc): (1) a named/default import of
 * the wrong kind, (2) a shared symbol used but never imported, (3) a named import pointed at the wrong module
 * when the symbol lives in exactly one other, (4) an enum/const imported with `import type` and read as a value
 * (autopsy f496c75b). Run on a finished lane before preview AND on the files a timed-out lane hands to the
 * full builder — before 2026-10-01 only the first, so a handed-over file kept the errors the lane would have
 * fixed. Every step only turns a broken file into a working one. Never throws.
 */
export async function deterministicImportFixes(files: ReadonlyArray<{ path: string; content: string }>): Promise<{ files: Record<string, string>; changes: number }> {
  const before = Object.fromEntries(files.map((f) => [f.path, f.content]));
  try {
    const recd = await reconcileImportExports(before);
    const addd = await addMissingProjectImports(recd.files);
    const wrong = await fixWrongSourceImports(addd.files);
    const typeOnly = await fixTypeOnlyValueImports(wrong.files);
    return { files: typeOnly.files, changes: recd.fixes.length + addd.added.length + wrong.fixes.length + typeOnly.fixes.length };
  } catch {
    return { files: before, changes: 0 };
  }
}

export function contractBlock(contract: string | undefined, at?: { path: string; from?: string }): string {
  const trimmed = (contract || '').trim();
  if (!trimmed) return '';
  if (at?.path) {
    const spec = at.from ? contractImportSpecifier(at.from, at.path) : '';
    return [
      '',
      `SHARED CONTRACT — ALREADY WRITTEN to \`${at.path}\` as real, exported declarations. Every enum,`,
      'interface and type below EXISTS in that file: IMPORT it from there'
        + (spec ? ` (from this file the specifier is \`${spec}\`)` : ' (relative path from the importing file)')
        + ' — never redeclare it in',
      'another file, never import it from any other path, and never invent a `types/` folder or file for',
      'it. Utility/helper SIGNATURES listed here are implemented in the file the file list names for them,',
      'not in the contract file. These symbols are FROZEN and SHARED across files: use these EXACT names,',
      'enum members, types, util signatures, and component prop interfaces. Do NOT rename, re-case,',
      'or invent variants; do NOT import a symbol that is not declared here:',
      ENUM_IMPORT_RULE,
      '```ts',
      trimmed.slice(0, 12_000),
      '```',
    ].join('\n');
  }
  return [
    '',
    'SHARED CONTRACT — these symbols are FROZEN and SHARED across files. Use these EXACT names,',
    'enum members, types, util signatures, and component prop interfaces. Do NOT rename, re-case,',
    'or invent variants; do NOT import a symbol that is not declared here:',
    ENUM_IMPORT_RULE,
    '```ts',
    trimmed.slice(0, 12_000),
    '```',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE CONTRACT IS A FILE, NOT A PARAGRAPH (autopsy 57875eb3, 2026-09-17).
//
// 🔴 THE DEFECT. The shared contract above was handed to every per-file call as PROSE — "these
// symbols are FROZEN, do NOT import a symbol that is not declared here" — and never told the file
// WHERE those symbols live, because they lived nowhere: the manifest planned no file for them. Eleven
// isolated calls then each guessed a home. In the car-racing build that produced this section, the
// same `GameStatus` / `PlayerProps` contract was imported from `../types/game`, `../types/note`,
// `./types/game` and `./App` — four invented paths for one paragraph, plus one file that re-declared
// the interfaces inline. Not one of those modules existed, so `tsc` failed on file one, the repair
// pass was needed at all, and that pass is where the build then spent twenty-seven minutes.
//
// 🔑 THE FIX IS UPSTREAM (the 50/50 law): give the symbols a real home BEFORE any file is written.
// `contractModule` turns the contract text into an actual TypeScript module of exported enums,
// interfaces and type aliases; the lane writes it at `contractFilePath` as the first produced file,
// lists it in every per-file prompt, and `contractBlock` tells each file the exact relative
// specifier to import it from. A file can no longer invent a path, because the path is given.
//
// ⚠️ What is deliberately NOT put in the file: utility/helper SIGNATURES. The contract declares them
// as bodiless signatures (`export function extractEmbedUrl(url: string): string`), which is valid in
// a declaration context and a compile error in a module. They stay in the prose block, and are
// implemented by the file the manifest names — exactly as before.
//
// 🔒 SAFE BY CONSTRUCTION. A contract that yields no exportable declaration produces no file (today's
// behaviour, byte-identical); a framework this cannot be right for (Python, a plain Node script)
// produces no file; and `AGENTV3_CONTRACT_FILE=off` restores today's behaviour without a deploy.
// The deterministic import reconciler already re-points a named import at a symbol's unique owner —
// so once the owner EXISTS, even a file that still guesses is corrected for free before `tsc` runs.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Kill switch — `AGENTV3_UTIL_OWNER=off` leaves contract helpers without a named file, as before. Default ON. */
export function utilOwnerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_UTIL_OWNER ?? '').trim().toLowerCase() !== 'off';
}

/** Kill switch — `off` restores the prose-only contract exactly. Default ON. */
export function contractFileEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_CONTRACT_FILE ?? '').trim().toLowerCase() !== 'off';
}

/**
 * Can a TypeScript contract module be a real file of this project? Pure.
 *
 * Positive list of the bundler/TS frameworks the fast lane actually builds (Vite resolves a `.ts`
 * import from a `.jsx` file, so a JavaScript React app is fine). Anything unrecognised — Python,
 * Rails, a bare Node script that runs without a bundler — gets today's prose-only behaviour: a wrong
 * answer here would ADD a file that cannot be loaded, so unknown means no.
 */
export function frameworkSupportsContractFile(framework: string | undefined): boolean {
  const fw = String(framework ?? '').toLowerCase();
  if (!fw) return false;
  if (/python|fastapi|flask|django|rails|ruby|php|laravel|\bgo\b|golang|rust|java\b|spring|dotnet|\.net/.test(fw)) return false;
  return /react|vite|next|remix|gatsby|vue|nuxt|svelte|astro|solid|qwik|angular|typescript|\bts\b/.test(fw);
}

/** Where the contract module lives: beside the app's sources when they are under `src/`. Pure. */
export function contractFilePath(manifest: ReadonlyArray<{ path: string }>): string {
  return manifest.some((f) => f.path.startsWith('src/')) ? 'src/types.ts' : 'types.ts';
}

/** The relative import specifier for `contractPath` from inside `fromPath` (no extension). Pure. */
export function contractImportSpecifier(fromPath: string, contractPath: string): string {
  let rel = posix.relative(posix.dirname(fromPath), contractPath).replace(/\.tsx?$/, '');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

/**
 * The utility functions the contract declares WITHOUT a body (`export function calculate(a: number): number;`).
 *
 * 🔴 WHY THESE NEED AN OWNER (autopsy 876afca9, 2026-09-30 — "Create a calculation app"). The contract
 * declared four helpers (`calculate`, `isValidOperand`, `formatResult`, `generateCalculationId`), the
 * contract FILE rightly kept only the types, and the prompt said helpers "are implemented in the file the
 * file list names for them". The file list named NO file for them. So `App.tsx` imported all four from
 * `./types`, `tsc` failed with five errors, and the repair spent 241 s — 53% of the lane — writing the
 * helpers into the types file. A symbol with no home gets a guessed home, the same defect the contract
 * file was built to end for types. PURE.
 */
export function contractUtilSignatures(contract: string | undefined): string[] {
  let text = String(contract ?? '').replace(/\r\n?/g, '\n');
  text = text.replace(/^[ \t]*```[a-zA-Z]*[ \t]*$/gm, '');
  const names: string[] = [];
  for (const st of topLevelStatements(text)) {
    const m = /^(?:export\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(st);
    if (!m) continue;
    if (!/;\s*$/.test(st) && /\}\s*$/.test(st)) continue; // ends in `}` with no `;`: it has a body
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

export interface UtilOwner {
  /** The file that implements and exports the contract's utility functions. */
  path: string;
  /** True when the lane ADDED this file to the manifest (no planned file owned the helpers). */
  added: boolean;
}

/**
 * Which file implements the contract's bodiless helpers — the one the manifest already gives them, or a
 * new `utils.ts` beside the contract file. PURE (the caller applies `added` to its manifest).
 *
 * Owner, in order: a planned file whose purpose names one of the helpers; a planned `utils`/`helpers`
 * file in the contract's folder; a planned plain module whose name and purpose DESCRIBE the helpers
 * (`helperModuleByWords`); otherwise a new `<contract folder>/utils.ts`. Never the contract file itself —
 * that file holds types only, and a bodiless signature there is a compile error.
 */
export function utilOwnerFor(manifest: ReadonlyArray<SimpleFileSpec>, names: readonly string[], contractPath: string): UtilOwner | null {
  if (names.length === 0) return null;
  const candidates = manifest.filter((f) => f.path !== contractPath && /\.[jt]sx?$/.test(f.path));
  const named = candidates.find((f) => names.some((n) => new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`).test(f.purpose || '')));
  if (named) return { path: named.path, added: false };
  const dir = posix.dirname(contractPath);
  const inDir = (p: string) => posix.dirname(p) === dir;
  const helper = candidates.find((f) => inDir(f.path) && /(^|\/)(utils?|helpers?)\.[jt]s$/i.test(f.path));
  if (helper) return { path: helper.path, added: false };
  const described = helperModuleByWords(candidates, names);
  if (described) return { path: described.path, added: false };
  const ext = /\.js$/.test(contractPath) ? 'js' : 'ts';
  return { path: dir === '.' ? `utils.${ext}` : `${dir}/utils.${ext}`, added: true };
}

/** Words too common in a file's purpose line to say which helpers it holds. */
const OWNER_STOPWORDS = new Set(['with', 'from', 'into', 'that', 'this', 'file', 'files', 'logic', 'helper', 'helpers', 'util', 'utils', 'utility', 'utilities', 'function', 'functions', 'shared', 'component', 'components', 'module', 'value', 'values']);

/** The four-letter stems of a name or a purpose line's words (`generateSampleSalesData` → gene, samp, sale, data). PURE. */
function ownerStems(text: string): Set<string> {
  const words = String(text ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !OWNER_STOPWORDS.has(w));
  return new Set(words.map((w) => w.slice(0, 4)));
}

/**
 * A planned plain module (never a component) whose path and purpose describe the helpers. PURE.
 *
 * 🔴 WHY (build 9762f589, 2026-09-30 — "sales ki city wise, only 10 employees"). The plan had
 * `src/utils/sales.ts :: Sample sales data generation with 10 employees and city distribution logic`, and the
 * contract's helpers were `generateSampleSalesData` and `aggregateCitySales`. The purpose DESCRIBED them without
 * NAMING them, and the file sat in `src/utils/`, not beside the contract — so neither rule above matched and
 * the lane ADDED a second home, `src/utils.ts`. Both files then wrote the same two helpers with different
 * signatures; `App.tsx` called `generateSampleSalesData()` with the arguments of one and the return shape of
 * the other, and three repair passes were spent on the disagreement.
 *
 * Precision-first, because a wrong owner is an import pointed at the wrong file: only `.ts`/`.js` modules
 * (a `.tsx` component is not where helpers live, and a component's purpose shares words with its data —
 * `SalesTable` says "sales"), never a config file, an entry or a declaration file, and a pick only when one
 * file clearly leads with at least two shared stems. A file under `utils/`, `helpers/` or `lib/` counts one
 * more. A tie or a weaker match adds `utils.ts` exactly as before.
 */
export function helperModuleByWords(candidates: ReadonlyArray<SimpleFileSpec>, names: readonly string[]): SimpleFileSpec | null {
  const want = new Set<string>();
  for (const n of names) for (const s of ownerStems(n)) want.add(s);
  if (want.size === 0) return null;
  const scored = candidates
    .filter((f) => /\.[jt]s$/.test(f.path) && !/\.d\.ts$/.test(f.path) && !/(^|\/)[^/]*\.config\.[jt]s$/.test(f.path)
      && !/(^|\/)(main|server|app)\.[jt]s$/i.test(f.path)
      && !(/(^|\/)index\.[jt]s$/i.test(f.path) && !/(^|\/)(utils?|helpers?|lib)\/index\.[jt]s$/i.test(f.path)))
    .map((f) => {
      const have = ownerStems(`${posix.basename(f.path).replace(/\.[jt]s$/, '')} ${f.purpose || ''}`);
      const shared = [...want].filter((s) => have.has(s)).length;
      const inHelperDir = /(^|\/)(utils?|helpers?|lib)\//i.test(f.path) ? 1 : 0;
      return { f, shared, score: shared + inHelperDir };
    })
    .filter((x) => x.shared >= 2)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[1].score === scored[0].score) return null;
  return scored[0].f;
}

/** The purpose line the lane gives the helpers' owner, naming each helper it must implement. PURE. */
export function utilOwnerPurpose(names: readonly string[], existing?: string): string {
  const need = `Implements and exports these shared utility functions exactly as the shared contract declares them: ${names.join(', ')}.`;
  return existing ? `${existing} ${need}` : need;
}

/** The note appended to the contract text so every per-file and repair call knows where the helpers live. PURE. */
export function utilOwnerNote(names: readonly string[], ownerPath: string): string {
  return `\n// The utility functions above (${names.join(', ')}) are implemented and exported by ${ownerPath} — import them from that file, never from the types file.`;
}

/**
 * The shared CONSTANTS the contract declares (`export declare const gkQuestions: GKQuestion[];`).
 *
 * 🔴 AUTOPSY 6ae30b33 (2026-09-30). The contract carried types and props, never a value. `src/utils/data.ts`
 * and both hooks that read it sit in the SAME generation tier, so they were written at the same time:
 * the data file exported `MOCK_GK_QUESTIONS`, the hooks imported `gkQuestions` and `swimmingBenefits`,
 * `tsc` failed and the lane handed its unfinished work on. A value two files share is a name two files
 * must agree on, exactly like a type. PURE.
 */
export function contractValueExports(contract: string | undefined): string[] {
  let text = String(contract ?? '').replace(/\r\n?/g, '\n');
  text = text.replace(/^[ \t]*```[a-zA-Z]*[ \t]*$/gm, '');
  const names: string[] = [];
  for (const st of topLevelStatements(text)) {
    const m = /^(?:export\s+)?(?:declare\s+)?const\s+(?!enum\b)([A-Za-z_$][\w$]*)\s*:/.exec(st);
    if (m && !names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

/**
 * Which file exports the contract's shared constants: a planned file whose purpose names one of them, a
 * planned data/constants/mock file, or a new `data.ts` beside the contract file. Never the contract file,
 * which holds types only. PURE (the caller applies `added` to its manifest).
 */
export function valueOwnerFor(manifest: ReadonlyArray<SimpleFileSpec>, names: readonly string[], contractPath: string): UtilOwner | null {
  if (names.length === 0) return null;
  const candidates = manifest.filter((f) => f.path !== contractPath && /\.[jt]sx?$/.test(f.path));
  const named = candidates.find((f) => names.some((n) => new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`).test(f.purpose || '')));
  if (named) return { path: named.path, added: false };
  const dataFile = candidates.find((f) => /(^|\/)(data|constants?|mocks?|mockData|fixtures?|seed(?:Data)?)\.[jt]sx?$/i.test(f.path));
  if (dataFile) return { path: dataFile.path, added: false };
  const inDataDir = dataDirOwner(candidates, names);
  if (inDataDir) return { path: inDataDir.path, added: false };
  const dir = posix.dirname(contractPath);
  const ext = /\.js$/.test(contractPath) ? 'js' : 'ts';
  return { path: dir === '.' ? `data.${ext}` : `${dir}/data.${ext}`, added: true };
}

/**
 * A planned plain module inside a constants / data / mocks / fixtures / seed FOLDER. PURE.
 *
 * 🔴 WHY (autopsy de3bb2bb, 2026-10-01). The plan had `src/constants/chat.ts` for the app's error
 * messages and timeout, and the contract declared `DEFAULT_LOCALE`, `ERROR_MESSAGES`, `API_TIMEOUT`. The rule
 * above matches a file NAMED `constants.ts`, never one that lives in `constants/`, so the lane ADDED
 * `src/data.ts`. The lane handed off before writing it, and the files it had written imported `../data`, a
 * module that did not exist: 21 type errors for the full builder to fix first. The planned file had written
 * exactly those three constants.
 *
 * One such module ⇒ it owns the constants. Several ⇒ the one whose name and purpose share the most word
 * stems with the constants, and a tie picks nobody (the lane then adds `data.ts`, as before). A `.tsx`
 * component, a declaration file and a config file are never owners.
 */
export function dataDirOwner(candidates: ReadonlyArray<SimpleFileSpec>, names: readonly string[]): SimpleFileSpec | null {
  const inDir = candidates.filter((f) => /(^|\/)(constants?|data|mocks?|fixtures?|seeds?)\/[^/]+\.[jt]s$/i.test(f.path)
    && !/\.d\.ts$/i.test(f.path) && !/(^|\/)[^/]*\.config\.[jt]s$/i.test(f.path));
  if (inDir.length === 0) return null;
  if (inDir.length === 1) return inDir[0];
  const want = new Set<string>();
  for (const n of names) for (const s of ownerStems(n)) want.add(s);
  const scored = inDir
    .map((f) => ({ f, score: [...ownerStems(`${posix.basename(f.path).replace(/\.[jt]s$/, '')} ${f.purpose || ''}`)].filter((s) => want.has(s)).length }))
    .sort((a, b) => b.score - a.score);
  if (scored[0].score === 0 || (scored.length > 1 && scored[1].score === scored[0].score)) return null;
  return scored[0].f;
}

/** The purpose line the constants' owner is given, naming each constant it must export. PURE. */
export function valueOwnerPurpose(names: readonly string[], existing?: string): string {
  const need = `Exports these shared constants under exactly these names, typed as the shared contract declares them: ${names.join(', ')}.`;
  return existing ? `${existing} ${need}` : need;
}

/** The note appended to the contract so every call knows where the constants live. PURE. */
export function valueOwnerNote(names: readonly string[], ownerPath: string): string {
  return `\n// The constants above (${names.join(', ')}) are exported by ${ownerPath} under exactly these names — import them from that file, never from the types file.`;
}

export interface ContractModule {
  /** The module source — exported enums, interfaces and type aliases only. */
  source: string;
  /** The exported symbol names, in declaration order. */
  symbols: string[];
}

const CONTRACT_HEAD = /^(?:export\s+)?(?:declare\s+)?(?:const\s+)?(enum|interface|type)\s+([A-Za-z_$][\w$]*)/;
/**
 * `const X = { … } as const` / `const X = [ … ] as const` — an enum written as data. Kept only when the
 * literal calls nothing (no `(`), so the contract file never depends on code it does not contain.
 */
const LITERAL_CONST = /^(?:export\s+)?(?:declare\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*[{[][^()]*[}\]]\s*as\s+const\s*;?\s*$/;
/** A line that begins a new top-level statement — used to end a statement that has no `;`. */
const TOP_LEVEL_START = /^(?:export|declare|import|enum|interface|type|function|const|let|var|class|abstract|namespace|module)\b/;

/**
 * Split TypeScript source into its top-level statements. Tracks brace/paren/bracket depth and skips
 * strings, template literals and comments; a statement ends at a `;` at depth 0, or at a line break at
 * depth 0 when the next non-blank line starts another top-level statement (or the text ends). Pure;
 * never throws on any input.
 */
export function topLevelStatements(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let i = 0;
  const n = text.length;
  const nextLineStartsStatement = (from: number): boolean => {
    // Skip whitespace and any comments that lead the next statement — a statement that opens with a
    // comment is still a statement.
    let rest = text.slice(from);
    for (;;) {
      const before = rest;
      rest = rest.replace(/^\s+/, '').replace(/^\/\/[^\n]*\n?/, '').replace(/^\/\*[\s\S]*?\*\//, '');
      if (rest === before) break;
    }
    return rest === '' || TOP_LEVEL_START.test(rest);
  };
  const flush = (end: number) => {
    if (start >= 0) {
      const st = text.slice(start, end).trim();
      if (st) out.push(st);
    }
    start = -1;
  };
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    // Comments: skip whole, but keep them inside a statement's span (they are harmless in output).
    if (c === '/' && next === '/') { const e = text.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (c === '/' && next === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      if (start < 0) start = i;
      let j = i + 1;
      while (j < n && text[j] !== c) { if (text[j] === '\\') j++; j++; }
      i = j + 1;
      continue;
    }
    if (start < 0) {
      if (/\s/.test(c)) { i++; continue; }
      start = i;
    }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) { flush(i + 1); i++; continue; }
    else if (c === '\n' && depth === 0 && nextLineStartsStatement(i + 1)) { flush(i); i++; continue; }
    i++;
  }
  flush(n);
  return out;
}

/**
 * Turn the contract paragraph into a real TypeScript module, or null when there is nothing to write.
 *
 * Kept: `enum` / `interface` / `type` declarations (exported, `declare` stripped, `const enum`
 * demoted to `enum` because `isolatedModules` cannot import an ambient const enum) and any `import`
 * lines the contract itself carries. Dropped: everything else — bodiless function signatures,
 * `declare function`, bare `const x: T;` — because those are declarations, not module code. A
 * contract that uses the `React.` namespace without importing it gets a type-only import added, since
 * `@types/react`'s UMD global is not reachable from a module. Pure.
 */
/**
 * One import line of the contract, as the types module may carry it. PURE.
 *
 * 🔴 AUTOPSY f496c75b: the contract imported a helper from `./MathUtils` while `MathUtils.ts` imported its
 * types from the contract — a circular VALUE import between two app files, the kind that is undefined on
 * import at run time. The types module is meant to be a leaf: everything it shares it declares itself,
 * and helpers live in their own owner (`utilOwnerFor`). So an import from another APP file is made
 * type-only (erased, so no cycle exists when the app runs; `typeof helper` still type-checks), and a
 * bare side-effect import of an app file is dropped. A package import (`react`) is kept as written.
 */
export function contractImport(statement: string): string | null {
  const st = statement.trim().replace(/;?\s*$/, ';');
  const spec = /\bfrom\s*['"]([^'"]+)['"]|^import\s*['"]([^'"]+)['"]/.exec(st);
  const target = spec ? (spec[1] ?? spec[2]) : '';
  if (!target.startsWith('.')) return st;
  if (/^import\s*['"]/.test(st)) return null; // a side-effect import of an app file
  if (/^import\s+type\b/.test(st)) return st;
  const bare = st.replace(/\{\s*type\s+/g, '{ ').replace(/,\s*type\s+/g, ', ');
  // `import type Foo, { a }` is not allowed — a type-only import names a default OR bindings — so split it.
  const both = /^import\s+([A-Za-z_$][\w$]*)\s*,\s*(\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*)\s+from\s+(['"][^'"]+['"]);$/.exec(bare);
  if (both) return `import type ${both[1]} from ${both[3]};\nimport type ${both[2]} from ${both[3]};`;
  return bare.replace(/^import\s+/, 'import type ');
}

export function contractModule(contract: string | undefined): ContractModule | null {
  let text = String(contract ?? '').replace(/\r\n?/g, '\n');
  text = text.replace(/^[ \t]*```[a-zA-Z]*[ \t]*$/gm, ''); // fences the prompt asked it not to add
  const kept: string[] = [];
  const imports: string[] = [];
  const symbols: string[] = [];
  const seen = new Set<string>();
  for (const st of topLevelStatements(text)) {
    if (/^import\b/.test(st)) {
      const line = contractImport(st);
      if (line) imports.push(line);
      continue;
    }
    // 🔴 AUTOPSY 120eb52f (2026-09-30). The contract declared an enum the modern way —
    // `export const EventStatus = { UPCOMING: 'UPCOMING', … } as const;` beside
    // `export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];` — and only the TYPE
    // reached the file: a `const` is not an enum, interface or type, and it has no `: Type` for the
    // constants' owner to pick up either, so it fell through both. The type then named a value that
    // existed nowhere, the types file did not compile, and the full builder spent its first edits
    // writing a second `EventStatus` into it. A literal `as const` object or array is pure data the
    // contract wrote out in full, so it is kept here with its type.
    const literal = LITERAL_CONST.exec(st);
    if (literal) {
      const name = literal[1];
      if (seen.has(`value:${name}`)) continue;
      seen.add(`value:${name}`);
      kept.push(`export ${st.replace(/^(?:export\s+)?(?:declare\s+)?/, '').replace(/;?\s*$/, ';')}`);
      if (!symbols.includes(name)) symbols.push(name);
      continue;
    }
    const head = CONTRACT_HEAD.exec(st);
    if (!head) continue;
    const name = head[2];
    if (seen.has(name)) continue; // a duplicate declaration is a compile error; first one wins
    seen.add(name);
    // Normalise the head: one `export`, no `declare`, no `const enum`.
    const body = st.replace(/^(?:export\s+)?(?:declare\s+)?(?:const\s+)?/, '');
    kept.push(`export ${body}`);
    // A type may share its name with a kept `as const` value (that is the pattern) — one symbol, not two.
    if (!symbols.includes(name)) symbols.push(name);
  }
  if (kept.length === 0) return null;
  const joined = kept.join('\n\n');
  if (/\bReact\.[A-Za-z]/.test(joined) && !imports.some((l) => /['"]react['"]/.test(l))) {
    imports.unshift("import type * as React from 'react';");
  }
  const header = [
    '// Shared contract — the enums, interfaces and types every file of this app imports from here.',
    '// Written by NavBharatAI before any other file, so all files agree on these names by construction.',
  ];
  const source = `${[...header, ...(imports.length ? ['', ...imports] : []), '', joined].join('\n')}\n`;
  return { source, symbols };
}

/** Kill switch — `AGENTV3_CONTRACT_NAME_SPLIT=off` leaves a type named after a component as the model wrote it. Default ON. */
export function contractNameSplitEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_CONTRACT_NAME_SPLIT ?? '').trim().toLowerCase() !== 'off';
}

/**
 * Rename every contract type, interface or enum that has the name of a planned component. PURE.
 *
 * 🔴 WHY BY CONSTRUCTION (build 9762f589, 2026-09-30). The contract prompt has said "NO NAME MAY BE BOTH A
 * TYPE AND A COMPONENT" since autopsy 121c2431, and this contract still declared `interface CitySummary` beside
 * a planned `src/components/CitySummary.tsx`. That file imported the type and declared a component of the same
 * name (TS2865), the first repair turned it into a self-import, and the error survived all three passes. A
 * rule the model can ignore twice is not a rule; the contract is ours to adjust before file one is written.
 *
 * A clashing name `X` becomes `XData` (then `XInfo`, `XRecord`) — the first not already declared — at every
 * whole-word use in the contract, so `XProps` and other compounds are untouched. Only PascalCase `.tsx`/`.jsx`
 * files count as components; nothing else is renamed.
 */
export function separateTypeFromComponentNames(
  contract: string,
  manifest: ReadonlyArray<{ path: string }>,
): { contract: string; renamed: Array<{ from: string; to: string }> } {
  const components = new Set(
    manifest
      .filter((f) => /\.[jt]sx$/.test(f.path))
      .map((f) => posix.basename(f.path).replace(/\.[jt]sx$/, ''))
      .filter((n) => /^[A-Z][A-Za-z0-9]*$/.test(n)),
  );
  if (components.size === 0) return { contract, renamed: [] };
  const declared = new Set<string>();
  const values = new Set<string>();
  for (const st of topLevelStatements(String(contract ?? '').replace(/\r\n?/g, '\n'))) {
    const head = CONTRACT_HEAD.exec(st);
    if (head) { declared.add(head[2]); continue; }
    const value = /^(?:export\s+)?(?:declare\s+)?(?:default\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/.exec(st);
    if (value) values.add(value[1]);
  }
  let out = contract;
  const renamed: Array<{ from: string; to: string }> = [];
  for (const name of [...declared]) {
    // The contract also declares the component itself under this name: a whole-word rename would
    // rename the component too. Leave it; the mechanical TS2865 fix is the net for this shape.
    if (!components.has(name) || values.has(name)) continue;
    const to = ['Data', 'Info', 'Record'].map((s) => `${name}${s}`).find((n) => !declared.has(n) && !components.has(n));
    if (!to) continue;
    out = out.replace(new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'g'), to);
    declared.add(to);
    renamed.push({ from: name, to });
  }
  return { contract: out, renamed };
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

export function fileUserPrompt(prompt: string, file: SimpleFileSpec, manifest: SimpleFileSpec[], contract?: string, deps?: string, contractPath?: string, existing?: string | null): string {
  const listed = manifest.map((f) => `  - ${f.path}${f.purpose ? ` — ${f.purpose}` : ''}`);
  // The contract file is a real file of the app: list it, so "the complete file list" is complete.
  if (contractPath && !manifest.some((f) => f.path === contractPath)) {
    listed.unshift(`  - ${contractPath} — SHARED CONTRACT (already written): the enums, interfaces and types below`);
  }
  const fileList = listed.join('\n');
  return [
    `App being built:\n${prompt}`,
    '',
    `The app's complete file list (so your imports line up):\n${fileList}`,
    contractBlock(contract, contractPath ? { path: contractPath, from: file.path } : undefined),
    deps || '',
    '',
    `Now write THIS file in full:\n  ${file.path}${file.purpose ? `\n  Purpose: ${file.purpose}` : ''}`,
    existingFileBlock(file.path, existing),
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
  const knownSet = new Set(known);
  return pathsNamedInErrors(errors).filter((p) => knownSet.has(p));
}

/**
 * Every source path a compiler error blob names, whether or not this build wrote it. Same token rule
 * as `offendingFiles` (a path-like token right before `(l,c)` or `:l:c`), which is now built on this;
 * a leading `./` is dropped so the answer compares with workspace paths. Pure; first-appearance order.
 */
export function pathsNamedInErrors(errors: string): string[] {
  if (!errors || typeof errors !== 'string') return [];
  const seen = new Set<string>();
  const out: string[] = [];
  // Match a path-like token (has a slash or a dotted extension) immediately before `(l,c)` or `:l:c`.
  const re = /(^|\s)([\w./-]+\.[a-zA-Z]{1,5})(?=\s*[(:]\s*\d+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(errors)) !== null) {
    const p = m[2].replace(/^\.\//, '');
    if (!seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out;
}

/**
 * Keep only the repair files that are IN SCOPE — a file the repair was shown, or one the errors name.
 *
 * Autopsy eed79815 (2026-09-26): the post-build typecheck repair was handed this build's files and a
 * list of errors, and answered with SEVENTEEN files, none of which it had been shown or the compiler
 * had named — a login page, an auth context, a router, two stylesheets — for a car game. A repair has
 * exactly one job: change the files that are wrong. A path outside that set is not a fix, it is a new
 * app, and writing it is how a finished game gained somebody else's scaffold. `dropped` is returned so
 * the caller can say so rather than discard silently. Pure.
 */
export function limitRepairToScope<T extends { path: string }>(fixes: T[], scope: Iterable<string>): { kept: T[]; dropped: string[] } {
  const norm = (p: string) => p.trim().replace(/^\.\//, '');
  const allowed = new Set<string>();
  for (const p of scope) allowed.add(norm(p));
  const kept: T[] = [];
  const dropped: string[] = [];
  for (const f of fixes) {
    if (allowed.has(norm(f.path))) kept.push(f);
    else dropped.push(f.path);
  }
  return { kept, dropped };
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
  contractPath?: string,
): string {
  const dump = files.map((f) => `<<<FILE ${f.path}>>>\n${f.content}\n<<<ENDFILE>>>`).join('\n\n');
  const lines = [
    `App being built:\n${prompt}`,
    contractBlock(contract, contractPath ? { path: contractPath } : undefined),
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
  /**
   * ONE cheap text-generation call (Haiku/etc). Returns the raw model text.
   *
   * `opts.deadlineAt` is an ABSOLUTE epoch-ms instant after which this lane stops waiting, forwarded
   * to the provider chain so the call it starts can no longer outlive the lane that asked for it. It
   * is optional on purpose: a caller (and every test) that omits it gets exactly today's behaviour.
   * See turnDeadline.ts for the report that produced it.
   */
  generate: (system: string, user: string, opts?: { deadlineAt?: number }) => Promise<string>;
  /**
   * Asked before every per-file call and after every tier: should the lane stop NOW and hand what it
   * has to the full builder? Returns the reason, or null to carry on.
   *
   * 🔴 WHY (autopsy Study-Racer, 2026-09-25): `fastLaneRungDecision` skips the lane when the build
   * OPENS on a rung that always reasons — the opener was glm-4.7-flashx, so the lane ran. Flashx then
   * crawled INSIDE the lane and the chain fell to kimi-k2.7-code, a rung that reasons before every
   * answer: the next per-file call took 123 s for a 2.3 KB hook (3,427 output tokens for 2,340
   * characters), and the lane handed off anyway at 157 s with 3 of 13 files. The decision taken once
   * at the opener needs a sibling taken on every fall. The route answers from the model that served
   * the last call; a lane that never falls never hears from it.
   */
  stopLane?: () => string | null;
  /**
   * The BUILD's stop signal (Stop / Unsend / a lease stop). Read before every model call, tier,
   * verify and repair round and before the preview starts; a stopped lane saves the files it
   * finished and returns `stopped: true` (autopsy 2720e553 — the lane used to ignore Stop entirely
   * and ran another nine minutes of model calls after it). Absent → today's behaviour.
   */
  signal?: AbortSignal;
  /**
   * Read a file the project already holds (preview bridge stripped), so a planned CONFIG file is edited
   * rather than rewritten blind — see `isProjectConfigPath`. Absent → today's behaviour.
   */
  readExisting?: (path: string) => Promise<string | null>;
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
  repair?: (errors: string, files: OneShotFile[], contract?: string, strategy?: RepairStrategy, contractPath?: string) => Promise<OneShotFile[]>;
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
  /**
   * The workspace's app entry when it is still the untouched starter template (`src/App.tsx` saying
   * "Hello World"), else undefined. Supplied by the caller, who can read the file; this lane only
   * knows paths. When set, the lane will not report success without having rewritten that entry —
   * see `ensureEntryPlanned` / `unwrittenEntries` (autopsy 3ab93068).
   */
  starterEntryPath?: string;
  /**
   * The request was judged COMPLEX (`complexityRouting.ts`, score above its 40 line). A complex lane
   * gets a larger budget and never skips its shared contract — see `fastLaneBudgetMs`.
   */
  complex?: boolean;
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
  /**
   * Called when the lane stops WRITING the app and starts VERIFYING and REPAIRING one that already
   * runs. The preview uses it to stop hard-remounting under a user mid-repair — see
   * components/agentv3/previewReloadPolicy.ts.
   */
  onSettling?: () => void;
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
   * The file list the lane PLANNED, whether or not it wrote any of them.
   *
   * Separate from `salvagedPaths`, which is finished work now in the workspace. This is only a plan —
   * so the caller offers it to the full builder as a starting point, never as something already done.
   * Empty when the lane failed before planning.
   */
  plannedPaths?: string[];
  /**
   * FALSE when the verify gate was wired but could not EXECUTE (sandbox infra failure) — the app
   * shipped UNVERIFIED, so the caller must NOT skip its own downstream gates. True = tsc really ran
   * and passed; undefined = verify was not wired at all.
   */
  typecheckRan?: boolean;
  /** TRUE when the lane ended because the build was asked to stop — never a failure of the app. */
  stopped?: boolean;
  /**
   * TRUE when the lane handed its plan to the full builder because the next engine reasons before every
   * answer — a planned handoff, never a failure (autopsy 8f797751: the report called it "could not
   * produce the app" and `BUILD_FAILED` beside `LLM_CALL_HANDED_OFF`).
   */
  handedOff?: boolean;
  /**
   * WHERE THE FAST LANE'S MINUTES WENT (autopsy `21b431e1`, 2026-09-22). Measurement only — nothing
   * reads it to make a decision.
   *
   * 🔴 WHY IT HAD TO EXIST BEFORE ANY FIX. That build spent ~8.5 minutes in this lane and died on ONE
   * `TS2554`, then handed off and was rebuilt by the architect — the single most expensive item in
   * the report. Two plausible cures were available (hand off sooner when the first verify blames many
   * files; send the repair only the offending file) and **nothing in the report could say which phase
   * the time was actually in**, so choosing between them would have been a guess. This repo's fourth
   * absolute rule forbids fixing from a guess; this is the evidence the fix will be chosen from.
   *
   * Every field is a real clock around a real call, summed across rounds. `verifyRuns` and
   * `repairRuns` are counts, not durations, so a lane that verified three times and repaired twice is
   * distinguishable from one that sat in a single slow compile.
   */
  phases?: FastLanePhases;
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
  /**
   * The phase ledger, as it stands right now. Called on EVERY return path — the handoff paths most of
   * all, since a lane that hands off is the one whose minutes are worth explaining. Returns undefined
   * before the lane started, so a caller never reports an all-zero ledger as a measurement of zero
   * (the `writeTypecheckUntouched` lesson, one module along).
   */
  // 🔴 A PHASE THAT ENDS BY HAND-OFF IS STILL A PHASE (autopsy Study-Racer, 2026-09-25). `generateMs`
  // was written only when the generate loop COMPLETED, so a lane that timed out or bailed mid-generation
  // — the very lane this ledger exists to explain — reported `generate 0s (0%) … everything else 145.4s
  // (93%)` about 150 s it had spent generating. The running phase is read off its start instant.
  const generateMsNow = (): number => clock.generateMs || (clock.generateStartedAt ? Date.now() - clock.generateStartedAt : 0);
  const phasesNow = (): SimpleBuildResult['phases'] => (clock.startedAt
    ? {
      planMs: clock.planMs, contractMs: clock.contractMs, generateMs: generateMsNow(),
      ...(clock.contractOutcome ? { contractOutcome: clock.contractOutcome, contractCapMs: clock.contractCapMs } : {}),
      verifyMs: clock.verifyMs, repairMs: clock.repairMs,
      verifyRuns: clock.verifyRuns, repairRuns: clock.repairRuns,
      totalMs: Date.now() - clock.startedAt,
    }
    : undefined);

  let lapsed = false;
  // WHERE THE MINUTES GO — see `SimpleBuildResult.phases`. Clocks only; they decide nothing, and they
  // are hoisted OUT of the closure for exactly the reason `generatedSoFar` below is: on the failure
  // path — the path this measurement exists for — the closure's locals are gone before the caller can
  // ask. A measurement that only survives success answers the wrong question.
  const clock: { startedAt: number; planMs: number; contractMs: number; generateMs: number; generateStartedAt?: number; verifyMs: number; repairMs: number; verifyRuns: number; repairRuns: number; contractOutcome?: FastLanePhases['contractOutcome']; contractCapMs?: number } = { startedAt: 0, planMs: 0, contractMs: 0, generateMs: 0, verifyMs: 0, repairMs: 0, verifyRuns: 0, repairRuns: 0 };
  // One budget for the whole lane, read ONCE — the race below and the tier arithmetic inside must agree.
  const laneBudgetMs = deps.overallTimeoutMs ?? fastLaneBudgetMs(deps.complex === true);
  const generatedSoFar: OneShotFile[] = [];
  // The contract module (see `contractModule`) — '' / null when the contract stays prose-only.
  let contractPath = '';
  let contractFile: OneShotFile | null = null;
  // How many files this lane's own manifest planned. Hoisted OUT of the closure for the same reason
  // `generatedSoFar` is: it is the lane's most valuable measurement of how big the app really is, and
  // on the failure path the closure's locals are gone before the caller can ask. See
  // `SimpleBuildResult.plannedFiles` for what the caller does with it.
  let plannedFiles = 0;
  /**
   * The manifest's PATHS — what `plannedFiles` counts, kept so an aborted lane can hand them over.
   *
   * 🔴 WHY (autopsy f97eb0ec, 2026-09-20): the lane spent 62 seconds and 2,220 output tokens planning
   * five files, then the budget projection bailed BEFORE writing any of them — and the full builder
   * started from nothing, re-running `ls` and re-reading the scaffold it had just been told about.
   * The bail's own comment read *"there is nothing to salvage"*, which was true of FILES and false of
   * the PLAN. `plannedFiles` already existed and is only a count, so the list itself had no home.
   */
  let plannedPaths: string[] = [];
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
      const overallMs = laneBudgetMs;
      const laneStartedAt = Date.now();
      clock.startedAt = laneStartedAt;
      const planCap = preambleCapMs(overallMs, 0, configuredPlanCap);
      // 🔴 THE INVERSION THIS CLOSES. `withTimeout` only RACES: the lane stopped waiting at this cap while
      // the Kimi rung kept running to its own 120 s client timeout, so a build could — and did — log
      // provider events 148 s after it had ended, on a sandbox still being billed. Handing the same cap
      // DOWN as an absolute deadline means the call it starts cannot outlive the wait. The race stays:
      // it is what makes the lane bail promptly; the deadline is what stops the abandoned call.
      let manifestText: string;
      try {
        manifestText = await withTimeout(
          deps.generate(
            manifestSystemPrompt(deps.framework, deps.scaffoldPaths),
            manifestUserPrompt(deps.prompt, deps.scaffoldPaths),
            { deadlineAt: deadlineFromBudget(planCap, laneStartedAt) },
          ),
          planCap, 'simple-plan');
      } finally {
        // 🔴 A PLAN CALL THAT FAILS STILL TOOK ITS TIME (autopsy 0d297b25). The phase clock was set
        // only on success, so a plan call cut off at its 90 s cap reported "plan 0s … everything else
        // 90s (100%)" — the one phase that consumed the whole lane read as zero.
        clock.planMs = Date.now() - laneStartedAt;
      }
      // The plan call is a REAL model call on this build's REAL provider chain, and it is the only
      // latency measurement that exists before a single file is generated. See canFinishAfterPreamble.
      const planCallMs = clock.planMs;
      // THE OTHER HALF OF THE SEVEN MINUTES (50/50 law). Restoring src/ErrorBoundary.tsx after the fact
      // is recovery; this is why it needed recovering. The manifest prompt hands the model the scaffold
      // list and says "edit/extend", so the plan can — and did — include a file we ship correct, and the
      // very FIRST generation pass overwrote it with a version missing the `extends React.Component`
      // clause. The prompt now says these are provided, and this filter means that instruction cannot be
      // ignored: a boilerplate path is dropped from the plan whatever the model answered.
      const planned = parseFileManifest(manifestText);
      const provided = new Set(providedBoilerplate(deps.scaffoldPaths));
      const droppedBoilerplate = planned.filter((m) => provided.has(m.path)).map((m) => m.path);
      const keptProvided = droppedBoilerplate.length ? planned.filter((m) => !provided.has(m.path)) : planned;
      // The planner's own "(provided)" entries — see dropUnchangedScaffold.
      const { kept: keptBoilerplate, dropped: droppedUnchanged } = dropUnchangedScaffold(keptProvided, deps.scaffoldPaths);
      if (droppedUnchanged.length) {
        deps.log?.(`Leaving ${droppedUnchanged.length} file(s) the plan marks as unchanged out of the file list: ${droppedUnchanged.join(', ')}.`);
      }
      // A second index.html in public/ shadows a Vite app's real entry (autopsy 876afca9) — see entryShadow.ts.
      const { kept, dropped: droppedShadow } = dropShadowingEntries(keptBoilerplate, deps.framework);
      if (droppedShadow.length) {
        deps.log?.(`Leaving out ${droppedShadow.join(', ')} — in this project the page entry is the root index.html, and a copy in public/ would shadow it.`);
      }
      // The plan must connect what it builds to the screen — see ensureEntryPlanned.
      const { manifest, injected: injectedEntry } = ensureEntryPlanned(kept, deps.starterEntryPath);
      if (droppedBoilerplate.length) {
        deps.log?.(`Skipping ${droppedBoilerplate.length} file(s) NavBharatAI already provides — they are correct as shipped: ${droppedBoilerplate.join(', ')}.`);
      }
      // Recorded BEFORE the minFiles bail: a manifest too small to be worth this lane is exactly the
      // case the one-shot lane exists for, and it must still be able to see that number. Counted AFTER
      // the filter, because that is the number of files this build will actually write.
      if (injectedEntry) {
        deps.log?.(`The plan did not include the app's root component — adding ${injectedEntry} so the parts are actually shown.`);
      }
      plannedFiles = manifest.length;
      plannedPaths = manifest.map((f) => f.path);
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
      // HOISTED ABOVE THE CONTRACT (autopsy c6e4c6ff). Every input is already known here — the manifest
      // is parsed and `depOrder` is a static option — and the tier projection is what decides whether
      // the OPTIONAL contract pass is affordable at all. Computed once and reused by the doomed check
      // further down, so the two can never disagree about how many tiers this build runs.
      const depOrder = deps.depOrder !== false;
      const tiers = depOrder ? [0, 1, 2, STYLESHEET_TIER] : [0];
      // The stages the lane cannot finish WITHOUT — the deferrable stylesheet stage is not one of them.
      const populatedTiers = depOrder ? requiredStageCount(manifest.map((s) => s.path)) : 1;
      // 🔴 THE BEST-EFFORT PASS MUST NOT BE WHAT DOOMS THE LANE. On the reported build the lane could
      // finish after planning (49 + 147 = 196s of 240s) and could not after the contract (96 + 147 =
      // 243s) — so the optional pass bought the bail that then threw the contract away with everything
      // else, and a 26.7-minute full-builder rebuild followed. The contract is already declared
      // skippable a few lines up for exactly this reason; this applies that rule to the tier budget.
      // 🔴 A BIG APP'S CONTRACT IS NOT OPTIONAL (autopsy 3ab93068, admin-approved 2026-09-24). The rule
      // above calls the contract best-effort, and for a small app it is. For a COMPLEX one the evidence
      // runs the other way: that build's contract was cut at 56 s, the per-file calls then disagreed on
      // names and shapes (`lat` vs `latitude`, an unexported context), and three repair rounds spent
      // 419 s — 63% of the lane — putting back what the contract would have agreed up front. A complex
      // lane is given a larger budget (`fastLaneBudgetMs`) precisely so the contract fits, and is never
      // talked out of it by the projection; if it still overruns, the tier checks hand off as before.
      const contractAffordable = deps.complex === true ? contractCap > 0 : canAffordSharedContract({
        preambleCallMs: planCallMs,
        tiers: populatedTiers,
        elapsedMs: Date.now() - laneStartedAt,
        overallMs,
        contractCapMs: contractCap,
      });
      // MEASURED, INCLUDING WHEN IT IS KILLED. A contract call that ran to its cap and was cut off is
      // the strongest evidence this chain is slow, and it used to be discarded — see PreambleProgress.
      let contractCallMs = 0;
      const nothingShared = shareContract && contractHasNothingToShare(manifest);
      if (nothingShared) {
        clock.contractOutcome = 'not-needed';
        deps.log?.('⏭️ No shared contract needed — the app has one component, so there is nothing for separate files to agree on.');
      } else if (shareContract && contractCap > 0 && contractAffordable) {
        deps.log?.('Designing the shared types & component contract…');
        const contractStartedAt = Date.now();
        try {
          contract = (await withTimeout(
            deps.generate(
              contractSystemPrompt(deps.framework),
              contractUserPrompt(deps.prompt, manifest),
              // SIBLING of the plan call above (rule 3): same race, same abandoned call, same bill.
              { deadlineAt: deadlineFromBudget(contractCap) },
            ),
            contractCap, 'simple-contract') || '').trim();
        } catch (err) {
          contract = '';
          // 🔴 A HAND-OFF DURING THE CONTRACT ENDS THE LANE HERE (autopsy 1219c639), the sibling of the stop
          // below (31254f9a). The engine crawled and the next one reasons before every answer, so the
          // provider chain declined to call it — a deliberate hand-off. The lane read it as an empty
          // contract: the report said it "came back with nothing usable, so the files were written without
          // a shared contract", and the user was told "Building 10 file(s)" — then not one file was
          // written, because every file call would have met the same rung. The plan goes to the full
          // builder instead, exactly as a hand-off during planning does.
          if (isReasoningRungHandoff(err)) {
            clock.contractMs = Math.min(Math.max(0, Date.now() - contractStartedAt), contractCap);
            clock.contractCapMs = contractCap;
            clock.contractOutcome = 'handed-off';
            throw err;
          }
        }
        // 🔴 A STOP DURING THE CONTRACT ENDS THE LANE HERE (autopsy 31254f9a). The call came back empty
        // because the user pressed Stop, and the lane carried on: it recorded the contract as having "come
        // back with nothing usable", and told the user it was "Building 9 file(s)" a few milliseconds
        // AFTER the stop. Nothing below may run, so nothing below may be announced.
        if (deps.signal?.aborted) {
          clock.contractMs = Math.min(Math.max(0, Date.now() - contractStartedAt), contractCap);
          clock.contractCapMs = contractCap;
          clock.contractOutcome = 'stopped';
          throw new BuildStoppedError();
        }
        // Recorded on BOTH paths: a throw here is usually the cap firing, and that duration is the
        // measurement worth having. Capped at the cap so a stray clock cannot inflate the projection.
        contractCallMs = Math.min(Math.max(0, Date.now() - contractStartedAt), contractCap);
        clock.contractMs = contractCallMs;
        clock.contractCapMs = contractCap;
        // Name what happened, so the report never has to guess which clock ended the call.
        clock.contractOutcome = contract ? 'written' : (contractCallMs >= contractCap - 1_000 ? 'cut' : 'failed');
        // A type named after a planned component — see `separateTypeFromComponentNames`. Before file one.
        if (contract && contractNameSplitEnabled()) {
          const split = separateTypeFromComponentNames(contract, manifest);
          if (split.renamed.length > 0) {
            contract = split.contract;
            deps.log?.(`🏷️ Renamed ${split.renamed.map((r) => `${r.from} → ${r.to}`).join(', ')} in the shared contract so no data type shares a component's name.`);
          }
        }
      } else if (shareContract) {
        clock.contractOutcome = 'skipped';
        // 🔴 ONE SKIP, ONE SENTENCE (autopsy f97eb0ec, 2026-09-20). This used to be TWO logs: an
        // `if (!contractAffordable)` above and this `else`, and they are not exclusive — an
        // unaffordable contract satisfied both, so the user was told the pass was skipped twice, in
        // the same millisecond, for two different-sounding reasons. The report shows the pair.
        // The branches carry different facts and both are worth keeping, so the choice moves INTO
        // the one place that can only fire once.
        deps.log?.(contractCap > 0
          ? '⏭️ Skipping the shared-contract pass — there is time to write your files or to design the contract, not both, and the files are the app.'
          : '⏭️ Skipping the shared-contract pass — planning used the time it needed, so the remaining budget goes to writing your files.');
      }
      // THE CONTRACT IS A FILE, NOT A PARAGRAPH — see `contractModule` for the build that proved it.
      // Decided BEFORE file one so every per-file prompt can name the path, and written FIRST so the
      // dependency context of every tier carries its export surface like any other produced file.
      if (contract && contractFileEnabled() && frameworkSupportsContractFile(deps.framework)) {
        const mod = contractModule(contract);
        if (mod) {
          contractPath = contractFilePath(manifest);
          const planned = manifest.findIndex((f) => f.path === contractPath);
          if (planned >= 0) {
            // The planner wanted a types file at this exact path. The contract IS that file — generating
            // a second, drifting version of it in an isolated call is the defect this section removes.
            manifest.splice(planned, 1);
          }
          contractFile = { path: contractPath, content: mod.source };
          generatedSoFar.push(contractFile); // salvageable on a timeout, like any finished file
          deps.log?.(`📐 Wrote the shared contract as ${contractPath} — ${mod.symbols.length} shared symbol(s) every file imports from one place.`);
        }
      }
      // THE HELPERS GET A HOME TOO (autopsy 876afca9) — see `contractUtilSignatures`. A helper the
      // contract declares and no planned file owns is given one, before file one, and every call is told.
      if (contract && utilOwnerEnabled() && frameworkSupportsContractFile(deps.framework)) {
        const names = contractUtilSignatures(contract);
        const owner = utilOwnerFor(manifest, names, contractPath || contractFilePath(manifest));
        if (owner) {
          const existing = manifest.find((f) => f.path === owner.path);
          if (existing) existing.purpose = utilOwnerPurpose(names, existing.purpose);
          else manifest.push({ path: owner.path, purpose: utilOwnerPurpose(names) });
          contract = `${contract}${utilOwnerNote(names, owner.path)}`;
          if (owner.added) deps.log?.(`🧰 ${names.length} shared helper(s) had no file to live in — added ${owner.path} for them.`);
        }
        // …and so do the shared CONSTANTS (autopsy 6ae30b33): one owner, named before file one.
        const values = contractValueExports(contract);
        const valueOwner = valueOwnerFor(manifest, values, contractPath || contractFilePath(manifest));
        if (valueOwner) {
          const existing = manifest.find((f) => f.path === valueOwner.path);
          if (existing) existing.purpose = valueOwnerPurpose(values, existing.purpose);
          else manifest.push({ path: valueOwner.path, purpose: valueOwnerPurpose(values) });
          contract = `${contract}${valueOwnerNote(values, valueOwner.path)}`;
          if (valueOwner.added) deps.log?.(`🧰 ${values.length} shared constant(s) had no file to live in — added ${valueOwner.path} for them.`);
        }
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
      let laneStopReason: string | null = null; // set by deps.stopLane; thrown at the next tier boundary
      const genOne = async (spec: SimpleFileSpec, produced: OneShotFile[]): Promise<OneShotFile | null> => {
        if (lapsed) return null; // the lane already timed out — stop burning tokens on files nobody will use
        // The lane's chain may have fallen to an engine this lane cannot afford (see SimpleBuildDeps.stopLane).
        // Refuse BEFORE spending the call; the tier boundary below turns the refusal into a hand-off.
        if (deps.signal?.aborted) return null; // stopped — the tier boundary below ends the lane
        const stop = deps.stopLane?.();
        if (stop) { laneStopReason = laneStopReason ?? stop; return null; }
        try {
          // Fix 69 — feed consumers the producers' EXPORT SURFACE (exact names/shapes/signatures,
          // full-file scan so no export is truncation-hidden) instead of full bodies: same contract
          // information at a fraction of the input tokens. AGENTV3_SIGNATURE_CONTEXT=off restores
          // the old full-body dump verbatim.
          const depBlock = !produced.length
            ? ''
            : isStylesheetPath(spec.path) && !/\.module\./i.test(spec.path) && stylesheetClassContext(produced, deps.framework)
              ? stylesheetClassContext(produced, deps.framework)
              : (signatureContextEnabled() ? signatureDependencyContext(produced) : dependencyContext(produced));
          // 🔴 THE SAME INVERSION THE PLAN CALL ALREADY CLOSED (line ~697), MISSED HERE — this is the
          // highest-volume call site in the whole lane and the one a real report caught running away
          // (build 782da7b7, 2026-09-16): a file's OWN truncation-continuation loop (fastGenerate's
          // "(1/3)" → "(2/3)" → "(3/3)") kept retrying GLM for the better part of TWO HOURS after this
          // lane had already lost its 240s race and the full builder had taken over and finished a
          // completely different app. `lapsed` (checked above and below) only stops a NEW genOne from
          // STARTING; it does nothing for a call already in flight or for the next continuation attempt
          // inside fastGenerate's own while loop, because — unlike the plan and contract calls just
          // above — this one passed no deadlineAt at all, so every hop down to OpenAiToolRunner saw an
          // unmeasured budget and used its own generous per-call clock instead of the lane's real one.
          // Anchoring every file call to the SAME absolute instant the lane's own race is bound by means
          // an abandoned closure's next attempt hits `bound.expired` and REFUSES BEFORE SPENDING — see
          // OpenAiToolRunner.runTurn — instead of starting another multi-minute call nobody will read.
          // A config file the project already has is shown to the call that rewrites it (isProjectConfigPath).
          const existing = deps.readExisting && isProjectConfigPath(spec.path) && deps.scaffoldPaths.includes(spec.path)
            ? await deps.readExisting(spec.path).catch(() => null)
            : null;
          if (lapsed) return null;
          const text = await deps.generate(fileSystemPrompt(deps.framework), fileUserPrompt(deps.prompt, spec, manifest, contract, depBlock, contractPath || undefined, existing), { deadlineAt: laneStartedAt + overallMs });
          if (lapsed) return null; // timed out while this call was in flight — discard, don't log
          const blocks = parseFileBlocks(text);
          const match = blocks.find((b) => b.path === spec.path) ?? blocks[0];
          if (!match) return null;
          filesDone += 1; // synchronous — safe even with concurrent genOne calls in flight
          deps.log?.(`✓ ${spec.path} (${filesDone}/${manifest.length})`);
          const file = { path: spec.path, content: ensureReactValueImport(spec.path, match.content) };
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
      // ARITHMETICALLY DOOMED BEFORE FILE ONE (dukaan report 2026-08-12). The between-tiers check below
      // needs a COMPLETED tier to measure, so it cannot protect a lane whose FIRST tier never finishes —
      // which is precisely what a timing-out provider produces. That build's plan call took 86.6s; three
      // tiers at that latency need ~260s against a 240s budget, and the lane still sat for its full 240
      // seconds and produced nothing. Only the tiers that actually have files are counted, so a manifest
      // that happens to be single-tier is judged on the one stage it will really run.
      // ⚠️ `depOrder` / `tiers` / `populatedTiers` are computed ABOVE the contract now — the contract's
      // own affordability needs the same projection, and one computation cannot drift from itself.
      // ⚠️ `contractCallMs` IS PART OF THE PROJECTION NOW (autopsy 31dc61fd). Using the plan call alone
      // was 1.8× optimistic — 34s measured against a real 62.5s tier — because a plan emits a short file
      // LIST while a tier writes whole files. The contract call, which also produces a long body,
      // predicted the tier almost exactly and was being thrown away. See tierEstimateMs.
      const preambleProgress = {
        preambleCallMs: planCallMs, contractCallMs, tiers: populatedTiers,
        elapsedMs: Date.now() - laneStartedAt, overallMs,
      };
      if (!canFinishAfterPreamble(preambleProgress)) {
        // No file has been generated yet, so there is nothing to salvage — this is the same handoff the
        // timeout was going to perform, minutes earlier and without burning the budget to reach it.
        throw new Error(`simple-build ${preambleBailReason(preambleProgress)}`);
      }
      // The contract file is produced, not generated: it leads `written` so every tier's dependency
      // context includes it, and is excluded from the "did the model generate enough?" counts below.
      const written: OneShotFile[] = contractFile ? [contractFile] : [];
      const generatedCount = () => written.length - (contractFile ? 1 : 0);
      const generateStartedAt = Date.now();
      clock.generateStartedAt = generateStartedAt; // read by phasesNow while this loop is still running
      for (let ti = 0; ti < tiers.length; ti++) {
        const tier = tiers[ti];
        const specs = depOrder ? manifest.filter((s) => generationTier(s.path) === tier) : manifest;
        if (specs.length === 0) continue;
        const producedSoFar = [...written]; // real source of all earlier tiers (snapshot for this tier)
        const tierStartedAt = Date.now();
        const gen = await mapWithConcurrency(specs, concurrency, (spec) => genOne(spec, producedSoFar));
        for (const f of gen) if (f && f.content) written.push(f);
        throwIfStopped(deps.signal);
        // "stopped early" ON PURPOSE — the wording that routes to the salvage path, so every finished
        // file reaches the full builder (see the root-component check below for the same idiom).
        if (laneStopReason) throw new Error(`simple-build fast lane stopped early — ${laneStopReason}`);
        // EARLY BAIL (admin report 858f6d7b). A tier costs as much as its slowest file, so once ONE tier's
        // real duration is known the rest is predictable. The reported build ground on to the full 240s to
        // produce 4 of 14 files — work the full builder then had to continue anyway. Bailing the moment the
        // arithmetic says we cannot finish hands off sooner and without a tier being killed mid-flight;
        // the catch below salvages exactly the same finished files. Never fires without a real measurement.
        const tiersRemaining = tiers.length - 1 - ti;
        const progress = { tiersRemaining, lastTierMs: Date.now() - tierStartedAt, elapsedMs: Date.now() - laneStartedAt, overallMs };
        if (!canFinishRemainingTiers(progress)) {
          // 🔴 "ENOUGH FILES" IS NOT "AN APP" (autopsy 3ab93068). The shell tier — the root component
          // that mounts everything — is generated LAST, so breaking here before it ran meant four
          // finished components and a page that still said "Hello World", reported as a success. A
          // lane may stop early only when the root is already written; otherwise it hands off below.
          if (generatedCount() >= minFiles && unwrittenEntries(manifest, written.map((f) => f.path)).length === 0) break;
          throw new Error(`simple-build ${earlyBailReason(progress)}`);
        }
      }
      clock.generateMs = Date.now() - generateStartedAt;
      if (generatedCount() < minFiles) throw new Error('too_few_files_generated');
      // The same rule for the other way a root goes missing: its own generation call failed (genOne
      // returns null). The wording contains "stopped early" ON PURPOSE — that is what routes it to the
      // salvage path, so every finished file reaches the full builder instead of being thrown away.
      {
        const unwritten = unwrittenEntries(manifest, written.map((f) => f.path));
        if (unwritten.length > 0) {
          throw new Error(`simple-build fast lane stopped early — the app's root component (${unwritten.join(', ')}) was not written, so the files built so far are not connected to the page yet`);
        }
      }
      // DETERMINISTIC IMPORT SELF-HEAL before the files are written/previewed (jungle-game report
      // 104f5b09 + fae70e42): (1) fix unambiguous named<->default import mismatches; (2) ADD a
      // forgotten shared-symbol import — a value used but never imported (e.g. Background.ts using
      // CANVAS_HEIGHT with only `import type { LayerConfig }`) shipped as a runtime ReferenceError that
      // CRASHED the preview, because the fast lane never ran tsc. Best-effort; only ever turns a broken
      // build into a working one. Kill switch: AGENTV3_IMPORT_RECONCILE=off.
      if (process.env.AGENTV3_IMPORT_RECONCILE !== 'off') {
        try {
          const fixed = await deterministicImportFixes(written);
          if (fixed.changes > 0) {
            for (const f of written) { const nc = fixed.files[f.path]; if (typeof nc === 'string') f.content = nc; }
            deps.log?.(`🔧 Auto-fixed ${fixed.changes} import issue(s) (wrong-kind, forgotten, or wrong-source) before preview.`);
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
          // …and a sheet the entry AND another module both import keeps only the entry's line (autopsy 33812996).
          const deduped = dedupeStylesheetImports(Object.fromEntries(written.map((f) => [f.path, f.content])));
          if (deduped.removed.length > 0) {
            for (const f of written) { const nc = deduped.files[f.path]; if (typeof nc === 'string') f.content = nc; }
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
    })(), laneBudgetMs, 'simple-build');
  } catch (e) {
    lapsed = true; // from this instant the orphaned closure can neither write files nor burn more tokens
    const reason = e instanceof Error ? e.message : String(e);
    // A STOP IS NOT A HANDOFF. Keep what finished — the user was promised their files are saved — and
    // say nothing about "carrying on": nothing carries on after a stop.
    if (deps.signal?.aborted || isBuildStoppedError(e)) {
      const finished = [...generatedSoFar];
      let saved: string[] = [];
      if (finished.length > 0) {
        try { await withTimeout(deps.writeFiles(finished), 30_000, 'simple-build-stop-save'); saved = finished.map((f) => f.path); }
        catch { /* best-effort — a failed save leaves the workspace as it was */ }
      }
      return {
        ok: false, stopped: true, filesWritten: saved.length,
        summary: stoppedLaneSummary(saved.length),
        reason: BUILD_STOPPED_MESSAGE, outcome: 'BUILD_FAILED', salvagedPaths: saved.length ? saved : undefined,
        plannedFiles, phases: phasesNow(), plannedPaths,
      };
    }
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
      // The import fixes the lane would have made had it finished, made on what it hands over (autopsy
      // 6cd698cc: four salvaged files carried 17 errors — enums imported with `import type` — and the full
      // builder spent five edit turns on them). Exact and best-effort: a failure hands the files over as written.
      if (process.env.AGENTV3_IMPORT_RECONCILE !== 'off') {
        try {
          const fixed = await deterministicImportFixes(salvage);
          if (fixed.changes > 0) {
            for (let i = 0; i < salvage.length; i++) {
              const nc = fixed.files[salvage[i].path];
              if (typeof nc === 'string' && nc !== salvage[i].content) salvage[i] = { ...salvage[i], content: nc };
            }
          }
        } catch { /* best-effort */ }
      }
      try {
        await withTimeout(deps.writeFiles(salvage), 30_000, 'simple-build-salvage');
        salvagedPaths = salvage.map((f) => f.path);
        // 🔴 THIS LINE WAS THE LAST THING A USER SAW BEFORE PRESSING STOP (autopsy `f152c1ab`,
        // 2026-09-20), 2.5 seconds later. It used to read:
        //
        //     "⏱️ The fast lane ran out of time — handing its 1 finished file(s) to the full
        //      builder to complete."
        //
        // Three things wrong with it, and none is the wording alone:
        //  1. IT NAMES OUR ARCHITECTURE. "The fast lane", "the full builder" — a user has no lanes.
        //     The White-Label Law's own list of forbidden leakage is routing internals *"or any hint
        //     that more than one vendor exists"*; the same argument covers our own internal engines.
        //  2. IT READS AS A FAILURE WHEN NOTHING FAILED. A handoff is how this build CONTINUES, and
        //     the files are already saved. "Ran out of time" describes a lane; the user hears it
        //     about their app.
        //  3. IT COUNTS THE FILES. "1 finished file(s)" after three and a half minutes is, to the
        //     person waiting, a progress report — and a damning one — when it is really an internal
        //     batch size. The plural-in-parentheses gives away that nobody expected a human to read it.
        //
        // What replaces it says the one thing that IS true and does matter: the work so far is kept
        // and the build is still going.
        deps.log?.('Still building your app — your work so far is saved and I am carrying on from it.');
      } catch { /* salvage is best-effort — on failure the full builder starts from the scaffold as before */ }
    }
    const handedOff = isReasoningRungHandoff(e) || /reasons before every answer/i.test(reason);
    return {
      ok: false,
      ...(handedOff ? { handedOff: true } : {}),
      filesWritten: salvagedPaths?.length ?? 0,
      summary: salvagedPaths?.length
        ? `Simple build timed out after generating ${salvagedPaths.length} file(s) — the full builder continues from them.`
        : handedOff
          ? 'Fast lane handed its plan to the full builder: the next engine reasons before every answer, which the lane cannot carry — a planned handoff, not a failure.'
          : 'Simple build could not produce the app — switching to the full builder.',
      reason,
      outcome: 'BUILD_FAILED',
      salvagedPaths,
      plannedFiles,
      phases: phasesNow(),
      plannedPaths,
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
    // From here on the app EXISTS and runs; everything below rewrites files in a working app. That is
    // the exact window in which reloading the preview shows somebody their app breaking.
    try { deps.onSettling?.(); } catch { /* a preview hint must never affect a build */ }
    const maxRepairs = deps.maxRepairs ?? 2;
    const byPath = new Map(files.map((f) => [f.path, f] as const));
    // A verify THROW = the check never executed (sandbox infra failure) — record that honestly
    // (ran:false) instead of silently converting it into a pass. The jungle-game report (2026-07-12)
    // shipped a runtime ReferenceError behind "Build verified ✓" through exactly this silent catch.
    // ONE clock for every verify call site (there are four), so a round can never be counted in one
    // place and missed in another — the drifted-copy class this repo keeps paying for.
    const timedVerify = async (): Promise<VerifyResult> => {
      const at = Date.now();
      try { return await deps.verify!(); }
      catch { return { ok: true, errors: '', ran: false }; }
      finally { clock.verifyMs += Date.now() - at; clock.verifyRuns++; }
    };
    let verdict: VerifyResult = await timedVerify();
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
          verdict = await timedVerify();
        }
      } catch { /* a free restore is best-effort — fall through to the model repair below */ }
    }
    /**
     * STOP PAYING A MODEL TO DO GREP'S JOB — on THIS lane too (2026-09-04).
     *
     * `EndgameRepair` was built for exactly this ("the admin's mandate: stop paying an LLM to do grep's
     * job") after a build ground its last ten tsc errors one round-trip each until the step limit, when
     * almost all of them were mechanical — an unused import, a missing import, an export-name mismatch.
     * Its deterministic layer is reachable only through `runEndgameRepair`, which only `AgentRunner`
     * calls. **This lane — the one most builds take — went from the scaffold restore straight to a model
     * call**, so on the fast lane a build failing purely on `TS6133: 'X' is declared but never read` paid
     * a full repair pass for a pure string edit.
     *
     * That is the SAME drift the scaffold-restore comment twenty lines above describes ("the agentic lane
     * has done this since 2026-08-12; THIS lane never did, and the two verify paths drifted apart in
     * silence") — the restore was ported then, the deterministic tsc layer was not.
     *
     * Calls the SHARED pass rather than copying its pieces: a third variant of this logic is precisely
     * what produced the drift being fixed. Re-running the reconcilers here is not redundant with the
     * generation-time pass above — the files have CHANGED since (later writes, an earlier repair
     * attempt), so drift introduced after generation is catchable now, for free.
     *
     * Costs nothing on a healthy build: it is gated on `!verdict.ok`, and re-verifies only when
     * something was genuinely changed. Every fix is honest — the reconcilers act on unique owners only
     * and `removeUnusedImports` leaves anything it cannot match confidently to the model.
     */
    const mechanicalPass = async (): Promise<void> => {
      if (verdict.ok || !endgameRepairEnabled()) return;
      try {
        const errs = parseTscErrors(verdict.errors);
        if (errs.length > 0) {
          const before = Object.fromEntries([...byPath].map(([path, f]) => [path, f.content]));
          const det = await endgameDeterministicPass(before, errs);
          if (det.changedPaths.length > 0) {
            const detFiles = det.changedPaths.map((path) => ({ path, content: det.files[path] }));
            await deps.writeFiles(detFiles);
            for (const f of detFiles) {
              const prev = byPath.get(f.path);
              byPath.set(f.path, prev ? { ...prev, content: f.content } : (f as OneShotFile));
            }
            deps.log?.(`Fixed ${det.fixes.length} mechanical error(s) directly — no repair pass needed for those: ${det.fixes.slice(0, 3).join('; ')}${det.fixes.length > 3 ? '; …' : ''}`);
            verdict = await timedVerify();
          }
        }
      } catch { /* a free fix is best-effort — fall through to the model repair below */ }
    };
    await mechanicalPass();
    let promptingErrors = verdict.errors;
    while (!verdict.ok && attempt < maxRepairs && deps.repair && !deps.signal?.aborted) {
      // The same question the generation calls ask (`SimpleBuildDeps.stopLane`), asked before every
      // repair too. 🔴 Autopsy 33812996: the lane's opener crawled DURING a repair, the chain fell to
      // reasoning rungs, and repair ran 560 s (77% of the lane) without fixing anything. Generation
      // consulted this; the repair loop — the lane's longest phase — never did.
      // No narration here: the hand-off line after the loop already says it, in the user's words.
      if (deps.stopLane?.()) break;
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
      // WHAT THE ERRORS MEAN (autopsy baa0b3c7) — the fifth and last place the compiler speaks to a model
      // in this engine, and the one that speaks to it REPEATEDLY: this loop runs up to `maxRepairs` times,
      // climbing a strategy ladder, which is precisely the four-rewrites-of-one-file shape that report
      // recorded. A missing-declaration error names the file where the symbol is USED, so every rung of
      // that ladder is aimed at a file that was never wrong. The project's own text is passed, so the
      // React ambiguity is resolved to the exact answer here rather than hedged — `byPath` already holds
      // it. Advisory and additive: '' for every other kind of error, so a normal repair is unchanged.
      try {
        const causes = tscCauseNote(tscErrorCauses(
          parseTscErrors(verdict.errors),
          Object.fromEntries([...byPath].map(([p, f]) => [p, f.content])),
        ));
        if (causes) repairErrors = `${repairErrors}${causes}`;
      } catch { /* the analysis is advisory — the repair still gets the compiler's own words */ }
      let fixed: OneShotFile[] = [];
      const repairStartedAt = Date.now();
      try { fixed = await deps.repair(repairErrors, [...byPath.values()], contract, strategy, contractPath || undefined); } catch { fixed = []; }
      finally { clock.repairMs += Date.now() - repairStartedAt; clock.repairRuns++; }
      // Stopped while the repair ran: its answer is not written. The workspace stays as it was when the
      // user pressed Stop — an unverified rewrite nobody will check is not a kinder place to leave it.
      if (deps.signal?.aborted) break;
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
      verdict = await timedVerify();
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
      // 🔴 A MODEL REPAIR CAN REINTRODUCE WHAT GREP FIXES (autopsy a9f8d186, 2026-09-30). The free pass
      // ran once, before the first repair. Round 2 then rewrote App.tsx with a default import of a named
      // export and without `import React`, and rounds 2 and 3 were spent — and the lane handed off — on
      // TS2613 and five TS2686 lines, every one of them mechanical. The same pass runs after every kept
      // repair, so the next round is spent only on what grep cannot fix.
      await mechanicalPass();
      // Circuit-breaker: the repair produced the identical compiler errors → zero progress, it's stuck.
      if (!verdict.ok && verdict.errors === promptingErrors) {
        // Same rule as the salvage line above: the user has no "full builder" to hand anything to.
        deps.log?.('Some build errors are still there after a repair — staying on it.');
        break;
      }
      promptingErrors = verdict.errors;
    }
    if (deps.signal?.aborted) {
      return {
        ok: false, stopped: true, filesWritten: files.length,
        summary: stoppedLaneSummary(files.length),
        reason: BUILD_STOPPED_MESSAGE, outcome: classifyBuildOutcome({ filesWritten: files.length, typecheckOk: null }),
        typecheckRan: verdict.ran !== false, plannedFiles, phases: phasesNow(),
      };
    }
    if (!verdict.ok) {
      deps.log?.('The app still has build errors — staying on it until it builds.');
      return {
        ok: false, filesWritten: files.length, reason: 'verify_failed',
        summary: 'Built the files but the app did not compile cleanly — switching to the full builder to finish it.',
        // 🔴 THE FILES ARE IN THE WORKSPACE — HAND THEM OVER (autopsy a9f8d186, 2026-09-30). Only the
        // timeout handoff carried `salvagedPaths`, so after a verify failure the full builder was told
        // nothing about the 15 files this lane had just written and worked from a project context taken
        // before the lane ran ("0 files"). It then re-read the workspace to discover its own app.
        salvagedPaths: [...byPath.keys()],
        outcome: classifyBuildOutcome({ filesWritten: files.length, typecheckOk: false }),
        plannedFiles,
        phases: phasesNow(),
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

  // Stopped during verify or repair: the files are already written, and nothing more is started — not
  // another repair, not an install, not a dev server.
  if (deps.signal?.aborted) {
    return {
      ok: false, stopped: true, filesWritten: files.length,
      summary: stoppedLaneSummary(files.length),
      reason: BUILD_STOPPED_MESSAGE, outcome: classifyBuildOutcome({ filesWritten: files.length, typecheckOk: null }),
      typecheckRan, plannedFiles, phases: phasesNow(),
    };
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
  return { ok: true, filesWritten: files.length, summary: `Built your app file-by-file — ${files.length} file(s).`, outcome, typecheckRan, plannedFiles, phases: phasesNow() };
}
