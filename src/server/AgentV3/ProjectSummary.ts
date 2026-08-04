// AgentV3 — Project Summary ("What I built", Layer 27 / Product Understanding).
//
// After a SUCCESSFUL v5.0 build, we derive a short, friendly summary of what was
// actually created — detected stack/framework, counts of files/components/routes,
// a few key files, and how to run it — straight from the project graph. The route
// emits it as a final narration so the user sees a clear, honest recap of the
// build in the chat (a user-facing benefit, not internal telemetry).
//
// PURE & deterministic: no I/O, derived only from the real ProjectGraph that was
// built from actual writes/edits. Best-effort at the call site — wrapped so it can
// NEVER affect the build result. Kept in simple English with the universal
// "Preview tab" hint (the build already runs in the user's language; this recap
// stays English and safe).

import type { ProjectGraph } from './WorkspaceMemory';

/** Hard cap for the whole summary so it stays a concise chat message. */
const MAX_CHARS = 1200;
/** How many key components / routes to name. */
const MAX_COMPONENTS = 5;
const MAX_ROUTES = 5;

/** True if any file in the graph matches one of the given extensions. */
function hasExt(files: string[], exts: string[]): boolean {
  return files.some((f) => exts.some((e) => f.toLowerCase().endsWith(e)));
}

/**
 * Best-guess stack/framework label from the external dependencies and file
 * extensions. Deterministic and order-stable — the FIRST matching rule wins, so
 * more specific frameworks (Next.js) are checked before generic ones (React).
 */
function detectStack(graph: ProjectGraph): string {
  const deps = new Set(graph.dependencies);
  const has = (d: string): boolean => deps.has(d);
  const pyFiles = hasExt(graph.files, ['.py']);

  if (has('next')) return 'Next.js';
  if (has('nuxt')) return 'Nuxt';
  if (has('@remix-run/react') || has('@remix-run/node')) return 'Remix';
  if (has('@angular/core')) return 'Angular';
  if (has('svelte') || has('@sveltejs/kit')) return 'Svelte';
  if (has('vue')) return 'Vue';
  if (has('react')) return has('vite') ? 'React + Vite' : 'React';
  if (has('express') || has('fastify') || has('koa')) return 'Node/Express';
  if (pyFiles && (has('fastapi') || has('flask') || has('django'))) return 'Python';
  if (pyFiles) return 'Python';
  if (has('vite')) return 'Vite';
  return 'Web app';
}

/**
 * Generic, safe "how to run" hint for a detected stack. Never fabricates exact commands.
 * When `previewLive` is false, the LIVE preview did NOT come up during this build — so we do NOT
 * claim "see it live" (the dishonest message a real build report showed while the preview never
 * rendered). Instead we point the user at the reliable paths: In-browser preview + Diagnose.
 */
function runHint(stack: string, previewLive: boolean): string {
  const runCmd = stack === 'Python'
    ? 'Run: pip install -r requirements.txt, then start the server.'
    : 'Run: npm install && npm run dev.';
  if (previewLive) {
    return `${runCmd} Use the Preview tab to see it live.`;
  }
  return `${runCmd} The live preview didn't start automatically — open the Preview tab, use the In-browser preview, or click "Diagnose" to boot the live server.`;
}

/**
 * Build a short, friendly multi-line summary of what was created from the project
 * graph. PURE — no I/O, fully deterministic. Returns '' for an essentially empty
 * graph (no files) so the caller never shows an empty summary.
 */
/** Engine-written setup files (dev env/config) — changes the PIPELINE made, never the user's source. */
const ENGINE_CONFIG_PATH = /^(\.env(\..*)?|\.npmrc|\.nvmrc)$/;

