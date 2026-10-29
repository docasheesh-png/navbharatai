import { registerProviderLoadBatchRoutes } from './providerLoadBatch';
import { DiagnosticEvidenceMissing } from '../lib/providerDiagnosticEvidence';
import { Router, type Express } from 'express';
import { requireDiagnosticAdmin, validateDiagnosticRun, type DiagnosticInput } from '../lib/providerDiagnosticBoundary';
import { runDiagnostic, diagnosticAdapter, type DiagnosticDependencies } from '../lib/providerDiagnosticRunner';
import { ProviderDiagnosticStore, DiagnosticAdmissionError } from '../lib/providerDiagnosticStore';
import { ProviderDiagnosticDirectStore } from '../lib/providerDiagnosticDirectStore';
import { adminUsername } from '../lib/adminAuth';
import { getServerDb } from '../lib/serverDb';
import { parseThroughputInput, runThroughput, throughputFailureReason, type ThroughputProgress } from '../lib/providerThroughput';
const throughputRunning = new Set<string>();

export async function readDiagnosticProviderState(provider: 'surplus' | 'cheaperinference', store: Pick<ProviderDiagnosticStore, 'control' | 'status'>, adapter: DiagnosticDependencies['adapter']) {
  let control;
  try { control = await store.control(provider); }
  catch { return { dispatchReady: false, reason: 'accounting_unavailable', missingFields: [`providers.${provider}.control`] }; }
  if (!control.enabled) return { ...control, dispatchReady: false, reason: 'diagnostics_disabled', missingFields: [] };
  try { return { ...control, ...await store.status(provider, adapter(provider).model, 1) }; }
  catch { return { ...control, dispatchReady: false, reason: 'config_missing', missingFields: [`providers.${provider}.adapterConfiguration`] }; }
}

