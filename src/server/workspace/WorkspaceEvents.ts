
import { EventEmitter } from 'node:events';
import { WorkspaceEvent, EventOperation } from './types.js';
import { writeFile, appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

class WorkspaceEventBus extends EventEmitter {
    constructor() {
        super();
    }

    async emitEvent(operation: EventOperation, workspaceId: string, path?: string) {
        const event: WorkspaceEvent = {
            event: operation,
            workspaceId,
            path,
            timestamp: new Date().toISOString()
        };
        
        console.log(`[WORKSPACE_EVENT] ${JSON.stringify(event)}`);
        this.emit('workspace_event', event);
        await this.logToAudit(event);
    }

    private async logToAudit(event: WorkspaceEvent) {
        const auditDir = join(process.cwd(), 'runtime', 'workspace-history');
        await mkdir(auditDir, { recursive: true });
        const auditFile = join(auditDir, `${event.workspaceId}.log`);
        await appendFile(auditFile, JSON.stringify(event) + '\n');
    }
}

export const workspaceEventBus = new WorkspaceEventBus();
