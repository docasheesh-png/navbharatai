import { Router, type Express } from 'express';
import { requireDiagnosticAdmin } from '../lib/providerDiagnosticBoundary';
import { LoadBatchError } from '../lib/providerLoadBatch';
import { providerLoadRuntime, type ProviderLoadRuntime } from '../lib/providerLoadRuntime';
import { adminUsername } from '../lib/adminAuth';

/** Composition is explicit: no environment credentials or invented approval record
 * is created here. The production caller must supply the reconciled batch service. */
export function registerProviderLoadBatchRoutes(app: Express, resolve: () => Pick<ProviderLoadRuntime, 'status' | 'configure' | 'advance' | 'stop' | 'resume' | 'item'> = providerLoadRuntime): void {
  const router = Router();
  router.use(requireDiagnosticAdmin);
  router.get('/status', async (_req, res) => {
    try { res.json(await resolve().status()); }
    catch { res.status(503).json({ error: 'Batch authority or ledger unavailable. No request dispatched.' }); }
  });
  router.get('/items/:ordinal', async (req, res) => {
    if (!/^(0|[1-9]\d{0,3})$/.test(req.params.ordinal)) { res.status(400).json({ error: 'Invalid ordinal.' }); return; }
    try { const item = await resolve().item(Number(req.params.ordinal)); res.status(item ? 200 : 404).json({ item }); }
    catch { res.status(503).json({ error: 'Batch item unavailable.' }); }
  });
  router.post('/configure', async (req, res) => {
    try { res.json({ batch: await resolve().configure(req.body, adminUsername()) }); }
    catch (error) { res.status(error instanceof LoadBatchError && error.code === 'invalid' ? 400 : error instanceof LoadBatchError && error.code === 'conflict' ? 409 : 503).json({ error: 'Configuration not saved. Check the revision, budget including held liabilities, and current native supplier cost bound. No inference dispatched.' }); }
  });
  router.post('/resume', async (req, res) => {
    if (!req.body || Object.keys(req.body).length !== 1 || !Number.isSafeInteger(req.body.expectedRevision)) { res.status(400).json({ error: 'Provide current expectedRevision only.' }); return; }
    try { res.json(await resolve().resume(req.body.expectedRevision, adminUsername())); }
    catch { res.status(409).json({ error: 'Resume not confirmed. Read original state and retained liabilities.' }); }
  });
  for (const action of ['advance', 'stop'] as const) router.post(`/${action}`, async (req, res) => {
    const body = req.body;
    if (action === 'advance' ? !body || typeof body.waveId !== 'string' || Object.keys(body).length !== 1 : body && Object.keys(body).length) {
      res.status(400).json({ error: 'Advance requires waveId only; stop accepts no overrides.' }); return;
    }
    try { res.json(action === 'advance' ? { batch: await resolve().advance(body.waveId) } : await resolve().stop(adminUsername())); }
    catch { res.status(503).json({ error: 'Outcome unconfirmed. Read original batch status; do not replace or retry individual items.' }); }
  });
  router.use((_req, res) => { res.status(404).json({ error: 'Batch endpoint not found.' }); });
  app.use('/api/admin/provider-load-batch', router);
}
