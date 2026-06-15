import { UniversalAIRouter } from '../AI/UniversalAIRouter';

/**
 * Shared UniversalAIRouter singleton, extracted from the server.ts monolith
 * (Phase 1, AI-core). Used by both the chat handler and the Pro build/chat
 * routes, so it lives in one place instead of the server-bootstrap closure.
 */
export const aiRouter = new UniversalAIRouter();
