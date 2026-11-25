// The disposable machines a Native Cloud Build runs on (2026-11-25).
//
// 🔒 TRUST BOUNDARIES — the reason this module exists as its own seam:
//   • The API server NEVER executes a user project. It only writes files into a sandbox and reads one
//     file back. The user's npm packages, build scripts and Gradle plugins run inside an E2B microVM
//     created for ONE build and killed after it.
//   • BUILD sandbox  — untrusted. Gets the app's files and nothing else: no platform credential, no env
//     var, no signing key. Egress is restricted to the package and Android dependency hosts.
//   • SIGN sandbox   — trusted. A FRESH machine with NO network that runs only our fixed signing script
//     on an already-built file. No app code ever runs in it (an .aab is a zip; jarsigner does not execute
//     its contents), so the upload key is never in a machine that ran a user's build script.
// Every machine has a hard lifetime (E2B's own `timeoutMs`), so a crashed server cannot leave one billing.

import { Sandbox, ALL_TRAFFIC } from 'e2b';

export interface RunResult { exitCode: number; stdout: string; stderr: string }

export interface WorkerSandbox {
  readonly id: string;
  writeFiles(files: Array<{ path: string; data: string | ArrayBuffer }>): Promise<void>;
  run(cmd: string, opts: { timeoutMs: number; onStdout?: (chunk: string) => void; onStderr?: (chunk: string) => void; cwd?: string }): Promise<RunResult>;
  readBytes(path: string): Promise<Uint8Array>;
  kill(): Promise<void>;
}

export interface WorkerSandboxFactory {
  create(role: 'build' | 'sign', opts: { template: string; lifetimeMs: number; buildId: string }): Promise<WorkerSandbox>;
  killById(id: string): Promise<void>;
}

/**
 * The only hosts a native build may reach: npm for the app's libraries, Google's and Maven Central's
 * repositories for Android and Gradle dependencies, and Gradle's own distribution hosts (whose downloads
 * redirect to GitHub's release storage). Everything else — the platform's own API, cloud metadata, other
 * tenants — is denied. An app whose build needs another host fails with that host's error in its log.
 */
export const BUILD_EGRESS_HOSTS: readonly string[] = [
  'registry.npmjs.org',
  'dl.google.com',
  'maven.google.com',
  'repo.maven.apache.org',
  'repo1.maven.org',
  'plugins.gradle.org',
  'plugins-artifacts.gradle.org',
  'services.gradle.org',
  'downloads.gradle.org',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
];

/** The non-root user E2B runs commands as. */
const SANDBOX_USER = 'user';

function e2bApiKey(): string {
  const k = (process.env.E2B_API_KEY ?? '').trim();
  if (!k) throw new Error('E2B_API_KEY is not configured');
  return k;
}

class E2BWorker implements WorkerSandbox {
  constructor(private readonly sb: Sandbox) {}
  get id(): string { return this.sb.sandboxId; }
  async writeFiles(files: Array<{ path: string; data: string | ArrayBuffer }>): Promise<void> {
    // Batched so a large app is a handful of requests, not thousands.
    for (let i = 0; i < files.length; i += 200) {
      await this.sb.files.write(files.slice(i, i + 200), { user: SANDBOX_USER });
    }
  }
  async run(cmd: string, opts: { timeoutMs: number; onStdout?: (c: string) => void; onStderr?: (c: string) => void; cwd?: string }): Promise<RunResult> {
    try {
      const r = await this.sb.commands.run(cmd, {
        timeoutMs: opts.timeoutMs,
        user: SANDBOX_USER,
        envs: {},
        cwd: opts.cwd,
        onStdout: opts.onStdout,
        onStderr: opts.onStderr,
      });
      return { exitCode: r.exitCode, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    } catch (err) {
      // The SDK throws CommandExitError for a non-zero exit; it still carries the result.
      const e = err as { exitCode?: number; stdout?: string; stderr?: string; message?: string };
      if (typeof e.exitCode === 'number') return { exitCode: e.exitCode, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
      throw err;
    }
  }
  async readBytes(path: string): Promise<Uint8Array> {
    return this.sb.files.read(path, { format: 'bytes', user: SANDBOX_USER });
  }
  async kill(): Promise<void> {
    await this.sb.kill().catch(() => {});
  }
}

export const e2bWorkerFactory: WorkerSandboxFactory = {
  async create(role, { template, lifetimeMs, buildId }) {
    const sb = await Sandbox.create(template, {
      apiKey: e2bApiKey(),
      timeoutMs: lifetimeMs,
      // Nothing from the platform's own environment is passed in — not one variable.
      envs: {},
      secure: true,
      metadata: { purpose: `mobile-native-${role}`, buildId },
      ...(role === 'sign'
        ? { allowInternetAccess: false }
        : { network: { allowOut: [...BUILD_EGRESS_HOSTS], denyOut: [ALL_TRAFFIC] } }),
    });
    return new E2BWorker(sb);
  },
  async killById(id) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return;
    await Sandbox.kill(id, { apiKey: e2bApiKey() }).catch(() => false);
  },
};
