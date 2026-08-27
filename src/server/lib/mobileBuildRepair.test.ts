// Tests for the self-healing build loop.
//
// Two things are being locked here, and the second matters more than the first:
//   1. Each failure class is recognised and mechanically repaired.
//   2. A repair that would change NOTHING returns null — that is the only thing standing between "fix
//      it and try again" and an infinite loop of empty commits and identical failures.

import { describe, it, expect } from 'vitest';
import {
  classifyBuildFailure, extractAppBuildError, normalizeLog, repairFiles,
  repairAndroidPlatform, repairBuildScript, repairGradlewPermission, repairJavaVersion,
  repairNpmCache, repairNpmCi, repairOutOfMemory, repairSdkLicenses, repairWebDir,
  webDirForPackageJson, repairPeerConflict, failedStage,
} from './mobileBuildRepair';
import { generateShipKit } from './mobileShipKit';
import { SHIP_WORKFLOWS, workflowPath } from '../../lib/shipWorkflows';

const APK_PATH = workflowPath(SHIP_WORKFLOWS.androidApk);
const kitFiles = generateShipKit({ appName: 'Test App' }).files;
const APK_WORKFLOW = kitFiles[APK_PATH];
const AAB_WORKFLOW = kitFiles[workflowPath(SHIP_WORKFLOWS.androidAab)];

