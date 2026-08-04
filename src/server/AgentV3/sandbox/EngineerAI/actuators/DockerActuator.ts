import Docker from 'dockerode';
import { PassThrough } from 'stream';
import { promises as fsPromises, createWriteStream } from 'fs';
import path from 'path';
import os from 'os';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { IEngineerActuator, BackendProvisionResult } from './IEngineerActuator';
import { toWorkspaceRelPath } from '../../../../lib/workspacePath';

const exec = promisify(execCb);

const WORKSPACE_DIR = '/workspace';

/**
 * Sanitize an agent-supplied path before it is interpolated into a shell command. Delegates to the
 * shared normalizer (also accepts an absolute in-workspace path — the doubled-path root cause), then
 * ADDITIONALLY rejects shell metacharacters so the path can neither escape the workspace nor break
 * out of the command. Legitimate code-file paths are unaffected.
 */
function safeRelPath(filePath: string): string {
  const cleaned = toWorkspaceRelPath(filePath, WORKSPACE_DIR);
  if (/[`$"'\\;|&<>(){}\n\r*?]/.test(cleaned)) {
    throw new Error(`Unsafe characters in path: ${JSON.stringify(filePath)}`);
  }
  return cleaned;
}

/** Reject identifiers that are not safe to interpolate into a shell command. */
function assertSafeId(id: string, label: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(String(id ?? ''))) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(id)}`);
  }
  return id;
}
const IMAGE = 'node:20-slim';
const CMD_TIMEOUT_MS = 120_000;
const BUILD_TIMEOUT_MS = 5 * 60_000;
const CKPT_DIR_INSIDE = '/workspace/.e-checkpoints';
const MAX_LIST_FILES = 500;

const IGNORED_DIRS = [
  'node_modules', '.git', 'dist', '.next', 'build',
  '__pycache__', '.venv', '.cache', 'coverage', 'out', '.e-checkpoints',
];

/**
 * Docker-based actuator for Engineer AI.
 * Uses a dedicated container per workspace — persistent, free (no per-hour billing).
 * Activated via DOCKER_ENABLED=true env var when E2B_API_KEY is not set.
 *
 * Limitations vs E2BActuator:
 * - screenshot(), browserAction(), browseUrl() are NOT supported (headless containers).
 * - provisionBackend() is NOT supported (node:20-slim has no DB services).
 * For projects requiring browser testing or DB provisioning, use E2B (set E2B_API_KEY).
 */
export class DockerActuator implements IEngineerActuator {
  private docker = new Docker();
  private containers = new Map<string, Docker.Container>();

  private containerName(workspaceId: string): string {
    return `engineer-ws-${workspaceId.replace(/[^a-zA-Z0-9_.-]/g, '-')}`;
  }

  private async getOrStartContainer(workspaceId: string): Promise<Docker.Container> {
    // Fast path: cached and still running
    const cached = this.containers.get(workspaceId);
    if (cached) {
      try {
        const info = await cached.inspect();
        if (info.State.Running) return cached;
        await cached.start();
        return cached;
      } catch {
        this.containers.delete(workspaceId);
      }
    }

    const name = this.containerName(workspaceId);

    // Try to reconnect to existing container
    try {
      const container = this.docker.getContainer(name);
      const info = await container.inspect();
      if (!info.State.Running) await container.start();
      this.containers.set(workspaceId, container);
      return container;
    } catch (e: any) {
      if (e.statusCode !== 404) throw e;
    }

    // Create a fresh container
    const container = await this.docker.createContainer({
      name,
      Image: IMAGE,
      Cmd: ['sleep', 'infinity'],
      WorkingDir: WORKSPACE_DIR,
      HostConfig: { NetworkMode: 'host' },
    });
    await container.start();
    await this.execInContainer(container, `mkdir -p "${WORKSPACE_DIR}" "${CKPT_DIR_INSIDE}"`);
    this.containers.set(workspaceId, container);
    return container;
  }

