import { Sandbox } from 'e2b';
import { TemplateRegistry } from '../../AppMakerLab/generator/templates/TemplateRegistry';
import { IEngineerActuator } from './IEngineerActuator';

const WORKSPACE_ROOT = '/home/user/workspace';
const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Phase 2 actuator: each workspaceId gets its own real e2b.dev cloud sandbox
 * (separate VM, real OS-level isolation) instead of sharing the server's own
 * process/filesystem like LocalActuator does. Requires E2B_API_KEY.
 */
export class E2BActuator implements IEngineerActuator {
  private sandboxes = new Map<string, Sandbox>();
  private templateRegistry = new TemplateRegistry();

  private async getSandbox(workspaceId: string): Promise<Sandbox> {
    const existing = this.sandboxes.get(workspaceId);
    if (existing) return existing;

    const sandbox = await Sandbox.create({ timeoutMs: SANDBOX_TIMEOUT_MS });
    this.sandboxes.set(workspaceId, sandbox);
    return sandbox;
  }

  async ensureWorkspace(workspaceId: string): Promise<void> {
    const sandbox = await this.getSandbox(workspaceId);
    const exists = await sandbox.files.exists(WORKSPACE_ROOT);
    if (exists) return;

    await sandbox.files.makeDir(WORKSPACE_ROOT);
    const files = this.templateRegistry.getProvider('vite-react').getFiles([]);
    await sandbox.files.writeFiles(
      Object.entries(files).map(([path, content]) => ({ path: `${WORKSPACE_ROOT}/${path}`, data: content }))
    );
  }

  async writeFile(workspaceId: string, filePath: string, content: string): Promise<void> {
    const sandbox = await this.getSandbox(workspaceId);
    await sandbox.files.write(`${WORKSPACE_ROOT}/${filePath}`, content);
  }

  async readFile(workspaceId: string, filePath: string): Promise<string> {
    const sandbox = await this.getSandbox(workspaceId);
    return sandbox.files.read(`${WORKSPACE_ROOT}/${filePath}`);
  }

  async listFiles(workspaceId: string): Promise<string[]> {
    const sandbox = await this.getSandbox(workspaceId);
    const entries = await sandbox.files.list(WORKSPACE_ROOT, { depth: 10 });
    return entries
      .filter(e => e.type === 'file')
      .map(e => e.path.slice(WORKSPACE_ROOT.length + 1));
  }

  async build(workspaceId: string): Promise<{ success: boolean; logs: string }> {
    const sandbox = await this.getSandbox(workspaceId);
    try {
      const install = await sandbox.commands.run('npm install', {
        cwd: WORKSPACE_ROOT,
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
      const build = await sandbox.commands.run('npm run build', {
        cwd: WORKSPACE_ROOT,
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
      return {
        success: build.exitCode === 0,
        logs: install.stdout + install.stderr + build.stdout + build.stderr,
      };
    } catch (err: any) {
      return { success: false, logs: `${err.stdout || ''}${err.stderr || ''}${err.message || String(err)}` };
    }
  }
}
