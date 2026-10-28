import { afterEach, describe, expect, it, vi } from 'vitest';
import { admitWeakBuild, WEAK_SCOPE_TIMEOUT_MS } from '../src/server/AgentV3/weakBuildAdmission';
import { tagScopeFailure, readScopeFailure } from '../src/server/AgentV3/scopeFailureDiagnostic';
import { persistedAuditEntry } from '../src/server/lib/audit';
import { projectScopeFailure, readScopeFailures, scopeFailureAudit, scopeCallAudit, recordScopeFailure, SCOPE_FAILURE_EVENT } from '../src/server/lib/scopeFailureReports';
const db = vi.hoisted(() => ({ get: vi.fn(), query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), startAfter: vi.fn(), limit: vi.fn() }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: db.get }));
const requestId = '12345678-1234-1234-1234-123456789abc';
const record = () => ({ ts: 10, ...persistedAuditEntry(SCOPE_FAILURE_EVENT,
  scopeFailureAudit(requestId, 'workspace', { stage: 'deadline', reason: 'scope_timeout' }), 'warn') });
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe('scope diagnostics without inference or accounting changes', () => {
  it('records one failure synchronously, ignores other outcomes, and projects only safe call fields', () => {
    const log = vi.fn();
    recordScopeFailure(requestId, 'workspace', null, log);
    recordScopeFailure(requestId, 'workspace', {}, log);
    expect(log).not.toHaveBeenCalled();
    recordScopeFailure(requestId, 'workspace', { failure: { stage: 'receipt', reason: 'receipt_failed' } }, log);
    expect(log).toHaveBeenCalledExactlyOnceWith(SCOPE_FAILURE_EVENT,
      scopeFailureAudit(requestId, 'workspace', { stage: 'receipt', reason: 'receipt_failed' }), 'warn');
    const row = { ok: false, model: 'unknown', latencyMs: 20, inputTokens: 0, outputTokens: 0,
      promptPreview: 'PRIVATE_PROMPT', responsePreview: 'PRIVATE_RESPONSE', error: 'PRIVATE_ERROR' };
    const entry = persistedAuditEntry('AGENTV3_DISCOUNT_SCOPE_CALL', scopeCallAudit(requestId, 'workspace', row));
    expect(entry.message).toContain('Scope call failed');
    expect(entry.message).toContain(requestId);
    expect(JSON.stringify(entry)).not.toContain('PRIVATE_');
  });
  it('distinguishes the five-second scope deadline even when abort rejects first, without retry', async () => {
    vi.useFakeTimers();
    const ask = vi.fn((_system, _user, signal: AbortSignal) => new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('PRIVATE_ABORT')));
    }));
    const result = admitWeakBuild('PRIVATE_PROMPT', ask);
    await vi.advanceTimersByTimeAsync(WEAK_SCOPE_TIMEOUT_MS - 1);
    expect(ask).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ scope: null, source: 'unavailable', failure: { stage: 'deadline', reason: 'scope_timeout' } });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps an early error distinct from malformed output and ignores forged diagnostic properties', async () => {
    const error = Object.assign(new Error('PRIVATE_KEY_AND_RESPONSE'), { stage: 'reservation', reason: 'reservation_failed' });
    const failed = await admitWeakBuild('PRIVATE_PROMPT', async () => { throw error; });
    expect(failed.failure).toEqual({ stage: 'classification', reason: 'classifier_failed' });
    expect(readScopeFailure(error)).toBeUndefined();
    const malformed = await admitWeakBuild('PRIVATE_PROMPT', async () => ({ text: 'PRIVATE_OUTPUT' }));
    expect(malformed.failure).toEqual({ stage: 'classification', reason: 'invalid_scope' });
    expect(JSON.stringify([failed, malformed])).not.toContain('PRIVATE_');
  });
  it('carries only a trusted fixed-enum failure through classification', async () => {
    const error = tagScopeFailure(new Error('PRIVATE_RECEIPT'), { stage: 'receipt', reason: 'receipt_failed' });
    const result = await admitWeakBuild('PRIVATE_PROMPT', async () => { throw error; });
    expect(result.failure).toEqual({ stage: 'receipt', reason: 'receipt_failed' });
    expect(JSON.stringify(error)).toBe('{}');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
  });
  it('renders a nonblank admin message and exports a strict projection, not raw audit metadata', () => {
    // Original event shape reproduces the blank detail: the UI renders message, not arbitrary meta.
    expect(persistedAuditEntry('AGENTV3_DISCOUNT_SCOPE_CALL', { ok: false, model: 'unknown', latencyMs: 20,
      inputTokens: 0, outputTokens: 0 }).message).toBeUndefined();
    const row = record();
    expect(row.message).toContain('stage=deadline; reason=scope_timeout');
    expect(row.message).toContain(requestId);
    expect(row.level).toBe('warn');
    expect(projectScopeFailure({ ...row, message: 'PRIVATE_ERROR', meta: { ...row.meta, prompt: 'PRIVATE_PROMPT', token: 'PRIVATE_KEY' } }))
      .toEqual({ requestId, workspaceId: 'workspace', observedAt: 10, stage: 'deadline', reason: 'scope_timeout', codingStarted: false });
    expect(projectScopeFailure({ ...row, meta: { stage: '__proto__', reason: 'PRIVATE' } })).toBeNull();
    expect(projectScopeFailure({ ...row, meta: { stage: 'receipt', reason: 'PRIVATE' } })).toBeNull();
  });
  it('pages empty filtered batches without losing the cursor and never substitutes an empty storage error', async () => {
    const query = { where: db.where, orderBy: db.orderBy, startAfter: db.startAfter, limit: db.limit, get: db.query };
    for (const fn of [db.where, db.orderBy, db.startAfter, db.limit]) fn.mockReturnValue(query);
    db.get.mockReturnValue({ collection: vi.fn(() => query) });
    db.query.mockResolvedValue({ docs: [{ id: 'a', data: record }, { id: 'b', data: record }] });
    const page = await readScopeFailures({ workspaceId: 'workspace', since: 11, limit: 1 });
    expect(page).toMatchObject({ failures: [], nextCursor: 'a', scanned: 1 });
    expect(db.limit).toHaveBeenCalledWith(2);
    expect(db.where.mock.calls).toEqual([['event', '==', SCOPE_FAILURE_EVENT], ['workspaceId', '==', 'workspace']]);
    await readScopeFailures({ workspaceId: 'workspace', cursor: page.nextCursor });
    expect(db.startAfter).toHaveBeenCalledWith('a');
    db.query.mockRejectedValue(new Error('database down'));
    await expect(readScopeFailures({ workspaceId: 'workspace' })).rejects.toThrow('database down');
    db.get.mockReturnValue(null);
    await expect(readScopeFailures({ workspaceId: 'workspace' })).rejects.toThrow('unavailable');
  });
  it.each([{ workspaceId: '../other' }, { workspaceId: 'workspace', limit: 51 }, { workspaceId: 'workspace', event: 'SECRET' },
    { workspaceId: 'workspace', since: -1 }, { workspaceId: 'workspace', cursor: '/' }])('rejects invalid read arguments %j before storage', async args => {
    await expect(readScopeFailures(args)).rejects.toThrow();
    expect(db.get).not.toHaveBeenCalled();
  });
});
