/**
 * THE NATIVE CLOUD BUILD'S STATE MACHINE — every path a real build can take (2026-11-25).
 *
 * The machine is a scripted fake (the real-Gradle run lives in nativeCloudBuildRealGradle.test.ts); the
 * runner, the store, the plan and the signing parser are all real. What these lock:
 *   • nothing is reported complete before a validated file is stored; nothing failed is ever charged;
 *   • a request replayed is the same build; a finished verdict is never overwritten;
 *   • one instance drives a build at a time; a lost machine, a timeout and a cancel all end honestly;
 *   • the upload key reaches only the signing machine, and is stored sealed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeBuildFirestore } from './helpers/nativeBuildFirestore';

const SAMPLE_APP: Record<string, string> = {
  'index.html': '<!doctype html><html><head><title>T</title></head><body><script src="app.js"></script></body></html>',
  'app.js': 'console.log(1)',
};
const prepareResult = { refuse: null as null | { status: number; body: Record<string, unknown> } };

vi.mock('../src/server/lib/mobileBuild/prepareMobileProject', async () => {
  const { generateShipKit } = await import('../src/server/lib/mobileShipKit');
  const { assembleMobileProject } = await import('../src/server/lib/mobileProjectAssembler');
  return {
    loadAppFilesForShip: async () => ({ ok: true, files: SAMPLE_APP }),
    prepareMobileProject: async (input: { appName: string; appId?: string }) => {
      if (prepareResult.refuse) return { ok: false, ...prepareResult.refuse };
      const kit = generateShipKit({ appName: input.appName, appId: input.appId, ios: false });
      const project = assembleMobileProject(SAMPLE_APP, kit.files, { appName: input.appName, appId: input.appId ?? kit.appId, ios: false });
      return { ok: true, project, kit, prebuild: { kind: 'skip', reason: 'unavailable', buildRan: false }, preflightNotes: [] };
    },
  };
});

import * as store from '../src/server/lib/mobileBuild/nativeBuildStore';
import * as runner from '../src/server/lib/mobileBuild/nativeBuildRunner';
import type { NativeBuildJob } from '../src/server/lib/mobileBuild/types';

const CERT = Array.from({ length: 32 }, () => 'C3').join(':');
const OTHER_CERT = Array.from({ length: 32 }, () => 'D4').join(':');

interface Machine {
  id: string; role: 'build' | 'sign'; alive: boolean;
  files: Map<string, string | Buffer>; runs: string[]; started: string[];
}

function fakeWorld() {
  const machines = new Map<string, Machine>();
  const script = {
    exit: null as number | null,
    markers: ['::nbai-step::3::7::Build the web app'],
    output: null as string | null,
    log: 'npm WARN something\nusing token ghp_abcdefghijklmnopqrstuvwxyz0123456789 in a log line\nBUILD FAILED',
    built: Buffer.from('PK\u0003\u0004built-file'),
    signStdout: '' as string,
    signed: Buffer.from('PK\u0003\u0004signed-bundle'),
    createFails: 0,
  };
  let n = 0;
  const handle = (m: Machine) => ({
    id: m.id,
    async writeFiles(files: Array<{ path: string; data: string | ArrayBuffer }>) {
      for (const f of files) m.files.set(f.path, typeof f.data === 'string' ? f.data : Buffer.from(f.data));
    },
    async run(cmd: string) {
      m.runs.push(cmd);
      if (m.role === 'build') {
        if (cmd.includes('nbai-exit')) {
          const lines = [...script.markers];
          if (script.output) lines.push(`::nbai-output::${script.output}`);
          return { exitCode: 0, stdout: `${lines.join('\n')}\n::nbai-exit::${script.exit ?? ''}`, stderr: '' };
        }
        if (cmd.startsWith('tail')) return { exitCode: 0, stdout: `${script.markers.join('\n')}\n${script.log}`, stderr: '' };
      }
      if (m.role === 'sign') return { exitCode: 0, stdout: script.signStdout, stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    },
    async start(cmd: string) { m.started.push(cmd); },
    async readBytes(p: string) { return new Uint8Array(m.role === 'sign' ? script.signed : script.built); void p; },
    async kill() { m.alive = false; },
  });
  const factory = {
    async create(role: 'build' | 'sign') {
      if (script.createFails > 0) { script.createFails--; throw new Error('machine unavailable'); }
      const m: Machine = { id: `m${++n}-${role}`, role, alive: true, files: new Map(), runs: [], started: [] };
      machines.set(m.id, m);
      return handle(m);
    },
    async connect(id: string) { const m = machines.get(id); return m?.alive ? handle(m) : null; },
    async killById(id: string) { const m = machines.get(id); if (m) m.alive = false; },
  };
  const stored = new Map<string, Buffer>();
  const artifacts = {
    putFails: false,
    async put(p: string, b: Buffer) { stored.set(p, b); return { sizeBytes: this.putFails ? b.length - 1 : b.length, md5Ok: true }; },
    stream() { throw new Error('not used'); },
    async remove(p: string) { stored.delete(p); },
  };
  const charges: string[] = [];
  let clock = Date.parse('2026-11-25T10:00:00Z');
  const deps = {
    sandboxes: factory,
    artifacts,
    charge: async (_u: string, ref: string) => { charges.push(ref); return { ok: true as const, tokensDebited: 1, tokenBalance: 0 }; },
    now: () => new Date(clock),
  };
  return { machines, script, deps, stored, charges, tick: (ms: number) => { clock += ms; } };
}

const ENV = { MOBILE_NATIVE_BUILD_ENABLED: 'on', E2B_API_KEY: 'k', MOBILE_NATIVE_BUILD_TEMPLATE: 'tpl', MOBILE_BUILD_ARTIFACT_BUCKET: 'bucket-x', SECRET_ENCRYPTION_KEY: 'unit-test-key-0123456789abcdef!!' };
const ident = (uid = 'user-a') => ({ uid, email: null, emailVerified: false });
let seq = 0;
const input = (over: Partial<Parameters<typeof runner.startNativeBuild>[0]> = {}) => ({
  identity: ident(), sessionId: 's1', workspaceId: 'ws-a', kind: 'apk' as const, appName: 'Tea Timer', appId: 'com.tea.timer',
  idempotencyKey: `request-key-${String(++seq).padStart(6, '0')}`, ...over,
});

let db: NativeBuildFirestore;
let w: ReturnType<typeof fakeWorld>;

beforeEach(() => {
  Object.assign(process.env, ENV);
  db = new NativeBuildFirestore();
  store.setNativeBuildDbForTests(db as any);
  w = fakeWorld();
  prepareResult.refuse = null;
});

async function startOk(over = {}) {
  const r = await runner.startNativeBuild(input(over), w.deps as any);
  if (!r.ok) throw new Error(`start refused: ${JSON.stringify(r.body)}`);
  return r.job;
}

function buildMachine(): Machine {
  return [...w.machines.values()].find((m) => m.role === 'build')!;
}

describe('starting a build', () => {
  it('refuses honestly when native is not configured, and records nothing', async () => {
    process.env.MOBILE_NATIVE_BUILD_ENABLED = 'off';
    const r = await runner.startNativeBuild(input(), w.deps as any);
    expect(r).toMatchObject({ ok: false, status: 503, body: { code: 'provider-unavailable' } });
    expect(db.rows(store.BUILDS)).toHaveLength(0);
    expect(w.machines.size).toBe(0);
  });

  it('a Play bundle needs the app\'s own upload key — never an invented one', async () => {
    const r = await runner.startNativeBuild(input({ kind: 'aab' }), w.deps as any);
    expect(r).toMatchObject({ ok: false, status: 409, body: { code: 'signing-key-required' } });
    expect(db.rows(store.BUILDS)).toHaveLength(0);
    expect(db.rows(store.KEYS)).toHaveLength(0);
  });

  it('launches the translated build detached in a fresh machine, with only the app\'s files', async () => {
    const job = await startOk();
    expect(job.state).toBe('building');
    const m = buildMachine();
    expect(m.files.has('/home/user/nbai-run/build.sh')).toBe(true);
    expect(m.files.has('/home/user/app/package.json')).toBe(true);
    expect([...m.files.keys()].some((p) => p.startsWith('/home/user/app/www/'))).toBe(true);
    for (const p of m.files.keys()) expect(p.startsWith('/home/user/app/') || p === '/home/user/nbai-run/build.sh').toBe(true);
    expect(m.started[0]).toMatch(/^setsid nohup bash -c 'timeout \d+ bash \/home\/user\/nbai-run\/build\.sh/);
    expect(String(m.files.get('/home/user/nbai-run/build.sh'))).toContain("export JAVA_HOME='/opt/java/jdk21'");
  });

  it('a replayed request is the SAME build: no second machine, no second row', async () => {
    const i = input();
    const a = await runner.startNativeBuild(i, w.deps as any);
    const b = await runner.startNativeBuild(i, w.deps as any);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) { expect(b.job.id).toBe(a.job.id); expect(b.created).toBe(false); }
    expect(db.rows(store.BUILDS)).toHaveLength(1);
    expect(w.machines.size).toBe(1);
  });

  it('one running build per user, and a system-wide cap', async () => {
    await startOk();
    const second = await runner.startNativeBuild(input(), w.deps as any);
    expect(second).toMatchObject({ ok: false, status: 429, body: { code: 'build-in-progress' } });
    process.env.MOBILE_NATIVE_BUILD_MAX_ACTIVE = '1';
    const other = await runner.startNativeBuild(input({ identity: ident('user-b') }), w.deps as any);
    expect(other).toMatchObject({ ok: false, status: 429, body: { code: 'capacity' } });
    delete process.env.MOBILE_NATIVE_BUILD_MAX_ACTIVE;
  });

  it('a preparation refusal fails the build with the shared preparation\'s own words, and is never charged', async () => {
    prepareResult.refuse = { status: 422, body: { error: 'Your app did not compile.', code: 'real-build-failed' } };
    const r = await runner.startNativeBuild(input(), w.deps as any);
    expect(r).toMatchObject({ ok: false, status: 422, body: { code: 'real-build-failed' } });
    expect(r.ok === false && r.job?.state).toBe('failed');
    expect(w.machines.size).toBe(0);
    expect(w.charges).toEqual([]);
  });

  it('retries a machine that failed to start ONCE, then reports it honestly', async () => {
    w.script.createFails = 1;
    expect((await startOk()).state).toBe('building');
    w.script.createFails = 2;
    const r = await runner.startNativeBuild(input({ identity: ident('user-c') }), w.deps as any);
    expect(r).toMatchObject({ ok: false, status: 502, body: { code: 'start-failed' } });
    expect(r.ok === false && r.job?.state).toBe('failed');
  }, 15_000);
});

describe('advancing a build', () => {
  it('reports the worker\'s real step while it compiles', async () => {
    const job = await startOk();
    const j = await runner.advanceNativeBuild(job.id, w.deps as any);
    expect(j).toMatchObject({ state: 'building', step: 'Build the web app', stepIndex: 3, stepCount: 7 });
  });

  it('APK: completes only after validation and a verified store — then charges exactly once', async () => {
    const job = await startOk();
    w.script.exit = 0;
    w.script.output = 'android/app/build/outputs/apk/debug/app-debug.apk';
    w.script.signStdout = '::nbai-inspect::{"applicationId":"com.tea.timer","versionCode":"1","versionName":"1.0","minSdk":"23","targetSdk":"35","abis":"","certSha256":"' + OTHER_CERT + '","signingType":"debug"}';
    const done = await runner.advanceNativeBuild(job.id, w.deps as any);
    expect(done?.state).toBe('completed');
    expect(done?.artifact).toMatchObject({ fileName: 'tea-timer-debug.apk', sizeBytes: w.script.built.length });
    expect(done?.artifact?.inspection.signingType).toBe('debug');
    expect(w.stored.size).toBe(1);
    expect(w.charges).toEqual([`native_${job.id}`]);
    // The signing machine got NO key for an APK, and both machines are gone.
    const sign = [...w.machines.values()].find((m) => m.role === 'sign')!;
    expect([...sign.files.keys()].some((p) => /\/(ks|storepass|keypass)$/.test(p))).toBe(false);
    expect([...w.machines.values()].every((m) => !m.alive)).toBe(true);
    // Asking again changes nothing and charges nothing more.
    await runner.advanceNativeBuild(job.id, w.deps as any);
    expect(w.charges).toHaveLength(1);
  });

  it('AAB: the upload key reaches ONLY the signing machine, and the signed bundle must match it', async () => {
    const saved = await store.saveKey('user-a', 'com.tea.timer', {
      keystore: Buffer.from('KEYSTORE-BYTES'), storePassword: 'store-pass-123', keyPassword: 'key-pass-456', alias: 'upload', certSha256: CERT, source: 'imported',
    }, { replace: false });
    expect(saved.ok).toBe(true);
    // Sealed at rest: no plaintext password or key bytes in the stored row.
    const row = JSON.stringify(db.rows(store.KEYS));
    for (const plain of ['store-pass-123', 'key-pass-456', Buffer.from('KEYSTORE-BYTES').toString('base64')]) expect(row).not.toContain(plain);

    const job = await startOk({ kind: 'aab' });
    const buildFiles = [...buildMachine().files.keys()];
    expect(buildFiles.some((p) => /\/(ks|storepass|keypass)$/.test(p))).toBe(false);
    w.script.exit = 0;
    w.script.output = 'android/app/build/outputs/bundle/release/app-release.aab';
    w.script.signStdout = `::nbai-inspect::{"applicationId":"com.tea.timer","versionCode":"${job.versionCode}","versionName":"1.0","minSdk":"23","targetSdk":"35","abis":"","certSha256":"${CERT}","signingType":"upload_key"}`;
    const done = await runner.advanceNativeBuild(job.id, w.deps as any);
    expect(done?.state).toBe('completed');
    const sign = [...w.machines.values()].find((m) => m.role === 'sign')!;
    expect(String(sign.files.get('/home/user/nbai-sign/storepass'))).toBe('store-pass-123');
    expect(sign.runs[0]).toBe('bash /home/user/nbai-sign/sign.sh aab sign upload');
    expect(sign.runs[0]).not.toContain('store-pass-123');
    expect(w.stored.get(done!.artifact!.objectPath)?.equals(w.script.signed)).toBe(true);
    expect(db.rows(store.KEY_EVENTS).map((e) => e.event)).toEqual(['imported', 'used']);
  });

  it('a bundle signed with a DIFFERENT key is refused, not delivered, not charged', async () => {
    await store.saveKey('user-a', 'com.tea.timer', { keystore: Buffer.from('K'), storePassword: 'p', keyPassword: 'p', alias: 'upload', certSha256: CERT, source: 'imported' }, { replace: false });
    const job = await startOk({ kind: 'aab' });
    w.script.exit = 0;
    w.script.output = 'android/app/build/outputs/bundle/release/app-release.aab';
    w.script.signStdout = `::nbai-inspect::{"applicationId":"com.tea.timer","versionCode":"${job.versionCode}","certSha256":"${OTHER_CERT}","signingType":"upload_key"}`;
    const done = await runner.advanceNativeBuild(job.id, w.deps as any);
    expect(done).toMatchObject({ state: 'failed', errorCode: 'VALIDATION_FAILED' });
    expect(w.stored.size).toBe(0);
    expect(w.charges).toEqual([]);
  });

  it('a wrong application id is refused', async () => {
    const job = await startOk();
    w.script.exit = 0;
    w.script.output = 'android/app/build/outputs/apk/debug/app-debug.apk';
    w.script.signStdout = '::nbai-inspect::{"applicationId":"com.someone.else","signingType":"debug"}';
    expect(await runner.advanceNativeBuild(job.id, w.deps as any)).toMatchObject({ state: 'failed', errorCode: 'VALIDATION_FAILED' });
    expect(w.charges).toEqual([]);
  });

  it('an unexpected output path is refused', async () => {
    const job = await startOk();
    w.script.exit = 0;
    w.script.output = 'android/app/build/outputs/apk/release/app-release-unsigned.apk';
    expect(await runner.advanceNativeBuild(job.id, w.deps as any)).toMatchObject({ state: 'failed', errorCode: 'UNEXPECTED_OUTPUT' });
  });

  it('a failed compile is reported with its step and a SANITIZED log, and never charged', async () => {
    const job = await startOk();
    w.script.exit = 1;
    w.script.markers = ['::nbai-step::6::7::Build the installable APK', '::nbai-failed::6::Build the installable APK'];
    const done = await runner.advanceNativeBuild(job.id, w.deps as any);
    expect(done).toMatchObject({ state: 'failed', errorCode: 'BUILD_FAILED', failedStep: 'Build the installable APK' });
    expect(done?.errorMessage).toMatch(/Nothing was charged/);
    expect(done?.logTail.join('\n')).toContain('[redacted]');
    expect(done?.logTail.join('\n')).not.toContain('ghp_abcdefghijklmnop');
    expect(w.charges).toEqual([]);
    expect(buildMachine().alive).toBe(false);
  });

  it('the shell `timeout` exit (124) is a timeout, not a compile error', async () => {
    const job = await startOk();
    w.script.exit = 124;
    expect(await runner.advanceNativeBuild(job.id, w.deps as any)).toMatchObject({ state: 'failed', errorCode: 'TIMEOUT' });
  });

  it('a build past its time limit with no result is stopped as a timeout', async () => {
    const job = await startOk();
    w.tick(26 * 60_000 + 3 * 60_000);
    expect(await runner.advanceNativeBuild(job.id, w.deps as any)).toMatchObject({ state: 'failed', errorCode: 'TIMEOUT' });
    expect(buildMachine().alive).toBe(false);
  });

  it('a machine that vanished ends the build honestly (no hanging spinner)', async () => {
    const job = await startOk();
    buildMachine().alive = false;
    expect(await runner.advanceNativeBuild(job.id, w.deps as any)).toMatchObject({ state: 'failed', errorCode: 'WORKER_LOST' });
  });

  it('stop: cancelling, then cancelled with the machine killed — never charged', async () => {
    const job = await startOk();
    const asked = await store.requestCancel(job.id, 'user-a');
    expect(asked?.state).toBe('cancelling');
    const done = await runner.advanceNativeBuild(job.id, w.deps as any);
    expect(done?.state).toBe('cancelled');
    expect(buildMachine().alive).toBe(false);
    expect(w.charges).toEqual([]);
    expect(await store.requestCancel(job.id, 'user-b')).toBeNull();
  });

  it('one instance drives a build at a time (the lease)', async () => {
    const job = await startOk();
    await Promise.all([runner.advanceNativeBuild(job.id, w.deps as any), runner.advanceNativeBuild(job.id, w.deps as any)]);
    const probes = buildMachine().runs.filter((c) => c.includes('nbai-exit'));
    expect(probes.length).toBe(1);
  });

  it('a transient failure in the trusted stage retries from the same compile, a bounded number of times', async () => {
    const job = await startOk();
    w.script.exit = 0;
    w.script.output = 'android/app/build/outputs/apk/debug/app-debug.apk';
    w.script.createFails = 10; // the signing machine cannot be created
    for (let i = 0; i < 3; i++) {
      const j = await runner.advanceNativeBuild(job.id, w.deps as any);
      expect(j?.state).toBe('validating');
      w.tick(4 * 60_000); // past the lease
    }
    const last = await runner.advanceNativeBuild(job.id, w.deps as any);
    expect(last).toMatchObject({ state: 'failed', errorCode: 'FINISH_FAILED' });
    expect(w.charges).toEqual([]);
  });

  it('a store that cannot prove the bytes landed fails the build, uncharged, and leaves no object', async () => {
    const job = await startOk();
    w.script.exit = 0;
    w.script.output = 'android/app/build/outputs/apk/debug/app-debug.apk';
    w.script.signStdout = '::nbai-inspect::{"applicationId":"com.tea.timer","signingType":"debug"}';
    w.deps.artifacts.putFails = true;
    expect(await runner.advanceNativeBuild(job.id, w.deps as any)).toMatchObject({ state: 'failed', errorCode: 'STORAGE_FAILED' });
    expect(w.stored.size).toBe(0);
    expect(w.charges).toEqual([]);
  });

  it('an exempt account is never charged', async () => {
    const r = await runner.startNativeBuild(input(), w.deps as any);
    if (!r.ok) throw new Error('refused');
    await store.updateJob(r.job.id, { billingExempt: true });
    w.script.exit = 0;
    w.script.output = 'android/app/build/outputs/apk/debug/app-debug.apk';
    w.script.signStdout = '::nbai-inspect::{"applicationId":"com.tea.timer","signingType":"debug"}';
    expect((await runner.advanceNativeBuild(r.job.id, w.deps as any))?.state).toBe('completed');
    expect(w.charges).toEqual([]);
  });

  it('a finished verdict is final: a late write cannot move it', async () => {
    const job = await startOk();
    await store.updateJob(job.id, { state: 'failed', errorCode: 'X' });
    const after = await store.updateJob(job.id, { state: 'building' });
    expect(after?.state).toBe('failed');
  });

  it('a stored file is retired at the end of its retention', async () => {
    const job = await startOk();
    w.script.exit = 0;
    w.script.output = 'android/app/build/outputs/apk/debug/app-debug.apk';
    w.script.signStdout = '::nbai-inspect::{"applicationId":"com.tea.timer","signingType":"debug"}';
    const done = (await runner.advanceNativeBuild(job.id, w.deps as any)) as NativeBuildJob;
    expect((await runner.expireIfDue(done, w.deps as any)).state).toBe('completed');
    w.tick(31 * 86_400_000);
    expect((await runner.expireIfDue(done, w.deps as any)).state).toBe('expired');
    expect(w.stored.size).toBe(0);
  });
});

describe('pure helpers', () => {
  it('versionCode only grows and stays under Play\'s ceiling', () => {
    const a = runner.nativeVersionCode(new Date('2026-11-25T00:00:00Z'));
    expect(runner.nativeVersionCode(new Date('2026-11-25T00:01:00Z'))).toBe(a + 1);
    expect(runner.nativeVersionCode(new Date('2100-01-01T00:00:00Z'))).toBeLessThan(2_100_000_000);
  });

  it('a project path can never escape the build folder', () => {
    for (const ok of ['index.html', 'android/app/build.gradle', 'www/assets/a.png']) expect(runner.isSafeProjectPath(ok)).toBe(true);
    for (const bad of ['/etc/passwd', '../x', 'a/../../b', 'a//b', '', 'a\\b', './a']) expect(runner.isSafeProjectPath(bad)).toBe(false);
  });

  it('markers are read strictly', () => {
    const m = runner.readMarkers('::nbai-step::2::9::Build the web app\n::nbai-output::android/app/build/outputs/apk/debug/app-debug.apk\n::nbai-exit::0\n::nbai-output::/etc/passwd');
    expect(m).toEqual({ step: { index: 2, count: 9, name: 'Build the web app' }, failed: null, output: 'android/app/build/outputs/apk/debug/app-debug.apk', exitCode: 0 });
    expect(runner.readMarkers('::nbai-exit::').exitCode).toBeNull();
  });

  it('keystores are decoded strictly and size-capped', () => {
    expect(runner.decodeKeystore(Buffer.from('abc').toString('base64'))?.toString()).toBe('abc');
    expect(runner.decodeKeystore('not base64 !!')).toBeNull();
    expect(runner.decodeKeystore(Buffer.alloc(70 * 1024).toString('base64'))).toBeNull();
    expect(runner.decodeKeystore(42)).toBeNull();
  });

  it('logs lose credentials and private keys', () => {
    expect(runner.sanitizeLogLine('key AIzaSyA1234567890abcdefghijklmnopqrstuv end')).toBe('key [redacted] end');
    expect(runner.sanitizeLogLine('-----BEGIN RSA PRIVATE KEY-----MIIE')).toBe('[redacted private key]');
    const block = `ok line\n-----BEGIN PRIVATE KEY-----\n${'A'.repeat(64)}\n${'B'.repeat(64)}\n-----END PRIVATE KEY-----\nafter`;
    const lines = runner.sanitizeLog(block);
    expect(lines.join('\n')).not.toContain('AAAA');
    expect(lines).toEqual(['ok line', '[redacted private key]', 'after']);
    expect(runner.sanitizeLogLine('\u001b[31mred\u001b[0m')).toBe('red');
  });
});

describe('upload keys', () => {
  it('an existing key is never silently replaced; replace is explicit and audited', async () => {
    const k = { keystore: Buffer.from('A'), storePassword: 'p', keyPassword: 'p', alias: 'upload', certSha256: CERT, source: 'imported' as const };
    expect((await store.saveKey('user-a', 'com.x.y', k, { replace: false })).ok).toBe(true);
    expect(await store.saveKey('user-a', 'com.x.y', { ...k, certSha256: OTHER_CERT }, { replace: false })).toEqual({ ok: false, reason: 'exists' });
    expect((await store.getKeyRecord('user-a', 'com.x.y'))?.certSha256).toBe(CERT);
    expect((await store.saveKey('user-a', 'com.x.y', { ...k, certSha256: OTHER_CERT }, { replace: true })).ok).toBe(true);
    expect(db.rows(store.KEY_EVENTS).map((e) => e.event)).toEqual(['imported', 'replaced']);
  });

  it('one user can never open another user\'s key', async () => {
    await store.saveKey('user-a', 'com.x.y', { keystore: Buffer.from('A'), storePassword: 'p', keyPassword: 'p', alias: 'upload', certSha256: CERT, source: 'imported' }, { replace: false });
    expect(await store.getKeyRecord('user-b', 'com.x.y')).toBeNull();
    expect(await store.openKeyForSigning('user-b', 'com.x.y', 'nb_x')).toBeNull();
    expect(await store.deleteKey('user-b', 'com.x.y')).toBe(false);
    expect(await store.deleteKey('user-a', 'com.x.y')).toBe(true);
    expect(await store.getKeyRecord('user-a', 'com.x.y')).toBeNull();
  });
});
