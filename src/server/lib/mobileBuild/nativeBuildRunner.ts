// The Native Cloud Build, end to end (2026-11-25).
//
// 🔒 STATELESS BY DESIGN — WHY THERE IS NO IN-PROCESS BUILD LOOP. The live service runs with
// `--min-instances 0` and does not pin CPU outside requests, so a build "driven" by a background promise
// in the server could be frozen or lose its instance at any moment. Instead:
//   • the build script runs DETACHED inside its own E2B machine and writes its log and exit code to files;
//   • the job row in Firestore is the only state; every step is a transition of that row;
//   • `advanceNativeBuild` moves a job one step forward, from ANY instance, under a short lease so two
//     instances never drive one build — it is called by every status request and by a sweeper;
//   • a server restart therefore loses nothing: the next status request reattaches by sandbox id.
//
// The order of trust is fixed: PREPARE (shared with the GitHub provider) → BUILD in an untrusted machine →
// SIGN + VALIDATE in a fresh, network-less machine → STORE privately → only then COMPLETED → only then CHARGE.
// A build is never reported complete before its validated file is retrievable, and a failed, cancelled or
// expired build is never charged.

import { loadAppFilesForShip, prepareMobileProject } from './prepareMobileProject';
import { planFromWorkflow, renderNativeBuildScript } from './workflowScript';
import { SIGN_DIR, SIGN_SCRIPT, inspectionMismatch, isSafeAlias, parseSignOutput } from './nativeSigning';
import { e2bWorkerFactory, type WorkerSandbox, type WorkerSandboxFactory } from './workerSandbox';
import { gcsArtifactStore, artifactObjectPath, sha256Hex, type ArtifactStore } from './nativeArtifactStore';
import {
  createJobIfAbsent, getJob, getKeyRecord, listActiveJobs, listJobsForUser, nativeBuildId, openKeyForSigning, tryLease, updateJob,
} from './nativeBuildStore';
import { nativeBuildTemplate, nativeLimits, nativeMissing } from './providerRegistry';
import { ACTIVE_STATES, isTerminalState, type MobileArtifactKind, type NativeBuildJob } from './types';
import { chargeMobileBuild, mobileBuildBillingExempt, type ChargeIdentity } from '../mobileBuildCharge';
import { capacitorMajorFromFiles } from '../mobileProjectAssembler';
import { toolchainForMajor } from '../capacitorToolchain';
import { classifyBuildFailure } from '../mobileBuildRepair';
import { normalizeRepairTier } from '../mobileBuildAiRepair';
import { SHIP_WORKFLOWS, workflowPath } from '../../../lib/shipWorkflows';

export const APP_DIR = '/home/user/app';
export const RUN_DIR = '/home/user/nbai-run';
/** Where each JDK lives in the worker image (infra/e2b/e2b-android-native.Dockerfile). */
export const JAVA_HOME_FOR: Record<number, string> = { 17: '/opt/java/jdk17', 21: '/opt/java/jdk21' };

const LEASE_MS = 3 * 60_000;
/** A job whose driver has not touched it for this long, while active, has lost its driver. */
const STALE_PREPARE_MS = 12 * 60_000;
const MAX_ARTIFACT_BYTES = 300 * 1024 * 1024;
const SIGN_TIMEOUT_MS = 4 * 60_000;
const LOG_TAIL_LINES = 300;
/** How many times the trusted stage (sign → validate → store) may be attempted for one compiled build. */
const MAX_FINISH_ATTEMPTS = 3;

export interface RunnerDeps {
  sandboxes: WorkerSandboxFactory;
  artifacts: ArtifactStore;
  charge: typeof chargeMobileBuild;
  now: () => Date;
}

export const defaultRunnerDeps: RunnerDeps = {
  sandboxes: e2bWorkerFactory,
  artifacts: gcsArtifactStore,
  charge: chargeMobileBuild,
  now: () => new Date(),
};

// ── Small pure helpers (exported for the tests) ───────────────────────────────────────────────────

/**
 * Play rejects a re-used versionCode. Minutes since the epoch only ever grows, needs no counter, and is
 * already far above any GitHub run number — so switching providers can never go BACKWARDS. PURE.
 */
export function nativeVersionCode(now: Date): number {
  return Math.floor(now.getTime() / 60_000);
}

