import type { Express, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { readTestChatAction, TEST_CHAT_FAILURE } from '../../lib/testChatBot';
import { loadTestChatStatus, runTestChat, testChatStatus, TestChatUnavailable } from '../lib/testChatBot';
import { readQubaxBalance } from '../lib/qubaxBalance';
import { adminUsername } from '../lib/adminAuth';
import { audit } from '../lib/audit';

const errors = {
  disabled: 'The selected provider is disabled on the server. No provider was called.',
  configuration: 'The selected provider is not configured on the server. No provider was called.',
  storage: 'Approval and budget storage is unavailable. No provider was called.',
  'approval-or-budget': 'This exact conversation needs a current operator-reviewed approval or a verified spending ceiling, plus available shared budget. No provider was called.',
  budget: 'The shared daily or monthly budget cannot reserve this try. No provider was called.',
  'no-model': 'No eligible priced model is available for the selected provider. No provider was called.',
  'tries-exhausted': 'The selected provider tried its allowed models and did not return a valid answer. No other NavBharatAI provider was tried.',
  capacity: 'The selected provider is already handling its maximum number of calls. No provider was called.',
  capability: 'This test is outside the supported text conversation. No provider was called.',
  invalid: 'Provide a supported provider, a fresh request ID, text-only conversation and disclosure confirmation.',
  unconfirmed: TEST_CHAT_FAILURE,
} as const;

export function registerTestChatBotRoutes(app: Express, verifyAdminToken: RequestHandler): void {
  const reads = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
  const sends = rateLimit({ windowMs: 60_000, limit: 6, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Please wait before sending another test message. No provider was called.' } });
  app.get('/api/admin/test-chat-bot/providers', verifyAdminToken, reads, async (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try { res.json(await loadTestChatStatus()); }
    catch { res.json(testChatStatus()); }
  });
  app.post('/api/admin/test-chat-bot/balance', verifyAdminToken, reads, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) {
      res.status(400).json({ error: 'Provide an empty balance-check request.', code: 'invalid' }); return;
    }
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnected);
    try {
      const result = await readQubaxBalance({ signal: controller.signal });
      audit('ADMIN_TEST_CHAT_BALANCE_CHECKED', { admin: adminUsername(), status: result.status });
      if (!res.destroyed) res.json(result);
    } catch {
      audit('ADMIN_TEST_CHAT_BALANCE_FAILED', { admin: adminUsername() });
      if (!res.destroyed) res.status(503).json({ status: 'unknown', code: 'unavailable' });
    } finally { res.off('close', disconnected); }
  });
  app.post('/api/admin/test-chat-bot/chat', verifyAdminToken, sends, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const action = readTestChatAction(req.body);
    if (!action) { res.status(400).json({ error: errors.invalid, code: 'invalid' }); return; }
    const actor = adminUsername();
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnected);
    try {
      // Audit only the server-verified actor and operation metadata. Never record the prompt, reply, credential or upstream body.
      audit('ADMIN_TEST_CHAT_STARTED', { admin: actor, provider: action.provider, requestId: action.requestId });
      const reply = await runTestChat(action, actor, controller.signal);
      audit('ADMIN_TEST_CHAT_FINISHED', { admin: actor, provider: action.provider, requestId: action.requestId });
      if (!res.destroyed) res.json(reply);
    } catch (error) {
      const known = error instanceof TestChatUnavailable;
      const code = known ? error.reason : 'unconfirmed';
      audit('ADMIN_TEST_CHAT_FAILED', { admin: actor, provider: action.provider, requestId: action.requestId, code });
      if (!res.destroyed) {
        res.status(known ? error.status : 503).json({
          error: errors[code], code, noFallback: true,
          ...(known && error.diagnostic ? { diagnostic: error.diagnostic } : {}),
        });
      }
    } finally { res.off('close', disconnected); }
  });
}