describe('reading a failed build log', () => {
  it('strips the timestamp GitHub prefixes every line with', () => {
    const raw = '2026-08-03T09:15:22.1234567Z ##[error]Dependencies lock file is not found';
    expect(normalizeLog(raw)).toBe('##[error]Dependencies lock file is not found');
  });

  it('names THE failure that actually happened to the admin: the npm cache with no lock file', () => {
    const log = [
      '2026-08-03T09:15:20.0000000Z ##[group]Run actions/setup-node@v4',
      '2026-08-03T09:15:22.0000000Z ##[error]Dependencies lock file is not found in /home/runner/work/my-app/my-app.',
      '2026-08-03T09:15:22.0000000Z ##[error]Process completed with exit code 1.',
    ].join('\n');
    const d = classifyBuildFailure(log, APK_PATH);
    expect(d.code).toBe('NPM_LOCK_CACHE');
    expect(d.autoFixable).toBe(true);
    expect(d.needs).toEqual([APK_PATH]);
  });

  it('a missing signing key is reported, never "fixed" — the key must stay the user\'s', () => {
    const d = classifyBuildFailure('##[error]Missing required secret: ANDROID_KEYSTORE_BASE64', APK_PATH);
    expect(d.code).toBe('MISSING_SIGNING_SECRET');
    expect(d.autoFixable).toBe(false);
    expect(d.detail?.secret).toBe('ANDROID_KEYSTORE_BASE64');
    expect(repairFiles(d, { [APK_PATH]: AAB_WORKFLOW }, APK_PATH)).toBeNull();
  });

  it.each([
    ['npm ci without a lock file', 'npm ERR! `npm ci` can only install packages when your package.json and package-lock.json are in sync', 'NPM_CI_NO_LOCK'],
    ['no build script', 'npm ERR! Missing script: "build"', 'BUILD_SCRIPT_MISSING'],
    ['wrong output folder', '[error] Could not find the web assets directory: ./dist', 'WEB_DIR_MISSING'],
    ['gradle wrapper not executable', '/home/runner/work/a/a/android/gradlew: Permission denied', 'GRADLEW_NOT_EXECUTABLE'],
    ['sdk terms', 'You have not accepted the license agreements of the following SDK components', 'SDK_LICENSE_NOT_ACCEPTED'],
    ['old java', 'Unsupported class file major version 61', 'JAVA_VERSION_TOO_OLD'],
    ['out of memory', 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory', 'NODE_OUT_OF_MEMORY'],
    ['wrong keystore password', 'Execution failed for task \':app:validateSigningRelease\'. > Keystore was tampered with, or password was incorrect', 'SIGNING_CREDENTIALS_WRONG'],
    ['cannot recover key', 'com.android.ide.common.signing.KeytoolException: Failed to read key app from store: Cannot recover key', 'SIGNING_CREDENTIALS_WRONG'],
    ['private registry auth', 'npm ERR! code E401\nnpm ERR! 401 Unauthorized - GET https://npm.mycompany.com/@acme%2fui', 'NPM_REGISTRY_AUTH'],
    ['needs login token', 'npm ERR! code ENEEDAUTH\nnpm ERR! need auth This command requires you to be logged in', 'NPM_REGISTRY_AUTH'],
    ['missing google-services', 'Execution failed for task \':app:processReleaseGoogleServices\'. > File google-services.json is missing. The Google Services Plugin cannot function without it.', 'GOOGLE_SERVICES_MISSING'],
  ])('recognises %s', (_name, log, code) => {
    expect(classifyBuildFailure(log, APK_PATH).code).toBe(code);
  });

  it('names infra failures honestly (not auto-fixable, actionable message, no vendor leak) — G6/G11/G12', () => {
    const cases = [
      'Keystore was tampered with, or password was incorrect',
      'npm ERR! code E403\nnpm ERR! 403 Forbidden - GET https://npm.private.io/@acme%2fkit',
      'File google-services.json is missing. The Google Services Plugin cannot function without it.',
    ];
    for (const log of cases) {
      const d = classifyBuildFailure(log, APK_PATH);
      expect(d.autoFixable).toBe(false);              // infra we cannot fix — never a fake "fixed"
      expect(d.summary.length).toBeGreaterThan(20);   // a real instruction, not a shrug
      // White-Label Law: a user-facing message never leaks an AI vendor/model name
      expect(d.summary).not.toMatch(/GLM|Kimi|Claude|Sonnet|Opus|Gemini|Grok|Anthropic|Moonshot/i);
      // and a rules repair never pretends to fix it
      expect(repairFiles(d, { [APK_PATH]: AAB_WORKFLOW }, APK_PATH)).toBeNull();
    }
  });

  it('keeps a MISSING key (absent) distinct from a WRONG key (present but bad password) — G11', () => {
    expect(classifyBuildFailure('##[error]Missing required secret: ANDROID_KEYSTORE_BASE64', APK_PATH).code).toBe('MISSING_SIGNING_SECRET');
    expect(classifyBuildFailure('> Keystore was tampered with, or password was incorrect', APK_PATH).code).toBe('SIGNING_CREDENTIALS_WRONG');
  });

  it('pulls the directory Capacitor actually wanted out of the log', () => {
    const d = classifyBuildFailure('[error] Could not find the web assets directory: ./build', APK_PATH);
    expect(d.detail?.expected).toBe('build');
  });

  it('does not claim to understand a failure it cannot name', () => {
    const d = classifyBuildFailure('##[error]Process completed with exit code 137.', APK_PATH);
    expect(d.code).toBe('UNKNOWN');
    expect(d.autoFixable).toBe(false);
  });

  // THE PIANO CASE (real run 2026-08-18, "Build Android APK (installable)" #3): the scaffold's build
  // script is "tsc && vite build"; the app carried type errors the preview never enforced, so the step
  // died in 3 seconds and the apk could never be built — for an app the user had SEEN working.
  describe('the type gate that blocked a working app from becoming an apk', () => {
    const TS_ONLY_LOG = [
      '##[group]Run npm run build',
      '> piano@0.0.0 build',
      '> tsc -p tsconfig.build.json && vite build',
      "src/components/Key.tsx(14,23): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
      '##[error]Process completed with exit code 2.',
      '##[endgroup]',
      'NBAI_FAILED_STAGE=webbuild',
    ].join('\n');

    it('names it, auto-fixable — the repair is refreshing our own workflow', () => {
      const d = classifyBuildFailure(TS_ONLY_LOG, APK_PATH);
      expect(d.code).toBe('TYPE_GATE_BLOCKED_PACKAGING');
      expect(d.autoFixable).toBe(true);
      // White-Label Law: the user-facing summary never leaks a vendor/model name.
      expect(d.summary).not.toMatch(/GLM|Kimi|Claude|Sonnet|Opus|Gemini|Grok|Anthropic|Moonshot/i);
    });

    it('stands aside when the BUNDLER also failed — that is a real app-code failure', () => {
      const log = `${TS_ONLY_LOG}\nerror during build:\nsrc/App.tsx (12:8): "useKeys" is not exported`;
      expect(classifyBuildFailure(log, APK_PATH).code).toBe('APP_CODE_BUILD_FAILED');
    });

    it('never claims a failure in a LATER stage, whatever the log happens to contain', () => {
      const log = 'error TS2345: whatever\nNBAI_FAILED_STAGE=android';
      expect(classifyBuildFailure(log, APK_PATH).code).not.toBe('TYPE_GATE_BLOCKED_PACKAGING');
    });

    it('repairs by pushing the CURRENT workflow (which carries the bundler fallback)', () => {
      const d = classifyBuildFailure(TS_ONLY_LOG, APK_PATH);
      const oldWorkflow = APK_WORKFLOW.replace(/ {6}- name: Build the web app[\s\S]*?exit "\$rc"/, '      - name: Build the web app\n        run: npm run build');
      const repair = repairFiles(d, { [APK_PATH]: oldWorkflow }, APK_PATH, { workflow: APK_WORKFLOW });
      expect(repair).not.toBeNull();
      expect(repair!.files[APK_PATH]).toContain('npx vite build');
    });

    it('returns null when the workflow is already current — the loop must stop, honestly', () => {
      const d = classifyBuildFailure(TS_ONLY_LOG, APK_PATH);
      expect(repairFiles(d, { [APK_PATH]: APK_WORKFLOW }, APK_PATH, { workflow: APK_WORKFLOW })).toBeNull();
    });
  });

  it('reports the app\'s own compile error precisely instead of "something went wrong"', () => {
    const log = [
      '> my-app@0.0.0 build',
      '> vite build',
      'error during build:',
      'src/App.tsx (12:8): "useTodos" is not exported by "src/hooks/useTodos.ts"',
    ].join('\n');
    const d = classifyBuildFailure(log, APK_PATH);
    expect(d.code).toBe('APP_CODE_BUILD_FAILED');
    expect(d.autoFixable).toBe(false);
    expect(d.detail?.error).toContain('useTodos');
  });

  it('bounds the extracted error so a runaway log cannot be echoed whole', () => {
    const huge = `error during build:\n${'x'.repeat(50000)}`;
    expect((extractAppBuildError(huge) || '').length).toBeLessThanOrEqual(400);
  });
});

describe('the repairs themselves', () => {
  it('removes the npm cache that has no lock file to read', () => {
    const broken = APK_WORKFLOW.replace("node-version: '22'", "node-version: '22'\n          cache: 'npm'");
    const fixed = repairNpmCache(broken);
    expect(fixed).not.toBeNull();
    // Assert on real DIRECTIVE lines, not on any mention of the words: the workflow's own comment
    // explains why the cache is absent, and a looser check would fail on that explanation.
    expect(fixed!.split('\n').some((l) => /^\s*cache:\s*'npm'\s*$/.test(l))).toBe(false);
    expect(fixed).toContain('npm run build');
  });

  it('falls back from a strict install to a plain one', () => {
    const fixed = repairNpmCi('      - run: npm ci\n');
    expect(fixed).toBe('      - run: npm ci || npm install\n');
  });

  it('creates the Android project before anything compiles it', () => {
    const fixed = repairAndroidPlatform('      - name: Sync\n        run: npx cap sync android\n');
    expect(fixed).toContain('npx cap add android');
    // The added line must come BEFORE the sync, or it fixes nothing.
    expect(fixed!.indexOf('cap add android')).toBeLessThan(fixed!.indexOf('cap sync android'));
  });

  it('lets the Android build tool run', () => {
    const fixed = repairGradlewPermission('        run: cd android && ./gradlew bundleRelease\n');
    expect(fixed).toContain('chmod +x ./gradlew && ./gradlew bundleRelease');
  });

  it('accepts the SDK terms before the first Gradle step', () => {
    const fixed = repairSdkLicenses(APK_WORKFLOW);
    expect(fixed).toContain('sdkmanager');
    // Compare LINE positions, not string offsets: the workflow explains assembleDebug in a comment
    // above the step that runs it, so an offset search finds the prose, not the command.
    const lines = fixed!.split('\n');
    expect(lines.findIndex((l) => l.includes('sdkmanager')))
      .toBeLessThan(lines.findIndex((l) => /\.\/gradlew/.test(l)));
  });

  it('bumps an older Java, and leaves a new enough one alone', () => {
    expect(repairJavaVersion("          java-version: '17'")).toContain("java-version: '21'");
    expect(repairJavaVersion("          java-version: '21'")).toBeNull();
    expect(repairJavaVersion("          java-version: '25'")).toBeNull();
  });

  it('gives the build more memory as a sibling of run:, not inside the shell command', () => {
    // The CURRENT kit bakes the heap in up front (the same 4g the Gradle step forces), so the repair on a
    // fresh workflow is correctly a no-op — the memory is already at the value the repair would set.
    expect(APK_WORKFLOW).toContain('NODE_OPTIONS: --max-old-space-size=4096');
    expect(repairOutOfMemory(APK_WORKFLOW)).toBeNull();
    // An OLD repository (pre-heap workflow) still gets the surgical insert, as a real step key.
    const old = '      - name: Build the web app\n        run: npm run build\n';
    const fixed = repairOutOfMemory(old);
    expect(fixed).toContain('NODE_OPTIONS: --max-old-space-size=4096');
    const lines = fixed!.split('\n');
    const runIdx = lines.findIndex((l) => l.trim() === 'run: npm run build');
    const envIdx = lines.findIndex((l) => l.trim() === 'env:');
    expect(envIdx).toBe(runIdx + 1);
    // Same indentation = same YAML level = a real step key. One space deeper and it would do nothing.
    expect(lines[envIdx].match(/^\s*/)![0]).toBe(lines[runIdx].match(/^\s*/)![0]);
  });

  it('knows where each toolchain writes its built app', () => {
    expect(webDirForPackageJson(JSON.stringify({ devDependencies: { vite: '^5' } }))).toBe('dist');
    expect(webDirForPackageJson(JSON.stringify({ dependencies: { 'react-scripts': '^5' } }))).toBe('build');
    expect(webDirForPackageJson(JSON.stringify({ dependencies: { next: '^14' } }))).toBe('out');
    expect(webDirForPackageJson('not json at all')).toBe('dist');
  });

  it('points the packager at the right folder', () => {
    const cfg = "const config: CapacitorConfig = {\n  webDir: 'dist',\n};";
    expect(repairWebDir(cfg, 'build')).toContain("webDir: 'build'");
    expect(repairWebDir(cfg, 'dist')).toBeNull();
  });

  it('adds a build script that matches the app\'s real bundler', () => {
    const vite = repairBuildScript(JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } }));
    expect(JSON.parse(vite!).scripts.build).toBe('vite build');
    const next = repairBuildScript(JSON.stringify({ dependencies: { next: '^14' } }));
    expect(JSON.parse(next!).scripts.build).toBe('next build');
    // An app with no bundler is genuinely ready as-is; inventing a build step would just fail.
    const plain = repairBuildScript(JSON.stringify({ name: 'x' }));
    expect(JSON.parse(plain!).scripts.build).toMatch(/echo/);
  });
});

