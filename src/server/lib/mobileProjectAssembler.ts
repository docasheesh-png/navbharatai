// Turning a user's NavBharatAI-built app into a repository that GitHub can actually build into a
// real, signed .aab / .apk / .ipa.
//
// WHY THIS EXISTS (admin 2026-07-27): the ship kit already generated the Capacitor config and the
// GitHub Actions workflows, but it generated them in isolation — it never saw the user's app. Pushed
// on its own, the workflow reaches `npm run build` and fails, because there is no package.json, no
// build script, and no web content to wrap. This module is the missing half: it takes the app's REAL
// files and produces a repository where the generated workflow genuinely succeeds.
//
// The division of labour is deliberately the same one Claude Code uses, and it is not a limitation we
// invented — it is what signing actually requires:
//
//   NavBharatAI does : assemble the project, write the workflows, push to the user's repo, start the
//                      build, and hand back the finished binary.
//   GitHub does      : the compiling, on its own Linux runner (and macOS for iOS — Apple allows no
//                      other kind of machine).
//   The user does    : holds their own keystore and Apple credentials, as GitHub repository secrets.
//                      A signing key IS the app's permanent identity; if we generated one and handed
//                      it out, losing it would mean their app could never be updated again. It stays
//                      theirs, and we never see it.
//
// TWO APP SHAPES, both real and both common from v5:
//
//   • A BUILT app (Vite/React with a package.json and a build script) — its own build produces `dist`,
//     so we keep the project as-is and point Capacitor at `dist`.
//   • A STATIC app (index.html and friends, no package.json) — there is nothing to build, so the web
//     files are placed in `www/` and the build script is an honest no-op. This is the case the old
//     kit failed on completely.
//
// Pure and unit-tested: no network, no filesystem.

import { DEFAULT_CAPACITOR_MAJOR } from './capacitorToolchain';
// Re-exported so existing importers keep a stable surface; the canonical value lives in the governed
// toolchain table (capacitorToolchain.ts) — one source of truth, never a second copy that can drift.
export { DEFAULT_CAPACITOR_MAJOR } from './capacitorToolchain';
import { sanitizeReservedSegments } from './appId';
// The SAME data-uri parser the asset store writes with — a second local regex here would be a second
// definition of what a stored asset looks like, and the two would drift.
import { parseDataUri } from '../AgentV3/ProjectImport';
// ONE definition of "which asset imports will not resolve" — shared with the App Store's publish gate.
// See assetImports.ts for why the two callers treat the same fact differently (a note vs a refusal).
import { unshippableAssetImports } from './assetImports';

/** Ignore anything that cannot be part of a web build — these bloat the repo and break nothing by leaving. */
const SKIP_PATH = /(^|\/)(node_modules|\.git|dist|build|\.next|\.cache|coverage)(\/|$)/;

export interface AssembleOptions {
  appName: string;
  appId: string;
  /** The app's background colour (any `#rrggbb`); ignored unless it is a valid hex colour. */
  backgroundColor?: string;
  /** Data URL of the icon the user chose or uploaded. Optional — omitted means the default icon. */
  iconDataUrl?: string;
  /** Include the iOS workflow + fastlane lane. */
  ios?: boolean;
  /**
   * THE APP'S OWN BINARY ASSETS — its logo, photos, fonts, icons — as `path → data:<mime>;base64,…`,
   * exactly the shape `loadWorkspaceAssets()` returns.
   *
   * 🔒 WHY THIS PARAMETER HAD TO EXIST (found 2026-08-16, tracing the admin's blocked APK).
   * The ship path builds the repo from `loadWorkspaceFiles()`, which is TEXT ONLY by design — binary
   * assets live in their own durable store (`WorkspaceAssetStore`) precisely so they cannot leak into
   * the text map. But nothing on this path ever read that store, so `binaryFiles` carried the launcher
   * ICON and nothing else. An imported app's logo, photos and fonts were persisted correctly and then
   * simply left behind: the pushed repo had `import logo from './logo.png'` and no `logo.png`.
   *
   * On a BUILT app that is not a cosmetic flaw — Vite fails the build with "Could not resolve
   * ./logo.png", which is the class of failure the admin has been reporting from the APK screen. The
   * preflight fix that stopped calling an image "a missing library" was right, but it only corrected
   * the SENTENCE; this is the condition that produced the failure.
   *
   * Optional: omitted or empty behaves exactly as before.
   */
  appAssets?: Record<string, string>;
  /**
   * Was the asset store actually READ? Defaults to true so existing callers are unchanged.
   *
   * When false, nothing below may claim an asset is missing from the user's app: an empty asset map
   * then means "we could not look", not "there is nothing there". See the note this guards.
   */
  appAssetsComplete?: boolean;
}

