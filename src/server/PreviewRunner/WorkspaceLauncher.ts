import * as fs from 'fs';
import * as path from 'path';

export class WorkspaceLauncher {
    async detectPackageManager(workspaceId: string): Promise<'npm' | 'pnpm' | 'yarn'> {
        if (fs.existsSync(path.join(workspaceId, 'pnpm-lock.yaml'))) return 'pnpm';
        if (fs.existsSync(path.join(workspaceId, 'yarn.lock'))) return 'yarn';
        return 'npm';
    }

    installDependencies(workspaceId: string, packageManager: string): string[] {
        // Return command and args
        return [packageManager, ['install']];
    }
    
    getStartCommand(workspaceId: string, packageManager: string): string[] {
        const pkg = JSON.parse(fs.readFileSync(path.join(workspaceId, 'package.json'), 'utf8'));
        const scripts = pkg.scripts || {};
        const script = scripts['dev'] ? 'dev' : scripts['start'] ? 'start' : scripts['preview'] ? 'preview' : 'start';
        return [packageManager, ['run', script]];
    }
}
