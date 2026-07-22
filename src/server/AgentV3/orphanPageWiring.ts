// AgentV3 — Orphan-Page Wiring: a deterministic self-heal for "page component created but never used".
//
// THE REAL DEFECT (deep-test SaaS dashboard, build 6f87751d): the builder wrote 9 page components
// (AnalyticsPage.tsx, ApiKeysPage.tsx, AuditLogPage.tsx, …) but never imported/routed them in App.tsx —
// so the readiness gate reported "9 component(s) created but never used" + "Requested feature not found:
// admin panel", and the live app could not reach those pages. (Root cause upstream: the routing edit is a
// LATE, separate step that a timeout / provider storm cut off before every page was wired.)
//
// Per the 50/50 law (CLAUDE.md fifth rule, Step 5): the upstream prevention is a separate concern; THIS is
// the last-line-of-defence heal — but it is a REAL, deterministic fix, never a best-effort workaround. It
// wires each orphaned page into the app's react-router `<Routes>` (an import + a `<Route>`), which both
// makes the page reachable AND removes the orphan flag (the file is now imported). SAFE BY CONSTRUCTION:
// it ONLY ADDS (never edits an existing route/import), is idempotent, and NO-OPS the moment anything is
// ambiguous (no single `<Routes>` block, no clear component) so it can never break a working router.
// PURE + dependency-free = fully unit-testable.

export interface OrphanWiringResult {
  /** The file map with the router file updated (only that one file changes). Same object shape as input. */
  files: Record<string, string>;
  /** Page files that were wired in, as "path (Route path)" — empty when nothing was safe to wire. */
  wired: string[];
}

const COMPONENT_EXT = /\.(?:t|j)sx$/;

/** PascalCase component-ish name (Dashboard, AnalyticsPage). */
function isComponentName(n: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(n);
}

/** The base name (no dir, no extension): src/pages/AnalyticsPage.tsx → AnalyticsPage. */
function baseName(file: string): string {
  return (file.split('/').pop() || file).replace(COMPONENT_EXT, '');
}

/** A "page" file: lives under a pages/ dir, or its name ends in Page/Screen/View. */
function isPageFile(file: string): boolean {
  if (!COMPONENT_EXT.test(file)) return false;
  if (/(?:^|\/)pages?\//i.test(file)) return true;
  return /(?:Page|Screen|View)$/.test(baseName(file));
}

/** Every local module basename imported anywhere EXCEPT by `selfPath` (so a file importing itself doesn't count). */
function importedBasenames(files: Record<string, string>, selfPath: string): Set<string> {
  const out = new Set<string>();
  const re = /\bfrom\s*['"]([^'"]+)['"]/g;
  for (const [f, content] of Object.entries(files)) {
    if (f === selfPath) continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const spec = m[1];
      if (spec.startsWith('.') || spec.startsWith('@/') || spec.startsWith('~/') || spec.includes('/')) {
        out.add((spec.split('/').pop() || spec).replace(COMPONENT_EXT, '').replace(/\.(?:mjs|cjs|ts|js)$/, ''));
      }
    }
  }
  return out;
}

/** The router file = the single file that contains a react-router `<Routes> … </Routes>` block. */
function findRouterFile(files: Record<string, string>): string | null {
  const candidates = Object.keys(files).filter(
    (f) => COMPONENT_EXT.test(f) && /<Routes\b/.test(files[f]) && /<\/Routes>/.test(files[f]),
  );
  // Exactly one router keeps the heal unambiguous; 0 (not react-router) or 2+ (nested/ambiguous) → no-op.
  return candidates.length === 1 ? candidates[0] : null;
}

/** kebab route path from a component name: AnalyticsPage→/analytics, ApiKeysPage→/api-keys, Home→/home. */
function routePathFor(name: string): string {
  const bare = name.replace(/(?:Page|Screen|View)$/, '') || name;
  const kebab = bare.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase();
  return '/' + kebab.replace(/^-+|-+$/g, '');
}

