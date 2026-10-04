// ONE ANSWER PATH for an app's built-in assistant — the published gateway AND the owner's preview both come
// here, so "whose key answers, is it switched off, is it within its cap, who pays" is decided once.
//
// Order, and why:
//   1. The owner's OWN key (appAiOwnKey.ts) — their choice wins, costs their provider and never our wallet.
//      A refused key is reported, never silently replaced by our engine.
//   2. The owner switched NavBharatAI's AI off (AppAiSettingsStore) → refused.
//   3. NavBharatAI's engine, inside the caps (gatewayDecision), charged to the owner's one wallet AFTER the
//      answer exists — the same rule every other assistant follows.

import { gatewayDecision, type GatewayRefusal } from './appAiGateway';
import { appAiUsageStore } from './AppAiUsageStore';
import { getAppAiSettings } from './AppAiSettingsStore';
import { ownKeyFor, askWithOwnKey, type OwnKeyProvider } from './appAiOwnKey';
import { callProfessionalAIWithUsage } from './professionalRouting';
import { collectAiSpend } from './aiSpendZone';
import { chargeForAiTurns } from './aiTurnCharge';
import { chatTurnCost, sumChatTurnCosts } from './chatSpend';
import { usdInrRate } from './UsdInrRate';
import { getServerDb } from './serverDb';
import { readWalletBalanceInr, firestoreWalletReader } from '../AgentV3/WalletBalance';

export type AppAiRefusal = GatewayRefusal | 'switched-off' | 'own-key-refused' | 'own-key-failed';

export type AppAiAnswer =
  /**
   * `settle` moves the counters and the money. The caller runs it AFTER the answer has been sent, so a
   * money-path failure can never cost anyone their reply (the same rule as every other assistant).
   */
  | { ok: true; text: string; via: 'own-key' | 'navbharat'; provider?: OwnKeyProvider; settle: () => void }
  | { ok: false; reason: AppAiRefusal; provider?: OwnKeyProvider };

export interface AppAiAsk {
  ownerId: string;
  workspaceId: string;
  system: string;
  prompt: string;
  /** Counter identity and caps: a published app's id + visitor, or `preview:<workspace>` with the preview cap. */
  counter: { appId: string; visitor: string; day: string; appCapInr: number; visitorCapInr: number };
}

export async function answerForApp(ask: AppAiAsk): Promise<AppAiAnswer> {
  const own = await ownKeyFor(ask.ownerId, ask.workspaceId);
  if (own) {
    const r = await askWithOwnKey(own, ask.system, ask.prompt);
    if (!r.ok) return { ok: false, reason: r.reason === 'refused' ? 'own-key-refused' : 'own-key-failed', provider: own.provider };
    // ₹0 on our side, but the CALL still counts — the counter is how a rate is seen later.
    const settleOwn = () => { void appAiUsageStore.record(ask.counter.appId, ask.counter.visitor, ask.counter.day, 0); };
    return { ok: true, text: r.text, via: 'own-key', provider: own.provider, settle: settleOwn };
  }

  if ((await getAppAiSettings(ask.workspaceId)).disabled) return { ok: false, reason: 'switched-off' };

  const [spent, balanceInr] = await Promise.all([
    appAiUsageStore.spentToday(ask.counter.appId, ask.counter.visitor, ask.counter.day),
    ask.ownerId ? readWalletBalanceInr(firestoreWalletReader(getServerDb() as any), ask.ownerId).catch(() => null) : Promise.resolve(null),
  ]);
  const decision = gatewayDecision(
    { appSpentInr: spent.appSpentInr, visitorSpentInr: spent.visitorSpentInr, ownerBalanceInr: balanceInr },
    { appCapInr: ask.counter.appCapInr, visitorCapInr: ask.counter.visitorCapInr },
  );
  if (!decision.allow) return { ok: false, reason: decision.reason };
  if (!spent.known) console.warn(`[APPAI] ${ask.counter.appId}: spend counters unreadable — this call was allowed without a cap check.`);

  const run = await collectAiSpend(() => callProfessionalAIWithUsage(ask.system, ask.prompt, 'free'));
  if (!run.ok) {
    console.error(`[APPAI] ${ask.counter.appId}: the assistant chain failed:`, run.error);
    return { ok: false, reason: 'disabled' };
  }
  const settle = () => {
    const usdInr = usdInrRate();
    const cost = sumChatTurnCosts(run.spend.map((u) => chatTurnCost(u, usdInr)), usdInr);
    // The COUNTER moves on what the turn COST, not on what was debited: the two differ whenever the
    // wallet is switched off or the owner is free-listed, and the cap has to keep biting then too.
    void appAiUsageStore.record(ask.counter.appId, ask.counter.visitor, ask.counter.day, cost.billedInr);
    // 🔒 NEITHER `isFreeListed` NOR `hasActivePass` IS PASSED, on purpose: a Pass pays for the HOLDER's
    // own assistant use, not an unlimited number of strangers; the free list is an account courtesy.
    void chargeForAiTurns(getServerDb() as any, { userId: ask.ownerId || null, feature: 'app-assistant' }, run.spend, usdInr, Date.now());
  };
  return { ok: true, text: run.result.content, via: 'navbharat', settle };
}
