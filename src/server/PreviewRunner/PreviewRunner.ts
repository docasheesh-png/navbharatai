import { IPreviewRunner } from './IPreviewRunner';
import { PreviewSession, PreviewStatus } from './PreviewTypes';
import { PortManager } from './PortManager';
import { WorkspaceLauncher } from './WorkspaceLauncher';
import { SandboxManager } from './SandboxManager';
import { PreviewHealthChecker, HealthStatus } from './PreviewHealthChecker';
// Import existing event bus (pseudo-path based on repo analysis)
import { EventBus } from '../AppMakerLab/eventbus/EventBus';

export class PreviewRunner implements IPreviewRunner {
    private sessions: Map<string, PreviewSession> = new Map();
    private portManager = new PortManager();
    private launcher = new WorkspaceLauncher();
    private sandbox = new SandboxManager();
    private healthChecker = new PreviewHealthChecker();
    private eventBus = new EventBus();

    async createSession(workspaceId: string): Promise<PreviewSession> {
        const sessionId = Math.random().toString(36).substring(7);
        const port = await this.portManager.allocatePort();
        const session: PreviewSession = {
            sessionId,
            workspaceId,
            status: PreviewStatus.CREATED,
            assignedPort: port,
            previewUrl: `http://localhost:${port}`
        };
        this.sessions.set(sessionId, session);
        this.eventBus.publish('PREVIEW_CREATED', session);
        return session;
    }

    async startSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error('Session not found');

        session.status = PreviewStatus.STARTING;
        const pm = await this.launcher.detectPackageManager(session.workspaceId);
        
        const [startCmd, startArgs] = this.launcher.getStartCommand(session.workspaceId, pm);
        const pid = this.sandbox.launch(
            session.workspaceId, 
            startCmd, 
            startArgs, 
            { PORT: session.assignedPort.toString() },
            1024 // 1GB limit
        );
        
        session.processId = pid;
        session.startedAt = new Date();
        this.eventBus.publish('PREVIEW_STARTED', session);

        // Robust crash detection
        this.sandbox.onProcessLifecycle(session.workspaceId, 
            () => this.handleUnexpectedTermination(sessionId),
            () => this.handleUnexpectedTermination(sessionId)
        );

        // Set expiration (e.g., 60 minutes)
        setTimeout(() => {
            if (session.status !== PreviewStatus.STOPPED && session.status !== PreviewStatus.FAILED) {
                session.status = PreviewStatus.EXPIRED;
                this.cleanup(sessionId);
            }
        }, 60 * 60 * 1000);

        const health = await this.healthChecker.check(session.previewUrl);
        if (health === HealthStatus.HEALTHY) {
            session.status = PreviewStatus.RUNNING;
            this.eventBus.publish('PREVIEW_HEALTHY', session);
        } else {
            session.status = PreviewStatus.FAILED;
            this.cleanup(sessionId);
            this.eventBus.publish('PREVIEW_FAILED', session);
        }
    }

    async stopSession(sessionId: string): Promise<void> {
        this.cleanup(sessionId);
        this.eventBus.publish('PREVIEW_STOPPED', { sessionId });
    }

    private handleUnexpectedTermination(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session && session.status !== PreviewStatus.STOPPED) {
            session.status = PreviewStatus.FAILED;
            this.cleanup(sessionId);
            this.eventBus.publish('PREVIEW_FAILED', session);
        }
    }

    private cleanup(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            this.sandbox.terminate(session.workspaceId);
            this.portManager.releasePort(session.assignedPort);
            this.sessions.delete(sessionId);
        }
    }

    getSession(sessionId: string): PreviewSession | undefined {
        return this.sessions.get(sessionId);
    }
}
