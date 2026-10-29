import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { DiagnosticProvider } from '../../shared/providerDiagnostics';
import { ProviderDiagnosticStore, DiagnosticAdmissionError, checkedRun } from './providerDiagnosticStore';

// Keep the deployed run namespace so old/new revisions contend on the same key.
const ROOT = 'free_chat_chain/provider_diagnostic_pair_20261028';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface DiagnosticStoredRun {
  runId: string; provider: DiagnosticProvider; model: string; startedAt: number;
  state: 'pending' | 'reserved' | 'settled' | 'unknown_liability'; actualCostNanoUsd: number | null;
  reservedNanoUsd?: number; dispatchBefore?: number; completedAt?: number;
}
interface DirectRun extends DiagnosticStoredRun { version: 2; controlRevision: number; dispatchClaimedAt?: number; accountingBasis: 'supplier_receipt_only' }
function project(raw: unknown): DirectRun {
  const r = raw as DirectRun;
  if (!r || r.version !== 2 || !UUID.test(r.runId) || !['surplus', 'cheaperinference'].includes(r.provider)
    || typeof r.model !== 'string' || !Number.isSafeInteger(r.startedAt) || (!Number.isSafeInteger(r.controlRevision) || r.controlRevision < 0)
    || !['pending', 'settled', 'unknown_liability'].includes(r.state)
    || r.accountingBasis !== 'supplier_receipt_only'
    || !(r.actualCostNanoUsd === null || Number.isSafeInteger(r.actualCostNanoUsd) && r.actualCostNanoUsd >= 0)) throw new DiagnosticAdmissionError('accounting_failed');
  return { version: 2, accountingBasis: 'supplier_receipt_only', runId: r.runId, provider: r.provider, model: r.model,
    startedAt: r.startedAt, state: r.state, actualCostNanoUsd: r.actualCostNanoUsd, controlRevision: r.controlRevision,
    ...(Number.isSafeInteger(r.completedAt) ? { completedAt: r.completedAt } : {}),
    ...(Number.isSafeInteger(r.dispatchClaimedAt) ? { dispatchClaimedAt: r.dispatchClaimedAt } : {}) };
}
/** Manual admin tests: durable idempotency and honest receipts, without diagnostic
 * pricing/budget/concurrency gates. Historical budget holds are never modified.
 * No prompts, responses, raw errors, keys or key hashes are persisted here. */
export class ProviderDiagnosticDirectStore {
  readonly controls: ProviderDiagnosticStore;
  constructor(private readonly db: Pick<Firestore, 'doc' | 'runTransaction'>, private readonly now = Date.now) {
    this.controls = new ProviderDiagnosticStore(db, now);
  }
  control = (provider: DiagnosticProvider) => this.controls.control(provider);
  setControl = (provider: DiagnosticProvider, enabled: boolean, revision: number, actor: string) => this.controls.setControl(provider, enabled, revision, actor);
  private ref(key: string) {
    if (!UUID.test(key)) throw new DiagnosticAdmissionError('invalid_request');
    return this.db.doc(`${ROOT}/runs/${key.toLowerCase()}`);
  }
  async read(key: string): Promise<DiagnosticStoredRun | null> {
    const snap = await this.ref(key).get();
    if (snap.exists) return snap.data()?.version === 2 ? project(snap.data()) : checkedRun(snap.data());
    for (const root of ['free_chat_chain/provider_diagnostics']) {
      const prior = await this.db.doc(`${root}/runs/${key.toLowerCase()}`).get();
      if (prior.exists) return checkedRun(prior.data());
    }
    return null;
  }
  async status(provider: DiagnosticProvider, _model: string, _tokens?: number) {
    const c = await this.control(provider);
    return { dispatchReady: c.enabled, reason: c.enabled ? null : 'diagnostics_disabled', missingFields: [] as string[] };
  }
  async reserve(key: string, provider: DiagnosticProvider, model: string): Promise<{ mayDispatch: boolean; run: DiagnosticStoredRun }> {
    if (!['surplus', 'cheaperinference'].includes(provider) || !/^[A-Za-z0-9][A-Za-z0-9._/:-]{0,255}$/.test(model)) throw new DiagnosticAdmissionError('invalid_request');
    const ref = this.ref(key), runId = randomUUID();
    return this.db.runTransaction(async tx => {
      const current = await tx.get(ref);
      const old = await Promise.all(['free_chat_chain/provider_diagnostics'].map(root => tx.get(this.db.doc(`${root}/runs/${key.toLowerCase()}`))));
      const existing = current.exists ? (current.data()?.version === 2 ? project(current.data()) : checkedRun(current.data())) : old.find(s => s.exists);
      if (existing) {
        const run = 'data' in existing ? checkedRun(existing.data()) : existing;
        if (run.provider !== provider || run.model !== model) throw new DiagnosticAdmissionError('invalid_request');
        return { mayDispatch: false, run };
      }
      const controlRef = this.db.doc(`free_chat_chain/provider_diagnostics/control/${provider}`);
      const c = (await tx.get(controlRef)).data();
      if (c?.enabled !== true || (!Number.isSafeInteger(c.revision) || c.revision < 0)) throw new DiagnosticAdmissionError('diagnostics_disabled');
      const run: DirectRun = { version: 2, accountingBasis: 'supplier_receipt_only', runId, provider, model, startedAt: this.now(),
        controlRevision: c.revision, state: 'pending', actualCostNanoUsd: null };
      tx.create(ref, run); return { mayDispatch: true, run };
    });
  }
  async claimDispatch(key: string, runId: string): Promise<boolean> {
    return this.db.runTransaction(async tx => {
      const ref = this.ref(key), run = project((await tx.get(ref)).data());
      const c = (await tx.get(this.db.doc(`free_chat_chain/provider_diagnostics/control/${run.provider}`))).data();
      if (run.runId !== runId || run.state !== 'pending' || run.dispatchClaimedAt !== undefined || c?.enabled !== true || !Number.isSafeInteger(c.revision) || c.revision < 0 || c.revision !== run.controlRevision) return false;
      tx.set(ref, { ...run, dispatchClaimedAt: this.now() }); return true;
    });
  }
  async finish(key: string, runId: string, amount: number | null): Promise<DiagnosticStoredRun> {
    if (!(amount === null || Number.isSafeInteger(amount) && amount >= 0)) throw new DiagnosticAdmissionError('accounting_failed');
    return this.db.runTransaction(async tx => {
      const ref = this.ref(key), run = project((await tx.get(ref)).data());
      if (run.runId !== runId) throw new DiagnosticAdmissionError('accounting_failed');
      if (run.state !== 'pending') {
        if (run.actualCostNanoUsd !== amount) throw new DiagnosticAdmissionError('accounting_failed');
        return run;
      }
      const next: DirectRun = { ...run, completedAt: this.now(), actualCostNanoUsd: amount,
        state: amount === null ? 'unknown_liability' : 'settled' };
      tx.set(ref, next); return next;
    });
  }
}
