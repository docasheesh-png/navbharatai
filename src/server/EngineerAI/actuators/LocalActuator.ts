import { exec } from 'child_process';
import path from 'path';
import util from 'util';
import { WorkspaceManager } from '../../AppMakerLab/WorkspaceManager';
import { ScaffoldGenerator } from '../../AppMakerLab/generator/ScaffoldGenerator';
import { IEngineerActuator } from './IEngineerActuator';

const execPromise = util.promisify(exec);
const NAMESPACE = 'engineer';
const WORKSPACES_ROOT = `/workspaces/${NAMESPACE}`;

// Max time for a single bash command (60 s) and for build (3 min)
const CMD_TIMEOUT_MS = 60_000;
const BUILD_TIMEOUT_MS = 3 * 60_000;
const MAX_BUFFER = 10 * 1024 * 1024;

// Directories never included in file listings so node_modules/dist don't
// flood the AI prompt or make listFiles unbearably slow.
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', '__pycache__', '.venv']);

/**
 * Process-level actuator (Cloud Run / local dev).
 * bash commands are run inside the workspace dir with a hard timeout.
 * PATH traversal outside the workspace is not explicitly blocked at the
 * OS level, but the AI is instructed to stay inside its workspace root.
 * For stricter isolation upgrade to E2BActuator (set E2B_API_KEY).
 */
export class LocalActuator implements IEngineerActuator {
  private workspaceManager = new WorkspaceManager(NAMESPACE);

  async ensureWorkspace(workspaceId: string, projectType?: string): Promise<void> {
    const info = await this.workspaceManager.getWorkspaceInfo(workspaceId).catch(() => null);
    if (info && info.files.length > 0) return;

    await this.workspaceManager.createWorkspace(workspaceId);
    const framework: 'vite-react' = 'vite-react';
    const scaffolder = new ScaffoldGenerator(this.workspaceManager);
    await scaffolder.generate({ framework, language: 'typescript', features: [], workspaceId });
  }

  writeFile(workspaceId: string, filePath: string, content: string): Promise<void> {
    return this.workspaceManager.writeFile(workspaceId, filePath, content);
  }

  readFile(workspaceId: string, filePath: string): Promise<string> {
    return this.workspaceManager.readFile(workspaceId, filePath);
  }

  async listFiles(workspaceId: string): Promise<string[]> {
    const all = await this.workspaceManager.listFiles(workspaceId);
    // Strip node_modules, dist, etc. so they never appear in the AI prompt.
    return all.filter(f => {
      const firstSegment = f.split('/')[0];
      return !IGNORED_DIRS.has(firstSegment);
    });
  }

  async build(workspaceId: string): Promise<{ success: boolean; logs: string }> {
    const workspacePath = path.join(WORKSPACES_ROOT, workspaceId);
    const opts = { cwd: workspacePath, timeout: BUILD_TIMEOUT_MS, maxBuffer: MAX_BUFFER };
    try {
      const install = await execPromise('npm install', opts);
      const build = await execPromise('npm run build', opts);
      return { success: true, logs: install.stdout + install.stderr + build.stdout + build.stderr };
    } catch (err: any) {
      return { success: false, logs: `${err.stdout || ''}${err.stderr || ''}${err.message || String(err)}` };
    }
  }

  async runCommand(workspaceId: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const workspacePath = path.join(WORKSPACES_ROOT, workspaceId);
    try {
      const { stdout, stderr } = await execPromise(command, {
        cwd: workspacePath,
        timeout: CMD_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
      });
      return { exitCode: 0, stdout, stderr };
    } catch (err: any) {
      // exec rejects on non-zero exit OR timeout; normalise to a result object
      return {
        exitCode: typeof err.code === 'number' ? err.code : 1,
        stdout: err.stdout || '',
        stderr: err.stderr || err.message || String(err),
      };
    }
  }

  async browseUrl(): Promise<{ html: string }> {
    throw new Error(
      'URL browsing requires a real sandbox (set E2B_API_KEY). LocalActuator cannot run Playwright.'
    );
  }

  async getPortUrl(_workspaceId: string, port: number): Promise<string> {
    return `http://localhost:${port}`;
  }
}
