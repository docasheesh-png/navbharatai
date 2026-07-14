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

const runChatMock = vi.fn();
vi.mock('../src/server/professionals/engine', () => ({
  runProfessionalChat: (...args: unknown[]) => runChatMock(...args),
}));

const verifyTokenMock = vi.fn();
vi.mock('../src/server/lib/authMiddleware', () => ({
  buildRateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  verifyFirebaseToken: (...args: unknown[]) => verifyTokenMock(...args),
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
    runChatMock.mockReset().mockResolvedValue('teacher reply');
    verifyTokenMock.mockReset().mockResolvedValue(null);
  });

  it('threads the VERIFIED uid into the engine (memory key), never the body userId', async () => {
    verifyTokenMock.mockResolvedValue('uid-verified');
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
    verifyTokenMock.mockResolvedValue(null);
    const res = mockRes();
    await chatHandler()(
      mockReq({ params: { id: 'teacher_ai' }, body: { message: 'hello', userId: 'uid-victim' } }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(runChatMock.mock.calls[0][3]).toBeUndefined();
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
