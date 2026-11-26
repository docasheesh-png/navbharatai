/**
 * THE NATIVE CLOUD BUILD RUNS THE SAME RECIPE AS THE GITHUB BUILD (2026-11-25).
 *
 * The native worker gets no hand-written Android recipe: it runs the app's own generated GitHub workflow,
 * translated step by step (workflowScript.ts). These tests are the census that keeps it that way — every
 * step of both lanes, for every supported Capacitor line, is classified; a new step that needs GitHub
 * context, or an unknown action, fails here instead of silently vanishing from native builds.
 */
import { describe, expect, it } from 'vitest';
import { generateShipKit } from '../src/server/lib/mobileShipKit';
import {
  NATIVE_OUTPUT_PATH, SIGNING_ONLY_STEPS, parseWorkflowSteps, planFromWorkflow, renderNativeBuildScript,
} from '../src/server/lib/mobileBuild/workflowScript';
import { SIGN_SCRIPT, inspectionMismatch, isSafeAlias, parseKeyVerify, parseSignOutput } from '../src/server/lib/mobileBuild/nativeSigning';
import { nativeMissing, providerCapabilities, nativeLimits, githubBuildEnabled } from '../src/server/lib/mobileBuild/providerRegistry';
import { normalizeGithubRun, toView } from '../src/server/lib/mobileBuild/types';
import {
  androidVersionLabel, architectureLabel, isBuildView, isCapabilities, readProviderPreference, realProgress,
} from '../src/lib/mobileBuildClient';

const workflows = (major?: number) => {
  const kit = generateShipKit({ appName: 'Census App', appId: 'com.census.app', ios: false, capacitorMajor: major });
  return { apk: kit.files['.github/workflows/android-apk.yml'], aab: kit.files['.github/workflows/android-aab.yml'] };
};

