import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);

export class BuildEvaluator {
    async evaluate(workspaceId: string): Promise<{ status: 'PASS' | 'FAIL', errors: string[] }> {
        const pkgManager = this.detectPackageManager(workspaceId);
        const cmd = pkgManager === 'npm' ? 'npm run build' : pkgManager === 'yarn' ? 'yarn build' : 'pnpm run build';
        try {
            await execPromise(cmd, { cwd: workspaceId });
            return { status: 'PASS', errors: [] };
        } catch (e: any) {
            return { status: 'FAIL', errors: [e.message] };
        }
    }

    private detectPackageManager(workspaceId: string): 'npm' | 'pnpm' | 'yarn' {
        if (fs.existsSync(path.join(workspaceId, 'pnpm-lock.yaml'))) return 'pnpm';
        if (fs.existsSync(path.join(workspaceId, 'yarn.lock'))) return 'yarn';
        return 'npm';
    }
}
