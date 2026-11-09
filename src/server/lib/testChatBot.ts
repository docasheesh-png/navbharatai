import { readTestChatAction, TEST_CHAT_MAX_MODEL_CHARS, TEST_CHAT_MAX_RESPONSE_CHARS,
  type TestChatAction, type TestChatReply, type TestChatStatus } from '../../lib/testChatBot';
import { qubaxConfig, QubaxError, runApprovedQubaxChat } from './qubax';
import { getServerDb } from './serverDb';
import { assertLegacyInferenceAllowed } from '../AI/inferencePolicy';
import { freeChainConfig } from '../AI/FreeChain/config';
import { FreeChainStore } from '../AI/FreeChain/store';
import { createTestChatPolicyFence, assertTestChatMaintenanceAtClaim } from './testChatPolicyFence';
import { testChatPayload, testChatRequestId, testChatUid } from './testChatPayload';
import { reserveMonthly, settleMonthly } from '../AI/FreeChain/masterPlan';

export class TestChatUnavailable extends Error {
  constructor(readonly reason: 'disabled' | 'configuration' | 'storage' | 'approval-or-budget' | 'invalid' | 'unconfirmed' | 'catalog' | 'approval' | 'budget' | 'capacity' | 'selection' | 'capability', readonly status = 503, readonly diagnostic?: string) { super(reason); }
}
/** Reading this status never probes the provider, performs inference or reveals a credential. */
export function testChatStatus(): TestChatStatus {
  let configured = false, enabled = false;
  try { const cfg = qubaxConfig(); configured = !!cfg.apiKey; enabled = cfg.enabled; } catch { /* Invalid config fails closed. */ }
  return { providers: [{ id: 'qubax', label: 'Qubax', configured, enabled, model: null }], approvalRequired: true, noFallback: true };
}

/** Fixed server-owned registry. Adding a provider requires its reviewed adapter and tests, not an arbitrary URL/key. */
const providers = { qubax: runApprovedQubaxChat } as const;

