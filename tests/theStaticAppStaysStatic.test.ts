import { describe, it, expect } from 'vitest';
import {
  assembleMobileProject, buildPackageJson, detectProjectKind, detectWebDir,
  missingWebPageRefusal, STATIC_NO_OP_BUILD,
} from '../src/server/lib/mobileProjectAssembler';
import { failedStage, repairWebDir, webDirForPackageJson } from '../src/server/lib/mobileBuildRepair';
import { generateShipKit } from '../src/server/lib/mobileShipKit';
import { SHIP_WORKFLOWS, workflowPath } from '../src/lib/shipWorkflows';

/**
 * AUTOPSY 2026-09-22 — a real APK build report the admin forwarded.
 *
 * User app `nagpurcity16-gif/bharat-alpha`, workflow `android-apk.yml`, **dead in 24 seconds**: machine
 * ready DONE, libraries DONE, "Building your app" DONE, "Preparing the Android project" FAILED with
 *   "Your app compiled, but it produced no web page to wrap: no index.html was found in "$WEBDIR" or in
 *    any of the usual build folders."
 * Three green steps and no app, and the report told the user their build could fix itself.
 *
 * THE ROOT CAUSE, measured on the real functions rather than reasoned about: `buildPackageJson` writes an
 * honest no-op `build` script into every STATIC app so that `npm run build` succeeds — and
 * `detectProjectKind` decided "is this app built?" by asking whether a build script exists. So a static
 * app was static exactly ONCE, at assembly. Every later read of the shipped repository answered `built`,
 * and every answer downstream flipped with it: `detectWebDir(repo, 'built')` finds no framework in a
 * capacitor-only package.json and returns `dist`, so the self-repair rewrote a CORRECT `webDir: 'www'`
 * into a folder a static app never produces. The advice "press Build again — it repairs itself" then made
 * the failure permanent.
 *
 * A classifier whose input is manufactured by the thing it classifies must recognise its own hand. These
 * cases are that lock, plus the three siblings found in the same autopsy.
 */
describe('a static app stays static — the assembler must not fool its own detector', () => {
  const opts = { appName: 'Bharat Alpha', appId: 'com.bharat.alpha' };

  it('🔴 the package.json WE write for a static app reads back as static', () => {
    const pkg = buildPackageJson(undefined, 'Bharat Alpha', 'static');
    // The sentinel really is in there, spelled by the constant rather than by hand.
    expect(JSON.parse(pkg).scripts.build).toBe(STATIC_NO_OP_BUILD);
    // …and the detector recognises it. Before this fix the answer was 'built'.
    expect(detectProjectKind({ 'package.json': pkg })).toBe('static');
  });

  it('🔴 the WHOLE assembled repository still reads as static, and its webDir is still www', () => {
    const shipped = assembleMobileProject({ 'index.html': '<html><body>hi</body></html>', 'style.css': 'b{}' }, {}, opts);
    expect(shipped.kind).toBe('static');
    expect(shipped.webDir).toBe('www');
    expect(shipped.files['www/index.html']).toBeTruthy();
    // The repository as GitHub now holds it — this is exactly what the repair path reads back.
    expect(detectProjectKind(shipped.files)).toBe('static');
    expect(detectWebDir(shipped.files, detectProjectKind(shipped.files))).toBe('www');
  });

  it('🔴 the self-repair no longer rewrites a CORRECT www into a dist that never exists', () => {
    const shipped = assembleMobileProject({ 'index.html': '<html>hi</html>' }, {}, opts);
    const config = shipped.files['capacitor.config.ts'];
    expect(config).toContain("webDir: 'www'");
    // What the WEB_DIR_MISSING repair now computes for this repository…
    const want = detectWebDir(shipped.files, detectProjectKind(shipped.files));
    expect(want).toBe('www');
    // …and therefore it changes nothing. `repairWebDir` returns null when the config is already right,
    // which is what stops a failed build from being made permanently unbuildable.
    expect(repairWebDir(config, want)).toBeNull();
    // The package.json-only entry point answers the same way — it carried the same hardcoded 'built'.
    expect(webDirForPackageJson(shipped.files['package.json'])).toBe('www');
  });

  it('a genuinely BUILT app is untouched by all of the above', () => {
    const vite = {
      'package.json': JSON.stringify({ name: 'shop', scripts: { build: 'tsc && vite build' }, dependencies: { vite: '^5.0.0' } }),
      'index.html': '<html><script type="module" src="/src/main.tsx"></script></html>',
      'src/main.tsx': 'export {}',
    };
    const shipped = assembleMobileProject(vite, {}, opts);
    expect(shipped.kind).toBe('built');
    expect(shipped.webDir).toBe('dist');
    expect(detectProjectKind(shipped.files)).toBe('built');
    // Its source files keep their own layout — nothing moved under www/.
    expect(shipped.files['src/main.tsx']).toBeTruthy();
    expect(shipped.files['www/index.html']).toBeUndefined();
  });
});

