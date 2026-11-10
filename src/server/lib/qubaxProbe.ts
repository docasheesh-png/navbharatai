import { randomBytes } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { dueQubaxProbe, emptyProbeLedger, istProbeDay, qubaxProbeDailyCapNanoUsd, qubaxRequestCeilingNanoUsd, validProbeLedger, QUBAX_PROBE_LEDGER_DOCUMENT, type QubaxProbeLedger, type QubaxProbeModel } from './qubaxMarket';
import { QubaxPriceFeedStore } from './qubaxPriceFeedStore';
import { qubaxConfig } from './qubax';

export function qubaxProbePrompt(language: 'hi' | 'en', nonce: string): string {
  return language === 'hi' ? `सिर्फ यह कोड लिखो: ${nonce}` : `Reply with only this code: ${nonce}`;
}
export function qubaxProbeAnswerSane(answer: string, nonce: string): boolean {
  const text = answer.trim();
  return text.length > 0 && text.length <= 120 && text.includes(nonce);
}
function scale(model: QubaxProbeModel): QubaxProbeModel {
  if (model.attempts < 20) return model;
  return { ...model, attempts: Math.floor(model.attempts / 2), successes: Math.floor(model.successes / 2) };
}

export async function runDueQubaxProbe(input: {
  db: Pick<Firestore, 'doc' | 'runTransaction'>;
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: number;
  reserveShared?: (requestId: string, nano: number) => Promise<null | { release(): Promise<void>; keep(): Promise<void> }>;
}): Promise<{ status: 'probed' | 'idle' | 'disabled' | 'unavailable'; modelId?: string }> {
  const now = input.now ?? Date.now();
  const ceiling = qubaxRequestCeilingNanoUsd(input.env);
  const cap = qubaxProbeDailyCapNanoUsd(input.env);
  if (!ceiling || !cap) return { status: 'disabled' };
  let cfg: ReturnType<typeof qubaxConfig>;
  try { cfg = qubaxConfig(input.env); } catch { return { status: 'disabled' }; }
  if (!cfg.enabled || !cfg.apiKey) return { status: 'disabled' };
  const snapshot = await new QubaxPriceFeedStore(input.db, () => now).read();
  if (!snapshot) return { status: 'idle' };
  const qubaxRows = snapshot.sources.find(source => source.source === 'qubax')?.rows ?? [];
  const officialRows = snapshot.sources.filter(source => source.source !== 'qubax').flatMap(source => source.rows);
  const ref = input.db.doc(QUBAX_PROBE_LEDGER_DOCUMENT);
  const reserved = await input.db.runTransaction(async tx => {
    const stored = validProbeLedger((await tx.get(ref)).data(), now) ?? emptyProbeLedger(now);
    const ledger: QubaxProbeLedger = stored.day === istProbeDay(now) ? stored : { ...stored, day: istProbeDay(now), spentNanoUsd: 0 };
    const due = dueQubaxProbe(qubaxRows, officialRows, ledger, now, input.env.QUBAX_MODEL?.trim() || null);
    if (!due || ledger.spentNanoUsd + ceiling > cap) return null;
    ledger.spentNanoUsd += ceiling;
    tx.set(ref, ledger);
    return { ...due, ledger };
  });
  if (!reserved) return { status: 'idle' };
  const nonce = `QX${randomBytes(4).toString('hex')}`;
  const requestId = `qubax-probe:${reserved.ledger.day}:${reserved.modelId}:${reserved.language}:${nonce}`;
  const shared = input.reserveShared ? await input.reserveShared(requestId, ceiling) : { release: async () => {}, keep: async () => {} };
  const releaseLedger = async () => {
    await input.db.runTransaction(async tx => {
      const ledger = validProbeLedger((await tx.get(ref)).data(), now);
      if (!ledger || ledger.day !== reserved.ledger.day) return;
      ledger.spentNanoUsd = Math.max(0, ledger.spentNanoUsd - ceiling);
      tx.set(ref, ledger);
    });
  };
  if (!shared) { await releaseLedger(); return { status: 'idle' }; }
  const started = Date.now();
  try {
    const response = await (input.fetchImpl ?? fetch)(`${cfg.baseURL}/chat/completions`, { method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: reserved.modelId, max_tokens: 16, stream: false, messages: [{ role: 'user', content: qubaxProbePrompt(reserved.language, nonce) }] }) });
    const body = response.ok ? await response.json() as { choices?: { message?: { content?: unknown } }[] } : null;
    const answer = typeof body?.choices?.[0]?.message?.content === 'string' ? body.choices[0].message.content : '';
    const ok = response.ok && qubaxProbeAnswerSane(answer, nonce);
    const latencyMs = Math.max(1, Date.now() - started);
    await input.db.runTransaction(async tx => {
      const ledger = validProbeLedger((await tx.get(ref)).data(), Date.now()) ?? emptyProbeLedger(Date.now());
      const current = scale(ledger.models[reserved.modelId] ?? { attempts: 0, successes: 0, hindi: null, english: null });
      current.attempts += 1; if (ok) current.successes += 1;
      current[reserved.language === 'hi' ? 'hindi' : 'english'] = { ok, latencyMs, atMs: Date.now() };
      ledger.models[reserved.modelId] = current;
      tx.set(ref, ledger);
    });
    if (shared) await shared.keep();
    return { status: 'probed', modelId: reserved.modelId };
  } catch {
    await releaseLedger();
    if (shared) await shared.release();
    return { status: 'unavailable' };
  }
}
export async function runScheduledQubaxProbe(env: Record<string, string | undefined> = process.env) {
  if (env.QUBAX_ENABLED !== '1' || !env.QUBAX_API_KEY?.trim()) return { status: 'disabled' as const };
  try {
    const { getServerDb } = await import('./serverDb');
    const db = getServerDb();
    if (!db) return { status: 'unavailable' as const };
    const { FreeChainStore } = await import('../AI/FreeChain/store');
    const { freeChainConfig } = await import('../AI/FreeChain/config');
    const store = new FreeChainStore(db);
    const cfg = freeChainConfig(env);
    return await runDueQubaxProbe({ db, env, reserveShared: async (requestId, nano) => {
      const hold = await store.reservePaid({ requestId, uid: 'system:qubax-probe', maxCostNanoUsd: nano, capNanoUsd: cfg.paidCapNanoUsd, perUserLimit: cfg.paidPerUserDaily });
      if (!hold?.mayDispatch) return null;
      return { release: async () => { await store.settlePaid(hold, 0); }, keep: async () => { await store.settlePaid(hold, nano); } };
    } });
  } catch { return { status: 'unavailable' as const }; }
}
