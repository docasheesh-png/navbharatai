// COMPILE PRE-FLIGHT — verify (and heal) the app BEFORE it is ever pushed to GitHub.
//
// WHY (admin 2026-08-04, verbatim): "build apk/aab button navbharatai pro v5 me hi bana do! waha se
// apk/aab v5 live banaye, fix kare. abhi jahan bana rahe hai, yaha bas download ho!!" — after a real
// build died on GitHub with "Your app itself did not compile".
//
// The admin's instinct is architecturally right, and this module is its substance: the WORST place to
// discover a compile error is a GitHub runner — five minutes per attempt, a remote log, and a repair
// loop that can only edit files by committing them. The RIGHT place is here, where v5 lives: the same
// esbuild parser Vite uses runs in-process in seconds, the same AI repair tier fixes what it finds, and
// the fix lands in the user's v5 WORKSPACE — so their app inside NavBharatAI is healed too, not just the
// GitHub copy. GitHub then only ever receives an app that is already proven to compile, which reduces
// the remote loop to what it is good at: compiling and handing back the file ("yaha bas download ho").
//
// THREE CHECKS, each mapping to a real runner death:
//   1. SYNTAX — esbuild parse of every JS/TS file (the exact parser `vite build` runs first).
//   2. UNRESOLVED LOCAL IMPORTS — `import x from './Missing'` where no such file exists ("Could not
//      resolve …", the most common Vite build death for generated apps).
//   3. MISSING NPM PACKAGES — imported but not declared in package.json ("Cannot find package …").
// Checks 2–3 only run for an app that BUILDS itself; a static app has no bundler to die in.
//
// HEALING ORDER (same tiering as the GitHub loop): deterministic first — the curated well-known-deps
// reconciler adds missing allowlisted packages with pinned ranges; then the AI pass, bounded rounds,
// each round RE-VERIFIED — an AI "fix" that does not actually make the app compile is a miss, never a
// success. Reuses runAiRepair/parse gates from mobileBuildAiRepair (one repair engine, no drift).

import { findSyntaxErrors } from '../AgentV3/SyntaxCheck';
import { findMissingDependencies, isLocalFileSpecifier } from '../AgentV3/DependencyReconciler';
import { applyWellKnownMissingDeps } from '../AgentV3/DependencyAutoFix';
import { resolveLocalImport } from '../AgentV3/ArchitectureAnalysis';
import { isBinaryAssetSpecifier } from '../AgentV3/fileClassification';
import { scaffoldMissingUiPrimitives } from './uiPrimitiveScaffold';
import { detectTailwindProblems, applyTailwindSetup } from './tailwindSetupHeal';
import { detectProjectKind } from './mobileProjectAssembler';
import {
  AI_REPAIR_MAX_FILES, runAiRepair,
  type AiRepairLlm, type AiRepairModel,
} from './mobileBuildAiRepair';

export interface PreflightProblem {
  kind: 'syntax' | 'unresolved-import' | 'missing-package';
  path: string;
  message: string;
  line?: number;
  /** For 'unresolved-import': the exact import specifier (e.g. "@/components/ui/button") — lets the
   *  deterministic UI-primitive scaffolder create the missing file without re-parsing the message. */
  spec?: string;
}

export interface PreflightReport {
  ok: boolean;
  problems: PreflightProblem[];
}

export interface PreflightHealResult {
  ok: boolean;
  /** The full file map after healing — what the ship pipeline should assemble and push. */
  files: Record<string, string>;
  /** Only the files healing changed — what gets merged back into the user's v5 workspace. */
  changed: Record<string, string>;
  /** Problems still present when ok=false; empty when ok=true. */
  problems: PreflightProblem[];
  /** Plain-language notes about what was fixed, for the user (already vendor-free). */
  notes: string[];
  aiRounds: number;
}

const CODE_FILE = /\.(mjs|cjs|jsx?|tsx?)$/i;
const DECL = /\.d\.ts$/i;
/** Import/export specifiers, including dynamic import and bare side-effect imports. */
const SPEC_RE = /(?:import|export)\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
/** Type-only imports are erased by esbuild before bundling, so a missing target never breaks the build. */
const TYPE_ONLY_RE = /(?:import|export)\s+type\s/;

