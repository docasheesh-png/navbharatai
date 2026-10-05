// Forensic audit 2026-10-04 — a user's code never runs inside the NavBharatAI server process outside
// development, and when it runs on a developer's machine it never sees the server's secrets.
//
// `POST /api/preview` (unauthenticated) routed any package.json naming express/next/... to the
// 'server-container' runtime, which wrote the caller's files to disk and ran `npm install` IN THE
// PRODUCTION SERVER with `env: process.env`. A `preinstall` script was therefore arbitrary code with every
// Cloud Run secret. LocalActuator had a guard; this sibling door never got it. These tests close the door
// at each layer and a census keeps a new spawn site from reopening it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { ServerContainerRuntime } from '../src/server/runtime/ServerContainerRuntime';
import { PreviewService } from '../src/server/runtime/PreviewService';
import { SandboxManager } from '../src/server/PreviewRunner/SandboxManager';
import { WorkspaceLauncher } from '../src/server/PreviewRunner/WorkspaceLauncher';
import { assertHostExecAllowed, hostChildEnv, HOST_EXEC_REFUSED_CODE } from '../src/server/lib/actuatorGuard';

afterEach(() => { vi.unstubAllEnvs(); });

/** Production as Cloud Run runs it: NODE_ENV=production and no test runner marker. */
function asProduction() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VITEST', '');
  vi.stubEnv('ALLOW_LOCAL_ACTUATOR', '');
}

const expressApp = () => VirtualFileSystem.fromRecord({
  'package.json': JSON.stringify({ dependencies: { express: '4' }, scripts: { preinstall: 'node -e "process.exit(0)"', dev: 'node server.js' } }),
  'server.js': "require('express')().listen(process.env.PORT)",
});

describe('the guard itself', () => {
  it('refuses in production, with a code a caller can recognise', () => {
    expect(() => assertHostExecAllowed('x', { NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(expect.objectContaining({ code: HOST_EXEC_REFUSED_CODE }));
    expect(() => assertHostExecAllowed('x', { NODE_ENV: 'staging' } as NodeJS.ProcessEnv)).toThrow();
    expect(() => assertHostExecAllowed('x', { NODE_ENV: 'development' } as NodeJS.ProcessEnv)).not.toThrow();
  });
});

describe('the preview service never starts a host install in production', () => {
  it('an app with a server gets an honest not-available answer, and the runtime is never called', async () => {
    const start = vi.fn();
    const svc = new PreviewService({ serverRuntime: { target: 'server-container', start, stop: vi.fn(), status: vi.fn() } as never, hostExecAllowed: () => false });
    const r = await svc.startPreview('p', expressApp());
    expect(r.ok).toBe(false);
    expect(r.target).toBe('server-container');
    expect(r.reason).toBeTruthy();
    expect(start).not.toHaveBeenCalled();
  });

  it('the default decision reads the real guard (production refuses)', async () => {
    asProduction();
    const start = vi.fn();
    const svc = new PreviewService({ serverRuntime: { target: 'server-container', start, stop: vi.fn(), status: vi.fn() } as never });
    expect((await svc.startPreview('p', expressApp())).ok).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });
});

describe('the runtime door refuses by itself, before a file is written', () => {
  it('ServerContainerRuntime.start in production: nothing materialised, nothing installed', async () => {
    asProduction();
    const materialize = vi.fn(() => ({ dir: '/tmp/never', fileCount: 1 }));
    const installer = vi.fn(async () => {});
    const rt = new ServerContainerRuntime({ materialize, installer });
    await expect(rt.start('p', expressApp())).rejects.toMatchObject({ code: HOST_EXEC_REFUSED_CODE });
    expect(materialize).not.toHaveBeenCalled();
    expect(installer).not.toHaveBeenCalled();
  });

  it('SandboxManager.launch in production refuses to spawn', () => {
    asProduction();
    expect(() => new SandboxManager().launch('/tmp', 'node', ['-e', '0'], {}, 64)).toThrow(expect.objectContaining({ code: HOST_EXEC_REFUSED_CODE }));
  });
});

describe('even in development the user\'s app gets no secrets and no install scripts', () => {
  it('the child environment is an allowlist', () => {
    const env = hostChildEnv({ PORT: '3000' }, { PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'sk-ant-x', CASHFREE_SECRET_KEY: 'c', SECRET_ENCRYPTION_KEY: 'k', NODE_ENV: 'production' } as NodeJS.ProcessEnv);
    expect(env).toEqual({ NODE_ENV: 'development', PATH: '/bin', HOME: '/h', PORT: '3000' });
  });

  it('dependencies install with lifecycle scripts off, for every package manager', () => {
    const l = new WorkspaceLauncher();
    for (const pm of ['npm', 'pnpm', 'yarn']) expect(l.installDependencies('/x', pm)[1]).toContain('--ignore-scripts');
  });
});

/** Every source file under the two directories that start user apps on the host. */
function hostRunnerSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (/\.ts$/.test(name) && !/\.test\./.test(name)) out.push(p);
    }
  };
  walk('src/server/runtime');
  walk('src/server/PreviewRunner');
  return out;
}

describe('census: every host spawn site is guarded and env-scrubbed', () => {
  it('a file that spawns a process calls the guard and never hands over process.env', () => {
    const offenders: string[] = [];
    for (const f of hostRunnerSources()) {
      const src = readFileSync(f, 'utf8');
      // A file that can start a process imports child_process (RegExp#exec is not a process).
      if (!/from\s+['"](?:node:)?child_process['"]|require\(\s*['"](?:node:)?child_process['"]\s*\)/.test(src)) continue;
      if (!/assertHostExecAllowed\(/.test(src)) offenders.push(`${f}: spawns without assertHostExecAllowed`);
      if (/env\s*:\s*process\.env\b|\.\.\.process\.env\b/.test(src)) offenders.push(`${f}: passes process.env to a child`);
    }
    expect(offenders).toEqual([]);
  });
});
