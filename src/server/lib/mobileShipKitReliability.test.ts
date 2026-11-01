import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
import JSZip from 'jszip';
import { generateShipKit } from './mobileShipKit';

interface Step {
  name?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Workflow {
  'run-name': string;
  on: { workflow_dispatch: { inputs: Record<string, { required?: boolean; type: string }> } };
  jobs: Record<string, { steps: Step[] }>;
}

const workflows = Object.entries(generateShipKit({ appName: 'Reliability App' }).files)
  .filter(([path]) => path.endsWith('.yml'))
  .map(([path, yaml]) => ({ path, workflow: load(yaml) as Workflow }));
const directories: string[] = [];

function sandbox(): string {
  const directory = mkdtempSync(join(tmpdir(), 'nbai-workflow-'));
  directories.push(directory);
  mkdirSync(join(directory, 'bin'));
  // Exercise retries without waiting on their real production delays.
  writeFileSync(join(directory, 'bin/sleep'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('generated Android build commands retain the real build result', () => {
  for (const { path, workflow } of workflows.filter(({ path }) => path.includes('android'))) {
    const build = Object.values(workflow.jobs).flatMap(job => job.steps)
      .find(step => step.name === 'Build the installable APK' || step.name === 'Build the signed bundle (.aab) and installable app (.apk)')!;

    function run(scenario: string): { status: number | null; attempts: number; output: string } {
      const directory = sandbox();
      mkdirSync(join(directory, 'android'));
      writeFileSync(join(directory, 'android/gradlew'), `#!/bin/bash
count=0
if [ -f "$TEST_DIRECTORY/attempts" ]; then read -r count < "$TEST_DIRECTORY/attempts"; fi
count=$((count + 1))
echo "$count" > "$TEST_DIRECTORY/attempts"
if [ "$TEST_SCENARIO" = deterministic ]; then echo 'Android resource linking failed'; exit 23; fi
if [ "$TEST_SCENARIO" = exhausted ] || { [ "$TEST_SCENARIO" = transient ] && [ "$count" -lt 3 ]; }; then
  echo 'Could not download artifact: connection reset'
  exit 17
fi
echo 'BUILD SUCCESSFUL'
`, { mode: 0o755 });
      // GitHub's implicit shell is bash -e, without pipefail. Do not add it in the harness: the
      // emitted script itself must handle the pipeline correctly.
      const result = spawnSync('bash', ['-e'], {
        input: build.run!.replaceAll('/tmp/nbai-gradle.log', join(directory, 'gradle.log')),
        cwd: directory,
        env: { ...process.env, PATH: `${directory}/bin:${process.env.PATH}`, TEST_DIRECTORY: directory, TEST_SCENARIO: scenario },
        encoding: 'utf8',
      });
      return { status: result.status, attempts: Number(readFileSync(join(directory, 'attempts'), 'utf8')), output: result.stdout };
    }

    it(`${path}: a deterministic failure exits nonzero immediately, even though tee succeeded`, () => {
      const result = run('deterministic');
      expect(result.status).toBe(23);
      expect(result.attempts).toBe(1);
    });

    it(`${path}: retries an actual transient Gradle failure and succeeds on recovery`, () => {
      const result = run('transient');
      expect(result.status).toBe(0);
      expect(result.attempts).toBe(3);
      expect(result.output).toContain('BUILD SUCCESSFUL');
    });

    it(`${path}: persistent network failure stops after the retry budget`, () => {
      const result = run('exhausted');
      expect(result.status).toBe(17);
      expect(result.attempts).toBe(3);
    });

    it(`${path}: old app outputs cannot survive a successful command that writes no new file`, () => {
      const directory = sandbox();
      mkdirSync(join(directory, 'android/app/build/outputs/apk/debug'), { recursive: true });
      mkdirSync(join(directory, 'android/app/build/outputs/bundle/release'), { recursive: true });
      writeFileSync(join(directory, 'android/app/build/outputs/apk/debug/app-debug.apk'), 'old apk');
      writeFileSync(join(directory, 'android/app/build/outputs/bundle/release/app-release.aab'), 'old bundle');
      writeFileSync(join(directory, 'android/gradlew'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
      const result = spawnSync('bash', ['-e'], { input: build.run, cwd: directory, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      expect(existsSync(join(directory, 'android/app/build/outputs/bundle/release/app-release.aab'))).toBe(false);
      const verification = Object.values(workflow.jobs).flatMap(job => job.steps)
        .find(step => step.name === 'Verify the Android app files')!;
      const checked = spawnSync('bash', ['-e'], {
        input: verification.run, cwd: directory,
        env: { ...process.env, RUNNER_TEMP: directory }, encoding: 'utf8',
      });
      expect(checked.status).not.toBe(0);
      expect(checked.stdout).toContain('no nonempty installable app file');
    });
  }
});

describe('the wrapper recovery repairs damaged jars without discarding a usable Android project', () => {
  for (const { path, workflow } of workflows.filter(({ path }) => path.includes('android'))) {
    const native = Object.values(workflow.jobs).flatMap(job => job.steps).find(step => step.name === 'Generate and sync the Android project')!;
    const recovery = native.run!.slice(native.run!.indexOf('# ./gradlew executes'), native.run!.indexOf("# THE APP'S OWN LOGO"));

    async function recover(scenario: string, version = '8.13') {
      const directory = sandbox();
      const jar = new JSZip().file('org/gradle/wrapper/GradleWrapperMain.class', 'fixture class');
      const fixture = join(directory, 'wrapper-fixture.jar');
      writeFileSync(fixture, await jar.generateAsync({ type: 'nodebuffer' }));
      mkdirSync(join(directory, 'android/gradle/wrapper'), { recursive: true });
      writeFileSync(join(directory, 'android/gradlew'), '#!/bin/bash\nexit 0\n');
      writeFileSync(join(directory, 'android/custom.marker'), 'keep my native project');
      if (scenario !== 'missing-properties') writeFileSync(join(directory, 'android/gradle/wrapper/gradle-wrapper.properties'),
        `distributionUrl=https\\://services.gradle.org/distributions/gradle-${version}-bin.zip\n`);
      writeFileSync(join(directory, 'android/gradle/wrapper/gradle-wrapper.jar'), scenario === 'empty' ? Buffer.alloc(0) : Buffer.from('truncated jar'));
      writeFileSync(join(directory, 'bin/curl'), `#!/bin/bash
output=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    https:*) echo "$1" > "$TEST_DIRECTORY/download-url"; shift ;;
    *) shift ;;
  esac
done
if [ "$TEST_SCENARIO" = offline ]; then echo 'partial' > "$output"; exit 22; fi
if [ "$TEST_SCENARIO" = bad-download ]; then echo 'not a jar' > "$output"; else cp "$TEST_DIRECTORY/wrapper-fixture.jar" "$output"; fi
`, { mode: 0o755 });
      writeFileSync(join(directory, 'bin/npx'), `#!/bin/bash
echo "$*" >> "$TEST_DIRECTORY/cap-calls"
if [ "$*" = 'cap add android' ]; then
  mkdir -p android/gradle/wrapper
  echo '#!/bin/bash' > android/gradlew
  if [ "$TEST_SCENARIO" = broken-scaffold ]; then echo broken > android/gradle/wrapper/gradle-wrapper.jar; else cp "$TEST_DIRECTORY/wrapper-fixture.jar" android/gradle/wrapper/gradle-wrapper.jar; fi
fi
`, { mode: 0o755 });
      // The failed scaffold branch reaches cap add only if its initial download is unavailable too.
      if (scenario === 'broken-scaffold') writeFileSync(join(directory, 'bin/curl'), '#!/bin/bash\nexit 22\n', { mode: 0o755 });
      const result = spawnSync('bash', ['-e'], {
        input: recovery, cwd: directory,
        env: { ...process.env, PATH: `${directory}/bin:${process.env.PATH}`, RUNNER_TEMP: directory,
          TEST_DIRECTORY: directory, TEST_SCENARIO: scenario }, encoding: 'utf8',
      });
      return { ...result, directory };
    }

    for (const scenario of ['empty', 'truncated']) {
      it(`${path}: repairs a ${scenario} jar using the real upstream release tag, preserving native files`, async () => {
        const result = await recover(scenario);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(readFileSync(join(result.directory, 'download-url'), 'utf8').trim()).toContain('/v8.13.0/gradle/wrapper/gradle-wrapper.jar');
        expect(existsSync(join(result.directory, 'android/custom.marker'))).toBe(true);
        expect(existsSync(join(result.directory, 'cap-calls'))).toBe(false);
      });
    }

    it(`${path}: retains patch release tags`, async () => {
      const result = await recover('truncated', '8.14.3');
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(readFileSync(join(result.directory, 'download-url'), 'utf8').trim()).toContain('/v8.14.3/gradle/wrapper/gradle-wrapper.jar');
    });

    for (const scenario of ['offline', 'bad-download', 'missing-properties']) {
      it(`${path}: recreates a complete wrapper after ${scenario} instead of accepting a broken binary`, async () => {
        const result = await recover(scenario);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(readFileSync(join(result.directory, 'cap-calls'), 'utf8').trim().split('\n')).toEqual(['cap add android', 'cap sync android']);
        expect(existsSync(join(result.directory, 'android/gradle/wrapper/gradle-wrapper.jar.download'))).toBe(false);
      });
    }

    it(`${path}: fails if re-scaffolding also returns a damaged wrapper`, async () => {
      const result = await recover('broken-scaffold');
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain('NBAI_FAILED_STAGE=capacitor');
    });
  }
});

describe('finished Android artifacts are verified before they become downloadable', () => {
  for (const { path, workflow } of workflows.filter(({ path }) => path.includes('android'))) {
    const release = path.includes('aab');
    const steps = Object.values(workflow.jobs).flatMap(job => job.steps);
    const verification = steps.find(step => step.name === 'Verify the Android app files')!;

    async function verify(scenario = 'valid') {
      const directory = sandbox();
      const apkPath = join(directory, `android/app/build/outputs/apk/${release ? 'release/app-release.apk' : 'debug/app-debug.apk'}`);
      const bundlePath = join(directory, 'android/app/build/outputs/bundle/release/app-release.aab');
      mkdirSync(join(directory, `android/app/build/outputs/apk/${release ? 'release' : 'debug'}`), { recursive: true });
      mkdirSync(join(directory, 'android/app/build/outputs/bundle/release'), { recursive: true });
      const apk = new JSZip();
      if (scenario !== 'missing-manifest') apk.file('AndroidManifest.xml', 'fixture manifest');
      if (scenario !== 'missing-dex') apk.file('classes.dex', 'fixture dex');
      if (scenario !== 'missing-page') apk.file('assets/public/index.html', scenario === 'empty-page' ? '' : '<html><body>My app</body></html>');
      const apkBytes = await apk.generateAsync({ type: 'nodebuffer' });
      if (scenario !== 'missing-apk') writeFileSync(apkPath, scenario === 'empty-apk' ? Buffer.alloc(0)
        : scenario === 'truncated-apk' ? apkBytes.subarray(0, apkBytes.length - 20) : apkBytes);
      const bundle = new JSZip();
      if (scenario !== 'missing-bundle-config') bundle.file('BundleConfig.pb', 'fixture config');
      bundle.file('base/manifest/AndroidManifest.xml', 'fixture manifest');
      bundle.file('base/dex/classes.dex', 'fixture dex');
      bundle.file('base/assets/public/index.html', '<html>My app</html>');
      const bundleBytes = await bundle.generateAsync({ type: 'nodebuffer' });
      writeFileSync(bundlePath, scenario === 'truncated-bundle' ? bundleBytes.subarray(0, bundleBytes.length - 20) : bundleBytes);
      const sdk = join(directory, 'sdk with spaces');
      if (scenario !== 'missing-tools') {
        // The obsolete directory exists too; only the newest complete toolset is used.
        mkdirSync(join(sdk, 'build-tools/33.0.0'), { recursive: true });
        const tools = join(sdk, 'build-tools/35.0.0');
        mkdirSync(tools, { recursive: true });
        writeFileSync(join(tools, 'apksigner'), `#!/bin/bash
echo "$*" > "$TEST_DIRECTORY/signer-calls"
if [ "$TEST_SCENARIO" = unsigned-apk ]; then exit 1; fi
exit 0
`, { mode: 0o755 });
        writeFileSync(join(tools, 'aapt'), `#!/bin/bash
echo "package: name='com.example.myapp' versionCode='1' versionName='1.0'"
if [ "$TEST_SCENARIO" != no-launcher ]; then echo "launchable-activity: name='com.example.myapp.MainActivity'"; fi
`, { mode: 0o755 });
      }
      if (scenario === 'real-signed-bundle') {
        const keystore = join(directory, 'fixture.keystore');
        const created = spawnSync('keytool', ['-genkeypair', '-alias', 'fixture', '-keyalg', 'RSA', '-keysize', '2048',
          '-validity', '2', '-dname', 'CN=APK Regression Fixture', '-keystore', keystore,
          '-storepass', 'fixture-password', '-keypass', 'fixture-password'], { encoding: 'utf8' });
        expect(created.status, created.stderr).toBe(0);
        const signed = spawnSync('jarsigner', ['-keystore', keystore, '-storepass', 'fixture-password',
          bundlePath, 'fixture'], { encoding: 'utf8' });
        expect(signed.status, signed.stderr).toBe(0);
      }
      if (!scenario.startsWith('real-')) writeFileSync(join(directory, 'bin/jarsigner'), `#!/bin/bash
if [ "$TEST_SCENARIO" = unsigned-bundle ]; then echo 'jar is unsigned.'; else echo 'jar verified.'; fi
exit 0
`, { mode: 0o755 });
      const result = spawnSync('bash', ['-e'], {
        input: verification.run, cwd: directory,
        env: {
          ...process.env, PATH: `${directory}/bin:${process.env.PATH}`, RUNNER_TEMP: directory,
          ANDROID_SDK_ROOT: '', ANDROID_HOME: sdk, TEST_DIRECTORY: directory, TEST_SCENARIO: scenario,
        }, encoding: 'utf8',
      });
      return { ...result, directory, apkPath };
    }

    it(`${path}: validates archive, bundled screen, actual signature command and launcher before upload`, async () => {
      const result = await verify();
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(readFileSync(join(result.directory, 'signer-calls'), 'utf8').trim())
        .toBe(`verify --verbose ${result.apkPath.slice(result.directory.length + 1)}`);
      const verifyAt = steps.indexOf(verification);
      expect(verifyAt).toBeGreaterThan(-1);
      for (const upload of steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'))) {
        expect(steps.indexOf(upload)).toBeGreaterThan(verifyAt);
      }
    });

    for (const scenario of ['missing-apk', 'empty-apk', 'truncated-apk', 'missing-manifest', 'missing-dex', 'missing-page', 'empty-page', 'unsigned-apk', 'no-launcher', 'missing-tools']) {
      it(`${path}: rejects ${scenario} instead of publishing a broken app`, async () => {
        const result = await verify(scenario);
        expect(result.status).not.toBe(0);
        expect(result.stdout).toContain('NBAI_FAILED_STAGE=android');
        expect(result.stdout).not.toContain('passed archive, signing and launcher checks');
      });
    }

    if (release) {
      for (const scenario of ['missing-bundle-config', 'truncated-bundle', 'unsigned-bundle']) {
        it(`${path}: rejects ${scenario}, including jarsigner's zero exit for an unsigned bundle`, async () => {
          const result = await verify(scenario);
          expect(result.status).not.toBe(0);
          expect(result.stdout).toContain('NBAI_FAILED_STAGE=android');
        });
      }
      it(`${path}: accepts a genuinely verified bundle signed by a self-signed upload certificate`, async () => {
        const result = await verify('real-signed-bundle');
        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(readFileSync(join(result.directory, 'nbai-bundle-signature.txt'), 'utf8')).toContain('jar verified.');
      });

      it(`${path}: rejects a real unsigned bundle even when the JDK verifier exits zero`, async () => {
        const result = await verify('real-unsigned-bundle');
        expect(result.status).not.toBe(0);
        expect(result.stdout).toContain('The Play bundle is not signed.');
        expect(readFileSync(join(result.directory, 'nbai-bundle-signature.txt'), 'utf8')).toContain('jar is unsigned.');
      });
    }
  }
});

describe('generated workflows recover installs and require downloadable artifacts', () => {
  for (const { path, workflow } of workflows) {
    const steps = Object.values(workflow.jobs).flatMap(job => job.steps);
    const install = steps.find(step => step.name === "Install the app's libraries")!;

    it(`${path}: a lockfile peer conflict gets the same working fallback as an unlocked app`, () => {
      const directory = sandbox();
      writeFileSync(join(directory, 'package-lock.json'), '{}');
      writeFileSync(join(directory, 'bin/npm'), `#!/bin/bash
echo "$*" >> "$TEST_DIRECTORY/npm-calls"
case " $* " in *' --legacy-peer-deps '*) exit 0;; esac
echo 'npm error ERESOLVE could not resolve dependency tree' >&2
exit 1
`, { mode: 0o755 });
      const result = spawnSync('bash', ['-e'], {
        input: install.run,
        cwd: directory,
        env: { ...process.env, ...install.env, PATH: `${directory}/bin:${process.env.PATH}`, TEST_DIRECTORY: directory },
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      const commands = readFileSync(join(directory, 'npm-calls'), 'utf8').trim().split('\n');
      expect(commands[0]).toBe('ci');
      expect(commands.at(-1)).toContain('--legacy-peer-deps');
      expect(Number(install.env?.NPM_CONFIG_FETCH_RETRIES)).toBeGreaterThan(0);
      expect(Number(install.env?.NPM_CONFIG_FETCH_TIMEOUT)).toBeLessThanOrEqual(60_000);
    });

    it(`${path}: a missing artifact cannot produce a successful workflow`, () => {
      const uploads = steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'));
      expect(uploads.length).toBeGreaterThan(0);
      for (const upload of uploads) expect(upload.with?.['if-no-files-found']).toBe('error');
    });

    it(`${path}: dispatched runs can be correlated without breaking manual builds`, () => {
      expect(workflow.on.workflow_dispatch.inputs.build_request_id).toMatchObject({ type: 'string', required: false });
      expect(workflow['run-name']).toContain('${{ inputs.build_request_id }}');
    });
  }
});