/** No ANSI, no over-long lines, and nothing that looks like a credential reaches a stored log. PURE. */
export function sanitizeLogLine(line: string): string {
  return line
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,})/g, '[redacted]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g, '[redacted private key]')
    .slice(0, 400);
}

export function sanitizeLog(text: string, maxLines = LOG_TAIL_LINES): string[] {
  return text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '').slice(-maxLines).map(sanitizeLogLine);
}

/** Read the worker's progress markers. PURE. */
export function readMarkers(text: string): {
  step: { index: number; count: number; name: string } | null;
  failed: string | null;
  output: string | null;
  exitCode: number | null;
} {
  let step: { index: number; count: number; name: string } | null = null;
  let failed: string | null = null;
  let output: string | null = null;
  let exitCode: number | null = null;
  for (const line of text.split('\n')) {
    const s = /^::nbai-step::(\d{1,3})::(\d{1,3})::(.{1,120})$/.exec(line.trim());
    if (s) step = { index: Number(s[1]), count: Number(s[2]), name: s[3] };
    const f = /^::nbai-failed::[^:]{1,10}::(.{1,300})$/.exec(line.trim());
    if (f) failed = f[1];
    const o = /^::nbai-output::(android\/app\/build\/outputs\/[A-Za-z0-9/._-]{1,200})$/.exec(line.trim());
    if (o) output = o[1];
    const e = /^::nbai-exit::(\d{1,3})$/.exec(line.trim());
    if (e) exitCode = Number(e[1]);
  }
  return { step, failed, output, exitCode };
}

/** A project file path we will write into the build machine: relative, no `..`, no absolute path. PURE. */
export function isSafeProjectPath(p: string): boolean {
  return typeof p === 'string' && p.length > 0 && p.length <= 400 && !p.startsWith('/') && !p.includes('\\')
    && !p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
}

function iso(d: Date): string { return d.toISOString(); }

function fileNameFor(job: NativeBuildJob): string {
  const slug = job.appName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'app';
  return job.kind === 'aab' ? `${slug}-${job.versionCode}-release.aab` : `${slug}-debug.apk`;
}

async function failJob(id: string, code: string, message: string, extra: Partial<NativeBuildJob> = {}, deps: RunnerDeps = defaultRunnerDeps): Promise<NativeBuildJob | null> {
  const job = await getJob(id);
  if (job?.buildSandboxId) await deps.sandboxes.killById(job.buildSandboxId);
  if (job?.signSandboxId) await deps.sandboxes.killById(job.signSandboxId);
  return updateJob(id, {
    state: 'failed', errorCode: code, errorMessage: message, finishedAt: iso(deps.now()), leaseUntil: null, ...extra,
  });
}

// ── Starting a build ──────────────────────────────────────────────────────────────────────────────

export interface StartInput {
  identity: ChargeIdentity;
  sessionId: string;
  workspaceId: string;
  kind: MobileArtifactKind;
  appName: string;
  appId: string;
  iconDataUrl?: string;
  backgroundColor?: string;
  powerLevel?: string;
  idempotencyKey: string;
}

export type StartResult =
  | { ok: true; job: NativeBuildJob; created: boolean }
  | { ok: false; status: number; body: Record<string, unknown>; job?: NativeBuildJob };

/**
 * Validate, record, prepare and launch one build. Takes as long as preparation takes (the same work the
 * GitHub provider's setup request does), then returns with the build machine already compiling.
 * Idempotent on (user, idempotencyKey): a replay returns the existing build and starts nothing.
 */
