import { randomUUID, createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { usdToNanoUsd } from '../AI/FreeChain/spendCap';
import { diagnosticAdapter, type DiagnosticAdapter } from './providerDiagnosticRunner';
import { FreeChainProviderError } from '../AI/FreeChain/providers/openAiCompatProvider';

/** Server-supplied authority, NEVER accepted from an HTTP request body. The caller
 * must bind actual approval, prior receipts, FX/fees and a defensible supplier bound.
 * This batch-only contract does not impose any restriction on manual diagnostics. */
import type { LoadBatchAuthority, LoadQuestion, LoadBatch, LoadItem } from '../../shared/providerLoadBatch';
export type { LoadBatchAuthority, LoadQuestion, LoadBatch, LoadItem } from '../../shared/providerLoadBatch';
export class LoadBatchError extends Error {
  constructor(readonly code: 'invalid' | 'conflict' | 'unavailable' | 'expired' | 'disabled' | 'corrupt') { super(`Batch ${code}`); }
}
const MAX_ITEMS = 10000;
const MAX_CONCURRENCY = 32;
const ROOT = 'free_chat_chain/provider_load_batches/scopes';
const CONTROL = 'free_chat_chain/provider_diagnostics/control/cheaperinference';
const safeId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const money = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
function add(a: number, b: number) { const n = a + b; if (!money(n)) throw new LoadBatchError('corrupt'); return n; }
function validateAuthority(a: LoadBatchAuthority) {
  if (!a || Object.keys(a).some(key => !['scopeId','model','totalAttempts','priorAttempts','priorCostNanoUsd','totalBudgetNanoUsd','maxAttemptNanoUsd','maxConcurrency','maxOutputTokens','expiresAt'].includes(key)) || !safeId(a.scopeId) || typeof a.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/:-]{0,255}$/.test(a.model)
    || ![a.totalAttempts, a.priorAttempts, a.priorCostNanoUsd, a.totalBudgetNanoUsd, a.maxAttemptNanoUsd, a.maxConcurrency, a.maxOutputTokens, a.expiresAt].every(money)
    || a.totalAttempts > MAX_ITEMS || a.priorAttempts > a.totalAttempts || a.priorCostNanoUsd > a.totalBudgetNanoUsd
    || a.maxAttemptNanoUsd === 0 || a.maxConcurrency < 1 || a.maxConcurrency > MAX_CONCURRENCY || a.maxOutputTokens < 1) throw new LoadBatchError('invalid');
}
function checked(raw: unknown): LoadBatch {
  const b = raw as LoadBatch;
  if (!b || Object.keys(b).some(key => !['version','revision','scopeId','model','corpusHash','count','concurrency','authority','next','active','completed','spentNanoUsd','heldNanoUsd','stopped','createdAt'].includes(key)) || b.version !== 1) throw new LoadBatchError('corrupt');
  validateAuthority(b.authority);
  if (b.scopeId !== b.authority.scopeId || b.model !== b.authority.model || !/^[a-f0-9]{64}$/.test(b.corpusHash)
    || ![b.revision, b.count, b.concurrency, b.next, b.active, b.completed, b.spentNanoUsd, b.heldNanoUsd, b.createdAt].every(money)
    || typeof b.stopped !== 'boolean' || b.count < 1 || b.count > b.authority.totalAttempts - b.authority.priorAttempts
    || b.concurrency < 1 || b.concurrency > b.authority.maxConcurrency || b.next > b.count || b.active > MAX_CONCURRENCY
    || b.completed > b.next || b.spentNanoUsd < b.authority.priorCostNanoUsd) throw new LoadBatchError('corrupt');
  return b;
}
function checkedItem(raw: unknown): LoadItem {
  const i = raw as LoadItem;
  if (!i || !money(i.ordinal) || !money(i.batchRevision) || !money(i.controlRevision) || !money(i.reservedNanoUsd)
    || typeof i.requestId !== 'string' || !/^[0-9a-f-]{36}$/.test(i.requestId)
    || !['reserved','dispatched','completed','unknown','cancelled'].includes(i.state)
    || i.actualNanoUsd !== null && !money(i.actualNanoUsd) || i.elapsedMs !== null && !money(i.elapsedMs)
    || !['pass','fail','not_evaluated'].includes(i.quality) || typeof i.responseReceived !== 'boolean'
    || !['completed','provider_failure','accounting_unknown','not_dispatched'].includes(i.reason)
    || i.provider !== 'cheaperinference' || typeof i.model !== 'string' || i.retryCount !== 0 || i.fallbackCount !== 0
    || !i.usage || [i.usage.inputTokens, i.usage.outputTokens, i.usage.cachedTokens].some(n => n !== null && !money(n))) throw new LoadBatchError('corrupt');
  return { ordinal: i.ordinal, requestId: i.requestId, batchRevision: i.batchRevision, controlRevision: i.controlRevision, state: i.state, reservedNanoUsd: i.reservedNanoUsd,
    actualNanoUsd: i.actualNanoUsd, elapsedMs: i.elapsedMs, quality: i.quality, responseReceived: i.responseReceived,
    reason: i.reason, provider: i.provider, model: i.model, retryCount: 0, fallbackCount: 0,
    usage: { inputTokens: i.usage.inputTokens, outputTokens: i.usage.outputTokens, cachedTokens: i.usage.cachedTokens } };
}
export function loadCorpusHash(questions: readonly LoadQuestion[]): string {
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > MAX_ITEMS
    || questions.some(q => !q || !safeId(q.id) || typeof q.prompt !== 'string' || !q.prompt.trim() || Buffer.byteLength(q.prompt) > 8192)
    || new Set(questions.map(q => q.id)).size !== questions.length || new Set(questions.map(q => q.prompt)).size !== questions.length) throw new LoadBatchError('invalid');
  // The supplied corpus is explicit synthetic test data, never ordinary user prompts.
  return createHash('sha256').update(JSON.stringify(questions)).digest('hex');
}
/** Durable cross-worker admission. No lease expiry grants permission to re-send:
 * uncertain dispatched work retains BOTH liability and concurrency until resolved. */
