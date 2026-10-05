/**
 * Which `/api` routes does the app itself call? Shared by the Q-162 census and its baseline writer.
 *
 * A route is CALLED when client code (`src/` outside `src/server/`, tests excluded) names its path: the
 * whole path for a route with no parameters, or the literal part before its first `:param` / `*` for one
 * with them (`/api/gallery/admin/${id}/review` names `/api/gallery/admin`). Comments are stripped on
 * both sides, so neither a route described in a comment nor a caller in a comment counts.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n)) out.push(f);
  }
  return out;
}

/** Drops block and line comments (a `//` preceded by `:` — a URL scheme — is kept). */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

export interface ApiRoute { method: string; path: string; file: string }

export function serverApiRoutes(root = '.'): ApiRoute[] {
  const files = [...walk(join(root, 'src/server')), join(root, 'server.ts')];
  const seen = new Set<string>();
  const out: ApiRoute[] = [];
  for (const f of files) {
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/\b(?:app|router)\.(get|post|put|patch|delete|all)\(\s*['"`](\/api\/[^'"`$]+)['"`]/g)) {
      const key = `${m[1].toUpperCase()} ${m[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ method: m[1].toUpperCase(), path: m[2], file: f.slice(root === '.' ? 0 : root.length + 1) });
    }
  }
  return out;
}

export function clientSource(root = '.'): string {
  return walk(join(root, 'src'))
    .filter((f) => !f.includes(`${join(root, 'src/server')}/`) && !f.startsWith('src/server/'))
    .map((f) => stripComments(readFileSync(f, 'utf8')))
    .join('\n');
}

export function isCalled(path: string, client: string): boolean {
  const cut = path.search(/[:*]/);
  if (cut === -1) return [`${path}'`, `${path}"`, `${path}\``, `${path}?`, `${path}/`, `${path}$`].some((s) => client.includes(s));
  return client.includes(path.slice(0, cut).replace(/\/$/, ''));
}

export function uncalledRoutes(root = '.'): string[] {
  const client = clientSource(root);
  return serverApiRoutes(root)
    .filter((r) => !isCalled(r.path, client))
    .map((r) => `${r.method} ${r.path}`)
    .sort();
}
