import { loadStage, LoadDiagnosticError } from './providerLoadDiagnostics';
import { loadPlatformAdmission } from './providerLoadPlatformBudget';
import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { getServerDb } from './serverDb';
import { ProviderLoadBatchStore, advanceLoadBatch, LoadBatchError, type LoadBatchAuthority } from './providerLoadBatch';
import { providerLoadCorpus } from './providerLoadCorpus';
import { readLoadQuote } from './providerLoadQuote';
import { usdToNanoUsd } from '../AI/FreeChain/spendCap';
import { providerLoadAdapter } from './providerLoadAdapter';
const SETTINGS = 'free_chat_chain/provider_load_batch_settings';
function paise(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value)) throw new LoadBatchError('invalid');
  const [whole, fraction = ''] = value.split('.'); const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new LoadBatchError('invalid'); return Number(amount);
}
export class ProviderLoadRuntime {
  readonly store: ProviderLoadBatchStore;
  constructor(private readonly db: Firestore, private readonly quote = readLoadQuote) { this.store = new ProviderLoadBatchStore(db); }
  private async settings() {
    const settings = (await this.db.doc(SETTINGS).get()).data();
    if (!settings) return null;
    if (typeof settings.scopeId !== 'string' || !Number.isSafeInteger(settings.revision) || !Number.isSafeInteger(settings.budgetPaise)
      || !Number.isSafeInteger(settings.allInPaisePerUsd)) throw new LoadBatchError('corrupt');
    return { scopeId: settings.scopeId, revision: settings.revision, budgetPaise: settings.budgetPaise, allInPaisePerUsd: settings.allInPaisePerUsd };
  }
  async status() { const settings = await this.settings(); return { settings, batch: settings ? await this.store.read(settings.scopeId) : null }; }
  async configure(raw: unknown, actor: string) {
    const p = raw as Record<string, unknown>;
    if (!p || Array.isArray(p) || Object.keys(p).sort().join(',') !== 'allInInrPerUsd,attempts,budgetInr,concurrency,expectedRevision,outputTokens,priorAttempts,priorSupplierUsd'
      || ![p.attempts,p.concurrency,p.expectedRevision,p.outputTokens,p.priorAttempts].every(v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0)
      || Number(p.attempts) < 1 || Number(p.attempts) + Number(p.priorAttempts) > 10000 || Number(p.outputTokens) < 1 || Number(p.outputTokens) > 131072) throw new LoadBatchError('invalid');
    const budgetPaise = paise(p.budgetInr), allInPaisePerUsd = paise(p.allInInrPerUsd);
    const total = BigInt(budgetPaise) * 1_000_000_000n / BigInt(allInPaisePerUsd);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new LoadBatchError('invalid');
    let prior: number; try { prior = usdToNanoUsd(String(p.priorSupplierUsd)); } catch { throw new LoadBatchError('invalid'); }
    const settings = await loadStage('settings_read', () => this.settings());
    if ((settings?.revision ?? 0) !== p.expectedRevision) throw new LoadDiagnosticError('conflict', 'revision', 'revision_conflict');
    const quote = await this.quote(Number(p.outputTokens));
    const authority: LoadBatchAuthority = { scopeId: settings?.scopeId ?? randomUUID(), model: quote.model, totalAttempts: Number(p.attempts) + Number(p.priorAttempts),
      priorAttempts: Number(p.priorAttempts), priorCostNanoUsd: prior, totalBudgetNanoUsd: Number(total), maxAttemptNanoUsd: quote.maximumNanoUsd,
      maxConcurrency: 32, maxOutputTokens: Number(p.outputTokens), expiresAt: Date.now() + 86400000 };
    return loadStage('configuration_write', () => this.store.configure(authority, providerLoadCorpus(Number(p.attempts)), Number(p.concurrency), Number(p.expectedRevision), actor, { budgetPaise, allInPaisePerUsd }));
  }
  async advance(waveId: string) {
    const { batch } = await this.status(); if (!batch) throw new LoadBatchError('unavailable');
    // Read-only native quote refresh: no paid request occurs if the earlier reservation is insufficient.
    const quote = await this.quote(batch.authority.maxOutputTokens);
    if (quote.model !== batch.model || quote.maximumNanoUsd > batch.authority.maxAttemptNanoUsd) throw new LoadBatchError('unavailable');
    return advanceLoadBatch(batch.scopeId, providerLoadCorpus(batch.count), this.store,
      providerLoadAdapter(batch.authority), waveId, undefined, loadPlatformAdmission(this.db), batch.revision);
  }
  async resume(expectedRevision: number, actor: string) { const settings = await this.settings(); if (!settings) throw new LoadBatchError('unavailable'); await this.store.setStopped(settings.scopeId, false, actor, expectedRevision); return this.status(); }
  async stop(actor = 'system') { const settings = await this.settings(); if (!settings) throw new LoadBatchError('unavailable'); await this.store.stop(settings.scopeId, actor); return this.status(); }
  async item(ordinal: number) { const settings = await this.settings(); return settings ? this.store.readItem(settings.scopeId, ordinal) : null; }
}
export function providerLoadRuntime(): ProviderLoadRuntime {
  const db = getServerDb(); if (!db) throw new LoadBatchError('unavailable'); return new ProviderLoadRuntime(db);
}
