// P-DEV.5 — Real package-manager operations at the manifest level.
//
// The IDE terminal used to return FAKE "npm install" output. These pure helpers make it real: they
// add/remove a dependency in the workspace's package.json and return the updated text, so typing
// `npm install axios` actually changes the app's manifest (and it persists via the file store). The
// node_modules fetch still happens when the app is built in the sandbox — but the manifest is the
// source of truth, so declaring the dep is the real, durable change. Pure → unit-testable.

export interface PackageSpec {
  name: string;
  /** Explicit version/range if the user gave one (`react@18.2.0`), else undefined. */
  version?: string;
}

/** Parse an npm package spec, handling scoped names (`@scope/pkg`) and `name@version`. Pure. */
export function parsePackageSpec(spec: string): PackageSpec | null {
  const s = String(spec || '').trim();
  if (!s) return null;
  const scoped = s.startsWith('@');
  // For a scoped name the FIRST '@' is part of the name; a version '@' would be the next one.
  const at = s.indexOf('@', scoped ? 1 : 0);
  if (at <= 0) return { name: s };
  const name = s.slice(0, at);
  const version = s.slice(at + 1).trim();
  return name ? { name, version: version || undefined } : null;
}

export interface PkgOpResult {
  ok: boolean;
  /** Updated package.json text (unchanged on failure). */
  text: string;
  message: string;
}

function parsePkg(text: string): Record<string, any> | null {
  try {
    const obj = JSON.parse(text);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

// Preserve 2-space indentation (the npm convention) + trailing newline.
function stringify(obj: Record<string, any>): string {
  return JSON.stringify(obj, null, 2) + '\n';
}

/**
 * Add (or update) a dependency in package.json. Honest about versions: uses the user-supplied
 * version/range verbatim, or the `latest` dist-tag when none is given (a valid, resolvable range) —
 * it never fabricates a specific version number it can't verify. Pure.
 */
export function addDependency(pkgText: string, name: string, version?: string, dev = false): PkgOpResult {
  const pkg = parsePkg(pkgText);
  if (!pkg) return { ok: false, text: pkgText, message: 'package.json is missing or invalid JSON.' };
  if (!name) return { ok: false, text: pkgText, message: 'no package name given.' };
  const field = dev ? 'devDependencies' : 'dependencies';
  if (!pkg[field] || typeof pkg[field] !== 'object') pkg[field] = {};
  const range = version ? version : 'latest';
  pkg[field][name] = range;
  // Keep dependency maps sorted (npm normalises them; keeps diffs clean).
  pkg[field] = Object.fromEntries(Object.entries(pkg[field]).sort(([a], [b]) => a.localeCompare(b)));
  return { ok: true, text: stringify(pkg), message: `+ added ${name}@${range} to ${field}` };
}

/** Remove a dependency from package.json (deps or devDeps). Pure. */
export function removeDependency(pkgText: string, name: string): PkgOpResult {
  const pkg = parsePkg(pkgText);
  if (!pkg) return { ok: false, text: pkgText, message: 'package.json is missing or invalid JSON.' };
  if (!name) return { ok: false, text: pkgText, message: 'no package name given.' };
  let removed = false;
  for (const field of ['dependencies', 'devDependencies']) {
    if (pkg[field] && typeof pkg[field] === 'object' && name in pkg[field]) {
      delete pkg[field][name];
      removed = true;
    }
  }
  if (!removed) return { ok: false, text: pkgText, message: `${name} is not a dependency.` };
  return { ok: true, text: stringify(pkg), message: `- removed ${name}` };
}

export type NpmAction = 'install' | 'uninstall';

/** Map a terminal verb to a normalized action (install/uninstall), or null if not a pkg op. Pure. */
export function npmActionForVerb(verb: string): NpmAction | null {
  const v = String(verb || '').toLowerCase();
  if (v === 'install' || v === 'i' || v === 'add') return 'install';
  if (v === 'uninstall' || v === 'remove' || v === 'rm' || v === 'un') return 'uninstall';
  return null;
}
