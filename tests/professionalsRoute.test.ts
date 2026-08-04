/**
 * /api/professional/:id/chat route — verified-identity memory lock (admin 2026-07-14).
 *
 * Persistent student-profile memory is keyed to the VERIFIED Firebase identity only.
 * These tests encode the failure class this closed: a client-claimed body `userId`
 * must never select whose memory the professional reads/writes (IDOR), and an
 * anonymous request must reach the engine with NO user id at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

// The route calls runProfessionalChatWithUsage — the variant that returns the turn's COST alongside the
// reply, because the wallet is one currency now and a professional answer draws on the same balance a
// build does (aiTurnCharge.ts). The identity and tier arguments are unchanged, which is what these
// tests are actually about.
const runChatMock = vi.fn();
vi.mock('../src/server/professionals/engine', () => ({
  runProfessionalChatWithUsage: (...args: unknown[]) => runChatMock(...args),
}));

// The charge is fire-and-forget after the answer. Stubbed so these tests never touch the money path;
// that it cannot be reached before the reply exists is asserted in aiTurnCharge.test.ts.
const chargeMock = vi.fn().mockResolvedValue({ charge: false, reason: 'disabled', billedInr: 0, debited: false, tokensDebited: 0 });
vi.mock('../src/server/lib/aiTurnCharge', async (importOriginal) => ({
  // Keep the REAL flag helper: passGate imports it too, and the gate's inert-by-default behaviour is
  // part of what these tests exercise. Only the charge itself is stubbed.
  ...(await importOriginal<typeof import('../src/server/lib/aiTurnCharge')>()),
  chargeForAiTurn: (...args: unknown[]) => chargeMock(...args),
}));

const verifyIdentityMock = vi.fn();
vi.mock('../src/server/lib/authMiddleware', () => ({
  buildRateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  enforceNotBanned: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  verifyFirebaseIdentity: (...args: unknown[]) => verifyIdentityMock(...args),
}));

vi.mock('../src/server/lib/attachmentText', () => ({
  buildDocumentContext: vi.fn().mockResolvedValue(''),
  isVisionAttachment: () => false,
}));
vi.mock('../src/server/lib/visionDescribe', () => ({
  describeVisionAttachments: vi.fn().mockResolvedValue(''),
}));

import { registerProfessionalsRoutes } from '../src/server/routes/professionals';

function chatHandler() {
  const routes = captureRoutes(registerProfessionalsRoutes as any);
  return routes.get('POST /api/professional/:id/chat')!;
}

describe('professional chat route — verified identity only', () => {
  beforeEach(() => {
    runChatMock.mockReset().mockResolvedValue({ reply: 'teacher reply', spend: {} });
    verifyIdentityMock.mockReset().mockResolvedValue(null);
  });

  it('threads the VERIFIED uid into the engine (memory key), never the body userId', async () => {
    verifyIdentityMock.mockResolvedValue({ uid: 'uid-verified', email: null });
    const res = mockRes();
    await chatHandler()(
      mockReq({ params: { id: 'teacher_ai' }, body: { message: 'hello', userId: 'uid-attacker-claimed' } }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ reply: 'teacher reply', professionalId: 'teacher_ai' });
    expect(runChatMock).toHaveBeenCalledTimes(1);
    expect(runChatMock.mock.calls[0][3]).toBe('uid-verified');
  });

  it('anonymous request (no/invalid token): engine gets NO user id even if body claims one', async () => {
    verifyIdentityMock.mockResolvedValue(null);
    const res = mockRes();
    await chatHandler()(
      mockReq({ params: { id: 'teacher_ai' }, body: { message: 'hello', userId: 'uid-victim' } }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(runChatMock.mock.calls[0][3]).toBeUndefined();
  });

  it('Professional Pass gate ON + anonymous → 401 login_required, engine never called', async () => {
    const prev = process.env.PROFESSIONAL_PAID_ENABLED;
    process.env.PROFESSIONAL_PAID_ENABLED = 'true';
    try {
      verifyIdentityMock.mockResolvedValue(null); // anonymous
      const res = mockRes();
      await chatHandler()(mockReq({ params: { id: 'teacher_ai' }, body: { message: 'hi' } }), res);
      expect(res.statusCode).toBe(401);
      expect(res.body.code).toBe('login_required');
      expect(runChatMock).not.toHaveBeenCalled();
    } finally { process.env.PROFESSIONAL_PAID_ENABLED = prev; }
  });

  it('Professional Pass gate ON + free-listed user → unlimited (200, engine called)', async () => {
    const prevFlag = process.env.PROFESSIONAL_PAID_ENABLED;
    const prevList = process.env.AGENTV3_FREE_LIST;
    process.env.PROFESSIONAL_PAID_ENABLED = 'true';
    process.env.AGENTV3_FREE_LIST = 'uid-free';
    try {
      verifyIdentityMock.mockResolvedValue({ uid: 'uid-free', email: 'admin@navbharatai.com' });
      const res = mockRes();
      await chatHandler()(mockReq({ params: { id: 'teacher_ai' }, body: { message: 'hi' } }), res);
      expect(res.statusCode).toBe(200);
      expect(runChatMock).toHaveBeenCalledTimes(1);
      // free-list → the full PAID model chain (admin gets best quality).
      expect(runChatMock.mock.calls[0][4]).toBe('paid');
    } finally {
      process.env.PROFESSIONAL_PAID_ENABLED = prevFlag;
      process.env.AGENTV3_FREE_LIST = prevList;
    }
  });

  it('Professional Pass gate ON + signed-in non-subscriber → free-tier models (200, tier "free")', async () => {
    const prevFlag = process.env.PROFESSIONAL_PAID_ENABLED;
    const prevList = process.env.AGENTV3_FREE_LIST;
    process.env.PROFESSIONAL_PAID_ENABLED = 'true';
    process.env.AGENTV3_FREE_LIST = 'someone-else'; // this user is NOT free-listed
    try {
      // Under VITEST the pass/usage stores return no-pass / 0-used, so this user is within the free quota.
      verifyIdentityMock.mockResolvedValue({ uid: 'uid-normal', email: 'user@example.com' });
      const res = mockRes();
      await chatHandler()(mockReq({ params: { id: 'teacher_ai' }, body: { message: 'hi' } }), res);
      expect(res.statusCode).toBe(200);
      expect(runChatMock).toHaveBeenCalledTimes(1);
      expect(runChatMock.mock.calls[0][4]).toBe('free'); // within free quota → cheap models only
    } finally {
      process.env.PROFESSIONAL_PAID_ENABLED = prevFlag;
      process.env.AGENTV3_FREE_LIST = prevList;
    }
  });

  it('unknown professional → 404; missing message → 400 (engine never called)', async () => {
    const res404 = mockRes();
    await chatHandler()(mockReq({ params: { id: 'nope_ai' }, body: { message: 'hi' } }), res404);
    expect(res404.statusCode).toBe(404);

    const res400 = mockRes();
    await chatHandler()(mockReq({ params: { id: 'teacher_ai' }, body: {} }), res400);
    expect(res400.statusCode).toBe(400);
    expect(runChatMock).not.toHaveBeenCalled();
  });
});