export interface AssembledProject {
  /** Every file to push, path → text content. Binary assets are returned separately. */
  files: Record<string, string>;
  /** Files that must be written as raw bytes (the icon), path → base64. */
  binaryFiles: Record<string, string>;
  /** 'built' when the app has its own build step, 'static' when the files are served as-is. */
  kind: 'built' | 'static';
  /** What Capacitor will package — `dist` for a built app, `www` for a static one. */
  webDir: string;
  /** Things the user should know that are true but not failures. Never silently swallowed. */
  notes: string[];
}

// WHY A BLOCKLIST, NOT A WHITELIST (build-failure autopsy 2026-08-03):
//
// This used to be a whitelist of extensions — html/css/js/jsx/ts/tsx/json/md/txt/svg/xml/yml/env. Any
// file whose extension was not on it was SILENTLY DROPPED from the pushed repository. That is a whole
// class of mysterious build failures with no message pointing at the cause:
//   • a component importing `./styles.scss`  → the file is gone → "Cannot resolve" → the build dies
//   • `vite.config.mjs`, `postcss.config.cjs`, `tailwind.config.cjs` → gone → wrong or unstyled output
//   • `.npmrc`, `.nvmrc`, `.env.production`, `App.vue`, `route.graphql` → gone
// The user's app compiled perfectly inside NavBharatAI and then failed on the runner, because the code
// that ran there was not the code they wrote.
//
// A whitelist has to predict every extension an app might ever use, and it silently loses whatever it
// failed to predict. A blocklist only has to name what genuinely cannot survive as text — and when it is
// wrong, the file is INCLUDED, which is the safe direction. Every value here is already a string from the
// workspace store, so "is it text?" is really "is this a binary asset or build junk we should not push?".
const BINARY_OR_JUNK = /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|icns|woff2?|ttf|otf|eot|mp[34]|m4a|wav|ogg|webm|mov|avi|pdf|zip|gz|tgz|bz2|7z|rar|jar|aab|apk|ipa|so|dll|dylib|exe|bin|wasm|db|sqlite3?|psd|ai|sketch|fig|keystore|jks|p12|pem|key)$/i;
/** Lock files are deliberately not pushed — see the workflow's install step, which handles their absence. */
const NEVER_PUSH = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|\.DS_Store|Thumbs\.db)$/i;

function isTextPath(path: string): boolean {
  return !BINARY_OR_JUNK.test(path) && !NEVER_PUSH.test(path);
}

/** Does this project build itself? Only a real `build` script counts — the workflow runs exactly that. */
export function detectProjectKind(files: Record<string, string>): 'built' | 'static' {
  const pkg = files['package.json'];
  if (!pkg) return 'static';
  try {
    const parsed = JSON.parse(pkg) as { scripts?: Record<string, string> };
    return typeof parsed.scripts?.build === 'string' && parsed.scripts.build.trim() ? 'built' : 'static';
  } catch {
    // A package.json we cannot parse is worse than none — treating it as buildable would fail on the
    // runner with a confusing error. Static is the outcome that still produces a working app.
    return 'static';
  }
}

/** The dependencies + build script of a repo's package.json, parsed safely (empty on missing/corrupt). */
function packageInfo(files: Record<string, string>): { deps: Record<string, string>; build: string } {
  let pkg: Record<string, unknown> = {};
  try { pkg = JSON.parse(files['package.json'] || '{}') as Record<string, unknown>; } catch { /* defaults */ }
  const deps = {
    ...((pkg.dependencies as Record<string, string> | undefined) || {}),
    ...((pkg.devDependencies as Record<string, string> | undefined) || {}),
  };
  const build = String((pkg.scripts as Record<string, string> | undefined)?.build || '');
  return { deps, build };
}

