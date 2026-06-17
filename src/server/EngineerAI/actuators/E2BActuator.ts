import { Sandbox } from 'e2b';
import { TemplateRegistry } from '../../AppMakerLab/generator/templates/TemplateRegistry';
import { IEngineerActuator } from './IEngineerActuator';

const WORKSPACE_ROOT = '/home/user/workspace';
const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Phase 2 actuator: each workspaceId gets its own real e2b.dev cloud sandbox
 * (separate VM, real OS-level isolation). Requires E2B_API_KEY.
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

  async ensureWorkspace(workspaceId: string, projectType?: string): Promise<void> {
    const sandbox = await this.getSandbox(workspaceId);
    const exists = await sandbox.files.exists(WORKSPACE_ROOT);
    if (exists) return;

    await sandbox.files.makeDir(WORKSPACE_ROOT);

    // Stack detection: if workspace has specific markers, skip vite-react scaffold.
    // For now only vite-react is available — other types can be set up via bash commands.
    if (!projectType || projectType === 'vite-react' || projectType === 'auto') {
      const files = this.templateRegistry.getProvider('vite-react').getFiles([]);
      await sandbox.files.writeFiles(
        Object.entries(files).map(([p, content]) => ({ path: `${WORKSPACE_ROOT}/${p}`, data: content }))
      );
    }
    // 'node' / 'python': leave workspace empty — the model scaffolds via bash
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

  async runCommand(workspaceId: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const sandbox = await this.getSandbox(workspaceId);
    try {
      const result = await sandbox.commands.run(command, {
        cwd: WORKSPACE_ROOT,
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    } catch (err: any) {
      return { exitCode: -1, stdout: err.stdout || '', stderr: err.stderr || err.message || String(err) };
    }
  }

  async browseUrl(workspaceId: string, url: string): Promise<{ html: string }> {
    const sandbox = await this.getSandbox(workspaceId);
    // Try Playwright if installed (for JS-rendered pages), fall back to curl.
    const playwrightScript = `node -e "
const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
  const p=await b.newPage();
  await p.goto(${JSON.stringify(url)},{waitUntil:'networkidle',timeout:15000}).catch(()=>{});
  console.log((await p.content()).slice(0,30000));
  await b.close();
})().catch(e=>{process.stderr.write(e.message);process.exit(1)});
" 2>/dev/null`;
    const pw = await sandbox.commands.run(playwrightScript, {
      cwd: WORKSPACE_ROOT, timeoutMs: 25_000,
    });
    if (pw.exitCode === 0 && pw.stdout.trim()) return { html: pw.stdout };

    // Playwright not available — fall back to curl
    const result = await sandbox.commands.run(
      `curl -s -L --max-time 20 -A "Mozilla/5.0" "${url}" 2>/dev/null | head -c 30000`,
      { cwd: WORKSPACE_ROOT, timeoutMs: 30_000 }
    );
    return { html: result.stdout || result.stderr };
  }

  async getPortUrl(workspaceId: string, port: number): Promise<string> {
    const sandbox = await this.getSandbox(workspaceId);
    return `https://${sandbox.getHost(port)}`;
  }
}
