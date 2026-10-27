/** Synthetic accounts only. Execute the real handlers, not a second copy of their state machine. */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfirmActionDialog } from '../src/components/admin/ConfirmActionDialog';
import { readAdminReason, readTokenDelta, tokenAdjustCopy } from '../src/lib/adminActionReason';
import { createAdminTokenAdjustmentIntent } from '../src/lib/adminTokenAdjustmentRequest';
import { validRequestId } from '../src/server/lib/walletOps';

const dashboard = readFileSync('src/components/AdminDashboard.tsx', 'utf8');
const server = readFileSync('src/server/routes/admin.ts', 'utf8');
function initializer(name: string): string {
  const ast = ts.createSourceFile('AdminDashboard.tsx', dashboard, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!found) throw new Error(`Missing real handler: ${name}`);
  return found.getText(ast);
}
function bind(expression: string, deps: Record<string, unknown>): (...args: any[]) => any {
  const code = ts.transpileModule(`const handler = ${expression};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(deps), `${code}; return handler;`)(...Object.values(deps));
}
const action = { kind: 'tokens', userId: 'synthetic-owner', who: 'Synthetic account',
  delta: 1000, balance: 12345, requestId: 'synthetic-request-0001' };
function setup(result: unknown) {
  const deps = {
    pendingAction: { ...action }, pendingFlight: { current: false }, headers: {},
    setPendingBusy: vi.fn(), setPendingFeedback: vi.fn(), setActionLoading: vi.fn(),
    setPendingAction: vi.fn(), setTokenRecoveryNotice: vi.fn(), setTokenRecoveryAvailable: vi.fn(),
    setTokenDelta: vi.fn(), setSelectedUserId: vi.fn(), fetchUsers: vi.fn(), toast: vi.fn(),
    restorePendingTokenAdjustment: vi.fn(), createAdminTokenAdjustmentIntent,
    submitAdminTokenAdjustment: vi.fn(async () => result),
    tokenSession: {}, tokenSessionAbort: { current: null }, adminActionGeneration: { current: 1 },
    tokenConfirmation: null as any, setTokenConfirmation: vi.fn(),
    tokenReceiptReview: null as any, setTokenReceiptReview: vi.fn(),
    clearConfirmedAdminTokenAdjustment: vi.fn(async () => ({ cleared: true, message: 'Acknowledged.' })),
    readPendingAdminTokenAdjustment: vi.fn(async () => ({ status: 'pending', intent: { ...action, attempted: true } })),
  };
  return { deps, run: bind(initializer('runPendingAction'), deps) };
}

describe('the final Add tokens confirmation tells the truth where the admin can see it', () => {
  it('shows a definite refusal inside the still-open dialog, not a toast behind its overlay', async () => {
    const { deps, run } = setup({ status: 'refused', pendingRetained: false, message: 'Not applied: update this app.' });
    await run('test for synthetic apps');
    expect(deps.setPendingFeedback).toHaveBeenLastCalledWith('Not applied: update this app.');
    expect(deps.toast).not.toHaveBeenCalled(); expect(deps.fetchUsers).not.toHaveBeenCalled();
    expect(deps.setPendingAction).not.toHaveBeenCalledWith(null);
    expect(deps.setPendingBusy.mock.calls).toEqual([[true], [false]]);
    expect(deps.pendingFlight.current).toBe(false);
  });
  it('holds the exact reason and operation identity after an unknown result', async () => {
    const { deps, run } = setup({ status: 'unknown', pendingRetained: true, message: 'Outcome unknown; retry only this request.' });
    await run('  test for  synthetic apps ');
    expect(deps.setPendingAction).toHaveBeenLastCalledWith(expect.objectContaining({ ...action,
      lockedReason: 'test for synthetic apps', createdAt: expect.any(Number), attempted: true }));
    expect(deps.setTokenRecoveryNotice).toHaveBeenLastCalledWith('Outcome unknown; retry only this request.');
    expect(deps.toast).not.toHaveBeenCalled();
  });
  it('catches an unexpected thrown transport error and does not pretend it was refused', async () => {
    const { deps, run } = setup(null);
    deps.submitAdminTokenAdjustment.mockRejectedValueOnce(new Error('synthetic lost response'));
    await run('test for synthetic apps');
    expect(deps.restorePendingTokenAdjustment).toHaveBeenCalledOnce();
    expect(deps.setPendingFeedback).toHaveBeenLastCalledWith(expect.stringContaining('may have completed'));
    expect(deps.setPendingBusy).toHaveBeenLastCalledWith(false);
  });
  it('blocks the second synchronous tap before a React busy-state render', async () => {
    const { deps, run } = setup(null);
    let release!: (result: unknown) => void;
    deps.submitAdminTokenAdjustment.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const first = run('test for synthetic apps'); const second = run('test for synthetic apps');
    expect(deps.submitAdminTokenAdjustment).toHaveBeenCalledOnce();
    release({ status: 'unknown', pendingRetained: true, message: 'Outcome unknown.' });
    await Promise.all([first, second]);
    expect(deps.setPendingBusy.mock.calls).toEqual([[true], [false]]);
  });
  it('never paints an old session response into a newly signed-in Admin panel', async () => {
    const { deps, run } = setup(null);
    let release!: (result: unknown) => void;
    deps.submitAdminTokenAdjustment.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = run('test for synthetic apps');
    deps.adminActionGeneration.current++;
    release({ status: 'confirmed', pendingRetained: true, previousBalance: 50, newBalance: 1050 });
    await pending;
    expect(deps.setTokenConfirmation).not.toHaveBeenCalled();
    expect(deps.setPendingAction).not.toHaveBeenCalled(); expect(deps.fetchUsers).not.toHaveBeenCalled();
    expect(deps.setPendingFeedback.mock.calls).toEqual([[null]]);
  });
  it('leaves a restored reason editable when exact re-entry is refused before dispatch', async () => {
    const { deps } = setup({ status: 'refused', pendingRetained: true, message: 'Re-enter the original reason. No new request was sent.' });
    Object.assign(deps.pendingAction, { restored: true, createdAt: 1000 });
    await bind(initializer('runPendingAction'), deps)('different synthetic reason');
    expect(deps.setPendingAction).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: action.requestId,
      restored: true, lockedReason: undefined, createdAt: 1000 }));
    expect(deps.setPendingFeedback).toHaveBeenLastCalledWith(expect.stringContaining('No new request was sent'));
  });
  it('uses confirmed actual balances and waits for explicit acknowledgment before allowing a new adjustment', async () => {
    const { deps, run } = setup({ status: 'confirmed', pendingRetained: true, previousBalance: 50,
      newBalance: 1050, walletId: 'synthetic-canonical', replayed: true, message: 'Confirmed.' });
    await run('test for synthetic apps');
    expect(deps.setPendingFeedback).toHaveBeenLastCalledWith(expect.stringContaining('50 → 1,050'));
    expect(deps.setTokenConfirmation).toHaveBeenCalledOnce();
    expect(deps.fetchUsers).toHaveBeenCalledOnce(); expect(deps.setPendingAction).not.toHaveBeenCalledWith(null);
    expect(deps.clearConfirmedAdminTokenAdjustment).not.toHaveBeenCalled();
  });
  it('Done clears only a checked receipt and does not send another POST', async () => {
    const { deps } = setup(null);
    deps.tokenConfirmation = { intent: { ...action }, receipt: { status: 'confirmed' } };
    await bind(initializer('runPendingAction'), deps)('test for synthetic apps');
    expect(deps.clearConfirmedAdminTokenAdjustment).toHaveBeenCalledOnce();
    expect(deps.submitAdminTokenAdjustment).not.toHaveBeenCalled();
    expect(deps.setPendingAction).toHaveBeenCalledWith(null);
  });
  it('does not dismiss a confirmed operation whose acknowledgment cleanup fails', async () => {
    const { deps } = setup(null);
    deps.tokenConfirmation = { intent: { ...action }, receipt: { status: 'confirmed' } };
    deps.clearConfirmedAdminTokenAdjustment.mockResolvedValue({ cleared: false, message: 'Confirmed; browser cleanup is blocked.' });
    await bind(initializer('runPendingAction'), deps)('test for synthetic apps');
    expect(deps.setPendingFeedback).toHaveBeenLastCalledWith('Confirmed; browser cleanup is blocked.');
    expect(deps.setPendingAction).not.toHaveBeenCalledWith(null);
  });
  it('renders refusal feedback and an immutable recovered reason inside the portalled sheet', () => {
    const html = renderToStaticMarkup(React.createElement(ConfirmActionDialog, {
      copy: tokenAdjustCopy('Synthetic account', 1000, null), lockedReason: 'test for synthetic apps',
      feedback: 'Outcome unknown; preserve this request.', confirmLabel: 'Retry same request safely',
      onCancel: vi.fn(), onConfirm: vi.fn(),
    }));
    expect(html).toContain('role="dialog"'); expect(html).toContain('role="alert"');
    expect(html).toContain('Outcome unknown; preserve this request.');
    expect(html).toMatch(/<textarea[^>]*read[Oo]nly=""[^>]*>test for synthetic apps<\/textarea>/);
    expect(html).toContain('Retry same request safely'); expect(html).not.toContain('real wallet');
  });
  it('names the stored preview and never calls a gift purchased or hosting money', () => {
    const copy = tokenAdjustCopy('Synthetic account', 1000, 100);
    expect(copy.consequence).toContain('Stored token preview');
    expect(copy.consequence).toContain('server confirms the actual balance');
    expect(copy.consequence).toContain('not purchased money or hosting funds');
  });
});

describe('closing, reopening and reloading cannot silently mint a new adjustment identity', () => {
  it('clears the previous Admin reason and receipt synchronously at the layout boundary before the next paint', () => {
    const ast = ts.createSourceFile('AdminDashboard.tsx', dashboard, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let effect: ts.CallExpression | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ['useEffect', 'useLayoutEffect'].includes(node.expression.getText(ast))
        && node.arguments[0]?.getText(ast).includes('createAdminTokenAdjustmentSession(adminToken)')) effect = node;
      ts.forEachChild(node, visit);
    };
    visit(ast); expect(effect?.expression.getText(ast)).toBe('useLayoutEffect');
    let pending: typeof action | null = { ...action };
    let feedback: string | null = 'Previous Admin reason';
    const aborted = vi.fn();
    const deps = { adminToken: 'synthetic-new-admin-session', adminActionGeneration: { current: 1 },
      tokenSessionRef: { current: {} }, tokenSessionAbort: { current: { abort: aborted } },
      setTokenSession: vi.fn(), setTokenConfirmation: vi.fn(), setTokenReceiptReview: vi.fn(), setPendingAction: (value: null) => { pending = value; },
      setPendingFeedback: (value: null) => { feedback = value; }, pendingFlight: { current: true },
      setPendingBusy: vi.fn(), setTokenRecoveryAvailable: vi.fn(), setTokenRecoveryNotice: vi.fn(),
      createAdminTokenAdjustmentSession: vi.fn(() => new Promise(() => {})), restorePendingTokenAdjustment: vi.fn() };
    const cleanup = bind(effect!.arguments[0].getText(ast), deps)();
    expect(aborted).toHaveBeenCalledOnce(); expect(deps.adminActionGeneration.current).toBe(2);
    expect(pending).toBeNull(); expect(feedback).toBeNull();
    // The first paint after this actual layout callback has no old dialog/reason to render.
    const html = renderToStaticMarkup(React.createElement('section', null, pending && React.createElement(ConfirmActionDialog, {
      copy: tokenAdjustCopy('Synthetic account', 1000, null), feedback, lockedReason: 'Previous Admin reason',
      onCancel: vi.fn(), onConfirm: vi.fn(),
    })));
    expect(html).not.toContain('role="dialog"'); expect(html).not.toContain('Previous Admin reason');
    cleanup();
  });
  it('restores the target, delta and ID but requires reason re-entry and does not use a stale source balance', async () => {
    const intent = { ...action, reasonDigest: 'synthetic-digest', createdAt: 1000, attempted: true };
    const session = {};
    const deps = { readPendingAdminTokenAdjustment: async () => ({ status: 'pending', intent }),
      tokenSession: session, tokenSessionRef: { current: session }, setTokenConfirmation: vi.fn(),
      setPendingAction: vi.fn(), setPendingFeedback: vi.fn(), setTokenRecoveryNotice: vi.fn(), setTokenRecoveryAvailable: vi.fn() };
    expect(await bind(initializer('restorePendingTokenAdjustment'), deps)()).toBe(true);
    expect(deps.setPendingAction).toHaveBeenCalledWith({ ...action, who: `account ${action.userId}`, balance: null,
      restored: true, attempted: true, createdAt: 1000 });
    expect(deps.setPendingFeedback).toHaveBeenCalledWith(expect.stringContaining('Re-enter its exact original reason'));
    expect(dashboard).toContain('if (session) void restorePendingTokenAdjustment(session)');
    expect(dashboard).toContain('onCancel={() => { if (!pendingBusy) setPendingAction(null); }}');
    expect(dashboard).toContain('feedback={pendingFeedback}');
  });
  it('new Tokens clicks first recover the pending operation and never mint another ID', async () => {
    const deps = { restorePendingTokenAdjustment: vi.fn(() => true), newRequestIdentity: vi.fn(), tokenDelta: '1000',
      readTokenDelta, setPendingAction: vi.fn(), setPendingFeedback: vi.fn(), setTokenRecoveryNotice: vi.fn(), toast: vi.fn() };
    await bind(initializer('handleTokenAdjust'), deps)('different-synthetic-owner', 'Different account', 0);
    expect(deps.restorePendingTokenAdjustment).toHaveBeenCalledOnce();
    expect(deps.newRequestIdentity).not.toHaveBeenCalled(); expect(deps.setPendingAction).not.toHaveBeenCalled();
  });
  it('passes the recovered attempted marker through instead of manufacturing a never-sent draft', async () => {
    const { deps } = setup({ status: 'unknown', pendingRetained: true, message: 'Saved operation must be reconciled.' });
    Object.assign(deps.pendingAction, { restored: true, attempted: true, createdAt: 1000 });
    await bind(initializer('runPendingAction'), deps)('test for synthetic apps');
    expect(deps.submitAdminTokenAdjustment).toHaveBeenCalledWith(expect.objectContaining({ requestId: action.requestId,
      attempted: true, createdAt: 1000 }), expect.any(Object));
  });
});

describe('an old bundled client must not be given a random server identity', () => {
  it('executes the actual route and refuses a missing request ID before the wallet adjustment', async () => {
    const ast = ts.createSourceFile('admin.ts', server, ts.ScriptTarget.Latest, true);
    let expression: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'app.post'
        && node.arguments[0]?.getText(ast) === "'/api/admin/users/:userId/tokens'") expression = node.arguments.at(-1);
      ts.forEachChild(node, visit);
    };
    visit(ast); expect(expression).toBeDefined();
    const adjustAdminBuildTokens = vi.fn(); const audit = vi.fn();
    const run = bind(expression!.getText(ast), { getDb: () => ({}), routeParams: (p: unknown) => p,
      readTokenDelta, readAdminReason, validRequestId, adjustAdminBuildTokens, audit });
    const res = { status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res);
    await run({ params: { userId: 'synthetic-owner' }, body: { delta: 1000, reason: 'test for synthetic apps' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false, code: 'ADMIN_CLIENT_UPDATE_REQUIRED',
      error: expect.stringContaining('No tokens were changed by this request') }));
    expect(adjustAdminBuildTokens).not.toHaveBeenCalled(); expect(audit).not.toHaveBeenCalled();
  });
});

describe('read-only receipt review closes a legitimate re-login recovery without replaying credit', () => {
  it('shows a checked receipt first and requires a separate acknowledgment of that exact review', async () => {
    const { deps } = setup(null);
    const result = { status: 'confirmed', reviewId: 'synthetic-review-one', receipt: { requestId: action.requestId },
      currentWallet: { ok: false, reason: 'Unknown current balance.' } };
    const inspectSavedAdminTokenReceipt = vi.fn(async () => result);
    const acknowledgeSavedAdminTokenReceipt = vi.fn(async () => ({ cleared: true, message: 'Acknowledged.' }));
    const extended = { ...deps, inspectSavedAdminTokenReceipt, acknowledgeSavedAdminTokenReceipt };
    await bind(initializer('checkSavedTokenReceipt'), extended)();
    expect(deps.setTokenReceiptReview).toHaveBeenLastCalledWith({ ok: true, receipt: result.receipt,
      currentWallet: result.currentWallet, reviewId: result.reviewId });
    expect(acknowledgeSavedAdminTokenReceipt).not.toHaveBeenCalled();
    expect(deps.submitAdminTokenAdjustment).not.toHaveBeenCalled();
    extended.tokenReceiptReview = { ...result, ok: true };
    await bind(initializer('acknowledgeTokenReceipt'), extended)();
    expect(acknowledgeSavedAdminTokenReceipt).toHaveBeenCalledWith(deps.tokenSession, undefined,
      { reviewId: result.reviewId, signal: undefined });
    expect(deps.setTokenReceiptReview).toHaveBeenLastCalledWith(null);
    expect(deps.submitAdminTokenAdjustment).not.toHaveBeenCalled();
  });
  it('keeps unknown, not-found and refused receipt outcomes visible without unlocking a new grant', async () => {
    const { deps } = setup(null);
    const inspectSavedAdminTokenReceipt = vi.fn(async () => ({ status: 'unknown', message: 'No verified receipt. Do not add again.' }));
    await bind(initializer('checkSavedTokenReceipt'), { ...deps, inspectSavedAdminTokenReceipt })();
    expect(deps.setTokenRecoveryNotice).toHaveBeenLastCalledWith('No verified receipt. Do not add again.');
    expect(deps.setPendingAction).not.toHaveBeenCalled(); expect(deps.setTokenDelta).not.toHaveBeenCalled();
    expect(deps.submitAdminTokenAdjustment).not.toHaveBeenCalled();
    // A blocked previous session still gets the read-only lookup button; it is not hidden by retry eligibility.
    expect(dashboard).toContain('disabled={pendingBusy || !tokenSession} onClick={() => void checkSavedTokenReceipt()}');
  });
  it('does not display a late receipt after another Admin session has mounted', async () => {
    const { deps } = setup(null);
    let release!: (value: unknown) => void;
    const inspectSavedAdminTokenReceipt = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const pending = bind(initializer('checkSavedTokenReceipt'), { ...deps, inspectSavedAdminTokenReceipt })();
    deps.adminActionGeneration.current++;
    release({ status: 'confirmed', reviewId: 'old-review', receipt: {}, currentWallet: {} });
    await pending;
    expect(deps.setTokenReceiptReview.mock.calls).toEqual([[null]]);
    expect(deps.setTokenRecoveryNotice).not.toHaveBeenCalled();
  });
  it('does not dismiss a receipt when a newer intent prevents local acknowledgment', async () => {
    const { deps } = setup(null);
    deps.tokenReceiptReview = { reviewId: 'synthetic-review-one' };
    const acknowledgeSavedAdminTokenReceipt = vi.fn(async () => ({ cleared: false, message: 'Saved operation changed; nothing cleared.' }));
    await bind(initializer('acknowledgeTokenReceipt'), { ...deps, acknowledgeSavedAdminTokenReceipt })();
    expect(deps.setTokenReceiptReview).not.toHaveBeenCalled(); expect(deps.setTokenDelta).not.toHaveBeenCalled();
    expect(deps.setTokenRecoveryNotice).toHaveBeenCalledWith('Saved operation changed; nothing cleared.');
  });
});
