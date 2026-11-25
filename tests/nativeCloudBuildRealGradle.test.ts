/**
 * THE NATIVE CLOUD BUILD, END TO END, WITH A REAL GRADLE — opt-in (2026-11-25).
 *
 * CI has no Android SDK, so this suite is skipped there. On a machine that has one it runs the REAL
 * runner (nativeBuildRunner.ts): the real translated build script, the real Gradle compile, the real
 * signing script (jarsigner / apksigner / aapt2 / bundletool), the real validation, the real store, the
 * real charge hook — with only the MACHINE replaced: a local process stands in for the E2B sandbox, a
 * directory for the bucket, an in-memory Firestore for the database.
 *
 *   NBAI_REAL_GRADLE_SDK=/path/to/android-sdk NBAI_BUNDLETOOL=/path/to/bundletool-all.jar \
 *     npx vitest run tests/nativeCloudBuildRealGradle.test.ts
 *
 * Needs JDK 21 on PATH (JAVA_HOME_21 overrides), network to npm / Google Maven / Maven Central.
 * First proven 2026-11-25: debug APK and upload-key-signed AAB, both validated and stored.
 */
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NativeBuildFirestore } from './helpers/nativeBuildFirestore';
import { makeTempDir } from './helpers/tempDir';

const SDK = process.env.NBAI_REAL_GRADLE_SDK ?? '';
const BUNDLETOOL = process.env.NBAI_BUNDLETOOL ?? '';
const JAVA21 = process.env.JAVA_HOME_21 ?? '/usr/lib/jvm/java-21-openjdk-amd64';
const enabled = !!SDK && fs.existsSync(SDK) && !!BUNDLETOOL && fs.existsSync(BUNDLETOOL);

const SAMPLE_APP: Record<string, string> = {
  'index.html': '<!doctype html><html><head><meta charset="utf-8"><title>Chai Timer</title></head><body><h1>Chai Timer</h1><p id="t">0</p><script src="app.js"></script></body></html>',
  'app.js': 'let n=0;setInterval(()=>{document.getElementById("t").textContent=String(++n)},1000);',
};

vi.mock('../src/server/lib/mobileBuild/prepareMobileProject', async () => {
  const { generateShipKit } = await import('../src/server/lib/mobileShipKit');
  const { assembleMobileProject } = await import('../src/server/lib/mobileProjectAssembler');
  return {
    loadAppFilesForShip: async () => ({ ok: true, files: SAMPLE_APP }),
    prepareMobileProject: async (input: { appName: string; appId?: string; appFiles?: Record<string, string> }) => {
      const kit = generateShipKit({ appName: input.appName, appId: input.appId, ios: false });
      const project = assembleMobileProject(input.appFiles ?? SAMPLE_APP, kit.files, { appName: input.appName, appId: input.appId ?? kit.appId, ios: false });
      return { ok: true, project, kit, prebuild: { kind: 'skip', reason: 'unavailable', buildRan: false }, preflightNotes: [] };
    },
  };
});

/** A local stand-in for one E2B machine: its `/home/user` is a temp dir, everything else is this host. */
function localFactory(root: string) {
  let n = 0;
  const machines = new Map<string, { dir: string; alive: boolean }>();
  const env = {
    ...process.env, ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK, NBAI_BUNDLETOOL: BUNDLETOOL,
    PATH: `${JAVA21}/bin:${process.env.PATH}`,
  };
  const rewrite = (dir: string, s: string) => s
    .split('/home/user/').join(`${dir}/`)
    .split('/opt/java/jdk21').join(JAVA21)
    .split('/opt/java/jdk17').join(JAVA21);
  const make = (id: string) => {
    const m = machines.get(id)!;
    return {
      id,
      async writeFiles(files: Array<{ path: string; data: string | ArrayBuffer }>) {
        for (const f of files) {
          const p = rewrite(m.dir, f.path);
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.writeFileSync(p, typeof f.data === 'string' ? rewrite(m.dir, f.data) : Buffer.from(f.data));
        }
      },
      run(cmd: string, opts: { timeoutMs: number }) {
        return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
          const c = spawn('bash', ['-c', rewrite(m.dir, cmd)], { env });
          let stdout = ''; let stderr = '';
          c.stdout.on('data', (d) => { stdout += d; });
          c.stderr.on('data', (d) => { stderr += d; });
          const t = setTimeout(() => c.kill('SIGKILL'), opts.timeoutMs);
          c.on('close', (code) => { clearTimeout(t); resolve({ exitCode: code ?? 1, stdout, stderr }); });
        });
      },
      async start(cmd: string) {
        const c = spawn('bash', ['-c', rewrite(m.dir, cmd)], { env, detached: true, stdio: 'ignore' });
        c.unref();
      },
      async readBytes(p: string) { return new Uint8Array(fs.readFileSync(rewrite(m.dir, p))); },
      async kill() { m.alive = false; },
    };
  };
  return {
    created: [] as string[],
    async create(role: 'build' | 'sign') {
      const id = `local-${role}-${++n}`;
      const dir = path.join(root, id);
      fs.mkdirSync(dir, { recursive: true });
      machines.set(id, { dir, alive: true });
      this.created.push(id);
      return make(id);
    },
    async connect(id: string) { return machines.get(id)?.alive ? make(id) : null; },
    async killById(id: string) { const m = machines.get(id); if (m) m.alive = false; },
  };
}

