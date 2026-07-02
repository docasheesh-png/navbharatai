// P-PIPE.40 — dependency auto-fix planner (advisory).
//
// DependencyAnalysis already detects packages that are IMPORTED but not declared in package.json
// (kind: 'missing', high). Two problems with just reporting that bluntly: (1) a real missing npm
// package (e.g. `react-router-dom`) deserves an EXACT, version-pinned "add this" instruction, and
// (2) a false positive — a bare local path alias like `components/Button` or `lib/api` that the
// import scanner can't resolve (tsconfig `paths` / vite `resolve.alias` aren't resolved) — must NOT
// be reported as a missing npm package, or the user is told to install something that doesn't exist.
//
// This module PARTITIONS the missing set against a curated allowlist of well-known npm packages:
//   • on the allowlist  → an exact `name@^range` add suggestion the builder can apply with edit_file
//   • otherwise         → a softened "verify — may be a local alias, not an npm package" note
// It NEVER touches package.json or the install path (the builder applies fixes under its own
// judgment, a second false-positive filter). Pure, no I/O, never throws. Advisory report content only.

import type { DependencyIssue } from './DependencyAnalysis';

/**
 * Curated well-known npm packages → a known-good caret range. Deliberately EXCLUDES bare names that
 * commonly collide with local path aliases (components, lib, utils, hooks, api, store, types, pages,
 * features, styles, assets, config) — those must fall through to "verify", never auto-suggested.
 * Every entry here is an unambiguous, real npm package an AgentV3-generated React/Vite app uses.
 */
export const WELL_KNOWN_DEPS: Record<string, string> = {
  'react-router-dom': '^6',
  'react-router': '^6',
  zustand: '^4',
  axios: '^1',
  '@tanstack/react-query': '^5',
  swr: '^2',
  clsx: '^2',
  classnames: '^2',
  'tailwind-merge': '^2',
  'class-variance-authority': '^0.7.0',
  dayjs: '^1',
  'date-fns': '^3',
  'framer-motion': '^11',
  zod: '^3',
  yup: '^1',
  'react-hook-form': '^7',
  '@hookform/resolvers': '^3',
  'lucide-react': '^0.400.0',
  'react-icons': '^5',
  '@heroicons/react': '^2',
  '@headlessui/react': '^2',
  '@radix-ui/react-dialog': '^1',
  recharts: '^2',
  'chart.js': '^4',
  'react-chartjs-2': '^5',
  uuid: '^9',
  nanoid: '^5',
  immer: '^10',
  'react-hot-toast': '^2',
  sonner: '^1',
  '@supabase/supabase-js': '^2',
  firebase: '^10',
  'react-markdown': '^9',
  'react-dropzone': '^14',
};

export interface DependencyAutoFixPlan {
  /** Missing packages that are on the well-known allowlist — safe to suggest with an exact version. */
  autofixable: Array<{ package: string; version: string }>;
  /** Missing names NOT on the allowlist — likely a local path alias; ask the user/agent to verify. */
  needsReview: string[];
}

/**
 * Partition the `missing` dependency findings into confidently-fixable (allowlisted npm packages) vs
 * needs-review (probable local aliases). Only considers kind === 'missing'. Deduped, order-stable. Pure.
 */
export function planDependencyAutoFix(missing: readonly DependencyIssue[]): DependencyAutoFixPlan {
  const autofixable: Array<{ package: string; version: string }> = [];
  const needsReview: string[] = [];
  const seen = new Set<string>();
  for (const issue of missing || []) {
    if (!issue || issue.kind !== 'missing') continue;
    const name = issue.package;
    if (typeof name !== 'string' || !name || seen.has(name)) continue;
    seen.add(name);
    const version = WELL_KNOWN_DEPS[name];
    if (version) autofixable.push({ package: name, version });
    else needsReview.push(name);
  }
  return { autofixable, needsReview };
}

/** Advisory report line(s), or '' when there is nothing to say. Pure. */
export function dependencyAutoFixSummary(plan: DependencyAutoFixPlan): string {
  if (!plan.autofixable.length && !plan.needsReview.length) return '';
  const lines: string[] = [];
  if (plan.autofixable.length) {
    lines.push(
      `Dependency auto-fix — add these to package.json, then reinstall: ${plan.autofixable
        .map((d) => `${d.package}@${d.version}`)
        .join(', ')}`,
    );
  }
  if (plan.needsReview.length) {
    lines.push(
      `Verify (imported but not in package.json — likely a local path alias in tsconfig/vite, NOT an npm package): ${plan.needsReview.join(
        ', ',
      )}`,
    );
  }
  return lines.join('\n');
}
