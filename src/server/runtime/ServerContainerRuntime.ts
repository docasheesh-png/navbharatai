/**
 * Phase 3 — Server-container runtime (the 'server-container' target).
 *
 * Runs a real Node/Vite/Next/Express app: materialize the VFS to disk → install
 * deps → launch its dev server on an allocated port → health-check → expose the
 * URL. Locally this spawns a child process; in production the SAME flow runs
 * inside a Cloud Run / Docker container (the container just wraps these steps).
 *
 * Collaborators are injected (real implementations by default) so the
 * orchestration is unit-testable without actually spawning npm.
 */
import { spawn } from 'child_process';
import type { PreviewRuntime, RuntimeTarget } from './RuntimeRouter';
import { VirtualFileSystem } from '../project/ProjectModel';
import { materializeWorkspace, cleanupWorkspace } from './WorkspaceMaterializer';
import { WorkspaceLauncher } from '../PreviewRunner/WorkspaceLauncher';
import { SandboxManager } from '../PreviewRunner/SandboxManager';
import { PortManager } from '../PreviewRunner/PortManager';
import { PreviewHealthChecker, HealthStatus } from '../PreviewRunner/PreviewHealthChecker';

type RunStatus = 'starting' | 'ready' | 'stopped' | 'error';

interface ServerSession {
  dir: string;
  port: number;
  status: RunStatus;
}

/** Install dependencies, resolving when the install process exits 0 (rejects otherwise). */
export type Installer = (dir: string, cmd: string, args: string[]) => Promise<void>;

const defaultInstaller: Installer = (dir, cmd, args) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: dir, env: process.env });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });

export interface ServerContainerDeps {
  launcher?: WorkspaceLauncher;
  sandbox?: SandboxManager;
  portManager?: PortManager;
  healthChecker?: PreviewHealthChecker;
  installer?: Installer;
  /** Override how a VFS becomes an on-disk dir (tests inject a fake). */
  materialize?: (vfs: VirtualFileSystem) => { dir: string; fileCount: number };
  /** Base URL host for the preview (default localhost). */
  host?: string;
}

export class ServerContainerRuntime implements PreviewRuntime {
  readonly target: RuntimeTarget = 'server-container';
  private sessions = new Map<string, ServerSession>();

  private launcher: WorkspaceLauncher;
  private sandbox: SandboxManager;
  private portManager: PortManager;
  private healthChecker: PreviewHealthChecker;
  private installer: Installer;
  private materialize: (vfs: VirtualFileSystem) => { dir: string; fileCount: number };
  private host: string;

  constructor(deps: ServerContainerDeps = {}) {
    this.launcher = deps.launcher ?? new WorkspaceLauncher();
    this.sandbox = deps.sandbox ?? new SandboxManager();
    this.portManager = deps.portManager ?? new PortManager();
    this.healthChecker = deps.healthChecker ?? new PreviewHealthChecker();
    this.installer = deps.installer ?? defaultInstaller;
    this.materialize = deps.materialize ?? ((vfs) => materializeWorkspace(vfs));
    this.host = deps.host ?? 'localhost';
  }

  async start(projectId: string, vfs: VirtualFileSystem): Promise<{ url: string; sessionId: string }> {
    const sessionId = `${projectId}-${Date.now().toString(36)}`;
    const { dir } = this.materialize(vfs);
    const port = await this.portManager.allocatePort();
    this.sessions.set(sessionId, { dir, port, status: 'starting' });

    try {
      const pm = await this.launcher.detectPackageManager(dir);
      const [installCmd, installArgs] = this.launcher.installDependencies(dir, pm);
      await this.installer(dir, installCmd, installArgs);

      const [startCmd, startArgs] = this.launcher.getStartCommand(dir, pm);
      this.sandbox.launch(dir, startCmd, startArgs, { PORT: String(port) }, 1024);

      const url = `http://${this.host}:${port}`;
      const health = await this.healthChecker.check(url);
      const session = this.sessions.get(sessionId)!;
      session.status = health === HealthStatus.HEALTHY ? 'ready' : 'error';
      return { url, sessionId };
    } catch (err) {
      const s = this.sessions.get(sessionId);
      if (s) s.status = 'error';
      await this.stop(sessionId);
      throw err;
    }
  }

  async stop(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    try { this.sandbox.terminate(s.dir); } catch { /* ignore */ }
    this.portManager.releasePort(s.port);
    cleanupWorkspace(s.dir);
    s.status = 'stopped';
    this.sessions.delete(sessionId);
  }

  async status(sessionId: string): Promise<RunStatus> {
    return this.sessions.get(sessionId)?.status ?? 'stopped';
  }

  /**
   * Internal origin (host:port) a reverse proxy should forward to for this
   * session. Returns null if the session is unknown/stopped. Used by the
   * preview proxy route so clients reach the dev server without exposing
   * the raw internal port.
   */
  getTarget(sessionId: string): { host: string; port: number; origin: string } | null {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    return { host: this.host, port: s.port, origin: `http://${this.host}:${s.port}` };
  }
}
