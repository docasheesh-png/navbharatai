// THE REAL BUILD THAT FAILED — encoded exactly as it happened (admin report, 2026-08-03).
//
// A generated .apk workflow failed on GitHub in 32 seconds. The step list told the whole story:
//
//   ✓ Install dependencies                  19s
//   ✓ Build the web app                      5s
//   ✓ Generate and sync the Android project  1s   ← creating an Android project takes ~20s
//   ✗ Build the installable APK              0s
//       chmod: cannot access './gradlew': No such file or directory
//
// `npx cap add android` failed, `|| echo "already present — continuing"` swallowed it, and the run
// carried on. Gradle then died against a directory that did not exist, reporting an error THREE STEPS
// away from its cause and pointing at file permissions — a problem that did not exist.
//
// Worse, NavBharatAI's own panel told the user the wrong thing: "The build used a strict install that
// needs a lock file this app does not have." The install had taken 19 seconds and gone GREEN. The
// classifier had been matching the whole job log, so it read the `npm ci` complaint that a healthy
// `npm ci || npm install` leaves behind on every successful run.
//
// Both failures are locked here against the real log text.

import { describe, it, expect } from 'vitest';
import { classifyBuildFailure, failedStepSection, repairFiles } from './mobileBuildRepair';
import { generateShipKit } from './mobileShipKit';
import { buildPackageJson, capacitorMajor, majorOfRange } from './mobileProjectAssembler';
import { SHIP_WORKFLOWS, workflowPath } from '../../lib/shipWorkflows';
import { load } from 'js-yaml';

const APK_PATH = workflowPath(SHIP_WORKFLOWS.androidApk);
const APK_WORKFLOW = generateShipKit({ appName: 'Test App' }).files[APK_PATH];

/** The real job log, in GitHub's own shape: every step, groups, and the error in the last one. */
const REAL_LOG = [
  "##[group]Run actions/setup-node@v4",
  "Found in cache @ /opt/hostedtoolcache/node/22.11.0/x64",
  "##[endgroup]",
  "##[group]Run npm ci || npm install",
  "npm error `npm ci` can only install packages when your package.json and package-lock.json are in sync.",
  "npm error Missing: react@19.0.0 from lock file",
  "added 214 packages in 19s",
  "##[endgroup]",
  "##[group]Run npm run build",
  "vite v5.4.10 building for production...",
  "✓ built in 4.21s",
  "##[endgroup]",
  "##[group]Run npx cap add android || echo \"android/ already present — continuing\"",
  "npx cap sync android",
  "android/ already present — continuing",
  "[error] android platform has not been added yet.",
  "##[endgroup]",
  "##[group]Run cd android && chmod +x ./gradlew && ./gradlew assembleDebug --no-daemon",
  "chmod: cannot access './gradlew': No such file or directory",
  "##[error]Process completed with exit code 1.",
].join('\n');

describe('the log is read from the step that FAILED, not the whole job', () => {
  it('isolates the failing step', () => {
    const section = failedStepSection(REAL_LOG);
    expect(section).toContain("chmod: cannot access './gradlew'");
    // The successful install's noise must not be in scope.
    expect(section).not.toContain('npm ci');
    expect(section).not.toContain('added 214 packages');
  });

  it('THE REGRESSION: no longer blames a lock file for a build whose install SUCCEEDED', () => {
    const d = classifyBuildFailure(REAL_LOG, APK_PATH);
    expect(d.code).not.toBe('NPM_CI_NO_LOCK');
    expect(d.summary).not.toMatch(/lock file/i);
  });

  it('names the actual cause: the Android project was never created', () => {
    const d = classifyBuildFailure(REAL_LOG, APK_PATH);
    expect(d.code).toBe('ANDROID_PLATFORM_MISSING');
    expect(d.autoFixable).toBe(true);
    expect(d.summary).toMatch(/never created|nothing to compile/i);
  });

  it('and does NOT mistake a missing file for a permissions problem', () => {
    // "chmod: cannot access" is a MISSING file. Repairing a chmod that is already correct would burn
    // an attempt and change nothing.
    const d = classifyBuildFailure(REAL_LOG, APK_PATH);
    expect(d.code).not.toBe('GRADLEW_NOT_EXECUTABLE');
  });

  it('repairs it by replacing the workflow that swallowed the failure', () => {
    const d = classifyBuildFailure(REAL_LOG, APK_PATH);
    const oldWorkflow = APK_WORKFLOW.replace(
      /- name: Generate and sync the Android project[\s\S]*?\n\n/,
      '- name: Generate and sync the Android project\n        run: |\n          npx cap add android || echo "continuing"\n          npx cap sync android\n\n',
    );
    const repair = repairFiles(d, { [APK_PATH]: oldWorkflow }, APK_PATH, APK_WORKFLOW);
    expect(repair?.files[APK_PATH]).toBeTruthy();
    expect(repair!.files[APK_PATH]).not.toContain('|| echo "continuing"');
  });

  it('a log with no group markers is still classified on its full text', () => {
    expect(failedStepSection('plain old log with no groups')).toBe('plain old log with no groups');
  });
});

