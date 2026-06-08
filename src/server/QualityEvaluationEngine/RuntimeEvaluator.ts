import { PreviewRunner } from '../PreviewRunner/PreviewRunner';
import { PreviewStatus } from '../PreviewRunner/PreviewTypes';

export class RuntimeEvaluator {
    private runner = new PreviewRunner();

    async evaluate(workspaceId: string): Promise<{ status: 'PASS' | 'FAIL', errors: string[] }> {
        const session = await this.runner.createSession(workspaceId);
        await this.runner.startSession(session.sessionId);
        
        const finalSession = this.runner.getSession(session.sessionId);
        if (finalSession && finalSession.status === PreviewStatus.RUNNING) {
            await this.runner.stopSession(session.sessionId);
            return { status: 'PASS', errors: [] };
        } else {
            return { status: 'FAIL', errors: ['Preview failed to reach RUNNING status'] };
        }
    }
}