describe('the native plan is the GitHub workflow, translated', () => {
  for (const major of [undefined, 5, 6, 7, 8]) {
    it(`classifies every step of both lanes (Capacitor ${major ?? 'default'})`, () => {
      const wf = workflows(major);
      for (const kind of ['apk', 'aab'] as const) {
        const plan = planFromWorkflow(wf[kind], kind, { versionCode: 29_400_000 });
        const parsed = parseWorkflowSteps(wf[kind]);
        expect(plan.dispositions.map((d) => d.name)).toEqual(parsed.map((s) => s.name));
        // The steps that decide whether an app compiles all run natively.
        const ran = plan.steps.map((s) => s.name);
        for (const must of ["Install the app's libraries", 'Build the web app', 'Generate and sync the Android project']) expect(ran).toContain(must);
        expect(plan.steps.some((s) => /\.\/gradlew (assembleDebug|bundleRelease)/.test(s.run))).toBe(true);
        expect(plan.outputPath).toBe(NATIVE_OUTPUT_PATH[kind]);
        // No step keeps an unresolved GitHub expression or a secret.
        for (const s of plan.steps) {
          expect(s.run).not.toMatch(/\$\{\{/);
          expect(Object.values(s.env).join('\n')).not.toMatch(/\$\{\{|secrets\./);
        }
      }
    });
  }

  it('signing never happens in the build machine: the secret steps are skipped by name, and those names still exist', () => {
    const plan = planFromWorkflow(workflows().aab, 'aab', { versionCode: 5 });
    const skipped = plan.dispositions.filter((d) => d.action === 'skip' && d.why === 'signing').map((d) => d.name);
    expect(new Set(skipped)).toEqual(SIGNING_ONLY_STEPS);
    expect(plan.steps.map((s) => s.run).join('\n')).not.toContain('release.keystore');
  });

  it('stamps the versionCode the build was created with', () => {
    const plan = planFromWorkflow(workflows().aab, 'aab', { versionCode: 29_123_456 });
    const stamp = plan.steps.find((s) => s.name === 'Stamp a unique versionCode');
    expect(stamp?.run).toContain('versionCode 29123456');
  });

  it('refuses a step that needs GitHub context it cannot have', () => {
    const wf = workflows().apk.replace('npm run build 2>&1', 'echo ${{ github.sha }}; npm run build 2>&1');
    expect(() => planFromWorkflow(wf, 'apk', { versionCode: 1 })).toThrow(/github\.sha/);
  });

  it('refuses an action it does not know, instead of dropping it', () => {
    const wf = workflows().apk.replace('uses: actions/checkout@v4', 'uses: someone/mystery-action@v1');
    expect(() => planFromWorkflow(wf, 'apk', { versionCode: 1 })).toThrow(/unknown action/);
  });

  it('refuses an out-of-range versionCode', () => {
    expect(() => planFromWorkflow(workflows().apk, 'apk', { versionCode: 0 })).toThrow();
    expect(() => planFromWorkflow(workflows().apk, 'apk', { versionCode: 2_200_000_000 })).toThrow();
  });

  it('renders one script: each step as `bash -e`, markers for progress, and a check that the output exists', () => {
    const plan = planFromWorkflow(workflows().apk, 'apk', { versionCode: 1 });
    const script = renderNativeBuildScript(plan, { projectDir: '/home/user/app', javaHome: '/opt/java/jdk21' });
    expect(script).toContain("cd '/home/user/app'");
    expect(script).toContain("export JAVA_HOME='/opt/java/jdk21'");
    expect((script.match(/bash -e "\$STEPS_DIR\/\d+\.sh"/g) ?? []).length).toBe(plan.steps.length);
    expect((script.match(/::nbai-step::/g) ?? []).length).toBe(plan.steps.length);
    expect(script).toContain(`if [ ! -f '${NATIVE_OUTPUT_PATH.apk}' ]`);
    expect(script).toContain(`echo "::nbai-output::${NATIVE_OUTPUT_PATH.apk}"`);
  });
});

describe('the trusted signing stage', () => {
  it('keeps every bash expansion intact and never puts a password on a command line', () => {
    expect(SIGN_SCRIPT).not.toContain('@{');
    expect(SIGN_SCRIPT).toContain('ALIAS="${3:-}"');
    expect(SIGN_SCRIPT).toContain('DIR="/home/user/nbai-sign"');
    expect(SIGN_SCRIPT).toContain('trap cleanup EXIT');
    expect(SIGN_SCRIPT).toContain('-storepass:file');
    expect(SIGN_SCRIPT).not.toMatch(/-storepass\s+"?\$/);
  });

  it('reads a valid result and refuses invented fields', () => {
    const cert = Array.from({ length: 32 }, () => 'AB').join(':');
    const ok = parseSignOutput(`noise\n::nbai-inspect::{"applicationId":"com.a.b","versionCode":"42","versionName":"1.0","minSdk":"23","targetSdk":"35","abis":"arm64-v8a x86_64 ;rm","certSha256":"${cert}","signingType":"upload_key"}\n`);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.inspection).toMatchObject({ applicationId: 'com.a.b', versionCode: 42, minSdk: 23, targetSdk: 35, certSha256: cert, signingType: 'upload_key' });
      expect(ok.inspection.abis).toEqual(['arm64-v8a', 'x86_64']);
    }
    const bad = parseSignOutput('::nbai-inspect::{"applicationId":"not an id; rm -rf","certSha256":"zz","signingType":"root"}');
    expect(bad.ok && bad.inspection.applicationId).toBe('');
    expect(bad.ok && bad.inspection.signingType).toBe('debug');
    expect(parseSignOutput('::nbai-sign-error::SIGN::The bundle could not be signed')).toEqual({ ok: false, error: { code: 'SIGN', detail: 'The bundle could not be signed' } });
    expect(parseSignOutput('nothing here').ok).toBe(false);
    expect(parseKeyVerify('::nbai-inspect::{"certSha256":"nope"}').ok).toBe(false);
  });

  it('refuses a file that is not what was asked for', () => {
    const insp = { applicationId: 'com.a.b', versionCode: 7, versionName: '1', minSdk: 23, targetSdk: 35, abis: [], certSha256: 'X', signingType: 'upload_key' as const };
    expect(inspectionMismatch('aab', insp, { appId: 'com.a.b', versionCode: 7, certSha256: 'X' })).toBeNull();
    expect(inspectionMismatch('aab', insp, { appId: 'com.other', versionCode: 7, certSha256: 'X' })).toMatch(/application id/);
    expect(inspectionMismatch('aab', insp, { appId: 'com.a.b', versionCode: 8, certSha256: 'X' })).toMatch(/versionCode/);
    expect(inspectionMismatch('aab', insp, { appId: 'com.a.b', versionCode: 7, certSha256: 'Y' })).toMatch(/different key/);
    expect(inspectionMismatch('aab', { ...insp, signingType: 'debug' }, { appId: 'com.a.b', versionCode: 7, certSha256: null })).toMatch(/upload key/);
    expect(inspectionMismatch('apk', { ...insp, applicationId: '' }, { appId: 'com.a.b', versionCode: null, certSha256: null })).toMatch(/could not be read/);
  });

  it('only ever puts a plain alias on a command line', () => {
    expect(isSafeAlias('upload')).toBe(true);
    for (const bad of ['', 'a b', 'x;rm -rf /', '$(id)', 'a'.repeat(65)]) expect(isSafeAlias(bad)).toBe(false);
  });
});

describe('which providers can run', () => {
  const ready = { MOBILE_NATIVE_BUILD_ENABLED: 'on', E2B_API_KEY: 'k', MOBILE_NATIVE_BUILD_TEMPLATE: 'navbharat-android-native', MOBILE_BUILD_ARTIFACT_BUCKET: 'my-bucket', SECRET_ENCRYPTION_KEY: 's' };

  it('native is OFF by default and says why; GitHub is ON by default', () => {
    const [native, gh] = providerCapabilities({});
    expect(native).toMatchObject({ id: 'native_cloud', available: false, artifacts: [] });
    expect(native.unavailableReason).toBeTruthy();
    expect(gh).toMatchObject({ id: 'github_actions', available: true, artifacts: ['apk', 'aab'], requiresGithub: true });
    expect(githubBuildEnabled({})).toBe(true);
  });

  it('native is available only with every piece configured, and AAB also needs the signing-key seal', () => {
    expect(providerCapabilities(ready)[0]).toMatchObject({ available: true, artifacts: ['apk', 'aab'] });
    const { SECRET_ENCRYPTION_KEY: _s, ...noSeal } = ready;
    expect(providerCapabilities(noSeal)[0]).toMatchObject({ available: true, artifacts: ['apk'] });
    for (const k of ['MOBILE_NATIVE_BUILD_ENABLED', 'E2B_API_KEY', 'MOBILE_NATIVE_BUILD_TEMPLATE', 'MOBILE_BUILD_ARTIFACT_BUCKET'] as const) {
      expect(nativeMissing('apk', { ...ready, [k]: '' })).toContain(k);
    }
    expect(nativeMissing('apk', { ...ready, MOBILE_NATIVE_BUILD_TEMPLATE: 'bad template!' })).toContain('MOBILE_NATIVE_BUILD_TEMPLATE');
  });

  it('switching native off never touches GitHub, and GitHub has its own switch', () => {
    expect(providerCapabilities({ ...ready, MOBILE_NATIVE_BUILD_ENABLED: 'off' })[1].available).toBe(true);
    expect(providerCapabilities({ MOBILE_GITHUB_BUILD_ENABLED: 'off' })[1]).toMatchObject({ available: false, artifacts: [] });
  });

  it('limits are clamped to safe ranges', () => {
    expect(nativeLimits({})).toEqual({ perUser: 1, system: 4, buildTimeoutMs: 25 * 60_000, retentionDays: 30 });
    expect(nativeLimits({ MOBILE_NATIVE_BUILD_TIMEOUT_MIN: '999', MOBILE_NATIVE_BUILD_MAX_ACTIVE: '0' })).toMatchObject({ buildTimeoutMs: 55 * 60_000, system: 1 });
  });
});

describe('one vocabulary for both providers', () => {
  it('maps GitHub run states onto the shared states', () => {
    expect(normalizeGithubRun('queued', null)).toBe('queued');
    expect(normalizeGithubRun('in_progress', null)).toBe('building');
    expect(normalizeGithubRun('completed', 'success')).toBe('completed');
    expect(normalizeGithubRun('completed', 'cancelled')).toBe('cancelled');
    expect(normalizeGithubRun('completed', 'failure')).toBe('failed');
    expect(normalizeGithubRun('completed', 'timed_out')).toBe('failed');
  });
});

describe('the screen only shows what the server proved', () => {
  const view = {
    id: 'nb_' + '0'.repeat(32), provider: 'native_cloud', kind: 'apk', appName: 'A', appId: 'com.a.b', versionCode: 1,
    state: 'building', step: 'Build the web app', stepIndex: 3, stepCount: 7, createdAt: 'x', startedAt: 'x', finishedAt: null,
    errorCode: null, errorMessage: null, failedStep: null, artifact: null,
  };
  it('accepts a real build view and rejects anything else', () => {
    expect(isBuildView(view)).toBe(true);
    expect(isBuildView({ ...view, state: 'done' })).toBe(false);
    expect(isBuildView({ ...view, id: '../etc' })).toBe(false);
    expect(isBuildView({ ...view, artifact: { fileName: 'a.apk' } })).toBe(false);
    expect(isCapabilities({ providers: [], priceInr: 1 })).toBe(false);
  });

  it('progress is real: never 100 before the file exists, and absent where nothing counts it', () => {
    expect(realProgress(view as any)).toBe(Math.round((2 / 7) * 90));
    expect(realProgress({ ...view, state: 'preparing' } as any)).toBeNull();
    expect(realProgress({ ...view, state: 'uploading' } as any)).toBe(95);
    expect(realProgress({ ...view, state: 'completed' } as any)).toBe(100);
    expect(realProgress({ ...view, stepIndex: 7, stepCount: 7 } as any)).toBeLessThan(100);
  });

  it('never claims one file works on every phone', () => {
    expect(androidVersionLabel(23)).toBe('Android 6.0 (API 23)');
    expect(androidVersionLabel(99)).toBe('API 99');
    expect(architectureLabel([])).toMatch(/no native code/);
    expect(architectureLabel(['arm64-v8a'])).toBe('arm64-v8a');
  });

  it('remembers the last provider only as a preference', () => {
    expect(readProviderPreference({ getItem: () => 'github_actions' })).toBe('github_actions');
    expect(readProviderPreference({ getItem: () => 'something-else' })).toBeNull();
    expect(readProviderPreference(null)).toBeNull();
  });

  it('the browser view carries no sandbox id, storage path or key reference', () => {
    const job = {
      ...view, userId: 'u', workspaceId: 'w', sessionId: 's', heartbeatAt: null, cancelRequested: false, attempt: 1,
      buildSandboxId: 'sbx-secret', signSandboxId: 'sbx2', toolchain: 't', signingKeyId: 'present', billingRef: 'r', billingExempt: false,
      logTail: [], leaseUntil: null, outputPath: 'p',
      artifact: { objectPath: 'mobile-builds/x/y/z.apk', fileName: 'z.apk', sizeBytes: 1, sha256: 'h', expiresAt: 'e', inspection: { applicationId: 'com.a.b', versionCode: 1, versionName: '1', minSdk: 23, targetSdk: 35, abis: [], certSha256: null, signingType: 'debug' } },
    };
    const v = JSON.stringify(toView(job as any));
    for (const secret of ['sbx-secret', 'sbx2', 'mobile-builds/x', '"userId"', 'workspaceId', 'logTail']) expect(v).not.toContain(secret);
  });
});
