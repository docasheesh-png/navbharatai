/** An acknowledged queue response. Invalid/truncated JSON is an unknown durable outcome. */
import { validQueueContinuation, type QueueContinuationState } from './queueContinuation';
export interface QueueResponseItem {
  id: string;
  prompt: string;
  source: 'user' | 'planner' | 'advisor';
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  createdTs: number;
  note?: string;
  claimToken?: string;
  continuation?: QueueContinuationState;
}
function validItem(value: unknown): value is QueueResponseItem {
  const item = value as QueueResponseItem;
  return !!item && typeof item.id === 'string' && !!item.id && typeof item.prompt === 'string'
    && ['user', 'planner', 'advisor'].includes(item.source)
    && ['pending', 'running', 'done', 'failed', 'cancelled'].includes(item.status)
    && typeof item.createdTs === 'number' && Number.isFinite(item.createdTs)
    && (item.claimToken === undefined || typeof item.claimToken === 'string')
    && (item.continuation === undefined || validQueueContinuation(item.continuation));
}
export function confirmedQueueResponse(value: unknown): { items: QueueResponseItem[]; paused: boolean } {
  const body = value as { items?: unknown; paused?: unknown };
  if (!body || !Array.isArray(body.items) || !body.items.every(validItem)
    || (body.paused !== undefined && typeof body.paused !== 'boolean')) {
    throw new Error('Queue progress could not be confirmed. Refresh or retry using the same request.');
  }
  return { items: body.items, paused: body.paused === true };
}
export function confirmedQueueClaim(value: unknown): QueueResponseItem | null {
  confirmedQueueResponse(value);
  const claim = (value as { claimed?: unknown }).claimed;
  if (claim === null) return null;
  if (!validItem(claim) || claim.status !== 'running') throw new Error('The queued step could not be confirmed. Refresh the queue before continuing.');
  return claim;
}
export function confirmedEnqueue(value: unknown): boolean {
  confirmedQueueResponse(value);
  const body = value as { added?: unknown; reason?: unknown };
  if (body.added === true) return true;
  if (body.added === false && ['duplicate-id', 'empty-prompt', 'queue-full'].includes(body.reason as string)) return body.reason === 'duplicate-id';
  throw new Error('Your queued step could not be confirmed. Retry using the same request.');
}