describe('THE LOOP GUARD — a repair that changes nothing must report failure, never retry', () => {
  it('every repair returns null when the file is already correct', () => {
    expect(repairNpmCache(APK_WORKFLOW)).toBeNull();          // already has no cache line
    expect(repairNpmCi(APK_WORKFLOW)).toBeNull();             // already `npm ci || npm install`
    expect(repairAndroidPlatform(APK_WORKFLOW)).toBeNull();   // already runs `cap add android`
    expect(repairGradlewPermission(APK_WORKFLOW)).toBeNull(); // already chmods
    expect(repairBuildScript(JSON.stringify({ scripts: { build: 'vite build' } }))).toBeNull();
  });

  it('repairFiles returns null rather than an empty commit', () => {
    const diag = classifyBuildFailure('##[error]Dependencies lock file is not found', APK_PATH);
    expect(repairFiles(diag, { [APK_PATH]: APK_WORKFLOW }, APK_PATH)).toBeNull();
  });

  it('does not "fix" the web folder to the value it already failed on', () => {
    const diag = classifyBuildFailure('[error] Could not find the web assets directory: ./dist', APK_PATH);
    const current = {
      'capacitor.config.ts': "const config = { webDir: 'dist' };",
      'package.json': JSON.stringify({ devDependencies: { vite: '^5' } }),
    };
    expect(repairFiles(diag, current, APK_PATH)).toBeNull();
  });

  it('but DOES fix it when the app genuinely builds somewhere else', () => {
    const diag = classifyBuildFailure('[error] Could not find the web assets directory: ./dist', APK_PATH);
    const current = {
      'capacitor.config.ts': "const config = { webDir: 'dist' };",
      'package.json': JSON.stringify({ dependencies: { 'react-scripts': '^5' } }),
    };
    const repair = repairFiles(diag, current, APK_PATH);
    expect(repair?.files['capacitor.config.ts']).toContain("webDir: 'build'");
    expect(repair?.message).toContain('build');
  });
});