export class ProviderLoadBatchStore {
  constructor(private readonly db: Pick<Firestore, 'doc' | 'runTransaction'>, private readonly now = Date.now) {}
  private ref(scope: string) { if (!safeId(scope)) throw new LoadBatchError('invalid'); return this.db.doc(`${ROOT}/${scope}`); }
  private item(scope: string, ordinal: number) {
    if (!money(ordinal) || ordinal >= MAX_ITEMS) throw new LoadBatchError('invalid');
    return this.db.doc(`${this.ref(scope).path}/items/${ordinal}`);
  }
  async read(scope: string): Promise<LoadBatch | null> { const snap = await this.ref(scope).get(); return snap.exists ? checked(snap.data()) : null; }
  async readItem(scope: string, ordinal: number): Promise<LoadItem | null> { const snap = await this.item(scope, ordinal).get(); return snap.exists ? checkedItem(snap.data()) : null; }
  async create(authority: LoadBatchAuthority, questions: readonly LoadQuestion[], concurrency: number): Promise<LoadBatch> {
    validateAuthority(authority); const corpusHash = loadCorpusHash(questions);
    if (!money(concurrency) || concurrency < 1 || concurrency > authority.maxConcurrency || questions.length > authority.totalAttempts - authority.priorAttempts) throw new LoadBatchError('invalid');
    const ref = this.ref(authority.scopeId);
    return this.db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const existing = checked(snap.data());
        if (existing.corpusHash !== corpusHash || existing.concurrency !== concurrency || JSON.stringify(existing.authority) !== JSON.stringify(authority)) throw new LoadBatchError('conflict');
        return existing;
      }
      if (authority.expiresAt <= this.now()) throw new LoadBatchError('expired');
      const batch: LoadBatch = { version: 1, revision: 0, scopeId: authority.scopeId, model: authority.model, corpusHash, count: questions.length, concurrency,
        authority: structuredClone(authority), next: 0, active: 0, completed: 0, spentNanoUsd: authority.priorCostNanoUsd, heldNanoUsd: 0, stopped: false, createdAt: this.now() };
      tx.create(ref, batch); return batch;
    });
  }
  async configure(authority: LoadBatchAuthority, questions: readonly LoadQuestion[], concurrency: number, expectedRevision: number, actor: string,
    display: { budgetPaise: number; allInPaisePerUsd: number }): Promise<LoadBatch> {
    validateAuthority(authority);
    if (!money(expectedRevision) || !money(concurrency) || concurrency < 1 || concurrency > authority.maxConcurrency
      || !actor || actor.length > 200 || questions.length > authority.totalAttempts - authority.priorAttempts
      || !money(display.budgetPaise) || !money(display.allInPaisePerUsd) || display.allInPaisePerUsd === 0) throw new LoadBatchError('invalid');
    const hash = loadCorpusHash(questions);
    return this.db.runTransaction(async tx => {
      const settingsRef = this.db.doc('free_chat_chain/provider_load_batch_settings');
      const settings = (await tx.get(settingsRef)).data();
      if ((settings?.revision ?? 0) !== expectedRevision || settings && settings.scopeId !== authority.scopeId) throw new LoadBatchError('conflict');
      const ref = this.ref(authority.scopeId), snap = await tx.get(ref);
      const b = snap.exists ? checked(snap.data()) : null;
      if (b && (b.authority.priorAttempts !== authority.priorAttempts || b.authority.priorCostNanoUsd !== authority.priorCostNanoUsd
        || b.model !== authority.model || questions.length < b.next || BigInt(b.spentNanoUsd) + BigInt(b.heldNanoUsd) > BigInt(authority.totalBudgetNanoUsd))) throw new LoadBatchError('invalid');
      const next: LoadBatch = b ? { ...b, authority, count: questions.length, corpusHash: hash, concurrency, revision: expectedRevision + 1 }
        : { version: 1, revision: 1, scopeId: authority.scopeId, model: authority.model, corpusHash: hash, count: questions.length, concurrency,
          authority, next: 0, active: 0, completed: 0, spentNanoUsd: authority.priorCostNanoUsd, heldNanoUsd: 0, stopped: false, createdAt: this.now() };
      // Production caller uses a deterministic corpus; enforce the old prefix before count growth.
      if (b && questions.length >= b.count && loadCorpusHash(questions.slice(0, b.count)) !== b.corpusHash) throw new LoadBatchError('conflict');
      tx.set(ref, next);
      tx.set(settingsRef, { scopeId: authority.scopeId, revision: next.revision, ...display });
      tx.create(this.db.doc(`${ref.path}/audit/${next.revision}`), { actor, at: this.now(), revision: next.revision, count: next.count,
        concurrency, budgetNanoUsd: authority.totalBudgetNanoUsd, ...display });
      return next;
    });
  }
  async update(scope: string, expectedRevision: number, authority: LoadBatchAuthority, questions: readonly LoadQuestion[], count: number, concurrency: number, actor: string): Promise<LoadBatch> {
    validateAuthority(authority);
    if (!money(expectedRevision) || !money(count) || !money(concurrency) || concurrency < 1 || concurrency > authority.maxConcurrency
      || !actor || actor.length > 200 || count < 1 || count > authority.totalAttempts - authority.priorAttempts) throw new LoadBatchError('invalid');
    return this.db.runTransaction(async tx => {
      const ref = this.ref(scope), b = checked((await tx.get(ref)).data());
      if (b.revision !== expectedRevision) throw new LoadBatchError('conflict');
      if (authority.scopeId !== scope || authority.model !== b.model || authority.priorAttempts !== b.authority.priorAttempts
        || authority.priorCostNanoUsd !== b.authority.priorCostNanoUsd || count < b.next
        || loadCorpusHash(questions.slice(0, b.count)) !== b.corpusHash || questions.length < count
        || BigInt(b.spentNanoUsd) + BigInt(b.heldNanoUsd) > BigInt(authority.totalBudgetNanoUsd)) throw new LoadBatchError('invalid');
      const next = { ...b, revision: b.revision + 1, authority: structuredClone(authority), corpusHash: loadCorpusHash(questions.slice(0, count)), count, concurrency };
      tx.set(ref, next);
      tx.create(this.db.doc(`${ref.path}/audit/${next.revision}`), { actor, at: this.now(), revision: next.revision,
        previousCount: b.count, count, previousConcurrency: b.concurrency, concurrency,
        previousBudgetNanoUsd: b.authority.totalBudgetNanoUsd, budgetNanoUsd: authority.totalBudgetNanoUsd });
      return next;
    });
  }
  async setStopped(scope: string, stopped: boolean, actor: string, expectedRevision?: number): Promise<void> {
    await this.db.runTransaction(async tx => {
      const ref = this.ref(scope), b = checked((await tx.get(ref)).data());
      const settingsRef = this.db.doc('free_chat_chain/provider_load_batch_settings'), settings = (await tx.get(settingsRef)).data();
      if (expectedRevision !== undefined && expectedRevision !== b.revision) throw new LoadBatchError('conflict');
      if (!stopped && (expectedRevision === undefined || BigInt(b.spentNanoUsd) + BigInt(b.heldNanoUsd) > BigInt(b.authority.totalBudgetNanoUsd))) throw new LoadBatchError('invalid');
      if (b.stopped === stopped) return;
      const revision = b.revision + 1;
      tx.set(ref, { ...b, stopped, revision });
      if (settings?.scopeId === scope) tx.set(settingsRef, { ...settings, revision });
      tx.create(this.db.doc(`${ref.path}/audit/${revision}`), { actor, at: this.now(), revision, action: stopped ? 'stop_unsent' : 'resume_unsent' });
    });
  }
  async stop(scope: string, actor = 'system'): Promise<void> { return this.setStopped(scope, true, actor); }
  async claim(scope: string): Promise<LoadItem | null> {
    return this.db.runTransaction(async tx => {
      const ref = this.ref(scope), b = checked((await tx.get(ref)).data());
      const control = (await tx.get(this.db.doc(CONTROL))).data();
      if (control?.enabled !== true || !money(control.revision)) throw new LoadBatchError('disabled');
      if (b.stopped || b.next >= b.count || b.active >= b.concurrency || b.authority.expiresAt <= this.now()) return null;
      if (BigInt(b.spentNanoUsd) + BigInt(b.heldNanoUsd) + BigInt(b.authority.maxAttemptNanoUsd) > BigInt(b.authority.totalBudgetNanoUsd)) return null;
      const item: LoadItem = { ordinal: b.next, requestId: randomUUID(), batchRevision: b.revision, controlRevision: control.revision, state: 'reserved', reservedNanoUsd: b.authority.maxAttemptNanoUsd,
        actualNanoUsd: null, quality: 'not_evaluated', elapsedMs: null, responseReceived: false, reason: 'not_dispatched',
        provider: 'cheaperinference', model: b.model, retryCount: 0, fallbackCount: 0, usage: { inputTokens: null, outputTokens: null, cachedTokens: null } };
      tx.create(this.item(scope, b.next), item);
      tx.set(ref, { ...b, next: b.next + 1, active: b.active + 1, heldNanoUsd: add(b.heldNanoUsd, item.reservedNanoUsd) });
      return item;
    });
  }
  async cancelReserved(scope: string, item: LoadItem): Promise<void> {
    await this.db.runTransaction(async tx => {
      const ref = this.ref(scope), itemRef = this.item(scope, item.ordinal);
      const b = checked((await tx.get(ref)).data()), i = checkedItem((await tx.get(itemRef)).data());
      if (i.requestId !== item.requestId || i.state !== 'reserved') return;
      tx.set(itemRef, { ...i, state: 'cancelled' });
      tx.set(ref, { ...b, active: b.active - 1, heldNanoUsd: b.heldNanoUsd - i.reservedNanoUsd });
    });
  }
  async claimWave(scope: string, waveId: string, expectedCorpusHash: string, expectedRevision: number): Promise<LoadItem[]> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(waveId)) throw new LoadBatchError('invalid');
    return this.db.runTransaction(async tx => {
      const ref = this.ref(scope), wave = this.db.doc(`${ref.path}/waves/${waveId.toLowerCase()}`);
      const previous = await tx.get(wave);
      if (previous.exists) return []; // A lost acknowledgement never grants another dispatch.
      const b = checked((await tx.get(ref)).data());
      if (b.corpusHash !== expectedCorpusHash || b.revision !== expectedRevision) throw new LoadBatchError('conflict');
      const control = (await tx.get(this.db.doc(CONTROL))).data();
      if (control?.enabled !== true || !money(control.revision)) throw new LoadBatchError('disabled');
      const items: LoadItem[] = [];
      let held = b.heldNanoUsd;
      if (!b.stopped && b.authority.expiresAt > this.now()) {
        while (items.length < b.concurrency - b.active && b.next + items.length < b.count
          && BigInt(b.spentNanoUsd) + BigInt(held) + BigInt(b.authority.maxAttemptNanoUsd) <= BigInt(b.authority.totalBudgetNanoUsd)) {
          items.push({ ordinal: b.next + items.length, requestId: randomUUID(), batchRevision: b.revision, controlRevision: control.revision, state: 'reserved',
            reservedNanoUsd: b.authority.maxAttemptNanoUsd, actualNanoUsd: null, quality: 'not_evaluated', elapsedMs: null, responseReceived: false,
            reason: 'not_dispatched', provider: 'cheaperinference', model: b.model, retryCount: 0, fallbackCount: 0,
            usage: { inputTokens: null, outputTokens: null, cachedTokens: null } });
          held = add(held, b.authority.maxAttemptNanoUsd);
        }
      }
      tx.create(wave, { waveId: waveId.toLowerCase(), ordinals: items.map(i => i.ordinal), createdAt: this.now() });
      for (const item of items) tx.create(this.item(scope, item.ordinal), item);
      tx.set(ref, { ...b, next: b.next + items.length, active: b.active + items.length, heldNanoUsd: held });
      return items;
    });
  }
  async dispatch(scope: string, claim: LoadItem): Promise<boolean> {
    return this.db.runTransaction(async tx => {
      const ref = this.ref(scope), itemRef = this.item(scope, claim.ordinal);
      const b = checked((await tx.get(ref)).data()), i = checkedItem((await tx.get(itemRef)).data());
      const control = (await tx.get(this.db.doc(CONTROL))).data();
      if (!i || i.requestId !== claim.requestId || i.state !== 'reserved') return false;
      if (b.stopped || b.revision !== i.batchRevision || control?.enabled !== true || control.revision !== i.controlRevision || b.authority.expiresAt <= this.now()) {
        tx.set(itemRef, { ...i, state: 'cancelled' });
        tx.set(ref, { ...b, active: b.active - 1, heldNanoUsd: b.heldNanoUsd - i.reservedNanoUsd });
        return false;
      }
      tx.set(itemRef, { ...i, state: 'dispatched' }); return true;
    });
  }
  async finish(scope: string, claim: LoadItem, result: Pick<LoadItem, 'actualNanoUsd' | 'quality' | 'elapsedMs' | 'responseReceived' | 'usage'>): Promise<void> {
    if (result.actualNanoUsd !== null && !money(result.actualNanoUsd) || !money(result.elapsedMs) || typeof result.responseReceived !== 'boolean'
      || !['pass', 'fail', 'not_evaluated'].includes(result.quality) || Object.values(result.usage).some(n => n !== null && !money(n))) throw new LoadBatchError('invalid');
    await this.db.runTransaction(async tx => {
      const ref = this.ref(scope), itemRef = this.item(scope, claim.ordinal);
      const b = checked((await tx.get(ref)).data()), i = checkedItem((await tx.get(itemRef)).data());
      if (!i || i.requestId !== claim.requestId) throw new LoadBatchError('conflict');
      if (i.state === 'completed' || i.state === 'unknown') {
        if (i.actualNanoUsd !== result.actualNanoUsd || i.quality !== result.quality || i.responseReceived !== result.responseReceived) throw new LoadBatchError('conflict');
        return; // Identical terminal settlement is idempotent, never a second charge.
      }
      if (i.state !== 'dispatched') throw new LoadBatchError('conflict');
      const actual = result.actualNanoUsd;
      // Only an observed complete response proves that the supplier call has finished.
      // Network/timeout ambiguity keeps a concurrency slot too; never quietly requeue it.
      const released = result.responseReceived;
      const next: LoadItem = { ...i, actualNanoUsd: actual, quality: result.quality, elapsedMs: result.elapsedMs,
        responseReceived: released, usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, cachedTokens: result.usage.cachedTokens },
        state: actual === null ? 'unknown' : 'completed', reason: result.quality === 'not_evaluated' ? 'provider_failure' : actual === null ? 'accounting_unknown' : 'completed' };
      tx.set(itemRef, next);
      tx.set(ref, { ...b, completed: b.completed + 1, active: b.active - (released ? 1 : 0),
        spentNanoUsd: actual === null ? b.spentNanoUsd : add(b.spentNanoUsd, actual),
        heldNanoUsd: actual === null ? b.heldNanoUsd : b.heldNanoUsd - i.reservedNanoUsd,
        stopped: b.stopped || actual !== null && actual > i.reservedNanoUsd });
    });
  }
}
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((key, n) => key === kb[n] && sameJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
/** Advances a bounded chunk only when invoked explicitly by the authenticated controller.
 * Reload/recovery never invokes this method. No detached workers, retry or provider fallback. */
export async function advanceLoadBatch(scope: string, questions: readonly LoadQuestion[], store: ProviderLoadBatchStore,
  adapter: DiagnosticAdapter, waveId: string, clock = () => performance.now(),
  admit?: (item: LoadItem, batch: LoadBatch) => Promise<(actual: number | null) => Promise<void>>, expectedRevision?: number): Promise<LoadBatch> {
  const batch = await store.read(scope);
  if (!batch || expectedRevision !== undefined && batch.revision !== expectedRevision || batch.corpusHash !== loadCorpusHash(questions) || batch.model !== adapter.model) throw new LoadBatchError('conflict');
  const items = await store.claimWave(scope, waveId, batch.corpusHash, batch.revision);
  const outcomes = await Promise.allSettled(items.map(async item => {
    let settlePlatform: ((actual: number | null) => Promise<void>) | undefined;
    try { settlePlatform = await admit?.(item, batch); }
    catch { await store.cancelReserved(scope, item); throw new LoadBatchError('unavailable'); }
    if (!await store.dispatch(scope, item)) { await settlePlatform?.(0); return; }
    const started = clock();
    let actualNanoUsd: number | null = null, quality: LoadItem['quality'] = 'not_evaluated', responseReceived = false;
    let usage: LoadItem['usage'] = { inputTokens: null, outputTokens: null, cachedTokens: null };
    try {
      const reply = await adapter.call(questions[item.ordinal].prompt, new AbortController().signal);
      responseReceived = true; usage = reply.usage;
      try { actualNanoUsd = reply.amount === null ? null : usdToNanoUsd(reply.amount); } catch { /* unknown is never zero */ }
      try { quality = sameJson(JSON.parse(reply.text), questions[item.ordinal].expected) ? 'pass' : 'fail'; } catch { quality = 'fail'; }
    } catch (error) {
      // Structured authenticated charge evidence survives failed calls too.
      if (error instanceof FreeChainProviderError) {
        try { actualNanoUsd = error.supplierChargeUsd === undefined ? null : usdToNanoUsd(error.supplierChargeUsd); } catch { /* unknown */ }
        // Even HTTP 502/503/504 can arrive while upstream work continues.
        // Only a successful adapter completion releases the concurrency slot.
      }
    }
    // Always retain the local result even when shared settlement acknowledgement is lost.
    const settlements = await Promise.allSettled([
      store.finish(scope, item, { actualNanoUsd, quality, responseReceived, usage, elapsedMs: Math.max(0, Math.round(clock() - started)) }),
      settlePlatform?.(actualNanoUsd),
    ]);
    if (settlements.some(settlement => settlement.status === 'rejected')) throw new LoadBatchError('unavailable');
  }));
  if (outcomes.some(outcome => outcome.status === 'rejected')) throw new LoadBatchError('unavailable');
  return (await store.read(scope))!;
}


/** Explicit server-side binding. No default/fabricated spending authority is created.
 * Production composition must reconcile the original run and supply actual bounds;
 * clients cannot provide or replace these via the batch HTTP API. */
export class ProviderLoadBatchService {
  constructor(readonly store: ProviderLoadBatchStore, private readonly questions: readonly LoadQuestion[],
    private readonly authority: () => Promise<LoadBatchAuthority>,
    private readonly adapter = (a: LoadBatchAuthority) => diagnosticAdapter('cheaperinference', process.env, false, a.maxOutputTokens)) {}
  private async context() {
    const authority = await this.authority(); validateAuthority(authority);
    return authority;
  }
  async status() { const a = await this.context(); return this.store.read(a.scopeId); }
  async create(concurrency: number) { return this.store.create(await this.context(), this.questions, concurrency); }
  async advance(waveId: string) {
    const a = await this.context(), b = await this.store.read(a.scopeId);
    if (!b || JSON.stringify(a) !== JSON.stringify(b.authority)) throw new LoadBatchError('conflict');
    return advanceLoadBatch(a.scopeId, this.questions, this.store, this.adapter(a), waveId);
  }
  async stop() { const a = await this.context(); await this.store.stop(a.scopeId); return this.store.read(a.scopeId); }
  async item(ordinal: number) { const a = await this.context(); return this.store.readItem(a.scopeId, ordinal); }
}
