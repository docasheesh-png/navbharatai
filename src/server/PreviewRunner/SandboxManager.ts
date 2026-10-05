import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { assertHostExecAllowed, hostChildEnv } from '../lib/actuatorGuard';

export class SandboxManager {
    private processes: Map<string, ChildProcess> = new Map();

    launch(workspaceId: string, cmd: string, args: string[], env: Record<string, string>, memoryLimitMB: number): number {
        // 🔒 This spawns a USER's app on the host: refused outside development, and the child gets an
        // allowlisted environment — never the server's secrets (forensic audit 2026-10-04, actuatorGuard.ts).
        assertHostExecAllowed('The host preview launcher');
        const child = spawn(cmd, args, {
            cwd: path.resolve(workspaceId),
            env: hostChildEnv({ ...env, NODE_OPTIONS: `--max-old-space-size=${memoryLimitMB}` }),
            detached: true
        });
        
        if (child.pid) {
            this.processes.set(workspaceId, child);
            return child.pid;
        }
        throw new Error('Failed to launch process');
    }

    onProcessLifecycle(workspaceId: string, onExit: (code: number | null) => void, onError: (err: Error) => void) {
        const process = this.processes.get(workspaceId);
        if (process) {
            process.on('exit', onExit);
            process.on('error', onError);
            process.on('close', (code) => onExit(code));
        }
    }

    terminate(workspaceId: string) {
        const process = this.processes.get(workspaceId);
        if (process) {
            try {
                process.kill(-process.pid!); // Kill process group
            } catch (e) {
                // Fallback: kill individual process if group kill fails
                process.kill();
            }
            this.processes.delete(workspaceId);
        }
    }
}
