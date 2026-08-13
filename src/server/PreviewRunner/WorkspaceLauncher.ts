import * as fs from 'fs';
import * as path from 'path';
import { detectPackageManager } from '../lib/packageManager';
import { pickDevScript, devPortFlags } from '../AgentV3/devScript';

export class WorkspaceLauncher {
    async detectPackageManager(workspaceId: string): Promise<'npm' | 'pnpm' | 'yarn'> {
        // Delegate to the shared detector (single source of truth). The launcher handles npm/pnpm/yarn,
        // so a bun project maps to npm — identical to the prior behavior.
        const present = ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'bun.lockb']
            .filter((f) => fs.existsSync(path.join(workspaceId, f)));
        const pm = detectPackageManager(present);
        return pm === 'bun' ? 'npm' : pm;
    }

    installDependencies(workspaceId: string, packageManager: string): [string, string[]] {
        // Return [command, args]
        return [packageManager, ['install']];
    }

    getStartCommand(workspaceId: string, packageManager: string, port?: number): [string, string[]] {
        const pkg = JSON.parse(fs.readFileSync(path.join(workspaceId, 'package.json'), 'utf8'));
        const scripts = pkg.scripts || {};
        // Shared derivation (AgentV3/devScript.ts) — the same question is answered for the sandbox's
        // per-version previews and for the generated E2E config, and the three copies had drifted.
        const script = pickDevScript(scripts);
        const runArgs = ['run', script];

        // Pin the dev server to the allocated port AND bind 0.0.0.0 so (a) the port
        // actually matches what the reverse proxy targets — Vite/Next ignore the
        // PORT env var — and (b) it's reachable from outside loopback inside Cloud
        // Run/Docker. Flag syntax is framework-specific and forwarded past npm via `--`.
        if (port) {
            const flags = devPortFlags(pkg, script, port);
            if (flags.length > 0) return [packageManager, [...runArgs, '--', ...flags]];
            // Unknown framework (CRA, plain Express, etc.): rely on the PORT env var.
        }
        return [packageManager, runArgs];
    }
}