  /** Run a bash command inside the container and return exit code + output. */
  private execInContainer(
    container: Docker.Container,
    command: string,
    timeoutMs = CMD_TIMEOUT_MS,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      container
        .exec({
          Cmd: ['bash', '-c', command],
          AttachStdout: true,
          AttachStderr: true,
          WorkingDir: WORKSPACE_DIR,
        })
        .then((dockerExec) => {
          const timer = setTimeout(
            () => resolve({ exitCode: 124, stdout: '', stderr: 'Command timed out' }),
            timeoutMs,
          );

          dockerExec.start({ hijack: true, stdin: false }, (startErr, stream) => {
            if (startErr || !stream) {
              clearTimeout(timer);
              resolve({ exitCode: 1, stdout: '', stderr: startErr?.message ?? 'exec start failed' });
              return;
            }

            const outChunks: Buffer[] = [];
            const errChunks: Buffer[] = [];
            const outStream = new PassThrough();
            const errStream = new PassThrough();
            outStream.on('data', (c: Buffer) => outChunks.push(c));
            errStream.on('data', (c: Buffer) => errChunks.push(c));
            container.modem.demuxStream(stream, outStream, errStream);

            stream.on('end', async () => {
              clearTimeout(timer);
              const info = await dockerExec.inspect().catch(() => ({ ExitCode: 0 }));
              resolve({
                exitCode: (info as Docker.ExecInspectInfo).ExitCode ?? 0,
                stdout: Buffer.concat(outChunks).toString(),
                stderr: Buffer.concat(errChunks).toString(),
              });
            });

            stream.on('error', (streamErr) => {
              clearTimeout(timer);
              resolve({ exitCode: 1, stdout: '', stderr: streamErr.message });
            });
          });
        })
        .catch((err) => resolve({ exitCode: 1, stdout: '', stderr: String(err) }));
    });
  }

  /** Write a file into the container by piping content through cat via stdin. */
  private writeViaStdin(
    container: Docker.Container,
    destPath: string,
    content: Buffer,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const dir = path.posix.dirname(destPath);
      container
        .exec({
          Cmd: ['bash', '-c', `mkdir -p "${dir}" && cat > "${destPath}"`],
          AttachStdin: true,
          AttachStdout: false,
          AttachStderr: true,
        })
        .then((dockerExec) => {
          dockerExec.start({ hijack: true, stdin: true }, (startErr, stream) => {
            if (startErr || !stream) {
              reject(startErr ?? new Error('exec start failed'));
              return;
            }

            const errChunks: Buffer[] = [];
            const outStream = new PassThrough();
            const errStream = new PassThrough();
            errStream.on('data', (c: Buffer) => errChunks.push(c));
            container.modem.demuxStream(stream, outStream, errStream);

            stream.write(content);
            stream.end();

            stream.on('end', async () => {
              const info = await dockerExec.inspect().catch(() => ({ ExitCode: 0 }));
              const code = (info as Docker.ExecInspectInfo).ExitCode ?? 0;
              if (code !== 0) {
                reject(new Error(`writeFile failed (exit ${code}): ${Buffer.concat(errChunks).toString()}`));
              } else {
                resolve();
              }
            });

            stream.on('error', reject);
          });
        })
        .catch(reject);
    });
  }

  // ── IEngineerActuator ──────────────────────────────────────────────────────

  async ensureWorkspace(workspaceId: string, _projectType?: string, _resumeSandboxId?: string): Promise<void> {
    await this.getOrStartContainer(workspaceId);
  }

  async writeFile(workspaceId: string, filePath: string, content: string): Promise<void> {
    const container = await this.getOrStartContainer(workspaceId);
    await this.writeViaStdin(container, `${WORKSPACE_DIR}/${safeRelPath(filePath)}`, Buffer.from(content, 'utf8'));
  }

  async writeBinaryFile(workspaceId: string, filePath: string, base64: string): Promise<void> {
    const container = await this.getOrStartContainer(workspaceId);
    await this.writeViaStdin(container, `${WORKSPACE_DIR}/${safeRelPath(filePath)}`, Buffer.from(base64, 'base64'));
  }

  async readFile(workspaceId: string, filePath: string): Promise<string> {
    const container = await this.getOrStartContainer(workspaceId);
    const result = await this.execInContainer(container, `cat "${WORKSPACE_DIR}/${safeRelPath(filePath)}"`);
    if (result.exitCode !== 0) {
      throw new Error(`readFile failed: ${result.stderr || 'file not found'}`);
    }
    return result.stdout;
  }

  async listFiles(workspaceId: string): Promise<string[]> {
    const container = await this.getOrStartContainer(workspaceId);
    const prune = IGNORED_DIRS.map(d => `-name "${d}" -prune`).join(' -o ');
    const result = await this.execInContainer(
      container,
      `find "${WORKSPACE_DIR}" \\( ${prune} \\) -o -type f -print 2>/dev/null | head -${MAX_LIST_FILES} | sed "s|${WORKSPACE_DIR}/||"`,
    );
    return result.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  async build(workspaceId: string): Promise<{ success: boolean; logs: string }> {
    const container = await this.getOrStartContainer(workspaceId);

    // Python
    const pyCheck = await this.execInContainer(container, `[ -f "${WORKSPACE_DIR}/main.py" ] && echo yes || echo no`);
    if (pyCheck.stdout.trim() === 'yes') {
      const r = await this.execInContainer(
        container,
        `cd "${WORKSPACE_DIR}" && ([ -f requirements.txt ] && pip install -r requirements.txt -q || true) && python3 -m py_compile main.py`,
        BUILD_TIMEOUT_MS,
      );
      return { success: r.exitCode === 0, logs: r.stdout + r.stderr };
    }

    // Static (no package.json)
    const pkgCheck = await this.execInContainer(container, `[ -f "${WORKSPACE_DIR}/package.json" ] && echo yes || echo no`);
    if (pkgCheck.stdout.trim() !== 'yes') {
      return { success: true, logs: '(no build step — static project)' };
    }

    // Node/npm
    const install = await this.execInContainer(
      container,
      `cd "${WORKSPACE_DIR}" && npm install`,
      BUILD_TIMEOUT_MS,
    );
    if (install.exitCode !== 0) return { success: false, logs: install.stdout + install.stderr };
    const build = await this.execInContainer(
      container,
      `cd "${WORKSPACE_DIR}" && npm run build`,
      BUILD_TIMEOUT_MS,
    );
    return { success: build.exitCode === 0, logs: install.stdout + build.stdout + build.stderr };
  }

  async runCommand(workspaceId: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const container = await this.getOrStartContainer(workspaceId);
    return this.execInContainer(container, `cd "${WORKSPACE_DIR}" && ${command}`);
  }

  async browseUrl(_workspaceId: string, _url: string): Promise<{ html: string }> {
    throw new Error(
      'URL browsing requires E2B sandbox (set E2B_API_KEY). DockerActuator containers are headless.',
    );
  }

  async getPortUrl(_workspaceId: string, port: number): Promise<string> {
    return `http://localhost:${port}`;
  }

  async screenshot(
    _workspaceId: string,
    _url: string,
    _viewport?: { width: number; height: number },
  ): Promise<{ base64: string; mimeType: 'image/png' }> {
    throw new Error(
      'Screenshots require E2B sandbox (set E2B_API_KEY). DockerActuator containers have no browser.',
    );
  }

  async browserAction(
    _workspaceId: string,
    _action: 'click' | 'type' | 'navigate' | 'scroll' | 'press' | 'wait' | 'hover' | 'double_click' | 'select_option',
    _args: { selector?: string; text?: string; url?: string; direction?: 'up' | 'down' },
  ): Promise<{ screenshot: string; result: string; cursorX?: number; cursorY?: number }> {
    throw new Error(
      'Browser interaction requires E2B sandbox (set E2B_API_KEY). DockerActuator containers have no browser.',
    );
  }

  async getConsoleErrors(
    _workspaceId: string,
    _sinceMs: number,
  ): Promise<{ errors: { t: number; kind: string; text: string }[]; captured: boolean }> {
    // Docker actuator has no browser console capture — captured:false so an empty result reads as "runtime
    // unchecked", not a false "runtime clean".
    return { errors: [], captured: false };
  }

  async getSandboxId(workspaceId: string): Promise<string | null> {
    return this.containerName(workspaceId);
  }

  async pauseSandbox(sandboxId: string): Promise<boolean> {
    try {
      const container = this.docker.getContainer(sandboxId);
      await container.stop({ t: 5 });
      for (const [wid, c] of this.containers.entries()) {
        const info = await c.inspect().catch(() => null);
        if (info?.Name === `/${sandboxId}`) this.containers.delete(wid);
      }
      return true;
    } catch {
      return false;
    }
  }

  async searchFiles(workspaceId: string, terms: string[]): Promise<string[]> {
    if (terms.length === 0) return [];
    const container = await this.getOrStartContainer(workspaceId);
    const termArgs = terms
      .slice(0, 8)
      .map((t) => `-e ${JSON.stringify(t)}`)
      .join(' ');
    const result = await this.execInContainer(
      container,
      `grep -rl ${termArgs} \
        --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
        --include="*.py" --include="*.css" --include="*.json" --include="*.html" \
        --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
        --exclude-dir=.next --exclude-dir=build --exclude-dir=__pycache__ \
        "${WORKSPACE_DIR}" 2>/dev/null | head -40 | sed "s|${WORKSPACE_DIR}/||"`,
      10_000,
    );
    return result.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  async checkpoint(workspaceId: string, _triggeredBy = 'manual'): Promise<string> {
    const container = await this.getOrStartContainer(workspaceId);
    const id = `ckpt_${Date.now()}`;
    await this.execInContainer(
      container,
      `mkdir -p "${CKPT_DIR_INSIDE}" && tar --exclude=./node_modules --exclude=./dist --exclude=./.git --exclude=./.next --exclude=./.e-checkpoints -czf "${CKPT_DIR_INSIDE}/${id}.tar.gz" -C "${WORKSPACE_DIR}" . 2>/dev/null || true`,
      30_000,
    );
    return id;
  }

  async restore(workspaceId: string, checkpointId: string): Promise<void> {
    const container = await this.getOrStartContainer(workspaceId);
    assertSafeId(checkpointId, 'checkpointId');
    const result = await this.execInContainer(
      container,
      `[ -f "${CKPT_DIR_INSIDE}/${checkpointId}.tar.gz" ] && tar -xzf "${CKPT_DIR_INSIDE}/${checkpointId}.tar.gz" -C "${WORKSPACE_DIR}" --overwrite`,
      30_000,
    );
    if (result.exitCode !== 0) {
      throw new Error(`Checkpoint ${checkpointId} not found or restore failed.`);
    }
  }

  async downloadDistFiles(workspaceId: string): Promise<Map<string, Buffer>> {
    const container = await this.getOrStartContainer(workspaceId);
    const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'engineer-dist-'));
    try {
      const tarPath = path.join(tmpDir, 'dist.tar');
      const extractDir = path.join(tmpDir, 'extracted');
      await fsPromises.mkdir(extractDir, { recursive: true });

      // Stream the dist folder as a tar archive from the container
      const archive = await container.getArchive({ path: `${WORKSPACE_DIR}/dist` });
      await new Promise<void>((resolve, reject) => {
        const ws = createWriteStream(tarPath);
        (archive as NodeJS.ReadableStream).pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
      });

      await exec(`tar -xf "${tarPath}" -C "${extractDir}"`);

      const files = new Map<string, Buffer>();
      const distExtracted = path.join(extractDir, 'dist');

      const walk = async (dir: string, prefix: string): Promise<void> => {
        const entries = await fsPromises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            await walk(full, rel);
          } else {
            files.set(rel, await fsPromises.readFile(full));
          }
        }
      };

      // The archive from getArchive contains 'dist/' as the root dir
      try {
        await walk(distExtracted, '');
      } catch {
        await walk(extractDir, '');
      }

      return files;
    } finally {
      await fsPromises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async provisionBackend(
    _workspaceId: string,
    _features: ('db' | 'auth' | 'storage')[],
  ): Promise<BackendProvisionResult> {
    throw new Error(
      'Backend provisioning (PostgreSQL) requires E2B sandbox (set E2B_API_KEY). DockerActuator uses node:20-slim which has no database services.',
    );
  }
}
