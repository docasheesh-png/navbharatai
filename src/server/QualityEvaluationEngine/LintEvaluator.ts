import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);

export class LintEvaluator {
    async evaluate(workspaceId: string): Promise<{ status: 'PASS' | 'FAIL' | 'SKIPPED', errors: string[] }> {
        const pkg = JSON.parse(fs.readFileSync(path.join(workspaceId, 'package.json'), 'utf8'));
        if (!pkg.scripts || !pkg.scripts.lint) return { status: 'SKIPPED', errors: ['No lint script found'] };
        
        try {
            await execPromise('npm run lint', { cwd: workspaceId });
            return { status: 'PASS', errors: [] };
        } catch (e: any) {
            return { status: 'FAIL', errors: [e.message] };
        }
    }
}
