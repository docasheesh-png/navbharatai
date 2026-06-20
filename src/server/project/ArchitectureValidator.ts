/**
 * Architecture Validator (NavBharatAI generation engine).
 *
 * Deterministic, browser-free guards that block the "React #299 / mixed
 * architecture" class of failures BEFORE a preview is ever shown:
 *
 *  - DOM mount validation: the React entry's createRoot(getElementById('X'))
 *    must match exactly one <div id="X"> in index.html.
 *  - Single-entry rule: index.html loads exactly one module entry and NO legacy
 *    <script src> tags pointing at local .js files.
 *  - Mixed-architecture detection: a React app must not also ship vanilla layers
 *    (js/*.js, pages/*.js, router.js, dashboard.js).
 *  - Manifest conformance: forbidden paths for the chosen architecture.
 *
 * Returned as ProjectIssue[] (errors) so the BuildPipeline's verify+repair loop
 * fixes them automatically and the build is marked FAILED until clean.
 */
import { VirtualFileSystem } from './ProjectModel';
import type { ProjectIssue } from './ProjectVerifier';
import { selectArchitecture, forbiddenPathPatterns, type ArchitectureManifest, type FrameworkId } from './ArchitectureManifest';

/** Is this VFS a React app? (react dep, or any jsx/tsx source). */
export function isReactApp(vfs: VirtualFileSystem): boolean {
  const pkg = vfs.readText('package.json');
  if (pkg) {
    try {
      const j = JSON.parse(pkg);
      const deps = { ...(j.dependencies || {}), ...(j.devDependencies || {}) };
      if (deps.react) return true;
    } catch { /* ignore */ }
  }
  return vfs.paths().some((p) => /\.(jsx|tsx)$/i.test(p));
}

/** Declared deps (dependencies + devDependencies) from package.json, or null. */
function readDeps(vfs: VirtualFileSystem): Set<string> | null {
  const pkg = vfs.readText('package.json');
  if (!pkg) return null;
  try {
    const j = JSON.parse(pkg);
    return new Set([...Object.keys(j.dependencies || {}), ...Object.keys(j.devDependencies || {})]);
  } catch { return null; }
}

/** Is this VFS a Vue app? (vue dep, or any .vue SFC source). */
export function isVueApp(vfs: VirtualFileSystem): boolean {
  const pkg = vfs.readText('package.json');
  if (pkg) {
    try {
      const j = JSON.parse(pkg);
      const deps = { ...(j.dependencies || {}), ...(j.devDependencies || {}) };
      if (deps.vue) return true;
    } catch { /* ignore */ }
  }
  return vfs.paths().some((p) => /\.vue$/i.test(p));
}

/** Local (non-external) reference? */
function isLocal(url: string): boolean {
  return !/^(https?:)?\/\//.test(url) && !url.startsWith('data:') && !url.startsWith('//');
}

