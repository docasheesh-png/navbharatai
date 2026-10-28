import { diagnosticPairAuthority } from '../lib/providerDiagnosticPair';
import { DiagnosticEvidenceMissing } from '../lib/providerDiagnosticEvidence';
import { Router, type Express } from 'express';
import { requireDiagnosticAdmin, validateDiagnosticRun, type DiagnosticInput } from '../lib/providerDiagnosticBoundary';
import { runDiagnostic, diagnosticAdapter, type DiagnosticDependencies } from '../lib/providerDiagnosticRunner';
import { ProviderDiagnosticStore, DiagnosticAdmissionError } from '../lib/providerDiagnosticStore';
import { getServerDb } from '../lib/serverDb';

function dependencies(): DiagnosticDependencies {
  const db = getServerDb();
  if (!db) throw new DiagnosticAdmissionError('accounting_failed');
  const store = new ProviderDiagnosticStore(db, Date.now, undefined, undefined, diagnosticPairAuthority());
  const adapter = (provider: 'surplus' | 'cheaperinference') => diagnosticAdapter(provider, process.env, true);
  const state = async (provider: 'surplus' | 'cheaperinference') => {
    try { return await store.status(provider, adapter(provider).model); }
    catch { return { dispatchReady: false, reason: 'config_missing', missingFields: [`providers.${provider}.adapterConfiguration`] }; }
  };
  return { store, adapter, fixedPrompt: 'Reply with exactly: OK',
    status: async () => { const surplus = await state('surplus'), cheaperinference = await state('cheaperinference'); return {
      dispatchReady: surplus.dispatchReady || cheaperinference.dispatchReady, providers: { surplus, cheaperinference }, liveVerification: false,
    }; },
    verifyEvidence: async (provider, model) => {
      const status = await store.status(provider, model);
      if (status.missingFields.length) throw new DiagnosticEvidenceMissing(status.missingFields);
      if (!status.dispatchReady) throw new DiagnosticAdmissionError(status.reason === 'budget_exhausted' ? 'budget_exhausted' : 'budget_evidence_unavailable');
    } };

}
export function registerProviderDiagnosticRoutes(app: Express, resolve = dependencies): void {
  const router = Router();
  router.use(requireDiagnosticAdmin);
  router.get('/status', async (_req, res) => {
    try { const deps = resolve(); res.json(deps.status ? await deps.status() : { dispatchReady: false, reason: 'budget_evidence_unavailable' }); }
    catch { res.status(503).json({ dispatchReady: false, reason: 'accounting_unavailable' }); }
  });
  router.get('/runs/:key', async (req, res) => {
    try { const run = await resolve().store.read(req.params.key); res.status(run ? 200 : 404).json({ run, historical: true, textPersisted: false }); }
    catch { res.status(503).json({ error: 'Diagnostic record unavailable. Do not resubmit with a new key.' }); }
  });
  router.post('/:provider/runs', validateDiagnosticRun, async (_req, res) => {
    try { res.json(await runDiagnostic(res.locals.diagnosticInput as DiagnosticInput, resolve())); }
    catch { res.status(503).json({ error: 'Diagnostic outcome unavailable. Read the original run before any further test.' }); }
  });
  router.use((_req, res) => { res.status(404).json({ error: 'Diagnostic endpoint not found.' }); });
  app.use('/api/admin/provider-diagnostics', router);
}
