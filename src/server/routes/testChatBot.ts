import type { Express, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { readTestChatAction, readTestChatApprovalImport, TEST_CHAT_DIAGNOSTIC_CODES, TEST_CHAT_FAILURE } from '../../lib/testChatBot';
import { runTestChat, testChatStatus, TestChatUnavailable } from '../lib/testChatBot';
import { checkTestChatReadiness, importTestChatApproval, importTestChatCatalog, QubaxAdminReviewError } from '../lib/qubaxReadiness';
import { readQubaxBalance } from '../lib/qubaxBalance';
import { adminUsername } from '../lib/adminAuth';
import { audit } from '../lib/audit';

const errors = {
  disabled: 'Qubax is disabled on the server. No provider was called.',
  configuration: 'Qubax is not configured on the server. No provider was called.',
  storage: 'Approval and budget storage is unavailable. No provider was called.',
  'approval-or-budget': 'This exact conversation needs a current operator-reviewed Qubax approval, supplier-enforced spending ceiling and available shared budget. No provider was called.',
  catalog: 'No eligible independently reviewed catalog selection is available. Check Qubax Readiness for pricing, quality and supplier-ceiling requirements. No provider was called.',
  approval: 'The exact-payload approval is missing, expired, used, revoked or does not match current evidence. Check Qubax Readiness. No provider was called.',
  budget: 'The existing shared daily, monthly or per-user budget cannot admit this request. No provider was called.',
  capacity: 'Qubax local request capacity is full. No provider was called.',
  selection: 'The reviewed model selection changed. Refresh readiness and obtain a matching independent approval. No provider was called.',
  capability: 'This payload is outside the supported text-only test capability. No provider was called.',
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
  app.post('/api/admin/test-chat-bot/readiness', verifyAdminToken, reads, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const action = readTestChatAction(req.body);
    if (!action) { res.status(400).json({ error: errors.invalid, code: 'invalid' }); return; }
    try {
      const readiness = await checkTestChatReadiness(action, adminUsername());
      audit('ADMIN_TEST_CHAT_READINESS', { admin: adminUsername(), requestId: action.requestId, ready: readiness.ready });
      res.json(readiness);
    } catch (error) {
      const code = error instanceof QubaxAdminReviewError ? error.code : 'storage-unavailable';
      audit('ADMIN_TEST_CHAT_READINESS_FAILED', { admin: adminUsername(), requestId: action.requestId, code });
      res.status(503).json({ error: 'Readiness could not be verified. No provider was called or budget reserved.', code, noProviderCall: true });
    }
  });
  app.post('/api/admin/test-chat-bot/balance', verifyAdminToken, reads, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) { res.status(400).json({ error: 'Provide an empty balance-check request.', code: 'invalid' }); return; }
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
  const reviewErrors: Record<QubaxAdminReviewError['code'], string> = {
    invalid: 'The signed review request is malformed. No provider was called.',
    'trust-unavailable': 'An independent public review key with the required purpose is not configured. Ask the security operator to provision it separately.',
    'catalog-unavailable': 'A current independently reviewed eligible catalog and supplier-enforced ceiling are required before payload import.',
    'review-invalid': 'The independent signature, exact binding, evidence, data review or expiry could not be verified. Nothing was approved.',
    'approval-conflict': 'An approval already exists for this exact binding. It cannot be overwritten or replayed, even after expiry.',
    'catalog-conflict': 'The catalog changed or this signed package is a replay. Obtain a new independent package bound to the current catalog digest.',
    'storage-unavailable': 'The import could not be confirmed. Do not resubmit automatically; check readiness before taking another action.',
    capacity: 'The read-only safety checker is at capacity. No provider was called.',
  };
  app.post('/api/admin/test-chat-bot/approval', verifyAdminToken, sends, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const input = readTestChatApprovalImport(req.body);
    if (!input) { res.status(400).json({ error: reviewErrors.invalid, code: 'invalid' }); return; }
    try {
      const receipt = await importTestChatApproval(input, adminUsername());
      audit('ADMIN_TEST_CHAT_APPROVAL_IMPORTED', { admin: adminUsername(), requestId: input.action.requestId, keyId: input.attestation.keyId });
      res.json(receipt);
    } catch (error) {
      const code = error instanceof QubaxAdminReviewError ? error.code : 'storage-unavailable';
      audit('ADMIN_TEST_CHAT_APPROVAL_FAILED', { admin: adminUsername(), requestId: input.action.requestId, code });
      res.status(error instanceof QubaxAdminReviewError ? error.status : 503).json({ error: reviewErrors[code], code, noProviderCall: true });
    }
  });
  app.post('/api/admin/test-chat-bot/catalog', verifyAdminToken, sends, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const input = readTestChatApprovalImport(req.body, 128_000);
    if (!input) { res.status(400).json({ error: reviewErrors.invalid, code: 'invalid' }); return; }
    try {
      const receipt = await importTestChatCatalog(input, adminUsername());
      audit('ADMIN_TEST_CHAT_CATALOG_IMPORTED', { admin: adminUsername(), requestId: input.action.requestId, keyId: input.attestation.keyId });
      res.json(receipt);
    } catch (error) {
      const code = error instanceof QubaxAdminReviewError ? error.code : 'storage-unavailable';
      audit('ADMIN_TEST_CHAT_CATALOG_FAILED', { admin: adminUsername(), requestId: input.action.requestId, code });
      res.status(error instanceof QubaxAdminReviewError ? error.status : 503).json({ error: reviewErrors[code], code, noProviderCall: true });
    }
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
      if (!res.destroyed) res.status(known ? error.status : 503).json({ error: errors[code], code, ...(known && error.diagnostic && TEST_CHAT_DIAGNOSTIC_CODES.includes(error.diagnostic as typeof TEST_CHAT_DIAGNOSTIC_CODES[number]) ? { diagnostic: error.diagnostic } : {}), noFallback: true });
    } finally { res.off('close', disconnected); }
  });
}
