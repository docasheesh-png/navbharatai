/**
 * A RECIPE'S DEPENDENCY IS INSTALLED, NOT NAMED (candy report 7da1cdca, 2026-10-04).
 *
 * Twenty-two recipe tools (state management, database, payments, email, OTP, SMS, hashing, feature
 * flags, AI, PDF, CSV, QR, …) ended their result with `Add the dependency: name@version` and left the
 * install to the model. A model that moves on writes code against a package that is not there: in that
 * report `three` was missing for two minutes while every typecheck quoted seven errors. The package and
 * its version are already decided by the recipe, so installing it is not a judgement — it is the
 * recipe's own last step. The dispatcher reads this line from every recipe's result, at one door, and
 * replaces it with what really happened.
 *
 * PURE: parsing and rewriting only. The install itself lives in ToolDispatcher.
 */

export interface NamedDependency { name: string; version: string; dev: boolean }

/** `Add the dependency: a@^1.0.0, @b/c@~2.1.0 (and @types/three)` — one line, as recipes write it. */
const LINE_RE = /^Add the dependency: (.+)$/m;
const SPEC_RE = /^(@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?)@([\^~]?[0-9][0-9A-Za-z.\-]*)$/;

/** The dependencies a recipe result names, and the exact line that named them. PURE. */
export function namedDependencies(text: string): { line: string; deps: NamedDependency[] } | null {
  const m = LINE_RE.exec(String(text ?? ''));
  if (!m) return null;
  const line = m[0];
  let body = m[1].trim();
  const withTypes = /\(and @types\/three\)/.test(body);
  body = body.replace(/\(and [^)]*\)/g, '').trim();
  const deps: NamedDependency[] = [];
  for (const raw of body.split(/,\s*/)) {
    const s = SPEC_RE.exec(raw.trim());
    if (s) deps.push({ name: s[1], version: s[2], dev: false });
  }
  if (withTypes) {
    const three = deps.find((d) => d.name === 'three');
    if (three) deps.push({ name: '@types/three', version: three.version, dev: true });
  }
  return deps.length > 0 ? { line, deps } : null;
}

/**
 * The folder whose package.json a recipe's files belong to: the deepest folder, among the written
 * paths' ancestors, that `hasManifest` confirms. '' is the project root. PURE (the probe is injected).
 */
export function manifestDirFor(paths: readonly string[], hasManifest: (dir: string) => boolean): string {
  let best = '';
  for (const p of paths) {
    const parts = String(p ?? '').replace(/^\.?\//, '').split('/').slice(0, -1);
    for (let i = parts.length; i > 0; i--) {
      const dir = parts.slice(0, i).join('/');
      if (hasManifest(dir)) { if (dir.length > best.length) best = dir; break; }
    }
  }
  return best;
}

/** Which of `deps` the manifest does not list yet. An unreadable manifest lists nothing we may touch. PURE. */
export function unlistedDependencies(deps: readonly NamedDependency[], packageJson: string | null): NamedDependency[] | null {
  try {
    const pkg = JSON.parse(packageJson ?? '') as Record<string, Record<string, string> | undefined>;
    const listed = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
    return deps.filter((d) => !listed.has(d.name));
  } catch {
    return null;
  }
}
