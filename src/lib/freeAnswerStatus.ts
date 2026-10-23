/** Server-authoritative daily Free answers, never a browser allowance counter. */
import type { FreeAnswerQuotaStatus } from './freeAnswerQuota';
export type FreeAnswerStatus = FreeAnswerQuotaStatus;
export function readFreeAnswerStatus(value: unknown): FreeAnswerStatus | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as FreeAnswerStatus;
  if (![s.limit, s.used, s.remaining, s.reserved].every(n => Number.isSafeInteger(n) && n >= 0)
    || ![0, 1].includes(s.reserved) || typeof s.inProgress !== 'boolean' || (s.reserved === 1 && !s.inProgress)
    || s.remaining !== Math.max(0, s.limit - s.used - s.reserved)
    || !Number.isFinite(s.resetsAt) || s.resetsAt <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(s.day)) return null;
  return { limit: s.limit, used: s.used, remaining: s.remaining, reserved: s.reserved, inProgress: s.inProgress, resetsAt: s.resetsAt, day: s.day };
}
export function freeAnswerStatusLine(status: FreeAnswerStatus | null): string {
  return status ? `${status.remaining}/${status.limit} remaining${status.inProgress ? ' · 1 in progress' : ''}` : 'Status unavailable';
}
/** Latest read wins; identity changes and unmount invalidate outstanding responses. */
export class FreeAnswerStatusReader {
  private sequence = 0;
  constructor(private readonly apply: (status: FreeAnswerStatus | null) => void) {}
  invalidate(): void { this.sequence++; }
  async refresh(read: () => Promise<unknown>): Promise<void> {
    const sequence = ++this.sequence;
    let status: FreeAnswerStatus | null = null;
    try { status = readFreeAnswerStatus(await read()); } catch { /* no guessed count on storage/network failure */ }
    if (sequence === this.sequence) this.apply(status);
  }
}
export const FREE_ANSWER_CHANGED = 'navbharat:free-answer-changed';
const SIGNAL_KEY = 'nb_free_answer_changed';
/** Only an invalidation signal crosses tabs. Each tab rechecks its own verified account. */
export function notifyFreeAnswerChanged(): void {
  try { window.dispatchEvent(new Event(FREE_ANSWER_CHANGED)); } catch { /* non-browser */ }
  try { localStorage.setItem(SIGNAL_KEY, `${Date.now()}:${Math.random()}`); } catch { /* storage disabled; focus/poll remain */ }
}
export function isFreeAnswerStorageKey(key: string | null): boolean { return key === SIGNAL_KEY; }
export function newFreeAnswerRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