/** All `<script ...>` tags in the HTML with their src + whether type=module. */
function scriptTags(html: string): Array<{ src: string; module: boolean }> {
  const out: Array<{ src: string; module: boolean }> = [];
  const re = /<script\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const src = attrs.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (!src) continue;
    out.push({ src, module: /\btype=["']module["']/i.test(attrs) });
  }
  return out;
}

/** Count elements with a given id in the HTML. */
function countMountId(html: string, id: string): number {
  const re = new RegExp(`id=["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'gi');
  return (html.match(re) || []).length;
}

/**
 * The mount target id from the entry: React's
 * createRoot/render(getElementById('X')|querySelector('#X')) OR Vue's
 * createApp(App).mount('#X').
 */
function mountIdFromEntry(code: string): string | null {
  const byId = code.match(/getElementById\(\s*["']([^"']+)["']\s*\)/);
  if (byId) return byId[1];
  const byQuery = code.match(/querySelector\(\s*["']#([^"'.\s]+)["']\s*\)/);
  if (byQuery) return byQuery[1];
  const byMount = code.match(/\.mount\(\s*["']#([^"'.\s]+)["']\s*\)/);
  if (byMount) return byMount[1];
  return null;
}

const SOURCE_EXTS = ['', '.jsx', '.tsx', '.js', '.ts', '.mjs'];

function resolveEntry(vfs: VirtualFileSystem, ref: string): string | null {
  // Normalize leading "/" and "./" so "/src/main.jsx", "./src/main.jsx" and
  // "src/main.jsx" all resolve against the VFS.
  const base = ref.replace(/^\.?\//, '').split(/[?#]/)[0];
  for (const e of SOURCE_EXTS) if (vfs.has(base + e)) return base + e;
  return null;
}

/**
 * Validate the project against its (inferred or supplied) architecture manifest.
 * Returns error-severity issues for any violation.
 */
export function validateArchitecture(vfs: VirtualFileSystem, manifest?: ArchitectureManifest): ProjectIssue[] {
  const issues: ProjectIssue[] = [];
  let framework: FrameworkId;
  if (manifest) {
    framework = manifest.framework;
  } else {
    // Dependency in package.json is the authoritative signal — it must win over
    // loose file-extension heuristics, so a Vue app with a STRAY .jsx is still
    // treated as Vue (and the .jsx is then flagged as mixing, not mis-detected).
    const deps = readDeps(vfs);
    if (deps?.has('vue')) framework = 'vue';
    else if (deps?.has('react')) framework = 'react';
    else if (isVueApp(vfs)) framework = 'vue';
    else if (isReactApp(vfs)) framework = 'react';
    else framework = 'vanilla';
  }
  if (framework === 'vanilla') return issues; // nothing framework-specific to enforce

  const isVue = framework === 'vue';
  const label = isVue ? 'Vue' : 'React';
  const m = manifest ?? selectArchitecture(isVue ? 'vue app' : 'react app');
  const html = vfs.readText('index.html') ?? vfs.readText('public/index.html');
  if (html == null) {
    issues.push({ severity: 'error', file: '(project)', message: `${label} app has no index.html entry document.` });
    return issues;
  }

  // 1. Mixed-architecture: forbidden foreign/legacy layers in a React/Vue app.
  const componentNoun = isVue ? 'Vue SFC (.vue)' : 'React component';
  for (const pat of forbiddenPathPatterns(m)) {
    const hit = vfs.paths().find((p) => pat.test(p));
    if (hit) {
      issues.push({
        severity: 'error',
        file: hit,
        message: `Mixed architecture: "${hit}" does not belong in a ${label} app. Remove it — build the feature as a ${componentNoun} under src/.`,
      });
    }
  }

  // 2. Script tags: exactly one module entry, no legacy local <script src>.
  const tags = scriptTags(html);
  const moduleEntries = tags.filter((t) => t.module && isLocal(t.src));
  const legacyLocal = tags.filter((t) => !t.module && isLocal(t.src));
  for (const t of legacyLocal) {
    issues.push({
      severity: 'error',
      file: m.html,
      message: `Mixed architecture: legacy <script src="${t.src}"> in a ${label} app. The HTML must load only the module entry "<script type=module src=/${m.entry}>".`,
    });
  }
  if (moduleEntries.length === 0) {
    issues.push({ severity: 'error', file: m.html, message: `Missing ${label} entry: index.html must load <script type="module" src="/${m.entry}">.` });
  } else if (moduleEntries.length > 1) {
    issues.push({ severity: 'error', file: m.html, message: `Multiple module entries in index.html — there must be exactly one.` });
  }

  // 3. DOM mount validation: entry's createRoot id must match exactly one mount node.
  const entryRef = moduleEntries[0]?.src;
  const entryPath = entryRef ? resolveEntry(vfs, entryRef) : (vfs.has(m.entry) ? m.entry : null);
  if (entryRef && !entryPath) {
    issues.push({ severity: 'error', file: m.html, message: `Entry script "${entryRef}" does not resolve to a project file.` });
  }
  if (entryPath) {
    const code = vfs.readText(entryPath) || '';
    const mountsApp = isVue ? /createApp\b/.test(code) : /createRoot|ReactDOM\.render|hydrateRoot/.test(code);
    if (mountsApp) {
      const id = mountIdFromEntry(code);
      if (!id) {
        issues.push({ severity: 'error', file: entryPath, message: isVue
          ? `Entry creates a Vue app but no .mount('#...') target was found.`
          : `Entry mounts React but no getElementById('...') / querySelector('#...') target found.` });
      } else {
        const count = countMountId(html, id);
        if (count === 0) {
          issues.push({
            severity: 'error',
            file: m.html,
            message: `DOM mount mismatch: entry mounts to #${id} but index.html has no element with id="${id}".${isVue ? '' : ' (This is the React #299 cause.)'}`,
          });
        } else if (count > 1) {
          issues.push({ severity: 'error', file: m.html, message: `Duplicate mount node: #${id} appears ${count} times — there must be exactly one.` });
        }
      }
    }
  }

  return issues;
}
