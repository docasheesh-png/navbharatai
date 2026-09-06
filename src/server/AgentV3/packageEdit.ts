// Add / remove a dependency in a project's package.json — the pure, deterministic core behind the
// user-facing "add/remove a package" control (ROADMAP §8C / minor 30).
//
// WHY A PURE MODULE. The route reads package.json from the workspace, calls one of these, and writes the
// result back — so ALL the logic that can go wrong (a bad package name interpolated somewhere, a malformed
// package.json, a dependency landing in the wrong section) lives here where it is unit-tested, not spread
// through a route handler. The install itself is the build/preview pipeline's job (it already runs
// `npm install`), so this only edits the manifest — the dependency is real the moment it is declared, and
// installed on the next build exactly like one the AI added.
//
// 🔒 THE NAME IS VALIDATED, NEVER TRUSTED. A package name typed by a user could otherwise reach a shell
// (`npm install <name>`) or a JSON key. It is checked against npm's own naming rules and REJECTED if it
// does not match — a rejected name is a clear message; a cleverly escaped one is a future bug.

/** npm package-name rules: optional @scope/, lowercase, url-safe, ≤214 chars, no leading dot/underscore. */
const UNSCOPED = /^[a-z0-9][a-z0-9._-]*$/;
const SCOPED = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

export function isValidPackageName(name: string): boolean {
  const n = (name ?? '').trim();
  if (!n || n.length > 214) return false;
  if (n !== n.toLowerCase()) return false;
  return n.startsWith('@') ? SCOPED.test(n) : UNSCOPED.test(n);
}

/** A version/range value we are willing to write. Empty ⇒ caller uses the default. Deliberately loose —
 *  npm accepts semver ranges, dist-tags (`latest`), and urls; we reject only whitespace/quotes that would
 *  break the JSON or a shell, never a valid-but-unusual range. */
export function isSafeVersionValue(v: string): boolean {
  const s = (v ?? '').trim();
  if (!s) return true; // empty is fine — the default is applied
  if (s.length > 100) return false;
  return !/[\s"'`\\]/.test(s);
}

const DEFAULT_VERSION = 'latest';
const DEP_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

export type PackageEditResult =
  | { ok: true; text: string; changed: boolean; name: string; version?: string; note: string }
  | { ok: false; message: string };

function parsePkg(text: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(text);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Stable 2-space JSON with a trailing newline — the npm norm; keeps diffs clean. */
function stringify(pkg: Record<string, unknown>): string {
  return JSON.stringify(pkg, null, 2) + '\n';
}

/**
 * Add (or update) a dependency in `dependencies`. If it already sits in another section (dev/peer/opt),
 * it is left there and updated in place rather than duplicated — a package declared in two sections is a
 * real npm warning this must not create.
 */
export function addDependency(pkgText: string, rawName: string, rawVersion = ''): PackageEditResult {
  const name = (rawName ?? '').trim();
  if (!isValidPackageName(name)) {
    return { ok: false, message: `"${rawName}" is not a valid package name. Use a name like "axios" or "@scope/pkg".` };
  }
  if (!isSafeVersionValue(rawVersion)) {
    return { ok: false, message: `"${rawVersion}" is not a valid version. Use a range like "^1.2.3", a tag like "latest", or leave it blank.` };
  }
  const pkg = parsePkg(pkgText);
  if (!pkg) return { ok: false, message: 'package.json could not be read — it is missing or not valid JSON.' };
  const version = (rawVersion ?? '').trim() || DEFAULT_VERSION;

  // If it already lives in a non-`dependencies` section, update it THERE (do not create a duplicate).
  const existingSection = DEP_SECTIONS.find((s) => {
    const sec = pkg[s];
    return sec && typeof sec === 'object' && name in (sec as Record<string, unknown>);
  });
  const targetSection = existingSection ?? 'dependencies';
  const sec = (pkg[targetSection] && typeof pkg[targetSection] === 'object'
    ? pkg[targetSection]
    : (pkg[targetSection] = {})) as Record<string, string>;

  if (sec[name] === version) {
    return { ok: true, text: pkgText, changed: false, name, version, note: `${name} is already at ${version}.` };
  }
  const had = name in sec;
  sec[name] = version;
  return {
    ok: true,
    text: stringify(pkg),
    changed: true,
    name,
    version,
    note: had
      ? `Updated ${name} to ${version} in ${targetSection}. It installs on your next build.`
      : `Added ${name}@${version} to ${targetSection}. It installs on your next build.`,
  };
}

/** Remove a dependency from EVERY section it appears in. Honest when it was not there. */
export function removeDependency(pkgText: string, rawName: string): PackageEditResult {
  const name = (rawName ?? '').trim();
  if (!isValidPackageName(name)) {
    return { ok: false, message: `"${rawName}" is not a valid package name.` };
  }
  const pkg = parsePkg(pkgText);
  if (!pkg) return { ok: false, message: 'package.json could not be read — it is missing or not valid JSON.' };

  const removedFrom: string[] = [];
  for (const s of DEP_SECTIONS) {
    const sec = pkg[s];
    if (sec && typeof sec === 'object' && name in (sec as Record<string, unknown>)) {
      delete (sec as Record<string, unknown>)[name];
      removedFrom.push(s);
    }
  }
  if (removedFrom.length === 0) {
    return { ok: true, text: pkgText, changed: false, name, note: `${name} was not in package.json — nothing to remove.` };
  }
  return { ok: true, text: stringify(pkg), changed: true, name, note: `Removed ${name}. The change takes effect on your next build.` };
}

/** The declared dependencies, flattened for a UI list: name, version, and which section it is in. Pure. */
export function listDependencies(pkgText: string): Array<{ name: string; version: string; section: string }> {
  const pkg = parsePkg(pkgText);
  if (!pkg) return [];
  const out: Array<{ name: string; version: string; section: string }> = [];
  for (const s of DEP_SECTIONS) {
    const sec = pkg[s];
    if (sec && typeof sec === 'object') {
      for (const [name, version] of Object.entries(sec as Record<string, unknown>)) {
        out.push({ name, version: String(version), section: s });
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
