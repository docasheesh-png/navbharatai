import { createHash } from 'node:crypto';
import type { TestChatAction } from '../../lib/testChatBot';

/** Derived once, before any provider call, from the already-validated action. */
export const testChatUid = (actor: string) => `admin-test-chat:${createHash('sha256').update(actor).digest('hex')}`;
export const testChatRequestId = (action: Pick<TestChatAction, 'provider' | 'requestId'>) => `test-chat:${action.provider}:${action.requestId}`;