/** Relative import specifier from the router file to a page file (no extension, always ./-prefixed). */
function relImport(fromFile: string, toFile: string): string {
  const fromDir = fromFile.split('/').slice(0, -1);
  const to = toFile.replace(COMPONENT_EXT, '').split('/');
  // strip common prefix
  let i = 0;
  while (i < fromDir.length && i < to.length - 1 && fromDir[i] === to[i]) i++;
  const ups = fromDir.slice(i).map(() => '..');
  const down = to.slice(i);
  const rel = [...ups, ...down].join('/');
  return rel.startsWith('.') ? rel : './' + rel;
}

/** Does the page file export a DEFAULT (→ `import X from`) or only a NAMED component (→ `import { X } from`)? */
function isDefaultExport(content: string): boolean {
  return /\bexport\s+default\b/.test(content);
}

/**
 * Wire every orphaned page component into the app's `<Routes>`. Returns the updated file map + the list of
 * pages wired. NO-OP (returns the input unchanged, wired: []) when there is no single unambiguous router,
 * or nothing orphaned. Idempotent + additive-only. PURE.
 */
export function wireOrphanPages(files: Record<string, string>): OrphanWiringResult {
  const empty: OrphanWiringResult = { files, wired: [] };
  const routerFile = findRouterFile(files);
  if (!routerFile) return empty;

  let router = files[routerFile];
  const imported = importedBasenames(files, routerFile);
  const wired: string[] = [];

  // Orphaned pages: a page file, not the router, not imported by anything, with a component-looking name.
  const orphans = Object.keys(files)
    .filter((f) => f !== routerFile && isPageFile(f) && isComponentName(baseName(f)) && !imported.has(baseName(f)))
    .sort();
  if (orphans.length === 0) return empty;

  const newImports: string[] = [];
  const newRoutes: string[] = [];
  const usedPaths = new Set<string>((router.match(/path\s*=\s*['"]([^'"]+)['"]/g) || []));
  for (const pageFile of orphans) {
    const name = baseName(pageFile);
    // already wired (import present) → skip, keep idempotent
    if (new RegExp(`\\b${name}\\b`).test(router)) continue;
    let path = routePathFor(name);
    // never collide with an existing route path
    let n = 2;
    while (usedPaths.has(`path="${path}"`) || usedPaths.has(`path='${path}'`)) { path = `${routePathFor(name)}-${n++}`; }
    usedPaths.add(`path="${path}"`);
    const spec = relImport(routerFile, pageFile);
    newImports.push(isDefaultExport(files[pageFile]) ? `import ${name} from '${spec}';` : `import { ${name} } from '${spec}';`);
    newRoutes.push(`        <Route path="${path}" element={<${name} />} />`);
    wired.push(`${pageFile} (${path})`);
  }
  if (wired.length === 0) return empty;

  // 1) inject the imports right after the LAST existing top-of-file import statement.
  const importLines = [...router.matchAll(/^import\b.*$/gm)];
  if (importLines.length === 0) return empty; // no import block to anchor to → don't risk a malformed edit
  const lastImport = importLines[importLines.length - 1];
  const at = (lastImport.index ?? 0) + lastImport[0].length;
  router = router.slice(0, at) + '\n' + newImports.join('\n') + router.slice(at);

  // 2) ensure `Route` is imported from react-router-dom (Routes is already there since <Routes> exists).
  if (!/\bimport\b[^\n]*\bRoute\b[^\n]*react-router/.test(router)) {
    router = router.replace(/(import\s*\{)([^}]*\bRoutes\b[^}]*)(\}\s*from\s*['"]react-router-dom['"])/,
      (full, a, names, c) => (/\bRoute\b/.test(names) ? full : `${a}${names}, Route${c}`));
  }

  // 3) inject the routes right before the LAST </Routes>.
  const closeIdx = router.lastIndexOf('</Routes>');
  router = router.slice(0, closeIdx) + newRoutes.join('\n') + '\n      ' + router.slice(closeIdx);

  return { files: { ...files, [routerFile]: router }, wired };
}