/**
 * THE SECOND HALF OF THE SAME REPORT: the page was not where Capacitor opens one, and the warning that
 * would have said so was suppressed by the very file that caused it.
 */
describe('the page has to be at the TOP of the web folder, and we say so before spending a build', () => {
  const opts = { appName: 'Bharat Alpha', appId: 'com.bharat.alpha' };

  it('🔴 a NESTED index.html is not a page: it is reported, and it is refused', () => {
    const nested = assembleMobileProject({ 'public/index.html': '<html>hi</html>', 'app.js': 'x' }, {}, opts);
    // The file is carried, but it is NOT where Capacitor looks…
    expect(nested.files['www/public/index.html']).toBeTruthy();
    expect(nested.files['www/index.html']).toBeUndefined();
    // …the note now fires (it used to be silent, because the old check accepted any nested index)…
    expect(nested.notes.join(' ')).toContain('public/index.html');
    // …and the ship is refused with the file named, before a repository is created.
    const refusal = missingWebPageRefusal(nested);
    expect(refusal).toContain('public/index.html');
    expect(refusal).toContain('top level');
  });

  it('no index.html at all is refused too, in the user\'s own words', () => {
    const none = assembleMobileProject({ 'app.js': 'x' }, {}, opts);
    expect(missingWebPageRefusal(none)).toContain('no index.html');
  });

  it('a static app WITH its page at the top is never refused', () => {
    const ok = assembleMobileProject({ 'index.html': '<html>hi</html>', 'app.js': 'x' }, {}, opts);
    expect(ok.notes.join(' ')).not.toContain('index.html');
    expect(missingWebPageRefusal(ok)).toBeNull();
  });

  it('🔒 a BUILT app is NEVER refused here — its page is made on the runner, and guessing is not ours to do', () => {
    // No index.html anywhere in the source: for a Vite app that is unusual but not knowably fatal, and
    // the workflow's own guard reports the real outcome honestly. A gate that blocked this would refuse
    // working apps on a hunch, which is the failure mode signingReadiness exists to avoid.
    const built = assembleMobileProject({
      'package.json': JSON.stringify({ name: 'x', scripts: { build: 'vite build' }, dependencies: { vite: '^5.0.0' } }),
      'src/main.tsx': 'export {}',
    }, {}, opts);
    expect(built.kind).toBe('built');
    expect(missingWebPageRefusal(built)).toBeNull();
  });
});

/**
 * THE DRIFT LOCK. `detectWebDir` (TypeScript, in the assembler) names the folder a framework builds into;
 * the generated workflow's G17b fallback (shell, in the ship kit) searches for the page when the config
 * turns out to be wrong. They are two expressions of one fact in two languages, and they HAD drifted:
 * Remix's `build/client` and Angular's nested `<outputPath>/browser` were real answers from the first and
 * were searched by neither. This asserts they agree, so a framework added to one fails CI until the other
 * knows about it.
 */
