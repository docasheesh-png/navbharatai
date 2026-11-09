import type { Express, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { readTestChatAction, TEST_CHAT_FAILURE } from '../../lib/testChatBot';
import { runTestChat, testChatStatus, TestChatUnavailable } from '../lib/testChatBot';
import { adminUsername } from '../lib/adminAuth';
import { audit } from '../lib/audit';

const errors = {
  disabled: 'Qubax is disabled on the server. No provider was called.',
  configuration: 'Qubax is not configured on the server. No provider was called.',
  storage: 'Approval and budget storage is unavailable. No provider was called.',
  'approval-or-budget': 'This exact conversation needs a current operator-reviewed Qubax approval, supplier-enforced spending ceiling and available shared budget. No provider was called.',
  invalid: 'Provide a supported provider, a fresh request ID, text-only conversation and disclosure confirmation.',
  unconfirmed: TEST_CHAT_FAILURE,
} as const;

export function registerTestChatBotRoutes(app: Express, verifyAdminToken: RequestHandler): void {
  const reads = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
  const sends = rateLimit({ windowMs: 60_000, limit: 6, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Please wait before sending another test message. No provider was called.' } });
  app.get('/api/admin/test-chat-bot/providers', verifyAdminToken, reads, (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(testChatStatus());
  });
  app.post('/api/admin/test-chat-bot/chat', verifyAdminToken, sends, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const action = readTestChatAction(req.body);
    if (!action) { res.status(400).json({ error: errors.invalid, code: 'invalid' }); return; }
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnected);
    try {
      // Audit only operation metadata. Never record the prompt, reply, credential or upstream body.
      audit('ADMIN_TEST_CHAT_STARTED', { provider: action.provider, requestId: action.requestId });
      const reply = await runTestChat(action, adminUsername(), controller.signal);
      audit('ADMIN_TEST_CHAT_FINISHED', { provider: action.provider, requestId: action.requestId });
      if (!res.destroyed) res.json(reply);
    } catch (error) {
      const known = error instanceof TestChatUnavailable;
      const code = known ? error.reason : 'unconfirmed';
      audit('ADMIN_TEST_CHAT_FAILED', { provider: action.provider, requestId: action.requestId, code });
      if (!res.destroyed) res.status(known ? error.status : 503).json({ error: errors[code], code, noFallback: true });
    } finally { res.off('close', disconnected); }
  });
}
