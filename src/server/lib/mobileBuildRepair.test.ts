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
  ])('recognises %s', (_name, log, code) => {
    expect(classifyBuildFailure(log, APK_PATH).code).toBe(code);
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
    const fixed = repairOutOfMemory(APK_WORKFLOW);
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
    const repair = repairFiles(d, { [APK_PATH]: '# an old workflow' }, APK_PATH, APK_WORKFLOW);
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
    expect(repairFiles(d, { [APK_PATH]: APK_WORKFLOW }, APK_PATH, APK_WORKFLOW)).toBeNull();
  });

  it('and with no fresh workflow supplied it simply cannot fix it — never an empty commit', () => {
    const d = classifyBuildFailure('##[error]exit code 1\nNBAI_FAILED_STAGE=android', APK_PATH);
    expect(repairFiles(d, { [APK_PATH]: '# old' }, APK_PATH)).toBeNull();
  });
});
