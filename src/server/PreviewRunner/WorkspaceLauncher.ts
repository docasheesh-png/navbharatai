import * as fs from 'fs';
import * as path from 'path';

export class WorkspaceLauncher {
    async detectPackageManager(workspaceId: string): Promise<'npm' | 'pnpm' | 'yarn'> {
        if (fs.existsSync(path.join(workspaceId, 'pnpm-lock.yaml'))) return 'pnpm';
        if (fs.existsSync(path.join(workspaceId, 'yarn.lock'))) return 'yarn';
        return 'npm';
    }

    installDependencies(workspaceId: string, packageManager: string): [string, string[]] {
        // Return [command, args]
        return [packageManager, ['install']];
    }

    getStartCommand(workspaceId: string, packageManager: string, port?: number): [string, string[]] {
        const pkg = JSON.parse(fs.readFileSync(path.join(workspaceId, 'package.json'), 'utf8'));
        const scripts = pkg.scripts || {};
        const script = scripts['dev'] ? 'dev' : scripts['start'] ? 'start' : scripts['preview'] ? 'preview' : 'start';
        const runArgs = ['run', script];

        // Pin the dev server to the allocated port AND bind 0.0.0.0 so (a) the port
        // actually matches what the reverse proxy targets — Vite/Next ignore the
        // PORT env var — and (b) it's reachable from outside loopback inside Cloud
        // Run/Docker. Flag syntax is framework-specific and forwarded past npm via `--`.
        if (port) {
            const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
            const scriptBody = String(scripts[script] || '');
            const isVite = 'vite' in deps || /\bvite\b/.test(scriptBody);
            const isNext = 'next' in deps || /\bnext\b/.test(scriptBody);
            if (isVite) {
                return [packageManager, [...runArgs, '--', '--port', String(port), '--host', '0.0.0.0']];
            }
            if (isNext) {
                return [packageManager, [...runArgs, '--', '-p', String(port), '-H', '0.0.0.0']];
            }
            // Unknown framework (CRA, plain Express, etc.): rely on the PORT env var.
        }
        return [packageManager, runArgs];
    }
}