export function summarizeProject(graph: ProjectGraph, request: string, opts?: { previewLive?: boolean; changedFiles?: number; editMode?: boolean; changedPaths?: string[] }): string {
  void request; // reserved for future tailoring; summary is graph-derived for now.
  if (!graph || graph.files.length === 0) return '';
  // Default TRUE (backward-compatible) — the caller passes the REAL preview state (whether a live
  // preview URL was actually published this build) so the recap never claims "see it live" falsely.
  const previewLive = opts?.previewLive !== false;
  // HONESTY (build-report autopsy 2026-07-05): how many files did THIS run actually create/modify,
  // and was it operating on an EXISTING app (edit/import) or building fresh? A read-only run
  // (import + survey, a question, an analysis) previously ended with "✅ Here's what I built: …
  // 165 files, 186 routes" — claiming authorship of an app it never touched. The header must say
  // what ACTUALLY happened: analyzed (0 changes) / edited (changed files in an existing app) /
  // built (fresh build, or the caller didn't track changes — today's wording, backward-compatible).
  // NOTE: editMode (not a changed-vs-total size comparison) distinguishes edit from fresh build —
  // a fresh build's graph also contains scaffold files the AI didn't write, so sizes can't be trusted.
  const changed = opts?.changedFiles;

  const stack = detectStack(graph);
  const lines: string[] = [];
  const analysisOnly = changed === 0;
  const editRun = typeof changed === 'number' && changed > 0 && opts?.editMode === true;
  // WHICH files changed (mitrify autopsy 2026-08-04): on a "do not change any files" survey turn the
  // header said "I changed 1 file in your project" — the pipeline's own dev .env from key-provisioning —
  // and named nothing. To the user that read as a broken promise. Naming the files (≤3) turns the
  // confusion into information, and a change-set that is ONLY engine-written setup config is said as
  // exactly that: setup, with their source untouched.
  const paths = (opts?.changedPaths ?? []).filter((p) => typeof p === 'string' && p);
  const named = paths.length > 0 && paths.length <= 3 ? ` (${paths.join(', ')})` : '';
  const onlyEngineConfig = paths.length > 0 && paths.every((p) => ENGINE_CONFIG_PATH.test(p));
  if (analysisOnly) {
    lines.push('🔍 I analyzed your project — no files were changed. Overview:');
  } else if (editRun && onlyEngineConfig) {
    lines.push(`🔍 I analyzed your project. Your source files are untouched — I only wrote ${paths.length === 1 ? 'a setup file' : `${paths.length} setup files`}${named} so the app can run here. Overview:`);
  } else if (editRun) {
    lines.push(`✅ Done — I changed ${changed} file${changed === 1 ? '' : 's'} in your project${named}. Overview:`);
  } else {
    lines.push("✅ Here's what I built:");
  }
  lines.push(`Stack: ${stack}`);

  const counts: string[] = [`${graph.files.length} file${graph.files.length === 1 ? '' : 's'}`];
  if (graph.components.length) {
    counts.push(`${graph.components.length} component${graph.components.length === 1 ? '' : 's'}`);
  }
  if (graph.routes.length) {
    counts.push(`${graph.routes.length} route${graph.routes.length === 1 ? '' : 's'}`);
  }
  // For analysis/edit runs the counts describe the EXISTING project, not this run's output.
  lines.push((analysisOnly || editRun ? 'Project: ' : '') + counts.join(', ') + '.');

  if (graph.components.length) {
    const names = graph.components.slice(0, MAX_COMPONENTS).join(', ');
    const more = graph.components.length > MAX_COMPONENTS ? ', …' : '';
    lines.push(`Components: ${names}${more}`);
  }
  if (graph.routes.length) {
    const paths = graph.routes.slice(0, MAX_ROUTES).join(', ');
    const more = graph.routes.length > MAX_ROUTES ? ', …' : '';
    lines.push(`Routes: ${paths}${more}`);
  }

  lines.push(runHint(stack, previewLive));

  const out = lines.join('\n');
  if (out.length <= MAX_CHARS) return out;
  // Trim to the bound without cutting a line in half where avoidable.
  const clipped = out.slice(0, MAX_CHARS - 1);
  const lastNl = clipped.lastIndexOf('\n');
  return (lastNl > MAX_CHARS * 0.6 ? clipped.slice(0, lastNl) : clipped) + '…';
}

/** Thin wrapper — single clear entry point alias for the route/other callers. */
export function projectSummaryNote(graph: ProjectGraph, request: string, opts?: { previewLive?: boolean; changedFiles?: number; editMode?: boolean }): string {
  return summarizeProject(graph, request, opts);
}
