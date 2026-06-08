import * as fs from 'fs';
import * as path from 'path';

export class SecurityEvaluator {
    async evaluate(workspaceId: string): Promise<{ status: 'PASS' | 'FAIL', errors: string[] }> {
        const errors: string[] = [];
        const secretRegex = /(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|JWT_SECRET)[^=]*=["']?[a-zA-Z0-9_\-]{16,40}["']?/i;

        const scanDirectory = (dir: string) => {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                if (file === 'node_modules' || file === '.git' || file === 'dist') continue;
                const fullPath = path.join(dir, file);
                const stat = fs.statSync(fullPath);
                
                if (stat.isDirectory()) {
                    scanDirectory(fullPath);
                } else {
                    try {
                        const content = fs.readFileSync(fullPath, 'utf8');
                        if (secretRegex.test(content)) {
                            errors.push(`Potentially exposed sensitive info in ${fullPath}`);
                        }
                    } catch (e) {
                        // Ignore non-readable files
                    }
                }
            }
        };

        scanDirectory(workspaceId);
        
        return {
            status: errors.length === 0 ? 'PASS' : 'FAIL',
            errors
        };
    }
}