/** True when a Next.js app is configured to emit a STATIC site (the only shape Capacitor can wrap). */
export function isNextStaticExport(files: Record<string, string>): boolean {
  const { build } = packageInfo(files);
  if (/next\s+export/.test(build)) return true; // the classic `next export` step
  const cfg = files['next.config.js'] || files['next.config.mjs'] || files['next.config.ts']
    || files['next.config.cjs'] || files['next.config.json'] || '';
  return /output\s*:\s*['"]export['"]/.test(cfg); // Next 13+/14 `output: 'export'`
}

/**
 * Where the built app ends up. Framework-aware and SHARED with the self-healing repair path (rule 3/4) so
 * the first ship already points Capacitor at the right folder instead of shipping a wrong `dist`, failing,
 * and self-healing it afterwards (rule 5 — prevent, don't heal): a real Create-React-App ships to `build`,
 * a Next static export to `out`, Vite to `dist` (or the config's own `outDir`, read from any config
 * extension). A Next app WITHOUT static export is server-rendered and produces no static folder — that
 * honest case is surfaced as a note in assembleMobileProject, not silently mis-detected here.
 */
export function detectWebDir(files: Record<string, string>, kind: 'built' | 'static'): string {
  if (kind === 'static') return 'www';
  // An explicit Vite outDir wins over every default, read from whichever config extension the app uses.
  const viteConfig = files['vite.config.ts'] || files['vite.config.js'] || files['vite.config.mjs']
    || files['vite.config.mts'] || files['vite.config.cjs'] || '';
  const outDir = viteConfig.match(/outDir\s*:\s*['"]([^'"]+)['"]/);
  if (outDir) return outDir[1].replace(/^\.\//, '').replace(/\/+$/, '');
  // Otherwise the framework decides the folder.
  const { deps, build } = packageInfo(files);
  /**
   * 🔒 THE FOUR THAT WERE SILENTLY WRONG (measured by really building all 24 scaffolds, 2026-08-24).
   *
   * Everything below used to fall through to `dist`, and for these four that folder is not where the
   * site is. Capacitor was therefore pointed at a path that does not exist, and the APK either failed
   * to assemble or shipped EMPTY — with nothing saying why, because a wrong guess looks exactly like
   * a right one until somebody opens the app on a phone.
   *
   * Angular is the nastiest of the four and is checked first: its `application` builder nests the
   * browser bundle one level BELOW `outputPath`, so `dist/` genuinely exists — full of server bundles
   * and stats, with no index.html anywhere in it. A folder that exists and is wrong beats a missing
   * one for wasting somebody's afternoon.
   *
   * Ordered before the Vite check on purpose: SvelteKit, Nuxt and Remix all build THROUGH Vite and
   * would otherwise be caught by `deps.vite` and told `dist`.
   */
  if (deps['@angular/core'] || /\bng build\b/.test(build)) {
    // Read the real outputPath when angular.json is present; `dist/app` is this scaffold's default.
    const ng = files['angular.json'] || '';
    const out = ng.match(/"outputPath"\s*:\s*"([^"]+)"/);
    const base = (out ? out[1] : 'dist/app').replace(/^\.\//, '').replace(/\/+$/, '');
    return base.endsWith('/browser') ? base : `${base}/browser`;
  }
  if (deps['@sveltejs/kit']) return 'build';                    // adapter-static writes here
  if (deps.nuxt || /\bnuxt (build|generate)\b/.test(build)) return '.output/public'; // nuxt generate
  if (deps['@remix-run/react'] || /remix vite:build/.test(build)) return 'build/client';
  if (deps.astro || /\bastro build\b/.test(build)) return 'dist';
  if (deps.next || /next build/.test(build)) return 'out';               // static export → out (SSR flagged elsewhere)
  if (deps['react-scripts'] || /react-scripts build/.test(build)) return 'build'; // Create React App
  if (deps.vite || /vite build/.test(build)) return 'dist';
  return 'dist';
}

/**
 * Make sure the package name is one Android will accept, changing it as little as possible.
 *
 * This id is the app's PERMANENT identity on the Play Store — it can never be changed once published,
 * and two ids that differ by a single letter are two different apps. So a valid id is returned exactly
 * as the user typed it, including capitals (Java package rules allow them). Only an id Android would
 * actually reject is replaced, and the caller reports that replacement rather than doing it silently.
 */
export function normaliseAppId(appId: string, appName: string): string {
  // The real rule: two or more segments, each starting with a letter, letters/digits/underscore after.
  const valid = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
  const candidate = (appId || '').trim();
  // A well-formed id can still carry a lowercase Java reserved word (com.new.shop), which Android's
  // package tooling rejects at `cap add`. Repair that segment in place rather than discard the id (G8) —
  // shared with appId.ts so both appId validators enforce the SAME reserved-word rule.
  if (valid.test(candidate)) return sanitizeReservedSegments(candidate);
  const slug = (appName || 'app').toLowerCase().replace(/[^a-z0-9]/g, '') || 'app';
  return sanitizeReservedSegments(`com.navbharat.${slug}`);
}

/**
 * The package.json the runner will use.
 *
 * For a project that already has one, the Capacitor dependencies and scripts are MERGED IN rather
 * than replacing what the user has — overwriting their dependencies would break their own build.
 * For a static app, a minimal one is created whose `build` script honestly does nothing, because
 * there is nothing to build; the workflow still calls it, so it has to exist and succeed.
 */
export function buildPackageJson(
  existing: string | undefined,
  appName: string,
  kind: 'built' | 'static',
): string {
  let pkg: Record<string, unknown> = {};
  if (existing) {
    try { pkg = JSON.parse(existing) as Record<string, unknown>; } catch { pkg = {}; }
  }

  const slug = (appName || 'app').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
  pkg.name = typeof pkg.name === 'string' && pkg.name ? pkg.name : slug;
  pkg.version = typeof pkg.version === 'string' && pkg.version ? pkg.version : '1.0.0';
  pkg.private = true;

  const scripts = { ...((pkg.scripts as Record<string, string>) || {}) };
  if (kind === 'static') {
    // An honest no-op: `npm run build` must succeed, and there is genuinely nothing to compile.
    scripts.build = 'echo "Static app — the web files in www/ are used as they are."';
  }
  pkg.scripts = scripts;

  const devDeps = { ...((pkg.devDependencies as Record<string, string>) || {}) };
  const deps = { ...((pkg.dependencies as Record<string, string>) || {}) };

  // CAPACITOR VERSIONS MUST AGREE (root cause of a real build failure, 2026-08-03).
  //
  // The three packages are one product split across three modules, and `cap add android` refuses to run
  // when the CLI, core and platform are on different majors. The old code filled each one in
  // independently with `existing || '^6.2.0'`, so an app that already declared `@capacitor/core: ^7`
  // got `@capacitor/android: ^6.2.0` bolted on beside it. `npx cap add android` then failed in about a
  // second — and because that failure was being swallowed by `|| echo`, the run marched on and died
  // three steps later at Gradle with "chmod: cannot access './gradlew'".
  //
  // So the major is decided ONCE, from whatever the app already declares, and applied to all three.
  const major = capacitorMajor({ ...deps, ...devDeps }) ?? DEFAULT_CAPACITOR_MAJOR;
  const range = `^${major}.0.0`;
  devDeps['@capacitor/cli'] = alignCapacitor(devDeps['@capacitor/cli'], major, range);
  deps['@capacitor/core'] = alignCapacitor(deps['@capacitor/core'], major, range);
  deps['@capacitor/android'] = alignCapacitor(deps['@capacitor/android'], major, range);

  pkg.devDependencies = devDeps;
  pkg.dependencies = deps;

  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/** First major version number in a semver range, or null when there is nothing readable in it. */
export function majorOfRange(range: string): number | null {
  const m = /(\d+)\s*\./.exec(String(range || ''));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The Capacitor major this app is already built around.
 *
 * `@capacitor/core` is the authority when present — a plugin can lag a major behind, but core is what
 * the app's own code is written against. Otherwise any declared `@capacitor/*` package answers it.
 */
export function capacitorMajor(all: Record<string, string>): number | null {
  const core = all['@capacitor/core'] && majorOfRange(all['@capacitor/core']);
  if (core) return core;
  for (const [name, range] of Object.entries(all)) {
    if (!name.startsWith('@capacitor/')) continue;
    const m = majorOfRange(range);
    if (m) return m;
  }
  return null;
}

/**
 * The Capacitor major an app repo is built around, read from its package.json — or null when the app
 * declares no Capacitor of its own (the caller then applies the governed DEFAULT). Threaded into the ship
 * kit so the Android workflow pins the Java THIS app's Capacitor actually needs (G2, 2026-08-11).
 */
export function capacitorMajorFromFiles(files: Record<string, string>): number | null {
  const raw = files['package.json'];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null; // an unparseable package.json is a separate failure; here we simply express no preference
  }
  const deps = (pkg.dependencies as Record<string, string>) || {};
  const devDeps = (pkg.devDependencies as Record<string, string>) || {};
  return capacitorMajor({ ...deps, ...devDeps });
}

/** Keep what the app already declared when it agrees with the chosen major; otherwise align it. */
function alignCapacitor(existing: string | undefined, major: number, range: string): string {
  return existing && majorOfRange(existing) === major ? existing : range;
}

/**
 * Normalise a user-supplied colour to a safe `#RRGGBB` literal, or null when it is not a colour.
 *
 * The value comes from the client and is interpolated into a generated TypeScript file, so it MUST be
 * validated to a fixed shape — never passed through — or a crafted string could inject code. Accepts
 * `#RGB`/`#RRGGBB` (with or without the hash) and returns the canonical lowercase `#rrggbb`.
 */
export function normaliseHexColor(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const m = input.trim().replace(/^#/, '').toLowerCase().match(/^([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return `#${hex}`;
}

/** The Capacitor config, pointing at whatever this app actually produces. */
export function buildCapacitorConfig(appId: string, appName: string, webDir: string, backgroundColor?: string): string {
  // Only a validated `#rrggbb` reaches the file; anything else is dropped so the config is byte-identical
  // to before (the colour is optional decoration, never a reason to emit a broken config).
  const color = normaliseHexColor(backgroundColor);
  const androidBlock = color
    ? `\n  // The app's background colour, chosen in NavBharatAI's App Information form.\n  android: { backgroundColor: '${color}' },\n  plugins: { SplashScreen: { backgroundColor: '${color}' } },`
    : '';
  return `import type { CapacitorConfig } from '@capacitor/cli';

// Generated by NavBharatAI for ${appName}.
const config: CapacitorConfig = {
  appId: '${appId}',
  appName: ${JSON.stringify(appName)},
  webDir: '${webDir}',${androidBlock}
};

export default config;
`;
}

/**
 * Assemble the whole repository.
 *
 * `shipKitFiles` are the workflows / fastlane / SHIPPING.md from generateShipKit — passed in rather
 * than imported so this stays a pure function over its inputs and the two can be tested separately.
 */
export function assembleMobileProject(
  appFiles: Record<string, string>,
  shipKitFiles: Record<string, string>,
  opts: AssembleOptions,
): AssembledProject {
  const notes: string[] = [];
  const appId = normaliseAppId(opts.appId, opts.appName);
  if (appId !== (opts.appId || '').trim().toLowerCase()) {
    notes.push(`The package name was adjusted to "${appId}" so Android accepts it (it must look like com.company.app).`);
  }

  const usable = Object.entries(appFiles).filter(([p, c]) => !SKIP_PATH.test(p) && typeof c === 'string');
  const kind = detectProjectKind(Object.fromEntries(usable));
  const webDir = detectWebDir(Object.fromEntries(usable), kind);

  const files: Record<string, string> = {};

  if (kind === 'static') {
    // Nothing here compiles, so the web files ARE the app: they go where Capacitor will look.
    let sawIndex = false;
    for (const [path, content] of usable) {
      if (path === 'package.json') continue; // replaced below
      if (!isTextPath(path)) continue;
      if (/(^|\/)index\.html?$/i.test(path)) sawIndex = true;
      files[`www/${path}`] = content;
    }
    if (!sawIndex) {
      notes.push('No index.html was found, so the app may open to a blank screen. Add one at the top level of your app.');
    }
  } else {
    for (const [path, content] of usable) {
      if (path === 'package.json') continue; // merged below
      if (!isTextPath(path)) continue;
      files[path] = content;
    }
    notes.push(`Your app builds itself with "npm run build", so the build output in "${webDir}/" is what gets packaged.`);
    // HONEST Next.js SSR case (rule 6): a plain `next build` produces a SERVER bundle (.next), not a static
    // site, so there is nothing for Capacitor to wrap. We say so plainly instead of shipping a build that
    // will fail with a confusing "out/index.html missing" three steps later.
    const nextFiles = Object.fromEntries(usable);
    const { deps: nDeps, build: nBuild } = ((): { deps: Record<string, string>; build: string } => {
      try {
        const p = JSON.parse(nextFiles['package.json'] || '{}') as Record<string, unknown>;
        return {
          deps: { ...((p.dependencies as Record<string, string>) || {}), ...((p.devDependencies as Record<string, string>) || {}) },
          build: String((p.scripts as Record<string, string> | undefined)?.build || ''),
        };
      } catch { return { deps: {}, build: '' }; }
    })();
    if ((nDeps.next || /next build/.test(nBuild)) && !isNextStaticExport(nextFiles)) {
      notes.push('This is a Next.js app without static export, so its build produces a server app, not a static site a mobile app can wrap. Add output: "export" to next.config (Next 13+/14) — then rebuild — so it produces the "out/" folder.');
    }
  }

  files['package.json'] = buildPackageJson(appFiles['package.json'], opts.appName, kind);
  files['capacitor.config.ts'] = buildCapacitorConfig(appId, opts.appName, webDir, opts.backgroundColor);
  files['.gitignore'] = 'node_modules/\ndist/\nandroid/\nios/\n.DS_Store\n*.keystore\n*.jks\n';

  // The workflows and the publishing guide, last so they always win over anything similarly named.
  for (const [path, content] of Object.entries(shipKitFiles)) {
    // The kit's own capacitor.config.ts does not know this app's webDir; ours does.
    if (path === 'capacitor.config.ts') continue;
    files[path] = content;
  }

  const binaryFiles: Record<string, string> = {};

  // THE APP'S OWN ASSETS FIRST (see AssembleOptions.appAssets). Written before the icon so the icon,
  // which is generated from the user's explicit choice on this screen, always wins a name collision.
  //
  // Placed at the SAME paths the app's code imports, and routed through the same static/built split the
  // text files use: a built app keeps its source layout (Vite resolves `./logo.png` relative to the
  // source file and hashes it into `dist/` itself), while a static app is served as-is, so its assets
  // go where its HTML already points — under the web dir, exactly like its text files.
  const skippedAssets: string[] = [];
  for (const [path, dataUri] of Object.entries(opts.appAssets || {})) {
    if (SKIP_PATH.test(path)) continue;
    const parsed = parseDataUri(dataUri);
    if (!parsed) { skippedAssets.push(path); continue; }
    binaryFiles[kind === 'static' ? `${webDir}/${path}` : path] = parsed.base64;
  }
  if (skippedAssets.length > 0) {
    // NEVER SILENT. A dropped asset means a missing image in the shipped app, and the user must hear it
    // from us rather than discover a blank logo — or a failed build — on the runner.
    notes.push(`${skippedAssets.length} file(s) could not be read and were not included: ${skippedAssets.slice(0, 3).join(', ')}${skippedAssets.length > 3 ? '…' : ''}. Any image or font among them will be missing from the app.`);
  }

  if (opts.iconDataUrl) {
    const parsed = parseImageDataUrl(opts.iconDataUrl);
    if (parsed) {
      // Capacitor's asset generator reads resources/icon.png; keeping the name it expects means the
      // icon is picked up without the user configuring anything.
      binaryFiles[`resources/icon.${parsed.ext}`] = parsed.base64;
      notes.push('Your icon was added as resources/icon.png — run "npx capacitor-assets generate" locally to produce every Android size, or Android will use the default icon.');
    } else {
      notes.push('The icon could not be read, so the default icon will be used.');
    }
  }

  // HONEST ABOUT WHAT STILL WILL NOT SHIP. With `files` and `binaryFiles` both final, this is a fact
  // rather than a guess — see unshippableAssetImports. A note, never a refusal.
  const unshippable = unshippableAssetImports(files, binaryFiles);
  if (unshippable.length > 0) {
    // 🔒 WHOSE FAULT IT IS DEPENDS ON WHETHER WE LOOKED (admin report 2026-08-22, mitrify). The asset
    // store used to answer an empty map for BOTH "this app has no images" and "Firestore did not
    // answer" — so a failed read pushed the app with no pictures and told the user to "add these to
    // your app and ship again". They had added them; we lost them, and then billed the mistake to
    // them. When the read did not complete, the honest sentence is that WE could not fetch them.
    const couldNotLook = opts.appAssetsComplete === false;
    const list = `${unshippable.slice(0, 3).join(', ')}${unshippable.length > 3 ? `, and ${unshippable.length - 3} more` : ''}`;
    notes.push(
      couldNotLook
        ? `${unshippable.length} image/font file(s) your app uses could not be fetched from your workspace just now, so they were not pushed: ${list}. This is on NavBharatAI's side, not your app — try shipping again in a moment.`
        : `${unshippable.length} image/font file(s) your code imports are not in the app and were not pushed: ${list}. `
          + (kind === 'built'
            ? 'A build that imports a file it cannot find will fail, so add these to your app and ship again.'
            : 'Those images will be blank in the app.'),
    );
  }

  return { files, binaryFiles, kind, webDir, notes };
}

/** Split a data: URL into its base64 payload and a file extension. Returns null for anything else. */
export function parseImageDataUrl(dataUrl: string): { base64: string; ext: string } | null {
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const base64 = m[2].replace(/\s+/g, '');
  if (!base64) return null;
  return { base64, ext };
}
