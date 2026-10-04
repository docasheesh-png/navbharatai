// WHAT DO THE INSTALLED PACKAGES REALLY EXPORT? (Q-115, 2026-10-04)
//
// The missing-import heal could restore a forgotten package import only when ANOTHER file of the project
// already imported that name — so `<Clock>` used once and imported nowhere stayed a red build, because
// guessing a package's export list is how this healer once turned a broken build into an unparseable one.
// The project's own node_modules can be asked instead. This builds the one command that asks, and parses
// its answer. The question is narrow on purpose:
//   • only the `dependencies` of the workspace's package.json (at most MAX_PACKAGES), never a path;
//   • only the names the compiler reported as undefined, validated as identifiers before they reach the
//     script, so nothing from a file can be injected into the command;
//   • only true NAMED exports (`Object.keys` of the module namespace) — never the keys of a CJS default,
//     which an ESM bundler may not let a named import reach;
//   • a package that throws on import (needs a DOM, imports CSS) is skipped, and the whole run is bounded.
// PURE.

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
export const MAX_PACKAGES = 100;
export const MAX_NAMES = 50;
const MARK = 'NBAI_INSTALLED_EXPORTS ';

/** The shell command that prints MARK + JSON { package: [names it exports] }. */
export function installedExportsCommand(names: readonly string[]): string {
  const asked = [...new Set(names)].filter((n) => IDENTIFIER.test(n) && n !== 'default').slice(0, MAX_NAMES);
  const script = [
    `const names = ${JSON.stringify(asked)};`,
    `const fs = await import('node:fs');`,
    `let pkg = {}; try { pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); } catch {}`,
    `const deps = Object.keys(pkg.dependencies || {}).filter((d) => /^(@[\\w.-]+\\/)?[\\w.-]+$/.test(d)).slice(0, ${MAX_PACKAGES});`,
    `const out = {};`,
    `for (const d of deps) {`,
    `  try { const keys = new Set(Object.keys(await import(d))); const hit = names.filter((n) => keys.has(n)); if (hit.length) out[d] = hit; } catch {}`,
    `}`,
    `console.log(${JSON.stringify(MARK)} + JSON.stringify(out));`,
  ].join('\n');
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  return `timeout 25 node --input-type=module -e "$(echo ${b64} | base64 -d)" 2>/dev/null`;
}

/** Read the command's answer. Anything malformed is an empty answer — never a guess. */
export function parseInstalledExports(stdout: string): Record<string, string[]> {
  const line = String(stdout ?? '').split('\n').reverse().find((l) => l.startsWith(MARK));
  if (!line) return {};
  try {
    const raw = JSON.parse(line.slice(MARK.length)) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string[]> = {};
    for (const [spec, names] of Object.entries(raw as Record<string, unknown>)) {
      if (!/^(@[\w.-]+\/)?[\w.-]+$/.test(spec) || !Array.isArray(names)) continue;
      const valid = names.filter((n): n is string => typeof n === 'string' && IDENTIFIER.test(n));
      if (valid.length) out[spec] = valid;
    }
    return out;
  } catch {
    return {};
  }
}