describe('the workflow searches every folder the detector can name', () => {
  const searchList = (): string[] => {
    const kit = generateShipKit({ appName: 'Drift', ios: false });
    const apk = kit.files[workflowPath(SHIP_WORKFLOWS.androidApk)];
    expect(apk, 'the APK workflow must exist').toBeTruthy();
    const m = apk.match(/for d in ([^;]+); do/);
    expect(m, 'the G17b fallback loop must still be in the generated workflow').toBeTruthy();
    return (m as RegExpMatchArray)[1].trim().split(/\s+/);
  };

  /** Does the shell list cover this directory? `*` matches one path segment, as a glob really does. */
  const covers = (list: readonly string[], dir: string): boolean =>
    list.some((entry) => new RegExp(`^${entry.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+')}$`).test(dir));

  const FRAMEWORKS: Array<{ name: string; files: Record<string, string> }> = [
    { name: 'Vite', files: { 'package.json': JSON.stringify({ dependencies: { vite: '^5' }, scripts: { build: 'vite build' } }) } },
    { name: 'Create React App', files: { 'package.json': JSON.stringify({ dependencies: { 'react-scripts': '^5' }, scripts: { build: 'react-scripts build' } }) } },
    { name: 'Next (static export)', files: { 'package.json': JSON.stringify({ dependencies: { next: '^14' }, scripts: { build: 'next build' } }) } },
    { name: 'SvelteKit', files: { 'package.json': JSON.stringify({ devDependencies: { '@sveltejs/kit': '^2' }, scripts: { build: 'vite build' } }) } },
    { name: 'Nuxt', files: { 'package.json': JSON.stringify({ dependencies: { nuxt: '^3' }, scripts: { build: 'nuxt generate' } }) } },
    { name: 'Remix', files: { 'package.json': JSON.stringify({ dependencies: { '@remix-run/react': '^2' }, scripts: { build: 'remix vite:build' } }) } },
    { name: 'Astro', files: { 'package.json': JSON.stringify({ dependencies: { astro: '^4' }, scripts: { build: 'astro build' } }) } },
    { name: 'Angular', files: { 'package.json': JSON.stringify({ dependencies: { '@angular/core': '^18' }, scripts: { build: 'ng build' } }) } },
  ];

  it('🔴 every framework default the detector returns is a folder the workflow really looks in', () => {
    const list = searchList();
    for (const fw of FRAMEWORKS) {
      const dir = detectWebDir(fw.files, 'built');
      expect(covers(list, dir), `${fw.name} builds to "${dir}" and the workflow's fallback does not search it`).toBe(true);
    }
    // …and the static app's own folder, which is the one this autopsy was about.
    expect(covers(list, 'www')).toBe(true);
  });

  it('🔴 EVERY lane that runs cap sync carries the page guard — the iOS lane had none', () => {
    const kit = generateShipKit({ appName: 'Drift', ios: true });
    // The guard's own error sentence, which is also what `diagnose()` keys on. A lane without it dies
    // inside Capacitor with a raw path error instead, which is what the iOS lane used to do.
    const GUARD = 'no web page to wrap';
    const lanes = Object.entries(kit.files).filter(([path, body]) => path.startsWith('.github/workflows/') && /npx cap sync/.test(body));
    expect(lanes.length, 'there must be lanes that run cap sync').toBeGreaterThanOrEqual(2);
    for (const [path, body] of lanes) {
      expect(body, `${path} runs cap sync without the web-page guard`).toContain(GUARD);
    }
  });

  it('🔴 every lane also EXPLAINS a failure, and names its own platform while doing it', () => {
    const kit = generateShipKit({ appName: 'Drift', ios: true });
    const lanes = Object.entries(kit.files).filter(([path]) => path.startsWith('.github/workflows/'));
    for (const [path, body] of lanes) {
      expect(body, `${path} has no failure diagnostic, so a failure reaches the user with no stage`).toContain('NBAI_FAILED_STAGE=$STAGE');
    }
    const ios = kit.files[workflowPath(SHIP_WORKFLOWS.iosIpa)];
    // Bolting the Android version onto iOS would have been worse than nothing: it tests for an `android`
    // directory that an iOS build never has, so every iOS failure would have been labelled `capacitor`.
    expect(ios).toContain('elif [ ! -d ios ]; then');
    expect(ios).toContain('STAGE=ios');
    expect(ios).not.toContain('elif [ ! -d android ]; then');
    // …and the classifier knows that stage, or an honest marker would still read as "no marker at all".
    expect(failedStage('NBAI_FAILED_STAGE=ios')).toBe('ios');
  });

  it('🔴 the STAGE is what a step EMITTED, never the script GitHub printed (the admin\'s own log shows both)', () => {
    // GitHub prints each step's whole `run:` block before running it, colour codes and all — so the
    // ensure step's two literal `echo "NBAI_FAILED_STAGE=capacitor"` lines are in EVERY log, executed
    // or not. Reading the first match read the script: an Android build that died at Gradle would have
    // been reported as stopping at `capacitor`, and repaired for a stage that never happened.
    const realLog = [
      '\u001b[36;1m  echo "NBAI_FAILED_STAGE=capacitor"\u001b[0m',
      '\u001b[36;1mfi\u001b[0m',
      'NBAI_FAILED_STAGE=android',
    ].join('\n');
    expect(failedStage(realLog)).toBe('android');
    // A log carrying ONLY the printed script names no stage at all — better than naming a wrong one.
    expect(failedStage('  echo "NBAI_FAILED_STAGE=capacitor"')).toBeNull();
    // …and a genuinely emitted marker is still read, wherever it sits.
    expect(failedStage('2026-09-22T09:15:09.0000000Z NBAI_FAILED_STAGE=capacitor')).toBe('capacitor');
  });

  it('🔒 the two folders the drift had lost are named explicitly, so removing one fails here', () => {
    const list = searchList();
    expect(list).toContain('build/client');       // Remix
    expect(list).toContain('dist/*/browser');     // Angular's application builder
    // And "public" stays OUT: in Create React App it is the SOURCE template, and packaging it would
    // ship a broken shell as a success — the one thing worse than this autopsy's honest failure.
    expect(list).not.toContain('public');
  });
});