function normalizeRelative(fromFile: string, spec: string): string {
  const parts = `${fromFile.split('/').slice(0, -1).join('/')}/${spec}`.split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

/** Run the three checks. Pure and fast — no network, no AI. */
export async function preflightVerify(files: Record<string, string>): Promise<PreflightReport> {
  const problems: PreflightProblem[] = [];

  for (const err of await findSyntaxErrors(files)) {
    problems.push({ kind: 'syntax', path: err.path, message: err.message, line: err.line });
  }

  // A static app is served as-is — there is no bundler run for an unresolved import or an undeclared
  // package to kill, so flagging them would block apps that genuinely work.
  if (detectProjectKind(files) === 'built') {
    const fileSet = new Set(Object.keys(files));
    for (const [path, content] of Object.entries(files)) {
      if (!CODE_FILE.test(path) || DECL.test(path) || typeof content !== 'string') continue;
      SPEC_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = SPEC_RE.exec(content))) {
        const spec = m[1] || m[2] || m[3];
        if (!spec || (!spec.startsWith('.') && !/^[@~]\//.test(spec))) continue; // npm package — check 3's job
        if (TYPE_ONLY_RE.test(m[0])) continue;
        // 🔒 A BINARY ASSET CANNOT BE CHECKED HERE, SO IT IS NOT CLAIMED MISSING. The durable store is
        // text-only (see isBinaryAssetSpecifier), so no `.png` is ever in `files` — this check said
        // "no such file exists in the app" for EVERY image, present or not, and refused the ship.
        // `import logo from './logo.png'` blocked an APK build. `.svg`/`.css` are text, are persisted,
        // and stay checked. A genuinely missing image now surfaces on the real bundler with a real
        // message instead of here with a guaranteed-wrong one.
        if (isBinaryAssetSpecifier(spec)) continue;
        // Code files resolve through the shared resolver (extensions, index files, aliases, .js→.ts);
        // an asset import (./styles.css, ./logo.svg) resolves by exact path.
        const resolved = resolveLocalImport(path, spec, fileSet)
          ?? (spec.startsWith('.') && fileSet.has(normalizeRelative(path, spec)) ? normalizeRelative(path, spec) : null);
        if (!resolved) {
          problems.push({
            kind: 'unresolved-import',
            path,
            message: `imports "${spec}", but no such file exists in the app`,
            spec,
          });
          if (problems.length >= 20) return { ok: false, problems };
        }
      }
    }

    for (const pkg of findMissingDependencies(files)) {
      problems.push({
        kind: 'missing-package',
        path: 'package.json',
        message: `the app imports "${pkg}" but package.json does not declare it`,
      });
    }

    // Check 4 — TAILWIND WIRING (2026-08-27). CSS is not an import graph the reconciler walks, so an
    // app styled with `@tailwind` directives but never declaring tailwindcss passed every check above
    // and died on the runner inside PostCSS. Named here, healed deterministically in Tier 0b below.
    for (const t of detectTailwindProblems(files)) {
      problems.push({
        kind: t.kind === 'undeclared' ? 'missing-package' : 'syntax',
        path: t.path,
        message: t.message,
      });
    }
  }

  return { ok: problems.length === 0, problems: problems.slice(0, 20) };
}

/** The problems as a compact report — fed to the AI pass as its "failing log", and to error messages. */
export function preflightProblemsText(problems: readonly PreflightProblem[]): string {
  return problems
    .slice(0, 15)
    .map((p) => `- ${p.path}${p.line ? ` (line ${p.line})` : ''}: ${p.message}`)
    .join('\n');
}

/** Does this name a file (an image, a font, an alias path) rather than an npm package? */
function isAssetSpecifier(name: string): boolean {
  return Boolean(name) && isLocalFileSpecifier(name);
}

/** One plain-language sentence for the user about why the ship stopped. Never a raw compiler line alone. */
export function preflightUserMessage(problems: readonly PreflightProblem[]): string {
  const first = problems[0];
  if (!first) return 'Your app has a code problem that stopped it from compiling.';
  const named = first.message.match(/"([^"]+)"/)?.[1] || '';
  const what = first.kind === 'missing-package'
    // ⚠️ SAY WHICH KIND OF MISSING THING IT IS. An import of a picture that was never created is not
    // "a library that is not set up" — that phrasing sent the user (and the repair pass) hunting for
    // an npm package that cannot exist, which is why an APK build stayed blocked (admin 2026-08-14).
    // The classifier no longer mistakes an asset for a package, and the sentence no longer mistakes
    // one for the other either.
    ? isAssetSpecifier(named)
      ? `it uses an image or file ("${named}") that is not in the app`
      : `it uses a library ("${named || 'unknown'}") that is not set up`
    : first.kind === 'unresolved-import'
      ? `${first.path} ${first.message}`
      : `${first.path}${first.line ? ` (line ${first.line})` : ''} has a code error: ${first.message}`;
  const more = problems.length > 1 ? ` (and ${problems.length - 1} more problem${problems.length > 2 ? 's' : ''})` : '';
  return `Your app cannot compile yet — ${what}${more}. NavBharatAI tried to repair it automatically and could not. ` +
    'Open this app in NavBharatAI Pro chat, ask it to fix this exact error, then come back and press the button again.';
}

