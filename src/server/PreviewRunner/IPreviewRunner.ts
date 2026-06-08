import { PreviewSession } from './PreviewTypes';

export interface IPreviewRunner {
    createSession(workspaceId: string): Promise<PreviewSession>;
    startSession(sessionId: string): Promise<void>;
    stopSession(sessionId: string): Promise<void>;
    getSession(sessionId: string): PreviewSession | undefined;
}
