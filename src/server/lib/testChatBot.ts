import { readTestChatAction, TEST_CHAT_MAX_OUTPUT_TOKENS, TEST_CHAT_MAX_RESPONSE_CHARS,
  type TestChatAction, type TestChatReply, type TestChatStatus } from '../../lib/testChatBot';
import { nanoUsdToDecimal, qubaxModelOverride, qubaxRequestCeilingNanoUsd, readQubaxFeedSummary, readQubaxMarketPlan } from './qubaxMarket';
import { qubaxConfig, QubaxError, runApprovedQubaxChat } from './qubax';
import { getServerDb } from './serverDb';
import { assertAiAvailable } from './aiMaintenance';
import { assertLegacyInferenceAllowed } from '../AI/inferencePolicy';
import { freeChainConfig } from '../AI/FreeChain/config';
import { FreeChainStore } from '../AI/FreeChain/store';
import { reserveMonthly, settleMonthly } from '../AI/FreeChain/masterPlan';
import { testChatRequestId, testChatUid } from './testChatPayload';

export class TestChatUnavailable extends Error {
  constructor(readonly reason: 'disabled' | 'configuration' | 'storage' | 'budget' | 'no-model' | 'tries-exhausted' | 'capacity' | 'capability' | 'invalid' | 'unconfirmed', readonly status = 503) { super(reason); }
}
const SKIP_REASON: Record<string, TestChatUnavailable['reason']> = {
  'qubax-disabled-or-unconfigured': 'configuration',
  'qubax-configuration': 'configuration',
  'qubax-capability-excluded': 'capability',
  'qubax-capacity': 'capacity',
  'qubax-price-or-quality-unverified': 'no-model',
  'qubax-budget': 'budget',
  'qubax-tries-exhausted': 'tries-exhausted',
};
/** Reading this status never probes the provider, performs inference or reveals a credential. */
export async function loadTestChatStatus(): Promise<TestChatStatus> {
  const status = testChatStatus();
  const ceiling = qubaxRequestCeilingNanoUsd(process.env);
  const override = qubaxModelOverride(process.env);
  if (!ceiling || override.mode === 'invalid') return status;
  try {
    const db = getServerDb();
    if (!db) return status;
    const [plan, feed] = await Promise.all([readQubaxMarketPlan(db, override, Date.now()), readQubaxFeedSummary(db, Date.now())]);
    const choice = plan.eligible[0] ?? plan.backup;
    if (!choice) return { ...status, feed, approvalRequired: false, providers: [{ ...status.providers[0], model: null, ceilingUsd: nanoUsdToDecimal(ceiling), selection: 'none' }] };
    return { ...status, feed, approvalRequired: false, providers: [{ ...status.providers[0], model: choice.modelId, ceilingUsd: nanoUsdToDecimal(ceiling),
      selection: choice.backup ? 'backup' : 'performance', inputUsdPerMillion: nanoUsdToDecimal(choice.inputNanoUsdPerMillion),
      outputUsdPerMillion: nanoUsdToDecimal(choice.outputNanoUsdPerMillion),
      officialInputUsdPerMillion: choice.officialInputNanoUsdPerMillion === null ? null : nanoUsdToDecimal(choice.officialInputNanoUsdPerMillion),
      officialOutputUsdPerMillion: choice.officialOutputNanoUsdPerMillion === null ? null : nanoUsdToDecimal(choice.officialOutputNanoUsdPerMillion),
      discountBps: choice.discountBps }] };
  } catch { return status; }
}
export function testChatStatus(): TestChatStatus {
  let configured = false, enabled = false;
  try { const cfg = qubaxConfig(); configured = !!cfg.apiKey; enabled = cfg.enabled; } catch { /* Invalid config fails closed. */ }
  const ceiling = qubaxRequestCeilingNanoUsd(process.env);
  return { providers: [{ id: 'qubax', label: 'Qubax', configured, enabled, model: null, ceilingUsd: ceiling ? nanoUsdToDecimal(ceiling) : null }], approvalRequired: !ceiling, noFallback: true };
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
  if (cfg.errors.some(e => /PAID_DAILY_CAP|MONTHLY_CAP|PAID_PER_USER/.test(e))) throw new TestChatUnavailable('budget', 409);
  const uid = testChatUid(actor);
  const requestId = testChatRequestId(action);
  const budget = new FreeChainStore(db);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
  const startedAt = Date.now();
  const revalidate = async () => {
    bounded.throwIfAborted();
    await assertAiAvailable();
    assertLegacyInferenceAllowed('admin-test-chat-bot');
    if (!qubaxConfig().enabled) throw new TestChatUnavailable('disabled');
  };
  await revalidate();
  try {
    const result = await providers[action.provider]({ db, uid, requestId, signal: bounded,
      // Arbitrary typed context is never downgraded to public by a checkbox or a keyword classifier.
      // The independent exact-payload review must cover both private and health data classes.
      privateTurn: true, healthTurn: true,
      body: { messages: action.messages, max_tokens: TEST_CHAT_MAX_OUTPUT_TOKENS, stream: false },
      revalidate,
      reserve: async (maximumNanoUsd, attemptKey) => {
        await revalidate();
        if (!Number.isSafeInteger(maximumNanoUsd) || maximumNanoUsd <= 0) return null;
        const month = cfg.features.monthlyCap ? await reserveMonthly(db, cfg.features.monthlyCapNanoUsd, maximumNanoUsd) : null;
        if (cfg.features.monthlyCap && !month) return null;
        // Duplicate/uncertain reservations do not authorize another request. Never relax the shared caps.
        let hold;
        try {
          hold = await budget.reservePaid({ requestId: attemptKey ?? requestId, uid, maxCostNanoUsd: maximumNanoUsd,
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
    if (result.kind === 'skipped') throw new TestChatUnavailable(SKIP_REASON[result.reason] ?? 'unconfirmed', 409);
    if (!result.content.trim() || result.content.length > TEST_CHAT_MAX_RESPONSE_CHARS || result.model.length > 200) throw new TestChatUnavailable('unconfirmed');
    // A successful text response is not an invoice. The reviewed maximum stays reserved until reconciled.
    return { requestId: action.requestId, provider: action.provider, content: result.content, model: result.model,
      latencyMs: Math.max(0, Date.now() - startedAt), ...(result.usage ? { usage: result.usage } : {}), noFallback: true };
  } catch (error) {
    if (error instanceof TestChatUnavailable) throw error;
    if (error instanceof QubaxError) throw new TestChatUnavailable('unconfirmed');
    throw new TestChatUnavailable('unconfirmed');
  }
}