function localArtifacts(root: string) {
  return {
    async put(objectPath: string, bytes: Buffer) {
      const p = path.join(root, objectPath);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, bytes);
      return { sizeBytes: fs.statSync(p).size, md5Ok: true };
    },
    stream(objectPath: string) { return fs.createReadStream(path.join(root, objectPath)); },
    async remove(objectPath: string) { fs.rmSync(path.join(root, objectPath), { force: true }); },
  };
}

describe.skipIf(!enabled)('Native Cloud Build — real Gradle, end to end', () => {
  const root = makeTempDir('nbai-native-');
  const db = new NativeBuildFirestore();
  const charges: Array<[string, string, string]> = [];
  let deps: any;
  let store: typeof import('../src/server/lib/mobileBuild/nativeBuildStore');
  let runner: typeof import('../src/server/lib/mobileBuild/nativeBuildRunner');

  beforeAll(async () => {
    Object.assign(process.env, {
      MOBILE_NATIVE_BUILD_ENABLED: 'on', E2B_API_KEY: 'local', MOBILE_NATIVE_BUILD_TEMPLATE: 'local-template',
      MOBILE_BUILD_ARTIFACT_BUCKET: 'local-bucket', SECRET_ENCRYPTION_KEY: 'a-local-test-key-of-32-chars-xxx',
    });
    store = await import('../src/server/lib/mobileBuild/nativeBuildStore');
    runner = await import('../src/server/lib/mobileBuild/nativeBuildRunner');
    store.setNativeBuildDbForTests(db as any);
    deps = {
      sandboxes: localFactory(path.join(root, 'machines')),
      artifacts: localArtifacts(path.join(root, 'bucket')),
      charge: async (uid: string, ref: string, file: string) => { charges.push([uid, ref, file]); return { ok: true, tokensDebited: 1, tokenBalance: 0 }; },
      now: () => new Date(),
    };
  });

  async function runToEnd(id: string) {
    const deadline = Date.now() + 25 * 60_000;
    for (;;) {
      const j = await runner.advanceNativeBuild(id, deps);
      if (j && ['completed', 'failed', 'cancelled', 'expired'].includes(j.state)) return j;
      if (Date.now() > deadline) throw new Error('build did not finish');
      await new Promise((r) => setTimeout(r, 4000));
    }
  }

  const identity = { uid: 'user-real-gradle', email: null, emailVerified: false };

  it('compiles a genuine debug APK, validates it, stores it, and charges once', async () => {
    const r = await runner.startNativeBuild({
      identity, sessionId: 's1', workspaceId: 'ws1', kind: 'apk', appName: 'Chai Timer', appId: 'com.navbharat.chaitimer', idempotencyKey: 'real-gradle-apk-0001',
    }, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.state).toBe('building');
    // A replay of the same request is the same build — no second machine, no second charge.
    const replay = await runner.startNativeBuild({
      identity, sessionId: 's1', workspaceId: 'ws1', kind: 'apk', appName: 'Chai Timer', appId: 'com.navbharat.chaitimer', idempotencyKey: 'real-gradle-apk-0001',
    }, deps);
    expect(replay.ok && replay.created).toBe(false);

    const done = await runToEnd(r.job.id);
    expect(done.errorMessage).toBeNull();
    expect(done.state).toBe('completed');
    const a = done.artifact!;
    expect(a.inspection).toMatchObject({ applicationId: 'com.navbharat.chaitimer', signingType: 'debug', minSdk: 23 });
    const bytes = fs.readFileSync(path.join(root, 'bucket', a.objectPath));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(a.sha256);
    expect(bytes.length).toBe(a.sizeBytes);
    expect(charges.filter(([, ref]) => ref === `native_${done.id}`)).toHaveLength(1);
    // Ask again: still one charge.
    await runner.advanceNativeBuild(done.id, deps);
    expect(charges.filter(([, ref]) => ref === `native_${done.id}`)).toHaveLength(1);
  }, 30 * 60_000);

  it('compiles an AAB, signs it with the app\'s own upload key in the trusted stage, and validates it', async () => {
    const { generateUploadKeystore } = await import('../src/server/lib/androidKeystore');
    const k = generateUploadKeystore('Chai Timer');
    const saved = await store.saveKey(identity.uid, 'com.navbharat.chaitimer', {
      keystore: Buffer.from(k.base64, 'base64'), storePassword: k.storePassword, keyPassword: k.storePassword,
      alias: k.keyAlias, certSha256: k.sha256Fingerprint, source: 'generated',
    }, { replace: false });
    expect(saved.ok).toBe(true);

    const r = await runner.startNativeBuild({
      identity, sessionId: 's1', workspaceId: 'ws1', kind: 'aab', appName: 'Chai Timer', appId: 'com.navbharat.chaitimer', idempotencyKey: 'real-gradle-aab-0001',
    }, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const done = await runToEnd(r.job.id);
    expect(done.errorMessage).toBeNull();
    expect(done.state).toBe('completed');
    expect(done.artifact!.inspection).toMatchObject({
      applicationId: 'com.navbharat.chaitimer', signingType: 'upload_key', versionCode: done.versionCode, certSha256: k.sha256Fingerprint,
    });
    // The key's files never outlive the signing machine.
    const signDirs = (deps.sandboxes.created as string[]).filter((id) => id.includes('sign')).map((id) => path.join(root, 'machines', id, 'nbai-sign'));
    for (const d of signDirs) for (const f of ['ks', 'storepass', 'keypass']) expect(fs.existsSync(path.join(d, f))).toBe(false);
  }, 30 * 60_000);
});
