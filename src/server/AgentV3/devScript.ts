/**
 * HOW THIS PROJECT STARTS ITSELF — one derivation, used everywhere.
 *
 * "Which npm script runs this app, and how do I pin it to a port?" was answered in three different
 * places, and the copies had already drifted:
 *   • `ToolDispatcher` (generate_e2e): dev → start. No `preview` fallback, no port pinning.
 *   • `WorkspaceLauncher.getStartCommand`: dev → start → preview, with Vite/Next port flags.
 *   • and now the per-version preview needed the same answer a third time.
 *
 * A drifted copy is not a style problem here: an app whose only script is `preview` (a common shape
 * for a static export) got `npm run dev` from one copy and the right answer from the other, so the
 * SAME project started in one code path and failed in another. Centralising is the fix for the class,
 * not for the instance.
 *
 * Deliberately pure — it takes a parsed package.json and returns strings. Nothing here reads a disk,
 * a sandbox, or an env, so every caller (local spawn, sandbox command, generated E2E config) can
 * compose the pieces the way its own runtime needs them.
 */

/** The scripts block of a package.json, however malformed. */
export type Scripts = Record<string, unknown>;

/** Script preference order. `start` is last-resort even when absent — npm's own default verb. */
const PREFERENCE = ['dev', 'start', 'preview'] as const;

/**
 * The npm script that runs this app in development.
 *
 * Falls back to `start` when a package.json has none of them: that is what every caller did before,
 * and an honest "npm start failed" is a better outcome than refusing to try.
 */
export function pickDevScript(scripts: Scripts | undefined | null): string {
  const s = scripts && typeof scripts === 'object' ? scripts : {};
  for (const name of PREFERENCE) {
    if (typeof (s as Record<string, unknown>)[name] === 'string') return name;
  }
  return 'start';
}

/**
 * Flags that pin a dev server to `port` on all interfaces, for the frameworks whose CLI accepts them.
 *
 * ⚠️ The PORT env var is NOT enough: Vite and Next both ignore it, which is exactly how a preview ends
 * up pointed at a port nothing is listening on. Returns [] for frameworks with no such flag (CRA, a
 * plain Express server) — those honour PORT and the caller sets it in the environment instead.
 */
export function devPortFlags(
  pkg: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>; scripts?: Scripts } | null | undefined,
  script: string,
  port: number,
): string[] {
  if (!Number.isInteger(port) || port <= 0) return [];
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const body = String((pkg?.scripts as Record<string, unknown> | undefined)?.[script] ?? '');
  if ('vite' in deps || /\bvite\b/.test(body)) return ['--port', String(port), '--host', '0.0.0.0'];
  if ('next' in deps || /\bnext\b/.test(body)) return ['-p', String(port), '-H', '0.0.0.0'];
  return [];
}

/**
 * The whole shell command, with `--` so the flags reach the framework rather than npm.
 *
 * `PORT=` is set as well as the flags, never instead of them: the flags win for Vite/Next, and PORT is
 * the only lever the frameworks that return no flags respond to. Setting both means one command shape
 * works for every project we can encounter.
 */
export function devServerCommand(
  pkg: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>; scripts?: Scripts } | null | undefined,
  port: number,
  packageManager = 'npm',
): string {
  const script = pickDevScript(pkg?.scripts);
  const flags = devPortFlags(pkg, script, port);
  const tail = flags.length > 0 ? ` -- ${flags.join(' ')}` : '';
  return `PORT=${port} HOST=0.0.0.0 ${packageManager} run ${script}${tail}`;
}

/** Parse a package.json without throwing — an unreadable one simply yields no hints. */
export function parsePackageJson(raw: string | undefined | null): { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>; scripts?: Scripts } | null {
  try {
    const parsed = JSON.parse(String(raw ?? ''));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
