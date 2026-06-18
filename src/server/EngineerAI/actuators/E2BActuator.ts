import { Sandbox } from 'e2b';
import { TemplateRegistry } from '../../AppMakerLab/generator/templates/TemplateRegistry';
import { IEngineerActuator } from './IEngineerActuator';

const WORKSPACE_ROOT = '/home/user/workspace';
// Dedicated tools dir outside the user's workspace — persists across workspace resets
const TOOLS_DIR = '/home/user/.e-tools';
const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

const SCREENSHOT_SCRIPT = `
const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
  const p=await b.newPage();
  await p.setViewportSize({width:1280,height:720});
  const url=process.argv[2]||'about:blank';
  await p.goto(url,{waitUntil:'networkidle',timeout:15000}).catch(()=>{});
  await new Promise(r=>setTimeout(r,800));
  const buf=await p.screenshot({type:'png',fullPage:false});
  process.stdout.write(buf.toString('base64'));
  await b.close();
})().catch(e=>{process.stderr.write(String(e));process.exit(1)});
`.trim();

/**
 * Phase 2 actuator: each workspaceId gets its own real e2b.dev cloud sandbox
 * (separate VM, real OS-level isolation). Requires E2B_API_KEY.
 */
export class E2BActuator implements IEngineerActuator {
  private sandboxes = new Map<string, Sandbox>();
  private templateRegistry = new TemplateRegistry();
  // Tracks per-sandbox playwright install progress
  private _playwrightReady = new Map<string, Promise<boolean>>();

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

    if (!projectType || projectType === 'vite-react' || projectType === 'auto') {
      const files = this.templateRegistry.getProvider('vite-react').getFiles([]);
      await sandbox.files.writeFiles(
        Object.entries(files).map(([p, content]) => ({ path: `${WORKSPACE_ROOT}/${p}`, data: content }))
      );
    }

    // Kick off playwright install in background immediately — by the time the agent
    // builds an app and starts a dev server, it'll be ready.
    this._kickoffPlaywright(sandbox, workspaceId);
  }

  /** Fire-and-forget: installs playwright + chromium in a dedicated tools dir. */
  private _kickoffPlaywright(sandbox: Sandbox, workspaceId: string): void {
    if (this._playwrightReady.has(workspaceId)) return;
    const promise: Promise<boolean> = (async () => {
      try {
        await sandbox.files.makeDir(TOOLS_DIR).catch(() => {});
        const hasPkg = await sandbox.files.exists(`${TOOLS_DIR}/node_modules/playwright`).catch(() => false);
        if (!hasPkg) {
          // --prefix installs into TOOLS_DIR without touching the workspace
          const install = await sandbox.commands.run(
            `npm install playwright --prefix ${TOOLS_DIR} --no-save 2>&1`,
            { timeoutMs: 120_000 }
          );
          if (install.exitCode !== 0) return false;
        }
        // Install chromium browser binaries
        const hasBin = await sandbox.files.exists(`${TOOLS_DIR}/.browsers/chromium-*/chrome-linux/chrome`).catch(() => false);
        if (!hasBin) {
          const pw = await sandbox.commands.run(
            `PLAYWRIGHT_BROWSERS_PATH=${TOOLS_DIR}/.browsers node ${TOOLS_DIR}/node_modules/.bin/playwright install chromium 2>&1`,
            { timeoutMs: 180_000 }
          );
          if (pw.exitCode !== 0) return false;
        }
        // Write the reusable screenshot script once
        await sandbox.files.write(`${TOOLS_DIR}/screenshot.js`, SCREENSHOT_SCRIPT);
        return true;
      } catch {
        return false;
      }
    })();
    this._playwrightReady.set(workspaceId, promise);
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

    // Long-running commands (dev servers, watchers) never exit — run in background,
    // collect startup output for 20 s (enough for Vite/Next to print the port),
    // then disconnect and leave the process alive.
    const isLongRunning =
      /\b(?:dev|serve|watch|livereload)\b/i.test(command) ||
      /npm\s+run\s+(?:dev|start|serve)\b/i.test(command) ||
      /python.*http\.server|http-server|live-server/i.test(command);

    if (isLongRunning) {
      let stdout = '';
      let stderr = '';
      const handle = await sandbox.commands.run(command, {
        cwd: WORKSPACE_ROOT,
        background: true,
        onStdout: s => { stdout += s; },
        onStderr: s => { stderr += s; },
      });
      await new Promise(resolve => setTimeout(resolve, 20_000));
      await handle.disconnect().catch(() => {});
      return { exitCode: 0, stdout, stderr };
    }

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
    // Try Playwright if installed, fall back to curl.
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

  async screenshot(workspaceId: string, url: string): Promise<{ base64: string; mimeType: 'image/png' }> {
    const sandbox = await this.getSandbox(workspaceId);

    // Ensure playwright background install has been kicked off
    if (!this._playwrightReady.has(workspaceId)) {
      this._kickoffPlaywright(sandbox, workspaceId);
    }

    // Wait up to 90 s for the install to complete (it runs in parallel with coding steps)
    const ready = await Promise.race([
      this._playwrightReady.get(workspaceId)!,
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 90_000)),
    ]);

    if (!ready) {
      throw new Error(
        'Playwright not ready yet (still installing or failed). ' +
        'Ask the agent to run: npm install playwright && npx playwright install chromium'
      );
    }

    const result = await sandbox.commands.run(
      `PLAYWRIGHT_BROWSERS_PATH=${TOOLS_DIR}/.browsers node ${TOOLS_DIR}/screenshot.js ${JSON.stringify(url)}`,
      { cwd: TOOLS_DIR, timeoutMs: 30_000 }
    );

    if (!result.stdout || result.exitCode !== 0) {
      throw new Error(`Screenshot failed: ${result.stderr.slice(0, 300)}`);
    }

    return { base64: result.stdout.trim(), mimeType: 'image/png' };
  }
}