describe('what the user is told', () => {
  it('never leaks a vendor name, a model, a machine or a raw log line', () => {
    const logs = [
      '##[error]Dependencies lock file is not found',
      'npm ERR! Missing script: "build"',
      'Unsupported class file major version 61',
      '##[error]Missing required secret: ANDROID_KEYSTORE_BASE64',
      '##[error]Process completed with exit code 137.',
    ];
    for (const log of logs) {
      const s = classifyBuildFailure(log, APK_PATH).summary;
      expect(s).not.toMatch(/gradle|npm|node_modules|runner|ubuntu|GLM|Kimi|Claude|Sonnet|Opus|Gemini|Grok/i);
      expect(s).not.toContain('##[error]');
      expect(s.length).toBeGreaterThan(20);
    }
  });
});

describe('failures while installing the app’s libraries (the 36s death class)', () => {
  it('names a package that does not exist, and refuses to "fix" it', () => {
    const log = [
      'npm ERR! code E404',
      "npm ERR! 404 Not Found - GET https://registry.npmjs.org/react-super-charts - Not found",
      "npm ERR! 404  'react-super-charts@^2.0.0' is not in this registry.",
    ].join('\n');
    const d = classifyBuildFailure(log, APK_PATH);
    expect(d.code).toBe('NPM_PACKAGE_NOT_FOUND');
    // Deliberately unfixable here: dropping the package would leave the code importing it, failing one
    // step later with a worse message. The real cure is upstream, in what the builder generates.
    expect(d.autoFixable).toBe(false);
    expect(d.detail?.package).toBe('react-super-charts');
    expect(d.summary).toContain('react-super-charts');
  });

  it('recovers from a peer-dependency conflict, which npm has an exact fix for', () => {
    const log = 'npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree';
    const d = classifyBuildFailure(log, APK_PATH);
    expect(d.code).toBe('NPM_PEER_CONFLICT');
    expect(d.autoFixable).toBe(true);
    const old = '      - run: npm install\n';
    expect(repairPeerConflict(old)).toContain('--legacy-peer-deps');
    // Already carrying the fallback: nothing to change, so the loop must stop.
    expect(repairPeerConflict(APK_WORKFLOW)).toBeNull();
  });
});

