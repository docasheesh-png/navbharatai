import type { Express, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { readFreeChainControlAction, readFreeChainBudgetAction } from '../../lib/freeChatChainView';
import { freeChainAdminView, freeChainAdminMetrics, controlFreeChain, controlFreeChainBudget } from '../AI/FreeChain/runtime';
import { audit } from '../lib/audit';
import { adminUsername } from '../lib/adminAuth';
import { sanitizeText } from '../../lib/observability/sanitize';

/** Admin-only configuration. Reads and controls never probe providers or perform inference. */
export function registerFreeChatChainRoutes(app: Express, verifyAdminToken: RequestHandler): void {
  const reads = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
  const historyReads = rateLimit({ windowMs: 60_000, limit: 2, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Sampled metrics are refreshed on demand. Please wait one minute before another scan.' } });
  const writes = rateLimit({ windowMs: 60_000, limit: 6, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many chain controls. Please wait one minute.' } });
  app.get('/api/admin/free-chat-chain', verifyAdminToken, reads, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await freeChainAdminView()); }
    catch { res.status(503).json({ error: 'Free Chat Chain status is unavailable. No quota, budget or routing health has been confirmed.' }); }
  });
  app.get('/api/admin/free-chat-chain/metrics', verifyAdminToken, historyReads, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await freeChainAdminMetrics()); }
    catch { res.status(503).json({ error: 'Sampled metrics are unavailable. Previous measurements have not been refreshed.' }); }
  });
  app.post('/api/admin/free-chat-chain/control', verifyAdminToken, writes, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const action = readFreeChainControlAction(req.body);
    if (!action) {
      res.status(400).json({ error: 'Provide an enabled flag, rollout percentage from 0 to 100, or known disabled providers, with a 10–500 character audit reason. No other settings can be changed here.' });
      return;
    }
    // A pasted credential must not enter either the durable controls history or audit output.
    action.reason = sanitizeText(action.reason, 500).slice(0, 500);
    const actor = adminUsername();
    const metadata = { controlTarget: 'free-chat-chain', ...action };
    try {
      await controlFreeChain(action, actor);
      audit('ADMIN_FREE_CHAT_CHAIN_CONTROL', { admin: actor, ...metadata, result: 'ok' });
      res.json({ ok: true });
    } catch (error) {
      const conflict = error instanceof Error && error.message === 'FREE_CHAIN_CONTROL_CONFLICT';
      audit('ADMIN_FREE_CHAT_CHAIN_CONTROL_FAILED', { admin: actor, ...metadata, result: conflict ? 'conflict' : 'unconfirmed' });
      res.status(conflict ? 409 : 503).json({ error: conflict
        ? 'Chain controls changed during review. Refresh and review the current settings before retrying.'
        : 'Control could not be confirmed. Refresh to check the stored state before retrying.' });
    }
  });
  app.post('/api/admin/free-chat-chain/budget', verifyAdminToken, writes, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const action = readFreeChainBudgetAction(req.body);
    if (!action) { res.status(400).json({ error: 'Provide a total daily cap from 0 to 10 USD in cents, the expected policy revision, and a 10–500 character audit reason. No other settings can be changed here.' }); return; }
    action.reason = sanitizeText(action.reason, 500).slice(0, 500);
    const actor = adminUsername();
    const metadata = { controlTarget: 'free-chat-chain-paid-budget', ...action };
    try {
      const result = await controlFreeChainBudget(action, actor);
      audit('ADMIN_FREE_CHAT_CHAIN_BUDGET', { admin: actor, ...metadata, policyRevision: result.policyRevision, result: 'ok' });
      res.json(result);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const conflict = code === 'FREE_CHAIN_BUDGET_CONFLICT';
      const invalid = code === 'FREE_CHAIN_BUDGET_INVALID_INPUT';
      audit('ADMIN_FREE_CHAT_CHAIN_BUDGET_FAILED', { admin: actor, ...metadata, result: conflict ? 'conflict' : invalid ? 'invalid_input' : 'unconfirmed' });
      res.status(conflict ? 409 : invalid ? 400 : 503).json({ error: conflict
        ? 'The paid budget policy changed during review. Refresh and review its current revision before retrying.'
        : invalid ? 'The requested cap exceeds this deployment’s configured limit or is invalid. Refresh before a new review.'
        : 'Budget control could not be confirmed. Refresh to check the stored policy before retrying.' });
    }
  });
}
