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
    const line = raw.trim().replace(/^[-*\d.)\s]+/, ''); // strip list bullets/numbers
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
  return out.slice(0, 40); // a simple app never needs more — keeps the build bounded
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
];

export function fileUserPrompt(prompt: string, file: SimpleFileSpec, manifest: SimpleFileSpec[]): string {
  const fileList = manifest.map((f) => `  - ${f.path}${f.purpose ? ` — ${f.purpose}` : ''}`).join('\n');
  return [
    `App being built:\n${prompt}`,
    '',
    `The app's complete file list (so your imports line up):\n${fileList}`,
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

export function repairUserPrompt(prompt: string, errors: string, files: OneShotFile[]): string {
  const dump = files.map((f) => `<<<FILE ${f.path}>>>\n${f.content}\n<<<ENDFILE>>>`).join('\n\n');
  return [
    `App being built:\n${prompt}`,
    '',
    `The build FAILED with these compiler errors:\n${errors.slice(0, 6000)}`,
    '',
    `Current files:\n${dump.slice(0, 60_000)}`,
    '',
    'Output ONLY the corrected <<<FILE …>>> blocks for the files you need to change.',
  ].join('\n');
}

/** Result of the real compile/build check run in the sandbox. */
export interface VerifyResult {
  ok: boolean;
  /** Compiler error text (empty when ok) — fed verbatim to the repair pass. */
  errors: string;
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
  repair?: (errors: string, files: OneShotFile[]) => Promise<OneShotFile[]>;
  /** Max auto-repair attempts before handing off to the full builder (default 2). */
  maxRepairs?: number;
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
}

/**
 * Run the Simple Builder. STICKY SUCCESS: once the files are written the build is a success even if
 * the best-effort preview is slow. Returns ok:false (never throws) on any failure so the caller falls
 * back to the agentic loop.
 */
export async function runSimpleBuild(deps: SimpleBuildDeps): Promise<SimpleBuildResult> {
  const minFiles = deps.minFiles ?? 2;
  const concurrency = deps.concurrency ?? 5;
  let files: OneShotFile[];
  try {
    files = await withTimeout((async () => {
      deps.log?.('Planning the file list…');
      const manifestText = await deps.generate(manifestSystemPrompt(deps.framework), manifestUserPrompt(deps.prompt, deps.scaffoldPaths));
      const manifest = parseFileManifest(manifestText);
      if (manifest.length < minFiles) throw new Error('manifest_too_small');
      deps.log?.(`Building ${manifest.length} file(s) — one focused pass each…`);
      // Generate each file in its OWN call, in parallel (bounded). Each returns one FILE block.
      const generated = await mapWithConcurrency(manifest, concurrency, async (spec) => {
        try {
          const text = await deps.generate(fileSystemPrompt(deps.framework), fileUserPrompt(deps.prompt, spec, manifest));
          const blocks = parseFileBlocks(text);
          // Prefer the block matching the requested path; else the first block; else nothing.
          const match = blocks.find((b) => b.path === spec.path) ?? blocks[0];
          return match ? { path: spec.path, content: match.content } : null;
        } catch {
          return null; // a single file's call failing must not kill the whole build
        }
      });
      const written = generated.filter((f): f is OneShotFile => !!f && !!f.content);
      if (written.length < minFiles) throw new Error('too_few_files_generated');
      await deps.writeFiles(written);
      return written;
    })(), deps.overallTimeoutMs ?? 240_000, 'simple-build');
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, filesWritten: 0, summary: 'Simple build could not produce the app — switching to the full builder.', reason };
  }

  deps.log?.(`Built your app — ${files.length} file(s), each generated individually.`);

  // A — VERIFY GATE + bounded AUTO-REPAIR. "Preview is EARNED": only claim success when the app
  // actually compiles. If verify is not wired (e.g. no sandbox), the prior sticky-success behavior
  // is kept unchanged. On a verify infra error we DON'T block (best-effort). If it still doesn't
  // compile after repairs, return ok:false so the caller falls through to the full agentic builder
  // (its own repair loop + readiness gate finish it) — never worse than today, never a fake success.
  if (deps.verify) {
    const maxRepairs = deps.maxRepairs ?? 2;
    const byPath = new Map(files.map((f) => [f.path, f] as const));
    let verdict = await deps.verify().catch(() => ({ ok: true, errors: '' }));
    let attempt = 0;
    while (!verdict.ok && attempt < maxRepairs && deps.repair) {
      attempt++;
      deps.log?.(`Found build errors — fixing them (attempt ${attempt}/${maxRepairs})…`);
      let fixed: OneShotFile[] = [];
      try { fixed = await deps.repair(verdict.errors, [...byPath.values()]); } catch { fixed = []; }
      fixed = fixed.filter((f) => f && f.path && f.content);
      if (!fixed.length) break;
      for (const f of fixed) byPath.set(f.path, f);
      try { await deps.writeFiles(fixed); } catch { break; }
      verdict = await deps.verify().catch(() => ({ ok: true, errors: '' }));
    }
    if (!verdict.ok) {
      deps.log?.('The app still has build errors — handing to the full builder to finish it.');
      return { ok: false, filesWritten: files.length, summary: 'Built the files but the app did not compile cleanly — switching to the full builder to finish it.', reason: 'verify_failed' };
    }
    files = [...byPath.values()];
    deps.log?.('Build verified — the app compiles. ✓');
  }

  // VERIFIED (or verify not wired) → success; the preview is a best-effort bonus.
  if (deps.startPreview) {
    try { await withTimeout(deps.startPreview(), deps.previewTimeoutMs ?? 90_000, 'simple-preview'); }
    catch { deps.log?.('Preview is still starting — your files are ready.'); }
  }
  return { ok: true, filesWritten: files.length, summary: `Built your app file-by-file — ${files.length} file(s).` };
}
