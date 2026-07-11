import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { detectPackageManager } from '../lib/packageManager';
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
        // Delegate to the shared detector (single source of truth). This evaluator's `build` command
        // supports npm/pnpm/yarn, so a bun project maps to npm — identical to the prior behavior.
        const present = ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'bun.lockb']
            .filter((f) => fs.existsSync(path.join(workspaceId, f)));
        const pm = detectPackageManager(present);
        return pm === 'bun' ? 'npm' : pm;
    }
}