export async function startNativeBuild(input: StartInput, deps: RunnerDeps = defaultRunnerDeps): Promise<StartResult> {
  const uid = input.identity.uid;
  const id = nativeBuildId(uid, input.idempotencyKey);
  const existing = await getJob(id);
  if (existing) {
    if (existing.userId !== uid) return { ok: false, status: 409, body: { error: 'That build request id is already in use.', code: 'id-conflict' } };
    return { ok: true, job: existing, created: false };
  }

  const missing = nativeMissing(input.kind);
  const template = nativeBuildTemplate();
  if (missing.length > 0 || !template) {
    return { ok: false, status: 503, body: { error: 'Native Cloud Build is not available right now. Use the GitHub option instead.', code: 'provider-unavailable' } };
  }

  const limits = nativeLimits();
  const mine = (await listJobsForUser(uid, 100)).filter((j) => (ACTIVE_STATES as readonly string[]).includes(j.state));
  if (mine.length >= limits.perUser) {
    return { ok: false, status: 429, body: { error: 'You already have a build running. Wait for it to finish, or stop it, before starting another.', code: 'build-in-progress' } };
  }
  if ((await listActiveJobs()).length >= limits.system) {
    return { ok: false, status: 429, body: { error: 'Native Cloud Build is busy right now. Please try again in a few minutes — nothing was charged.', code: 'capacity' } };
  }

  // A Play bundle must be signed with the app's OWN upload key. Never invented here: if NavBharatAI does
  // not hold one for this app, the user decides (import their existing key, or create one for a new app).
  let certSha256: string | null = null;
  if (input.kind === 'aab') {
    const key = await getKeyRecord(uid, input.appId);
    if (!key) {
      return {
        ok: false,
        status: 409,
        body: {
          error: 'A Play Store bundle must be signed with this app’s upload key. Add your existing key, or create one if this app has never been uploaded to Google Play.',
          code: 'signing-key-required',
        },
      };
    }
    certSha256 = key.certSha256;
  }

  const now = deps.now();
  const versionCode = nativeVersionCode(now);
  const plan0Path = input.kind === 'apk' ? 'android/app/build/outputs/apk/debug/app-debug.apk' : 'android/app/build/outputs/bundle/release/app-release.aab';
  const job: NativeBuildJob = {
    id, userId: uid, workspaceId: input.workspaceId, sessionId: input.sessionId, provider: 'native_cloud',
    kind: input.kind, appName: input.appName, appId: input.appId, versionCode,
    state: 'preparing', step: 'Preparing your app', stepIndex: null, stepCount: null,
    createdAt: iso(now), startedAt: null, finishedAt: null, heartbeatAt: iso(now),
    cancelRequested: false, attempt: 1, errorCode: null, errorMessage: null, failedStep: null,
    buildSandboxId: null, signSandboxId: null, toolchain: template, signingKeyId: certSha256 ? 'present' : null,
    artifact: null, billingRef: null, billingExempt: mobileBuildBillingExempt(input.identity),
    logTail: [], leaseUntil: null, outputPath: plan0Path,
  };
  const { job: stored, created } = await createJobIfAbsent(job);
  if (!created) return { ok: true, job: stored, created: false };

  try {
    // ── PREPARE — the same code the GitHub provider's setup runs. ──
    const loaded = await loadAppFilesForShip(input.workspaceId);
    if (!loaded.ok) {
      const failed = await failJob(id, 'PREPARE_REFUSED', String(loaded.body.error ?? 'The app could not be prepared.'), {}, deps);
      return { ok: false, status: loaded.status, body: { ...loaded.body, buildId: id }, job: failed ?? undefined };
    }
    const prepared = await prepareMobileProject({
      workspaceId: input.workspaceId,
      appFiles: loaded.files,
      appName: input.appName,
      appId: input.appId,
      iconDataUrl: input.iconDataUrl,
      backgroundColor: input.backgroundColor,
      ios: false,
      repairTier: normalizeRepairTier(input.powerLevel),
    });
    if (!prepared.ok) {
      const failed = await failJob(id, 'PREPARE_REFUSED', String(prepared.body.error ?? 'The app could not be prepared.'), {}, deps);
      return { ok: false, status: prepared.status, body: { ...prepared.body, buildId: id }, job: failed ?? undefined };
    }
    if ((await getJob(id))?.cancelRequested) {
      const c = await updateJob(id, { state: 'cancelled', errorCode: 'CANCELLED', errorMessage: 'You stopped this build.', finishedAt: iso(deps.now()) });
      return { ok: true, job: c ?? stored, created: true };
    }

    // ── PLAN — this app's own workflow, translated (workflowScript.ts). ──
    const { project } = prepared;
    const wfPath = workflowPath(input.kind === 'apk' ? SHIP_WORKFLOWS.androidApk : SHIP_WORKFLOWS.androidAab);
    const yaml = project.files[wfPath];
    if (!yaml) throw new Error(`the prepared project has no ${wfPath}`);
    const plan = planFromWorkflow(yaml, input.kind, { versionCode });
    const java = toolchainForMajor(capacitorMajorFromFiles(project.files)).java;
    const javaHome = JAVA_HOME_FOR[java];
    if (!javaHome) throw new Error(`no JDK ${java} in the build image`);
    const script = renderNativeBuildScript(plan, { projectDir: APP_DIR, javaHome });

    const files: Array<{ path: string; data: string | ArrayBuffer }> = [];
    for (const [p, text] of Object.entries(project.files)) {
      if (!isSafeProjectPath(p)) throw new Error(`unsafe project path ${JSON.stringify(p)}`);
      files.push({ path: `${APP_DIR}/${p}`, data: text });
    }
    for (const [p, b64] of Object.entries(project.binaryFiles)) {
      if (!isSafeProjectPath(p)) throw new Error(`unsafe project path ${JSON.stringify(p)}`);
      const buf = Buffer.from(b64, 'base64');
      files.push({ path: `${APP_DIR}/${p}`, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
    }
    files.push({ path: `${RUN_DIR}/build.sh`, data: script });

    // ── BUILD — an untrusted, disposable machine (workerSandbox.ts). One retry, for the machine only. ──
    const lifetimeMs = limits.buildTimeoutMs + 20 * 60_000;
    let sandbox: WorkerSandbox;
    try {
      sandbox = await deps.sandboxes.create('build', { template, lifetimeMs, buildId: id });
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
      sandbox = await deps.sandboxes.create('build', { template, lifetimeMs, buildId: id });
    }
    await updateJob(id, { buildSandboxId: sandbox.id, heartbeatAt: iso(deps.now()) });
    await sandbox.writeFiles(files);
    const secs = Math.floor(limits.buildTimeoutMs / 1000);
    await sandbox.start(
      `setsid nohup bash -c 'timeout ${secs} bash ${RUN_DIR}/build.sh > ${RUN_DIR}/log 2>&1; echo $? > ${RUN_DIR}/exit.tmp; mv ${RUN_DIR}/exit.tmp ${RUN_DIR}/exit' >/dev/null 2>&1 &`,
    );
    const building = await updateJob(id, {
      state: 'building', step: 'Starting the build machine', startedAt: iso(deps.now()), heartbeatAt: iso(deps.now()),
      outputPath: plan.outputPath,
    });
    return { ok: true, job: building ?? stored, created: true };
  } catch (err) {
    const failed = await failJob(id, 'START_FAILED', 'The build machine could not be started. Nothing was charged — please try again.', {
      logTail: [sanitizeLogLine(err instanceof Error ? err.message : String(err))],
    }, deps);
    return { ok: false, status: 502, body: { error: 'The build machine could not be started. Nothing was charged — please try again.', code: 'start-failed', buildId: id }, job: failed ?? undefined };
  }
}

// ── Advancing a build ─────────────────────────────────────────────────────────────────────────────

/** Take the job's lease, or return null when another instance holds it (or the job is finished). */
async function takeLease(id: string, deps: RunnerDeps): Promise<NativeBuildJob | null> {
  return tryLease(id, deps.now().getTime(), LEASE_MS);
}

/**
 * Move one build forward by at most one stage. Safe to call from any instance, as often as wanted:
 * a status request calls it, the sweeper calls it. Returns the job as it now stands.
 */
export async function advanceNativeBuild(id: string, deps: RunnerDeps = defaultRunnerDeps): Promise<NativeBuildJob | null> {
  const job = await takeLease(id, deps);
  if (!job) return getJob(id);
  try {
    if (job.state === 'preparing' || job.state === 'queued') {
      // The starting request is still preparing; only a driver that vanished long ago is a failure.
      const since = Date.parse(job.heartbeatAt ?? job.createdAt);
      if (deps.now().getTime() - since > STALE_PREPARE_MS) {
        return failJob(id, 'WORKER_LOST', 'The build stopped while your app was being prepared. Nothing was charged — please start it again.', {}, deps);
      }
      return updateJob(id, { leaseUntil: null });
    }
    if (!job.buildSandboxId) {
      return failJob(id, 'WORKER_LOST', 'The build machine was never started. Nothing was charged — please start it again.', {}, deps);
    }
    if (job.cancelRequested) {
      await deps.sandboxes.killById(job.buildSandboxId);
      if (job.signSandboxId) await deps.sandboxes.killById(job.signSandboxId);
      return updateJob(id, { state: 'cancelled', errorCode: 'CANCELLED', errorMessage: 'You stopped this build. Nothing was charged.', finishedAt: iso(deps.now()), leaseUntil: null });
    }
    const sb = await deps.sandboxes.connect(job.buildSandboxId);
    if (!sb) {
      return failJob(id, 'WORKER_LOST', 'The build machine stopped before the build finished. Nothing was charged — please start it again.', {}, deps);
    }
    const probe = await sb.run(`sh -c "grep -a '^::nbai-' ${RUN_DIR}/log 2>/dev/null | tail -n 80; printf '::nbai-exit::'; cat ${RUN_DIR}/exit 2>/dev/null || true"`, { timeoutMs: 30_000 });
    const m = readMarkers(probe.stdout);
    const stepPatch: Partial<NativeBuildJob> = m.step ? { step: m.step.name, stepIndex: m.step.index, stepCount: m.step.count } : {};

    if (m.exitCode === null) {
      const started = Date.parse(job.startedAt ?? job.createdAt);
      if (deps.now().getTime() - started > nativeLimits().buildTimeoutMs + 2 * 60_000) {
        return failJob(id, 'TIMEOUT', 'The build took longer than the time limit and was stopped. Nothing was charged.', stepPatch, deps);
      }
      return updateJob(id, { ...stepPatch, heartbeatAt: iso(deps.now()), leaseUntil: null });
    }

    const logText = (await sb.run(`tail -n ${LOG_TAIL_LINES} ${RUN_DIR}/log`, { timeoutMs: 30_000 })).stdout;
    const logTail = sanitizeLog(logText);
    if (m.exitCode !== 0) {
      // The failing step's own section, read by the same classifier the GitHub lane's repair uses.
      const lastStep = logText.lastIndexOf('::nbai-step::');
      const section = lastStep >= 0 ? logText.slice(lastStep) : logText;
      const diag = classifyBuildFailure(section, workflowPath(job.kind === 'apk' ? SHIP_WORKFLOWS.androidApk : SHIP_WORKFLOWS.androidAab));
      const timedOut = m.exitCode === 124;
      return failJob(id, timedOut ? 'TIMEOUT' : 'BUILD_FAILED',
        timedOut ? 'The build took longer than the time limit and was stopped. Nothing was charged.' : `${diag.summary} Nothing was charged.`,
        { ...stepPatch, failedStep: m.failed ?? m.step?.name ?? null, logTail }, deps);
    }

    // ── The compile succeeded: collect the file, then the trusted stage. ──
    const outputPath = m.output ?? job.outputPath;
    if (outputPath !== job.outputPath) {
      return failJob(id, 'UNEXPECTED_OUTPUT', 'The build produced a different file than expected, so it was not delivered. Nothing was charged.', { logTail }, deps);
    }
    // The build machine is kept until the file is STORED: a transient failure in the trusted stage then
    // retries from the same compiled output instead of losing the build. Bounded, so it cannot loop.
    if (job.attempt > MAX_FINISH_ATTEMPTS) {
      return failJob(id, 'FINISH_FAILED', 'Your app compiled, but signing or saving the file kept failing. Nothing was charged — please try again.', { logTail }, deps);
    }
    const unsigned = Buffer.from(await sb.readBytes(`${APP_DIR}/${outputPath}`));
    if (unsigned.length === 0 || unsigned.length > MAX_ARTIFACT_BYTES) {
      return failJob(id, 'UNEXPECTED_OUTPUT', 'The built file was empty or too large to deliver. Nothing was charged.', { logTail }, deps);
    }
    await updateJob(id, {
      ...stepPatch, logTail, attempt: job.attempt + 1, heartbeatAt: iso(deps.now()),
      state: job.kind === 'aab' ? 'signing' : 'validating', step: job.kind === 'aab' ? 'Signing your bundle' : 'Checking your app file',
    });
    const done = await finishBuild(id, unsigned, deps);
    if (done && isTerminalState(done.state)) await sb.kill();
    return done;
  } catch (err) {
    // A transient failure to REACH a machine is not a build failure: release the lease and let the next
    // poll try again. The timeout, stale-driver and attempt limits above still end a build that cannot finish.
    console.warn('[native-build] advance deferred', id, sanitizeLogLine(err instanceof Error ? err.message : String(err)));
    await updateJob(id, { leaseUntil: null }).catch(() => null);
    return getJob(id);
  }
}

/** Sign (AAB) and validate (both) in a fresh network-less machine, store privately, complete, then charge. */
async function finishBuild(id: string, built: Buffer, deps: RunnerDeps): Promise<NativeBuildJob | null> {
  const job = await getJob(id);
  if (!job) return null;
  const template = nativeBuildTemplate();
  if (!template) return failJob(id, 'PROVIDER_DISABLED', 'Native Cloud Build was switched off during this build. Nothing was charged.', {}, deps);

  let key = null as Awaited<ReturnType<typeof openKeyForSigning>>;
  if (job.kind === 'aab') {
    key = await openKeyForSigning(job.userId, job.appId, job.id);
    if (!key || !isSafeAlias(key.alias)) {
      return failJob(id, 'SIGNING_KEY_MISSING', 'This app’s upload key is no longer saved, so the bundle could not be signed. Nothing was charged.', {}, deps);
    }
  }

  let signer: WorkerSandbox | null = null;
  let finalBytes: Buffer;
  let inspection;
  try {
    signer = await deps.sandboxes.create('sign', { template, lifetimeMs: SIGN_TIMEOUT_MS + 60_000, buildId: id });
    await updateJob(id, { signSandboxId: signer.id });
    const files: Array<{ path: string; data: string | ArrayBuffer }> = [
      { path: `${SIGN_DIR}/sign.sh`, data: SIGN_SCRIPT },
      { path: `${SIGN_DIR}/in.bin`, data: built.buffer.slice(built.byteOffset, built.byteOffset + built.byteLength) },
    ];
    if (key) {
      files.push(
        { path: `${SIGN_DIR}/ks`, data: key.keystore.buffer.slice(key.keystore.byteOffset, key.keystore.byteOffset + key.keystore.byteLength) },
        { path: `${SIGN_DIR}/storepass`, data: key.storePassword },
        { path: `${SIGN_DIR}/keypass`, data: key.keyPassword },
      );
    }
    await signer.writeFiles(files);
    const r = await signer.run(`bash ${SIGN_DIR}/sign.sh ${job.kind} sign ${key ? key.alias : ''}`, { timeoutMs: SIGN_TIMEOUT_MS });
    const parsed = parseSignOutput(r.stdout);
    if (!parsed.ok) {
      return failJob(id, job.kind === 'aab' ? 'SIGNING_FAILED' : 'VALIDATION_FAILED', `${parsed.error.detail}. Nothing was charged.`, {}, deps);
    }
    inspection = parsed.inspection;
    finalBytes = job.kind === 'aab' ? Buffer.from(await signer.readBytes(`${SIGN_DIR}/out.bin`)) : built;
  } finally {
    if (signer) await signer.kill();
  }

  const mismatch = inspectionMismatch(job.kind, inspection, {
    appId: job.appId,
    versionCode: job.kind === 'aab' ? job.versionCode : null,
    certSha256: key?.certSha256 ?? null,
  });
  if (mismatch) return failJob(id, 'VALIDATION_FAILED', `${mismatch} The file was not delivered and nothing was charged.`, {}, deps);

  // ── STORE — private, verified, before anything says "ready". ──
  await updateJob(id, { state: 'uploading', step: 'Saving your file', heartbeatAt: iso(deps.now()) });
  const fileName = fileNameFor(job);
  const objectPath = artifactObjectPath(job.userId, job.id, fileName);
  const stored = await deps.artifacts.put(objectPath, finalBytes, job.kind);
  if (stored.sizeBytes !== finalBytes.length || !stored.md5Ok) {
    await deps.artifacts.remove(objectPath);
    return failJob(id, 'STORAGE_FAILED', 'The file could not be saved safely. Nothing was charged — please try again.', {}, deps);
  }
  const now = deps.now();
  const completed = await updateJob(id, {
    state: 'completed', step: 'Ready to download', finishedAt: iso(now), leaseUntil: null, signSandboxId: null,
    artifact: {
      objectPath, fileName, sizeBytes: finalBytes.length, sha256: sha256Hex(finalBytes), inspection,
      expiresAt: iso(new Date(now.getTime() + nativeLimits().retentionDays * 86_400_000)),
    },
  });

  // ── CHARGE — only now, for a file that exists, once (idempotent on the build id). ──
  if (completed?.state === 'completed' && !completed.billingExempt) {
    const ref = `native_${id}`;
    await deps.charge(completed.userId, ref, fileName);
    return updateJob(id, { billingRef: ref }).then((j) => j ?? completed);
  }
  return completed;
}

/** Retire a finished build whose retention has passed: the file is deleted and the row says so. */
export async function expireIfDue(job: NativeBuildJob, deps: RunnerDeps = defaultRunnerDeps): Promise<NativeBuildJob> {
  if (job.state !== 'completed' || !job.artifact || Date.parse(job.artifact.expiresAt) > deps.now().getTime()) return job;
  await deps.artifacts.remove(job.artifact.objectPath);
  return (await updateJob(job.id, { state: 'expired', step: 'This file has expired' })) ?? job;
}

// ── The sweeper: advances active builds while an instance is alive ────────────────────────────────

let sweeper: ReturnType<typeof setInterval> | null = null;

export function startNativeBuildSweeper(deps: RunnerDeps = defaultRunnerDeps, everyMs = 45_000): void {
  if (sweeper || process.env.VITEST) return;
  sweeper = setInterval(() => {
    if (nativeMissing(null).length > 0) return;
    void (async () => {
      try {
        for (const j of await listActiveJobs()) await advanceNativeBuild(j.id, deps).catch(() => null);
      } catch { /* the next tick tries again */ }
    })();
  }, everyMs);
  sweeper.unref?.();
}

// ── Upload keys: import (verified by a real keytool) and create (only for a never-published app) ──

const MAX_KEYSTORE_BYTES = 64 * 1024;

export type KeyResult =
  | { ok: true; certSha256: string; alias: string }
  | { ok: false; status: number; body: Record<string, unknown> };

/** Strict base64 → bytes, refusing anything that is not exactly base64 or is too large. PURE. */
export function decodeKeystore(b64: unknown): Buffer | null {
  if (typeof b64 !== 'string') return null;
  const clean = b64.replace(/\s+/g, '');
  if (clean.length === 0 || clean.length > Math.ceil(MAX_KEYSTORE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
  const buf = Buffer.from(clean, 'base64');
  return buf.length > 0 && buf.length <= MAX_KEYSTORE_BYTES ? buf : null;
}

/**
 * Open the user's own keystore with a real JDK `keytool`, in a fresh machine with no network that runs
 * nothing else, and read its certificate fingerprint. Nothing is saved unless this succeeds.
 */
export async function verifyKeystoreInSandbox(
  keystore: Buffer, storePassword: string, keyPassword: string, alias: string, deps: RunnerDeps = defaultRunnerDeps,
): Promise<{ ok: true; certSha256: string } | { ok: false; code: string; detail: string }> {
  const template = nativeBuildTemplate();
  if (!template) return { ok: false, code: 'PROVIDER_UNAVAILABLE', detail: 'Native Cloud Build is not available right now' };
  const sb = await deps.sandboxes.create('sign', { template, lifetimeMs: 3 * 60_000, buildId: 'key-verify' });
  try {
    await sb.writeFiles([
      { path: `${SIGN_DIR}/sign.sh`, data: SIGN_SCRIPT },
      { path: `${SIGN_DIR}/ks`, data: keystore.buffer.slice(keystore.byteOffset, keystore.byteOffset + keystore.byteLength) },
      { path: `${SIGN_DIR}/storepass`, data: storePassword },
      { path: `${SIGN_DIR}/keypass`, data: keyPassword },
    ]);
    const r = await sb.run(`bash ${SIGN_DIR}/sign.sh aab verify-key ${alias}`, { timeoutMs: 90_000 });
    const parsed = parseSignOutput(r.stdout);
    if (!parsed.ok) return { ok: false, code: parsed.error.code, detail: parsed.error.detail };
    if (!parsed.inspection.certSha256) return { ok: false, code: 'KEYSTORE_READ', detail: 'The key\'s certificate could not be read' };
    return { ok: true, certSha256: parsed.inspection.certSha256 };
  } finally {
    await sb.kill();
  }
}