describe('the workflow can no longer swallow a failed cap add', () => {
  const steps = () => {
    const wf = load(APK_WORKFLOW) as { jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }> };
    return Object.values(wf.jobs).flatMap((j) => j.steps);
  };

  it('does not ignore every error from creating the project', () => {
    const step = steps().find((s) => /Generate and sync/.test(s.name || ''))!;
    expect(step.run).not.toMatch(/cap add android \|\|/);
    // The correct test for "already there" is to look, not to ignore errors.
    expect(step.run).toContain('if [ ! -d android ]');
  });

  it('verifies the project really exists before anything depends on it', () => {
    const step = steps().find((s) => /Generate and sync/.test(s.name || ''))!;
    expect(step.run).toContain('android/gradlew');
    expect(step.run).toContain('NBAI_FAILED_STAGE=capacitor');
    expect(step.run).toContain('exit 1');
  });
});

describe('Capacitor packages are kept on ONE major — the likely reason cap add failed', () => {
  const parse = (json: string) => JSON.parse(json) as {
    dependencies: Record<string, string>; devDependencies: Record<string, string>;
  };

  it('THE REGRESSION: an app on Capacitor 7 does not get a version-6 platform bolted on', () => {
    const p = parse(buildPackageJson(JSON.stringify({
      scripts: { build: 'vite build' },
      dependencies: { '@capacitor/core': '^7.0.1' },
    }), 'My App', 'built'));
    expect(majorOfRange(p.dependencies['@capacitor/android'])).toBe(7);
    expect(majorOfRange(p.devDependencies['@capacitor/cli'])).toBe(7);
    expect(p.dependencies['@capacitor/core']).toBe('^7.0.1'); // the app's own choice is kept
  });

  it('all three agree whatever the app declares, including an older major', () => {
    for (const declared of ['^5.7.0', '^6.2.0', '^7.0.0', '8.1.2']) {
      const p = parse(buildPackageJson(JSON.stringify({
        scripts: { build: 'vite build' },
        devDependencies: { '@capacitor/cli': declared },
      }), 'My App', 'built'));
      const majors = new Set([
        majorOfRange(p.devDependencies['@capacitor/cli']),
        majorOfRange(p.dependencies['@capacitor/core']),
        majorOfRange(p.dependencies['@capacitor/android']),
      ]);
      expect(majors.size, `mixed majors for ${declared}`).toBe(1);
      expect([...majors][0]).toBe(majorOfRange(declared));
    }
  });

  it('an app with no opinion gets one consistent default', () => {
    const p = parse(buildPackageJson(undefined, 'My App', 'static'));
    const majors = new Set([
      majorOfRange(p.devDependencies['@capacitor/cli']),
      majorOfRange(p.dependencies['@capacitor/core']),
      majorOfRange(p.dependencies['@capacitor/android']),
    ]);
    expect(majors.size).toBe(1);
  });

  it('core decides, because that is what the app’s own code is written against', () => {
    expect(capacitorMajor({ '@capacitor/core': '^7.0.0', '@capacitor/haptics': '^6.0.0' })).toBe(7);
    expect(capacitorMajor({ '@capacitor/haptics': '^6.0.0' })).toBe(6);
    expect(capacitorMajor({ react: '^19.0.0' })).toBeNull();
  });
});