function dependencies(): DiagnosticDependencies {
  const db = getServerDb();
  if (!db) throw new DiagnosticAdmissionError('accounting_failed');
  const store = new ProviderDiagnosticDirectStore(db);
  const adapter = (provider: 'surplus' | 'cheaperinference', outputTokens?: number) => diagnosticAdapter(provider, process.env, true, outputTokens);
  const state = (provider: 'surplus' | 'cheaperinference') => readDiagnosticProviderState(provider, store, adapter);
  return { store, adapter, setControl: store.setControl.bind(store),
    status: async () => { const surplus = await state('surplus'), cheaperinference = await state('cheaperinference'); return {
      dispatchReady: surplus.dispatchReady || cheaperinference.dispatchReady, providers: { surplus, cheaperinference }, liveVerification: false,
    }; },
    verifyAdmission: async (provider, model, outputTokens) => {
      const status = await store.status(provider, model, outputTokens);
      if (status.missingFields.length) throw new DiagnosticEvidenceMissing(status.missingFields);
      if (!status.dispatchReady) throw new DiagnosticAdmissionError(status.reason === 'diagnostics_disabled' ? 'diagnostics_disabled' : status.reason === 'budget_exhausted' ? 'budget_exhausted' : 'budget_evidence_unavailable');
    } };

}
export function registerProviderDiagnosticRoutes(app: Express, resolve = dependencies): void {
  registerProviderLoadBatchRoutes(app);
  const router = Router();
  router.use(requireDiagnosticAdmin);
  router.get('/status', async (_req, res) => {
    try { const deps = resolve(); res.json(deps.status ? await deps.status() : { dispatchReady: false, reason: 'budget_evidence_unavailable' }); }
    catch { res.status(503).json({ dispatchReady: false, reason: 'accounting_unavailable' }); }
  });
  router.post('/:provider/control', async (req, res) => {
    const provider = req.params.provider, data = req.body;
    if ((provider !== 'surplus' && provider !== 'cheaperinference') || !data || typeof data !== 'object' || Array.isArray(data)
      || Object.keys(data).some(k => k !== 'enabled' && k !== 'expectedRevision') || typeof data.enabled !== 'boolean'
      || !Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0) {
      res.status(400).json({ error: 'Provide enabled and the current expectedRevision only.' }); return;
    }
    try {
      const change = resolve().setControl;
      if (!change) throw new Error('unavailable');
      const control = await change(provider, data.enabled, data.expectedRevision, adminUsername());
      res.json({ provider, ...control });
    } catch (error) {
      const conflict = error instanceof DiagnosticAdmissionError && error.reason === 'control_conflict';
      res.status(conflict ? 409 : 503).json({ error: conflict ? 'Controls changed. Refresh status before retrying.' : 'Control outcome unconfirmed. Refresh status; do not assume it changed.' });
    }
  });
  router.get('/runs/:key', async (req, res) => {
    try { const run = await resolve().store.read(req.params.key); res.status(run ? 200 : 404).json({ run, historical: true, textPersisted: false }); }
    catch { res.status(503).json({ error: 'Diagnostic record unavailable. Do not resubmit with a new key.' }); }
  });
  router.post('/:provider/runs', validateDiagnosticRun, async (_req, res) => {
    try { res.json(await runDiagnostic(res.locals.diagnosticInput as DiagnosticInput, resolve())); }
    catch (error) {
      // Root cause of "Outcome unavailable": every admission refusal (run_in_progress, budget, disabled, …) was
      // flattened into one opaque 503, so the admin could not tell "never sent" from "unknown". Expose the safe enum.
      const reason = error instanceof DiagnosticAdmissionError ? error.reason : 'outcome_unknown';
      const status = reason === 'run_in_progress' || reason === 'control_conflict' ? 409 : reason === 'invalid_request' ? 400
        : reason === 'diagnostics_disabled' || reason === 'budget_exhausted' ? 403 : 503;
      res.status(status).json({ error: 'Diagnostic outcome unavailable. Read the original run before any further test.', reason });
    }
  });
  // Owner t124u: concurrent unique-prompt throughput (target 1000 working responses/min per provider).
  // DNA fix (live HTTP 503 "Throughput run unavailable"): the old route (a) flattened every adapter-construction
  // failure into one opaque 503, and (b) held a silent request open for minutes, so any proxy/idle timeout or
  // instance recycle surfaced as the same 503/network error with no evidence. Now: configuration failures are a
  // precise 424 with a safe reason; one run per provider per instance (409); and the run streams NDJSON progress
  // heartbeats every 2s (keeps the request active so Cloud Run keeps CPU allocated and no idle timeout fires),
  // ending with exactly one {type:"result"} or {type:"error", reason} line.
  router.post('/:provider/throughput', async (req, res) => {
    const provider = req.params.provider, input = parseThroughputInput(req.body);
    if ((provider !== 'surplus' && provider !== 'cheaperinference') || !input) { res.status(400).json({ error: 'Provide requests (1-20000), concurrency (1-2000), optional retries (0-3), maxOutputTokens.', reason: 'invalid_request' }); return; }
    if (throughputRunning.has(provider)) { res.status(409).json({ error: 'A throughput run for this provider is already in progress on this instance.', reason: 'run_in_progress' }); return; }
    let adapter;
    try { adapter = diagnosticAdapter(provider, process.env, true, input.maxOutputTokens); }
    catch (error) { res.status(424).json({ error: 'Provider adapter not configured; nothing dispatched.', reason: `adapter_unavailable:${throughputFailureReason(error)}` }); return; }
    throughputRunning.add(provider);
    req.setTimeout?.(3_600_000); res.setTimeout?.(3_600_000);
    res.status(200).setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('X-Accel-Buffering', 'no');
    const write = (o: unknown) => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
    let last: ThroughputProgress | null = null;
    write({ type: 'started', provider, model: adapter.model, requests: input.requests, concurrency: input.concurrency });
    const beat = setInterval(() => write({ type: 'progress', ...(last ?? { done: 0, ok: 0, pass: 0, requests: input.requests, elapsedMs: 0 }) }), 2_000);
    try { write({ type: 'result', ...await runThroughput(provider, adapter, input, undefined, p => { last = p; }) }); }
    catch (error) { write({ type: 'error', error: 'Throughput run aborted.', reason: throughputFailureReason(error) }); }
    finally { clearInterval(beat); throughputRunning.delete(provider); res.end(); }
  });
  router.use((_req, res) => { res.status(404).json({ error: 'Diagnostic endpoint not found.' }); });
  app.use('/api/admin/provider-diagnostics', router);
}