describe('the workflow tells us which stage died, instead of us guessing', () => {
  it('reads the marker the generated workflow prints', () => {
    expect(failedStage('2026-08-03T09:00:00.0000000Z NBAI_FAILED_STAGE=install')).toBe('install');
    expect(failedStage('NBAI_FAILED_STAGE=webbuild')).toBe('webbuild');
    expect(failedStage('nothing useful here')).toBeNull();
  });

  it('an unnamed failure in OUR stage becomes a workflow refresh', () => {
    const d = classifyBuildFailure('##[error]Process completed with exit code 1.\nNBAI_FAILED_STAGE=install', APK_PATH);
    expect(d.code).toBe('STALE_WORKFLOW');
    expect(d.autoFixable).toBe(true);
    const repair = repairFiles(d, { [APK_PATH]: '# an old workflow' }, APK_PATH, { workflow: APK_WORKFLOW });
    expect(repair?.files[APK_PATH]).toBe(APK_WORKFLOW);
  });

  it('an unnamed failure in the USER\'S app code is never "fixed" by touching our files', () => {
    const d = classifyBuildFailure('##[error]Process completed with exit code 1.\nNBAI_FAILED_STAGE=webbuild', APK_PATH);
    expect(d.code).toBe('UNKNOWN');
    expect(d.autoFixable).toBe(false);
    expect(d.summary).toMatch(/did not compile/i);
  });

  it('THE LOOP GUARD on the refresh: an already-current workflow is not committed again', () => {
    const d = classifyBuildFailure('##[error]exit code 1\nNBAI_FAILED_STAGE=capacitor', APK_PATH);
    expect(repairFiles(d, { [APK_PATH]: APK_WORKFLOW }, APK_PATH, { workflow: APK_WORKFLOW })).toBeNull();
  });

  it('and with no fresh workflow supplied it simply cannot fix it — never an empty commit', () => {
    const d = classifyBuildFailure('##[error]exit code 1\nNBAI_FAILED_STAGE=android', APK_PATH);
    expect(repairFiles(d, { [APK_PATH]: '# old' }, APK_PATH)).toBeNull();
  });
});