/** Which files the AI pass may see and rewrite for these problems: the broken ones plus package.json. */
export function preflightAiPaths(problems: readonly PreflightProblem[]): string[] {
  const paths = new Set<string>(['package.json']);
  for (const p of problems) {
    paths.add(p.path);
    if (paths.size >= AI_REPAIR_MAX_FILES) break;
  }
  return [...paths];
}

/**
 * Verify, then heal until the app compiles or the attempts are spent.
 *
 * Deterministic first (free, instant): the well-known-deps reconciler. Then up to `maxAiRounds` AI
 * rounds, each RE-VERIFIED — the loop's success condition is "preflightVerify says ok", never "the model
 * said it fixed it". Every changed file is tracked so the caller can write the healing back into the
 * user's v5 workspace, which is what makes this "v5 fixes your app live" rather than a shadow copy.
 */
export async function preflightAndHeal(
  input: Record<string, string>,
  llm: AiRepairLlm,
  chain: AiRepairModel[],
  maxAiRounds = 2,
): Promise<PreflightHealResult> {
  let files = { ...input };
  const changed: Record<string, string> = {};
  const notes: string[] = [];
  let aiRounds = 0;

  let report = await preflightVerify(files);
  if (report.ok) return { ok: true, files, changed, problems: [], notes, aiRounds };

  // Tier 0a — deterministic: CREATE the shadcn/ui primitives the app imports but never wrote
  // (`@/components/ui/button` etc. + `@/lib/utils`). The #1 "cannot compile" class for generated apps.
  // Real, dependency-light implementations; the missing-package tier below then adds their deps
  // (clsx / tailwind-merge / class-variance-authority — all allowlisted). Re-verified like every tier.
  {
    const unresolved = report.problems
      .filter((p) => p.kind === 'unresolved-import' && typeof p.spec === 'string')
      .map((p) => ({ path: p.path, spec: p.spec as string }));
    if (unresolved.length > 0) {
      const scaf = scaffoldMissingUiPrimitives(files, unresolved);
      if (Object.keys(scaf.files).length > 0) {
        files = { ...files, ...scaf.files };
        Object.assign(changed, scaf.files);
        notes.push(`Created ${scaf.created.length} missing UI component${scaf.created.length === 1 ? '' : 's'} your app referenced (${scaf.created.join(', ')}).`);
        report = await preflightVerify(files);
        if (report.ok) return { ok: true, files, changed, problems: [], notes, aiRounds };
      }
    }
  }

  // Tier 0 — deterministic: add the allowlisted missing packages with their pinned, known-good ranges.
  if (report.problems.some((p) => p.kind === 'missing-package')) {
    const fixed = applyWellKnownMissingDeps(files);
    if (fixed.added.length > 0) {
      files = { ...files, ...fixed.files };
      changed['package.json'] = fixed.files['package.json'];
      notes.push(`Set up ${fixed.added.length} librar${fixed.added.length === 1 ? 'y' : 'ies'} your app uses (${fixed.added.map((a) => a.package).join(', ')}).`);
      report = await preflightVerify(files);
      if (report.ok) return { ok: true, files, changed, problems: [], notes, aiRounds };
    }
  }

  // Tier 0b — deterministic: complete a broken Tailwind setup (declare the pinned packages, write the
  // missing configs, rewrite the v4 import line). One correct shape, so no model is involved.
  if (detectTailwindProblems(files).length > 0) {
    const tw = applyTailwindSetup(files);
    if (Object.keys(tw.changed).length > 0) {
      files = tw.files;
      Object.assign(changed, tw.changed);
      notes.push(...tw.notes);
      report = await preflightVerify(files);
      if (report.ok) return { ok: true, files, changed, problems: [], notes, aiRounds };
    }
  }

  // Tier 1 — the AI pass, bounded and re-verified.
  for (; aiRounds < maxAiRounds && chain.length > 0; ) {
    aiRounds += 1;
    const involved: Record<string, string> = {};
    for (const p of preflightAiPaths(report.problems)) {
      if (typeof files[p] === 'string') involved[p] = files[p];
    }
    const result = await runAiRepair(llm, chain, {
      log: `The app does not compile. Problems found:\n${preflightProblemsText(report.problems)}`,
      files: involved,
      ruleSummary: 'The app has code errors that stop it from compiling.',
    });
    if (!result || !('files' in result)) break; // the model gave up or replied out of contract — honesty over retries

    files = { ...files, ...result.files };
    Object.assign(changed, result.files);
    report = await preflightVerify(files);
    if (report.ok) {
      notes.push(result.explanation || 'Corrected the code errors that stopped your app from compiling.');
      return { ok: true, files, changed, problems: [], notes, aiRounds };
    }
  }

  return { ok: false, files, changed, problems: report.problems, notes, aiRounds };
}
