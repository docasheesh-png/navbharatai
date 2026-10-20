/**
 * Opt-in retention fence. Every writer of a fenced collection must read the parent
 * transactionally and refuse this field, including an idempotent replay.
 * A fence is not an autopsy status and must never be rendered as one.
 */
export const RETENTION_PURGE_TOKEN = 'retentionPurgeToken';

export function isRetentionPurgeToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
}

export function hasRetentionFence(value: unknown): boolean {
  return value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, RETENTION_PURGE_TOKEN);
}
