// A NEW APP MAY START WITH TYPESCRIPT'S STRICT MODE ON — a measured trial (queue Q-008, admin 2026-10-01).
//
// 🔴 WHY. The Vite-React starter and every golden scaffold compile with strict OFF (the template's
// tsconfig sets no `strict`, so TypeScript's default of off applies). Off, TypeScript does not narrow a
// `{ ok: true } | { ok: false; message }` union by `if (!result.ok)`, so correct code fails with TS2339,
// and that error has its own prompt line and its own entry in `tscErrorCause.ts`. Off, it also lets
// "this value may be null" reach the user's phone as a crash instead of stopping the build. Strict ON
// removes the first class and catches the second at build time.
//
// ⚠️ WHY A TRIAL AND NOT A SWITCH. Strict mode makes every generated app typecheck harder, and the
// cheaper models may write more errors that need a repair. Whether that costs more than it saves is
// unmeasured. So a fixed share of NEW workspaces start strict, chosen by their workspace id (the same
// project is always in or always out), and every build records which kind it was (`strictCohort`,
// folded into the daily cost telemetry). Comparing `strict-new` with `loose-new` builds is the answer.
//
// 🔒 ONLY A NEW APP. The transform is applied where a workspace is SEEDED with our starter — never to a
// tsconfig an app already has. An app built loose stays loose for ever; nothing here rewrites it.
//
// Flag: `AGENTV3_STRICT_TRIAL` (default ON; `off` seeds every new app loose, as before) and
// `AGENTV3_STRICT_TRIAL_PCT` (default 20; `0` pauses; an unreadable value means 0 with a log line —
// the shared `parseRolloutPercent` rule; blank means the default, NOT 100%).
//
// PURE except for the env read.

import { inEscalationRollout, parseRolloutPercent } from './escalationRollout';

/** The share of new workspaces that start strict when nothing is configured. */
export const STRICT_TRIAL_DEFAULT_PCT = 20;

/** The percentage of new workspaces in the trial (0 when the trial is off). */
export function strictTrialPercent(env: NodeJS.ProcessEnv = process.env): number {
  if (String(env.AGENTV3_STRICT_TRIAL ?? '').trim().toLowerCase() === 'off') return 0;
  const pct = parseRolloutPercent(env.AGENTV3_STRICT_TRIAL_PCT, 'AGENTV3_STRICT_TRIAL_PCT');
  return pct == null ? STRICT_TRIAL_DEFAULT_PCT : pct;
}

/** Does a NEW app in this workspace start strict? Deterministic per workspace id. */
export function inStrictTrial(workspaceId: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return inEscalationRollout(workspaceId, strictTrialPercent(env));
}

function isTsconfigPath(path: string): boolean {
  return String(path).replace(/^\.?\/+/, '') === 'tsconfig.json';
}

/**
 * The strict form of a seeded tsconfig: `compilerOptions.strict = true`, written back with the same
 * 2-space JSON and trailing-newline shape. Deterministic, so the result is byte-identical every time
 * (the content-based "is this our starter?" readers depend on that). A tsconfig that is not plain JSON
 * (comments), already strict, or has no `compilerOptions` is returned unchanged.
 */
export function strictTsconfig(content: string): string {
  if (typeof content !== 'string') return content;
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return content; }
  if (!parsed || typeof parsed !== 'object') return content;
  const opts = (parsed as { compilerOptions?: unknown }).compilerOptions;
  if (!opts || typeof opts !== 'object') return content;
  if ((opts as { strict?: unknown }).strict === true) return content;
  const next = { ...(parsed as object), compilerOptions: { ...(opts as object), strict: true } };
  return JSON.stringify(next, null, 2) + (content.endsWith('\n') ? '\n' : '');
}

/** Seeded starter files for this workspace: the strict tsconfig when the workspace is in the trial. */
export function applyStrictTrial(
  files: Record<string, string>,
  workspaceId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  if (!inStrictTrial(workspaceId, env)) return files;
  let changed = false;
  const out: Record<string, string> = {};
  for (const [p, c] of Object.entries(files)) {
    if (isTsconfigPath(p)) {
      const strict = strictTsconfig(c);
      if (strict !== c) changed = true;
      out[p] = strict;
    } else {
      out[p] = c;
    }
  }
  return changed ? out : files;
}

/**
 * Every form NavBharatAI may have seeded at this path: the content itself and, for `tsconfig.json`,
 * its strict form. The byte-exact "is this our own starter file?" readers use this so a trial
 * workspace's untouched tsconfig is still recognised as ours.
 */
export function seededForms(path: string, content: string): string[] {
  if (!isTsconfigPath(path)) return [content];
  const strict = strictTsconfig(content);
  return strict === content ? [content] : [content, strict];
}

/** Is this tsconfig content strict? `null` when it cannot be read (not JSON, no compilerOptions). */
export function tsconfigIsStrict(content: string | null | undefined): boolean | null {
  if (typeof content !== 'string') return null;
  try {
    const parsed = JSON.parse(content) as { compilerOptions?: { strict?: unknown } };
    if (!parsed || typeof parsed !== 'object' || !parsed.compilerOptions) return null;
    return parsed.compilerOptions.strict === true;
  } catch {
    return null;
  }
}

/** The measurement label for one build: was the app strict, and was it a fresh app? */
export type StrictCohort = 'strict-new' | 'loose-new' | 'strict-existing' | 'loose-existing' | 'unknown';

export function strictCohort(tsconfig: string | null | undefined, freshApp: boolean): StrictCohort {
  const strict = tsconfigIsStrict(tsconfig);
  if (strict == null) return 'unknown';
  return `${strict ? 'strict' : 'loose'}-${freshApp ? 'new' : 'existing'}`;
}
