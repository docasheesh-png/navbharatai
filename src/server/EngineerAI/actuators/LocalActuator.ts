import { exec } from 'child_process';
import path from 'path';
import util from 'util';
import { WorkspaceManager } from '../../AppMakerLab/WorkspaceManager';
import { ScaffoldGenerator } from '../../AppMakerLab/generator/ScaffoldGenerator';
import { IEngineerActuator } from './IEngineerActuator';

const execPromise = util.promisify(exec);
const NAMESPACE = 'engineer';
const WORKSPACES_ROOT = `/workspaces/${NAMESPACE}`;

/**
 * Process-level actuator — no real sandbox isolation.
 * Shell execution (runCommand / browseUrl) is intentionally rejected here:
 * it would run as the same OS user as the server. Swap to E2BActuator for
 * those capabilities.
 */
export class LocalActuator implements IEngineerActuator {
  private workspaceManager = new WorkspaceManager(NAMESPACE);

  async ensureWorkspace(workspaceId: string, projectType?: string): Promise<void> {
    const info = await this.workspaceManager.getWorkspaceInfo(workspaceId).catch(() => null);
    if (info && info.files.length > 0) return;

    await this.workspaceManager.createWorkspace(workspaceId);
    // Stack detection: if 'node' or 'python' are requested we still fall back to
    // vite-react since those scaffolders aren't implemented yet — the model can
    // reshape via bash once a real sandbox is available.
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

  listFiles(workspaceId: string): Promise<string[]> {
    return this.workspaceManager.listFiles(workspaceId);
  }

  async build(workspaceId: string): Promise<{ success: boolean; logs: string }> {
    const workspacePath = path.join(WORKSPACES_ROOT, workspaceId);
    try {
      const install = await execPromise('npm install', { cwd: workspacePath });
      const build = await execPromise('npm run build', { cwd: workspacePath });
      return { success: true, logs: install.stdout + install.stderr + build.stdout + build.stderr };
    } catch (err: any) {
      return { success: false, logs: `${err.stdout || ''}${err.stderr || ''}${err.message || String(err)}` };
    }
  }

  async runCommand(): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    throw new Error(
      'Shell command execution requires a real sandbox (set E2B_API_KEY) — not available in the ' +
      'process-level LocalActuator, since it runs in the same OS process/user as the server.'
    );
  }

  async browseUrl(): Promise<{ html: string }> {
    throw new Error(
      'URL browsing requires a real sandbox (set E2B_API_KEY) — not available in LocalActuator.'
    );
  }
}
