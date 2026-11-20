/**
 * 🔴 THE BROWSER SAYS AN EXPORT IS MISSING; THE FILE SAYS IT IS THERE (Q-2732, Q-2242; failedbr #1577, #1565, #1561,
 * #1544, #1540, 2026-11-20).
 *
 * Five builds ended RED on "The requested module '/src/game/core/meta.ts?t=1792462459867' does not provide an export
 * named 'combo'" (also `startMeta`, `Save` in src/lib/icons.tsx, `default` in src/App.tsx). In every one the model
 * opened the file, found the export, and said so ("`combo` IS exported … at line 248"); `tsc` was clean. In #1540 the
 * two checks 150 s apart carried the SAME `?t=` stamp: the dev server kept serving one stale transform of the file,
 * taken while a write was half-landed, and never invalidated it. A code repair cannot fix that, and the repair pass
 * spent its one attempt proving the code was fine.
 *
 * So the claim is checked against the file before any model is paid: when every "missing export" the console names
 * is in fact exported by that file on disk, the server is restarted with Vite's cache cleared, once, and the page is
 * looked at again. Anything else (a package module, a name the file really lacks) goes to the repair as before. PURE.
 */

export interface MissingExportClaim {
  /** Workspace-relative path of the module, without its `?t=` query (`src/game/core/meta.ts`). */
  path: string;
  /** The export the browser could not link. */
  name: string;
}

const CLAIM_RE = /requested module ['"]\/((?:src|app|lib|components|pages)\/[^'"?]+)(?:\?[^'"]*)?['"] does not provide an export named ['"]([A-Za-z_$][\w$]*)['"]/g;

/** Every "does not provide an export named" claim about a project source file, de-duplicated. */
export function missingExportClaims(consoleErrors: readonly string[]): MissingExportClaim[] {
  const seen = new Set<string>();
  const out: MissingExportClaim[] = [];
  for (const line of consoleErrors ?? []) {
    for (const m of String(line ?? '').matchAll(CLAIM_RE)) {
      const key = `${m[1]}#${m[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ path: m[1], name: m[2] });
    }
  }
  return out;
}

function withoutComments(src: string): string {
  return String(src ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** Does this module source export `name` (a declaration, a list, an alias, or `default`)? */
export function fileExportsName(source: string, name: string): boolean {
  const src = withoutComments(source);
  const n = name.replace(/[$]/g, '\\$');
  if (name === 'default') return /\bexport\s+default\b/.test(src) || /\bexport\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(src);
  if (new RegExp(`\\bexport\\s+(?:declare\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class|abstract\\s+class|interface|type|enum)\\s+${n}\\b`).test(src)) return true;
  for (const m of src.matchAll(/\bexport\s*(?:type\s*)?\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/);
      const exported = (bits[1] ?? bits[0]).replace(/^type\s+/, '').trim();
      if (exported === name) return true;
    }
  }
  return false;
}

/**
 * The claims that are stale: the file exists and exports the name. Returns them only when EVERY claim is stale (one
 * real missing export means the code needs a repair, and a restart would only delay it); otherwise `[]`.
 */
export function staleExportClaims(claims: readonly MissingExportClaim[], readFile: (path: string) => string | null): MissingExportClaim[] {
  if (claims.length === 0) return [];
  for (const c of claims) {
    const src = readFile(c.path);
    if (typeof src !== 'string' || !fileExportsName(src, c.name)) return [];
  }
  return [...claims];
}