describe('Android resource linking (the real @drawable/splash failure, autopsy 2026-08-10)', () => {
  // Real user APK build died at aapt2: "resource drawable/splash (aka …:drawable/splash) not found.
  // error: failed linking references." The broken file is in the GENERATED android/ project (gitignored,
  // absent from the repo), so the AI repair can't touch it — the deterministic workflow self-heal is the
  // only fix. The classifier must NAME this class (not sweep it into the generic android fallback) and the
  // repair must refresh our own workflow, which now writes a placeholder @drawable/splash before compiling.
  const LINK_LOG = [
    '##[group]Build the Android app',
    '> Task :app:processDebugResources FAILED',
    "error: resource drawable/splash (aka com.shivmedical.app:drawable/splash) not found.",
    'error: failed linking references.',
    'Android resource linking failed',
    '##[error]Process completed with exit code 1.',
  ].join('\n');

  it('names the failure as ANDROID_RESOURCE_LINKING, not a vague android stall', () => {
    const d = classifyBuildFailure(LINK_LOG, APK_PATH);
    expect(d.code).toBe('ANDROID_RESOURCE_LINKING');
    expect(d.autoFixable).toBe(true);
    // White-Label Law: the user-facing summary names no vendor and no raw aapt line.
    expect(d.summary).not.toMatch(/aapt|drawable|gradle|splash/i);
  });

  it('repairs by refreshing our own workflow (which now self-heals the missing splash)', () => {
    const d = classifyBuildFailure(LINK_LOG, APK_PATH);
    const res = repairFiles(d, { [APK_PATH]: '# stale workflow' }, APK_PATH, { workflow: APK_WORKFLOW });
    expect(res).not.toBeNull();
    expect(res!.files[APK_PATH]).toBe(APK_WORKFLOW);
    // and the refreshed workflow genuinely carries the splash self-heal.
    expect(res!.files[APK_PATH]).toContain('android/app/src/main/res/drawable/splash.xml');
  });

  it('with an already-current workflow there is nothing to change — no empty commit, no loop', () => {
    const d = classifyBuildFailure(LINK_LOG, APK_PATH);
    expect(repairFiles(d, { [APK_PATH]: APK_WORKFLOW }, APK_PATH, { workflow: APK_WORKFLOW })).toBeNull();
  });
});

