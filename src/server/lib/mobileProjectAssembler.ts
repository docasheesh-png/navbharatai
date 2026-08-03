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

/** Ignore anything that cannot be part of a web build — these bloat the repo and break nothing by leaving. */
const SKIP_PATH = /(^|\/)(node_modules|\.git|dist|build|\.next|\.cache|coverage)(\/|$)/;

export interface AssembleOptions {
  appName: string;
  appId: string;
  /** Data URL of the icon the user chose or uploaded. Optional — omitted means the default icon. */
  iconDataUrl?: string;
  /** Include the iOS workflow + fastlane lane. */
  ios?: boolean;
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

/** Where the built app ends up, read from the project's own Vite config when it says something unusual. */
export function detectWebDir(files: Record<string, string>, kind: 'built' | 'static'): string {
  if (kind === 'static') return 'www';
  const viteConfig = files['vite.config.ts'] || files['vite.config.js'] || '';
  const outDir = viteConfig.match(/outDir\s*:\s*['"]([^'"]+)['"]/);
  if (outDir) return outDir[1].replace(/^\.\//, '');
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
  if (valid.test(candidate)) return candidate;
  const slug = (appName || 'app').toLowerCase().replace(/[^a-z0-9]/g, '') || 'app';
  return `com.navbharat.${slug}`;
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
  devDeps['@capacitor/cli'] = devDeps['@capacitor/cli'] || '^6.2.0';
  pkg.devDependencies = devDeps;

  const deps = { ...((pkg.dependencies as Record<string, string>) || {}) };
  deps['@capacitor/core'] = deps['@capacitor/core'] || '^6.2.0';
  deps['@capacitor/android'] = deps['@capacitor/android'] || '^6.2.0';
  pkg.dependencies = deps;

  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/** The Capacitor config, pointing at whatever this app actually produces. */
export function buildCapacitorConfig(appId: string, appName: string, webDir: string): string {
  return `import type { CapacitorConfig } from '@capacitor/cli';

// Generated by NavBharatAI for ${appName}.
const config: CapacitorConfig = {
  appId: '${appId}',
  appName: ${JSON.stringify(appName)},
  webDir: '${webDir}',
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
  }

  files['package.json'] = buildPackageJson(appFiles['package.json'], opts.appName, kind);
  files['capacitor.config.ts'] = buildCapacitorConfig(appId, opts.appName, webDir);
  files['.gitignore'] = 'node_modules/\ndist/\nandroid/\nios/\n.DS_Store\n*.keystore\n*.jks\n';

  // The workflows and the publishing guide, last so they always win over anything similarly named.
  for (const [path, content] of Object.entries(shipKitFiles)) {
    // The kit's own capacitor.config.ts does not know this app's webDir; ours does.
    if (path === 'capacitor.config.ts') continue;
    files[path] = content;
  }

  const binaryFiles: Record<string, string> = {};
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
