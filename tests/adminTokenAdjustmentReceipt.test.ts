import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readAdminTokenAdjustmentReceipt, adminTokenAdjustmentReceipt } from '../src/server/lib/adminTokenAdjustmentReceipt';
import { ADMIN_TOKEN_REASON_DIGEST_DOMAIN, readAdminTokenAdjustmentReceiptResponse } from '../src/lib/adminTokenAdjustmentReceipt';
import { TokenAdjustmentReceiptReview } from '../src/components/admin/TokenAdjustmentReceiptReview';
import { walletOpId } from '../src/server/lib/walletOps';
import { verifyAdminTokenValue, adminTokenTtlMs, mintAdminToken } from '../src/server/lib/adminAuth';

const requestId = 'synthetic-receipt-0001';
const at = '2026-10-01T00:00:00.000Z';
const refreshedAt = '2026-10-27T00:00:00.000Z';
const stored = { requestedUserId: 'synthetic-source', walletId: 'wallet-at-grant', delta: 1000,
  reason: 'Synthetic support adjustment', previousBalance: 0, newBalance: 1000, createdAt: at };
const current = { ok: true as const, canonicalUserId: 'synthetic-current', storedTokens: 300,
  ownerVisibleTokens: 300, weakEligibleTokens: 300, paidSpendableTokens: 0, refreshedAt,
  paused: true, pauseStateKnown: true, mergeResolutionEnabled: true };
const receipt = { requestId, requestedUserId: stored.requestedUserId, walletId: stored.walletId, delta: stored.delta,
  previousBalance: stored.previousBalance, newBalance: stored.newBalance, committedAt: at,
  reasonDigest: createHash('sha256').update(ADMIN_TOKEN_REASON_DIGEST_DOMAIN + stored.reason).digest('hex') };
const response = { ok: true as const, receipt, currentWallet: current };

describe('read-only durable receipt reconciliation', () => {
  it('reads only the exact original operation and separately refreshes its current canonical wallet', async () => {
    const before = structuredClone(stored); const readOperation = vi.fn(async () => stored);
    const readCurrent = vi.fn(async () => current);
    const result = await readAdminTokenAdjustmentReceipt(requestId, { readOperation, readCurrent, now: () => refreshedAt });
    expect(result).toEqual({ status: 'confirmed', response });
    expect(readOperation).toHaveBeenCalledExactlyOnceWith(walletOpId('admin', 'admin-adjustment', requestId));
    expect(readCurrent).toHaveBeenCalledExactlyOnceWith(stored.requestedUserId);
    expect(stored).toEqual(before); expect(JSON.stringify(result)).not.toContain(stored.reason);
    // Original credited amount is not today's remaining amount after consumption/merges.
    expect(result.status === 'confirmed' && result.response.receipt.newBalance).toBe(1000);
    expect(result.status === 'confirmed' && result.response.currentWallet).toEqual(current);
  });
  it.each([
    { pauseStateKnown: true, mergeResolutionEnabled: true, ownerVisibleTokens: 300, weakEligibleTokens: 300 },
    { pauseStateKnown: true, mergeResolutionEnabled: false, ownerVisibleTokens: 0, weakEligibleTokens: 300 },
    { pauseStateKnown: false, mergeResolutionEnabled: true, ownerVisibleTokens: null, weakEligibleTokens: null },
  ])('refreshes canonical data with zero writes and explicit policy/projection provenance: %s', async expected => {
    const rows = new Map<string, unknown>([
      [`wallet_ops/${walletOpId('admin', 'admin-adjustment', requestId)}`, stored],
      ['user_token_wallets/synthetic-source', { mergedInto: 'synthetic-current', tokenBalance: 99000, remaining_balance: 990, totalMoneySpent: 0 }],
      ['user_token_wallets/synthetic-current', { tokenBalance: 300, remaining_balance: 3,
        giftTokensRemaining: 300, adminBuildTokensRemaining: 300, totalMoneySpent: 0, walletLedger: [] }],
    ]);
    const before = structuredClone(rows); const reads: string[] = []; const write = vi.fn();
    const snapshot = (path: string) => { reads.push(path); return { exists: rows.has(path), data: () => structuredClone(rows.get(path)) }; };
    const db = { doc: (path: string) => ({ path, get: async () => snapshot(path), set: write, update: write, delete: write }),
      runTransaction: async fn => fn({ get: async ({ path }) => snapshot(path), set: write, update: write, delete: write }) };
    const result = await adminTokenAdjustmentReceipt(db, requestId, { paused: true,
      pauseStateKnown: expected.pauseStateKnown, mergeResolutionEnabled: expected.mergeResolutionEnabled });
    expect(result.status).toBe('confirmed');
    expect(result.status === 'confirmed' && result.response.currentWallet).toMatchObject({ ...current, ...expected, refreshedAt: expect.any(String) });
    expect(reads).toEqual([`wallet_ops/${walletOpId('admin', 'admin-adjustment', requestId)}`,
      'user_token_wallets/synthetic-source', 'user_token_wallets/synthetic-current']);
    expect(write).not.toHaveBeenCalled(); expect(rows).toEqual(before);
  });
  it.each([null, { ...stored, requestedUserId: '../not-an-account' }, { ...stored, newBalance: NaN },
    { ...stored, previousBalance: Infinity }, { ...stored, delta: 0 }, { ...stored, reason: '' },
    { ...stored, createdAt: 'not-a-time' }, { ...stored, walletId: null }])('missing or invalid immutable receipt remains unknown: %s', async value => {
    const readCurrent = vi.fn();
    const result = await readAdminTokenAdjustmentReceipt(requestId, { readOperation: async () => value as never,
      readCurrent, now: () => refreshedAt });
    expect(result.status).toBe('unknown'); expect(readCurrent).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('not-an-account');
  });
  it('does not perform any read for a malformed request ID', async () => {
    const readOperation = vi.fn(); const readCurrent = vi.fn();
    expect((await readAdminTokenAdjustmentReceipt('../other', { readOperation, readCurrent, now: () => refreshedAt })).status).toBe('unknown');
    expect(readOperation).not.toHaveBeenCalled(); expect(readCurrent).not.toHaveBeenCalled();
  });
  it('keeps a proven receipt while a current wallet read fails, without inventing zero', async () => {
    const result = await readAdminTokenAdjustmentReceipt(requestId, { readOperation: async () => stored,
      readCurrent: async () => { throw new Error('synthetic private backend detail'); }, now: () => refreshedAt });
    expect(result).toMatchObject({ status: 'confirmed', response: { receipt, currentWallet: { ok: false } } });
    expect(JSON.stringify(result)).not.toContain('private backend');
    if (result.status === 'confirmed') expect(result.response.currentWallet).not.toHaveProperty('storedTokens');
  });
});