/**
 * THE REAL RUN (admin report 2026-08-22, mitrify — GitHub run 32569998304).
 *
 * The app compiled. GitHub's own job summary said so in as many words: "Your app compiled correctly.
 * It stopped while creating the Android project around it." NavBharatAI's screen, reading the same
 * run, told the user "Your app itself did not compile, so it could not be packaged. NavBharatAI could
 * not fix this one on its own."
 *
 * Two of our own surfaces contradicting each other, and the one the user reads was the wrong one — plus
 * it closed the only door they had. Two causes, both ours:
 *   1. the workflow stamped NBAI_FAILED_STAGE=webbuild from inside the CAPACITOR step, so the marker
 *      this module treats as ground truth named a stage that had already succeeded; and
 *   2. our own early guard prints a friendlier message than Capacitor's, which stopped Capacitor's
 *      wording from ever appearing — making the correct, already-written WEB_DIR_MISSING rule
 *      unreachable and dropping the log into UNKNOWN.
 */
describe('the mitrify run: app compiled, wrapper looked in the wrong folder', () => {
  const REAL_LOG = [
    'Build the web app',
    'vite v5.4.10 building for production...',
    '✓ built in 6.42s',
    'Generate and sync the Android project',
    'NBAI_FAILED_STAGE=webbuild',
    'Error: Your app built, but dist/index.html was not produced — there is no page to put inside the '
      + 'Android app. Make sure your web build outputs to the folder named as webDir (dist) in capacitor.config.',
    'Error: Process completed with exit code 1.',
  ].join('\n');

  it('never again tells the user their working app did not compile', () => {
    const r = classifyBuildFailure(REAL_LOG);
    expect(r.summary).not.toMatch(/did not compile/i);
    expect(r.code).not.toBe('UNKNOWN');
  });

  it('names it as what it is, and as something NavBharatAI can fix', () => {
    const r = classifyBuildFailure(REAL_LOG);
    expect(r.code).toBe('WEB_DIR_MISSING');
    expect(r.autoFixable).toBe(true);
    expect(r.needs).toContain('capacitor.config.ts');
  });

  it('survives a STALE stage marker — the wording decides, not the marker that lied', () => {
    // Repositories already carrying the old workflow still print webbuild here. The classification
    // must not depend on the very field that was wrong.
    expect(classifyBuildFailure(REAL_LOG).code).toBe('WEB_DIR_MISSING');
    expect(classifyBuildFailure(REAL_LOG.replace('=webbuild', '=capacitor')).code).toBe('WEB_DIR_MISSING');
  });

  it('matches the CURRENT workflow’s wording too, not only the old message', () => {
    const current = 'NBAI_FAILED_STAGE=capacitor\nError: Your app compiled, but it produced no web page '
      + 'to wrap: no index.html was found in "dist" or in any of the usual build folders.';
    const r = classifyBuildFailure(current);
    expect(r.code).toBe('WEB_DIR_MISSING');
    expect(r.summary).not.toMatch(/did not compile/i);
  });

  it('a genuinely broken app is STILL reported as a broken app', () => {
    // The fix must not turn every failure into "wrong folder" — that would be the opposite lie.
    const broken = 'NBAI_FAILED_STAGE=webbuild\nerror during build:\nRollupError: Could not resolve "./Missing" from "src/App.tsx"';
    const r = classifyBuildFailure(broken);
    expect(r.code).toBe('APP_CODE_BUILD_FAILED');
    expect(r.autoFixable).toBe(false);
  });
});