export async function runTestChat(value: TestChatAction, actor: string, signal: AbortSignal): Promise<TestChatReply> {
  const action = readTestChatAction(value);
  if (!action) throw new TestChatUnavailable('invalid', 400);
  const status = testChatStatus().providers.find(p => p.id === action.provider)!;
  if (!status.enabled) throw new TestChatUnavailable('disabled');
  if (!status.configured) throw new TestChatUnavailable('configuration');
  const db = getServerDb();
  if (!db) throw new TestChatUnavailable('storage');
  const cfg = freeChainConfig();
  if (cfg.errors.some(e => /PAID_DAILY_CAP|MONTHLY_CAP|PAID_PER_USER/.test(e))) throw new TestChatUnavailable('budget', 409, 'budget-configuration');
  const uid = testChatUid(actor);
  const payload = testChatPayload(action);
  const requestId = testChatRequestId(action);
  const budget = new FreeChainStore(db);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
  const startedAt = Date.now();
  const policyFence = createTestChatPolicyFence();
  const revalidate = async () => {
    bounded.throwIfAborted();
    await policyFence.refresh();
    assertLegacyInferenceAllowed('admin-test-chat-bot');
    if (!qubaxConfig().enabled) throw new TestChatUnavailable('disabled');
  };
  try {
    await revalidate();
    const result = await providers[action.provider]({ db, uid, requestId, signal: bounded,
      // Arbitrary typed context is never downgraded to public by a checkbox or a keyword classifier.
      // The independent exact-payload review must cover both private and health data classes.
      privateTurn: payload.privateTurn, healthTurn: payload.healthTurn, body: payload.body,
      requireIndependentReview: true,
      revalidate,
      validateFinalClaim: async tx => { await assertTestChatMaintenanceAtClaim(db, tx); policyFence.assertCurrent(); },
      beforeHttpDispatch: () => { bounded.throwIfAborted(); policyFence.assertCurrent(); },
      reserve: async maximumNanoUsd => {
        await revalidate();
        if (!Number.isSafeInteger(maximumNanoUsd) || maximumNanoUsd <= 0) return null;
        const month = cfg.features.monthlyCap ? await reserveMonthly(db, cfg.features.monthlyCapNanoUsd, maximumNanoUsd) : null;
        if (cfg.features.monthlyCap && !month) return null;
        // Duplicate/uncertain reservations do not authorize another request. Never relax the shared caps.
        let hold;
        try {
          hold = await budget.reservePaid({ requestId, uid, maxCostNanoUsd: maximumNanoUsd,
            capNanoUsd: cfg.paidCapNanoUsd, perUserLimit: cfg.paidPerUserDaily });
        } catch (error) {
          // This attempt never dispatched. Release only its fresh monthly hold;
          // a rejected daily write has no receipt proving that liability can be cleared.
          if (month) await settleMonthly(db, month, maximumNanoUsd, 0);
          throw error;
        }
        if (hold && !hold.mayDispatch) {
          // This is a new monthly hold for an already-claimed daily request, not that request's original hold.
          if (month) await settleMonthly(db, month, maximumNanoUsd, 0);
          throw new TestChatUnavailable('unconfirmed', 409);
        }
        if (!hold) { if (month) await settleMonthly(db, month, maximumNanoUsd, 0); return null; }
        return { releaseUndispatched: async () => {
          await budget.settlePaid(hold, 0);
          if (month) await settleMonthly(db, month, maximumNanoUsd, 0);
        } };
      },
    });
    if (result.kind === 'skipped') {
      const reasons: Record<string, TestChatUnavailable['reason']> = {
        'qubax-disabled-or-unconfigured': 'configuration', 'qubax-configuration': 'configuration',
        'qubax-capability-excluded': 'capability', 'qubax-capacity': 'capacity',
        'qubax-price-or-quality-unverified': 'catalog', 'qubax-selection-claim-mismatch': 'selection',
        'qubax-data-approval-or-ceiling-unavailable': 'approval', 'qubax-budget': 'budget',
      };
      const reason = reasons[result.reason];
      throw new TestChatUnavailable(reason ?? 'unconfirmed', 409, reason ? result.reason : undefined);
    }
    if (!result.content.trim() || result.content.length > TEST_CHAT_MAX_RESPONSE_CHARS || result.model.length > TEST_CHAT_MAX_MODEL_CHARS) throw new TestChatUnavailable('unconfirmed');
    // A successful text response is not an invoice. The reviewed maximum stays reserved until reconciled.
    return { requestId: action.requestId, provider: action.provider, content: result.content, model: result.model,
      latencyMs: Math.max(0, Date.now() - startedAt), ...(result.usage ? { usage: result.usage } : {}), ...(payload.synthetic ? { syntheticMatch: result.content.trim() === '4' } : {}), noFallback: true };
  } catch (error) {
    if (error instanceof TestChatUnavailable) throw error;
    if (error instanceof QubaxError) {
      // Fixed identifiers only. A response failure still has unknown liability and never permits automatic retry.
      const diagnostic = error.status === 401 ? 'qubax-auth-401' : error.status === 403 ? 'qubax-auth-403'
        : error.status === 402 ? 'qubax-payment-402' : error.status === 429 ? 'qubax-rate-429'
        : error.status >= 500 ? 'qubax-upstream-5xx'
        : ['QUBAX_CANCELLED', 'QUBAX_INVALID_RESPONSE', 'QUBAX_INCOMPLETE_STREAM', 'QUBAX_POLICY_BLOCKED', 'QUBAX_APPROVAL_REVOKED'].includes(error.code) ? error.code : 'qubax-unavailable';
      throw new TestChatUnavailable('unconfirmed', 503, diagnostic);
    }
    throw new TestChatUnavailable('unconfirmed');
  } finally { policyFence.close(); }
}