describe('checked wire data and truthful visible acknowledgment', () => {
  it('rejects an error or malformed current data and never preserves raw reason text', () => {
    expect(readAdminTokenAdjustmentReceiptResponse({ ...response, ok: false })).toBeNull();
    expect(readAdminTokenAdjustmentReceiptResponse({ ...response, error: 'Conflicting response' })).toBeNull();
    expect(readAdminTokenAdjustmentReceiptResponse({ ...response, currentWallet: { ...current, storedTokens: Infinity } })).toBeNull();
    expect(readAdminTokenAdjustmentReceiptResponse({ ...response, receipt: { ...receipt, reasonDigest: 'bad' } })).toBeNull();
    expect(readAdminTokenAdjustmentReceiptResponse({ ...response, receipt: { ...receipt, reason: 'Not for local storage' } })).toEqual(response);
  });
  it('separates historical receipt balances from freshly read current balances and has no credit action', () => {
    const html = renderToStaticMarkup(React.createElement(TokenAdjustmentReceiptReview, {
      response, busy: false, onAcknowledge: vi.fn(),
    }));
    expect(html).toContain('Historical receipt balances: 0 → 1,000 tokens');
    expect(html).toContain('not the current balance'); expect(html).toContain('Current stored tokens: 300');
    expect(html).toContain('Current canonical wallet: synthetic-current');
    expect(html).toContain('Acknowledge confirmed operation'); expect(html).not.toContain('Add tokens');
    expect(html).not.toContain(stored.reason);
  });
  it('shows an unavailable current wallet as unknown, not as the old receipt or zero', () => {
    const html = renderToStaticMarkup(React.createElement(TokenAdjustmentReceiptReview, {
      response: { ...response, currentWallet: { ok: false, refreshedAt, reason: 'Current wallet is unknown.' } },
      busy: true, onAcknowledge: vi.fn(),
    }));
    expect(html).toContain('Current wallet is unknown.'); expect(html).not.toContain('Current stored tokens:');
    expect(html).toContain('disabled=""');
  });
  it('does not hide unavailable policy or a stale source-login projection behind canonical figures', () => {
    const html = renderToStaticMarkup(React.createElement(TokenAdjustmentReceiptReview, {
      response: { ...response, currentWallet: { ...current, pauseStateKnown: false, mergeResolutionEnabled: false,
        ownerVisibleTokens: null, weakEligibleTokens: null } }, busy: false, onAcknowledge: vi.fn(),
    }));
    expect(html).toContain('Free-program state is unavailable');
    expect(html).toContain('Merge resolution is disabled');
    expect(html).toContain('unknown, not zero');
    expect(html).toContain('Historical receipt balances: 0 → 1,000');
  });
});

describe('the existing Admin authentication boundary guards receipt reads', () => {
  it('requires the same real Admin middleware and refuses an ordinary or expired token before any lookup', () => {
    const source = readFileSync('src/server/routes/admin.ts', 'utf8');
    expect(source).toContain("app.get('/api/admin/token-adjustments/:requestId/receipt', verifyAdminToken,");
    const ast = ts.createSourceFile('admin.ts', source, ts.ScriptTarget.Latest, true);
    let initializer: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'verifyAdminToken') initializer = node.initializer;
      ts.forEachChild(node, visit);
    };
    visit(ast); expect(initializer).toBeDefined();
    const js = ts.transpileModule(`const middleware = ${initializer!.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const middleware = new Function('adminPassword', 'adminUsername', 'verifyAdminTokenValue', 'adminTokenTtlMs', 'audit', `${js};return middleware;`)(
      () => 'synthetic-test-password', () => 'synthetic-admin', verifyAdminTokenValue, adminTokenTtlMs, vi.fn());
    const next = vi.fn(); const res = { status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res);
    for (const token of ['ordinary-user-token', mintAdminToken('synthetic-test-password', 'synthetic-admin', Date.now() - 400 * 24 * 60 * 60 * 1000)]) {
      middleware({ headers: { 'x-admin-token': token }, ip: '127.0.0.1', path: '/api/admin/token-adjustments/synthetic/receipt' }, res, next);
    }
    expect(res.status).toHaveBeenCalledWith(401); expect(next).not.toHaveBeenCalled();
    const route = source.slice(source.indexOf("app.get('/api/admin/token-adjustments/:requestId/receipt'"), source.indexOf('// ── User token adjustment'));
    expect(route).toContain("audit('ADMIN_TOKEN_ADJUSTMENT_RECEIPT_VIEW'");
    expect(route).toContain("'Cache-Control', 'no-store'");
    expect(route).not.toContain('adjustAdminBuildTokens(');
  });
});
