import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

export class SandboxManager {
    private processes: Map<string, ChildProcess> = new Map();

    launch(workspaceId: string, cmd: string, args: string[], env: Record<string, string>, memoryLimitMB: number): number {
        const child = spawn(cmd, args, {
            cwd: path.resolve(workspaceId),
            env: { ...process.env, ...env, NODE_OPTIONS: `--max-old-space-size=${memoryLimitMB}` },
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