// ── NPM_VERSION_NOT_FOUND — the invented-version failure (2026-08-27 pipeline hardening) ──
//
// The classic generated-package.json death: the builder writes `"lib": "^9.9.9"` for a package whose
// real latest is 2.x. npm says ETARGET / "No matching version found" — a DIFFERENT failure from E404
// (name does not exist), and the only npm-resolution class with a repair that is always right.
import { classifyBuildFailure as classifyV, packageFromNpmNoMatchingVersion, repairDependencyVersion, repairFiles as repairV } from './mobileBuildRepair';

describe('NPM_VERSION_NOT_FOUND', () => {
  const LOG = [
    'npm error code ETARGET',
    'npm error notarget No matching version found for framer-motion@^12.99.0.',
    "npm error notarget In most cases you or one of your dependencies are requesting",
    "npm error notarget a package version that doesn't exist.",
  ].join('\n');

  it('is classified, with the package and range extracted', () => {
    const diag = classifyV(LOG, '.github/workflows/android-apk.yml');
    expect(diag.code).toBe('NPM_VERSION_NOT_FOUND');
    expect(diag.autoFixable).toBe(true);
    expect(diag.detail?.package).toBe('framer-motion');
    expect(diag.detail?.version).toBe('^12.99.0');
  });

  it('the older npm ERR! log format classifies too', () => {
    const old = 'npm ERR! code ETARGET\nnpm ERR! notarget No matching version found for react-scripts@^6.0.0.';
    expect(classifyV(old, 'wf.yml').code).toBe('NPM_VERSION_NOT_FOUND');
  });

  it('a scoped package splits on the LAST @, keeping its scope', () => {
    const hit = packageFromNpmNoMatchingVersion('No matching version found for @tanstack/react-query@^99.0.0.');
    expect(hit).toEqual({ pkg: '@tanstack/react-query', range: '^99.0.0' });
  });

  it('does NOT swallow an E404 — a missing NAME is a different failure with a different answer', () => {
    const e404 = 'npm ERR! code E404\nnpm ERR! 404 Not Found - GET https://registry.npmjs.org/react-quantum - Not found';
    expect(classifyV(e404, 'wf.yml').code).toBe('NPM_PACKAGE_NOT_FOUND');
  });

  it('repairs an allowlisted package to its CURATED pin — version policy stays in one table', () => {
    const pkgJson = JSON.stringify({ dependencies: { 'framer-motion': '^12.99.0' } });
    const next = repairDependencyVersion(pkgJson, 'framer-motion');
    expect(next).not.toBeNull();
    expect(JSON.parse(next as string).dependencies['framer-motion']).toBe('^11');
  });

  it('repairs an unknown-but-real package to the latest dist-tag, which always resolves', () => {
    const pkgJson = JSON.stringify({ dependencies: { 'some-real-lib': '^99.0.0' } });
    const next = repairDependencyVersion(pkgJson, 'some-real-lib');
    expect(JSON.parse(next as string).dependencies['some-real-lib']).toBe('latest');
  });

  it('a package not declared anywhere yields null — the honest v5 hand-off, never an invented entry', () => {
    expect(repairDependencyVersion(JSON.stringify({ dependencies: {} }), 'ghost-lib')).toBeNull();
    expect(repairDependencyVersion('{ not json', 'x')).toBeNull();
  });

  it('repairFiles routes the diagnosis to package.json end to end', () => {
    const diag = classifyV(LOG, '.github/workflows/android-apk.yml');
    const result = repairV(diag, { 'package.json': JSON.stringify({ dependencies: { 'framer-motion': '^12.99.0' } }) }, '.github/workflows/android-apk.yml');
    expect(result).not.toBeNull();
    expect(JSON.parse(result!.files['package.json']).dependencies['framer-motion']).toBe('^11');
  });
});
