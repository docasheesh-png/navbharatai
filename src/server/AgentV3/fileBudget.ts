// AgentV3 — FILE BUDGET for the build plan (admin 2026-08-02: "AI bahut bada code likhta hai —
// unnecessary code hata kar chhoti app banao").
//
// ROOT CAUSE it fixes, upstream (the 50/50 law: PREVENT, don't heal):
// the manifest prompt's only size guidance was the adjective "Keep it minimal but COMPLETE". To a weak
// model "minimal" is an opinion, not a rule — so a real reported build planned **50 files** for an app
// that needed roughly a dozen, then spent 30+ minutes writing them. Every extra file is also another
// place a duplicate import or a wrong path can appear, so bloat costs correctness, not just time.
//
// WHY A BUDGET AND NOT A POST-HOC "DELETE THE UNNECESSARY CODE" PASS (deliberate, admin-discussed):
//   • The shipped app is NOT bigger — Vite tree-shakes unused code out of the bundle at build time. The
//     real costs of bloat are build TIME, token COST, later EDITABILITY and BUG SURFACE.
//   • An LLM pass that deletes what it judges "unnecessary" is the automated form of the exact failure
//     this codebase guards against (wrongly deleting a still-used module). It cannot reliably tell dead
//     code from code reached dynamically, and on the weak tier it would be the weakest model making the
//     subtlest call.
// So the size is decided ONCE, up front, where it is free and safe: in the plan.
//
// The budget is a CEILING, never a target — a genuinely simple app should come in far under it. Nothing
// is ever trimmed silently: a plan that exceeds the budget still builds (an incomplete app is far worse
// than a large one), it is just recorded honestly so the overrun is measurable.
//
// Pure + deterministic — no I/O, no clock.

import { complexityFromPrompt } from '../lib/BuildTimeEstimator';

export type FileBudgetLabel = 'simple' | 'standard' | 'large';

export interface FileBudget {
  /** The ceiling on planned source files. */
  maxFiles: number;
  label: FileBudgetLabel;
}

const BASE_FILES = 8;       // entry + App + a couple of components + styles + config
const PER_MODULE = 1.5;     // each page/screen/dashboard
const PER_FEATURE = 1;      // each distinct capability
const MIN_FILES = 10;
const MAX_FILES = 32;

/**
 * The file ceiling for an app description. Derived from the SAME complexity signal the build-time
 * estimator already uses (`complexityFromPrompt`), so the budget and the ETA can never disagree about
 * how big an app is. Pure.
 */
export function fileBudgetForPrompt(prompt: string): FileBudget {
  const { moduleCount, featureCount } = complexityFromPrompt(String(prompt || ''));
  const raw = BASE_FILES + moduleCount * PER_MODULE + featureCount * PER_FEATURE;
  const maxFiles = Math.max(MIN_FILES, Math.min(MAX_FILES, Math.round(raw)));
  const label: FileBudgetLabel = maxFiles <= 14 ? 'simple' : maxFiles <= 24 ? 'standard' : 'large';
  return { maxFiles, label };
}

/**
 * The size instruction injected into the manifest (plan) prompt. Gives the model a NUMBER instead of an
 * adjective, plus the concrete anti-pattern that actually produces the bloat: a separate file for every
 * tiny helper, type or constant. Pure.
 */
export function fileBudgetInstruction(budget: FileBudget): string {
  return [
    `SIZE BUDGET — plan AT MOST ${budget.maxFiles} source files for this app. Fewer is better.`,
    'This is a hard ceiling, not a target: if the app is genuinely done in half of that, plan half.',
    '- Do NOT create a separate file for a single small helper, type, constant or one-off hook —',
    '  put it in the file that uses it. A file earns its own existence by being reused or genuinely large.',
    '- Prefer a few cohesive files over many thin ones (one solid component file beats four 10-line files).',
    '- Every file you plan must be REQUIRED for the app the user asked for — no "nice to have" extras,',
    '  no speculative abstraction layers, no scaffolding for features nobody requested.',
  ].join('\n');
}

/**
 * An honest diagnostics note when a plan exceeds its budget, or null when it is within it. The plan is
 * never silently trimmed — shipping an incomplete app would be far worse than shipping a large one — so
 * this exists to make the overrun visible and measurable. Pure.
 */
export function overBudgetNote(plannedFiles: number, budget: FileBudget): string | null {
  if (!Number.isFinite(plannedFiles) || plannedFiles <= budget.maxFiles) return null;
  return (
    `Plan exceeded the file budget: ${plannedFiles} files planned vs a ${budget.maxFiles}-file ceiling ` +
    `(${budget.label} app). The build proceeds in full — nothing was trimmed — but this plan is larger ` +
    `than this app should need, which costs build time and adds bug surface.`
  );
}
