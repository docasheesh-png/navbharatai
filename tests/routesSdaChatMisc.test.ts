/**
 * Route handler validation tests — SDA, Chat, Zip, and Anthropic routes.
 *
 * Tests the 400 early-return branches that fire before any AI/Firestore call.
 * All run without booting a server, using captureRoutes() + direct handler invocation.
 */
import { describe, it, expect } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

process.env.VITEST = 'true';

// ── SDA routes ────────────────────────────────────────────────────────────────

async function importSdaRoutes() {
  const { registerSdaRoutes } = await import('../src/server/routes/sda');
  return registerSdaRoutes;
}

describe('SDA routes — /api/sda-chat', () => {
  it('registers the sda-chat endpoint', async () => {
    const register = await importSdaRoutes();
    const routes = captureRoutes(register);
    expect(routes.has('POST /api/sda-chat')).toBe(true);
  });

  it('returns 400 when both message and fileData are missing', async () => {
    const register = await importSdaRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/sda-chat')!;

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/message required/i);
  });

  it('passes validation when message is present (proceeds to AI call)', async () => {
    const register = await importSdaRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/sda-chat')!;

    // Providing a message should NOT return 400 — it proceeds past validation.
    // Without real AI keys the call will return 503 or error, but NOT 400.
    const req = mockReq({ body: { message: 'Patient has a fever' } });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).not.toBe(400);
  });

  it('passes validation when fileData is present (proceeds to AI call)', async () => {
    const register = await importSdaRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/sda-chat')!;

    const req = mockReq({ body: { fileData: 'base64content', fileType: 'image/jpeg' } });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).not.toBe(400);
  });
});

// ── Chat routes ───────────────────────────────────────────────────────────────

async function importChatRoutes() {
  const { registerChatRoutes } = await import('../src/server/routes/chat');
  return registerChatRoutes;
}

describe('Chat routes — /api/chat/* validation', () => {
  it('registers all five chat tier endpoints', async () => {
    const register = await importChatRoutes();
    // Pass a dummy chatLimiter (captured handlers ignore the middleware positionally)
    const routes = captureRoutes(register, () => {});
    expect(routes.has('POST /api/chat/navbharat')).toBe(true);
    expect(routes.has('POST /api/chat/navbharatai')).toBe(true);
    expect(routes.has('POST /api/chat/vishwakarma-basic')).toBe(true);
    expect(routes.has('POST /api/chat/vishwakarma-pro')).toBe(true);
    expect(routes.has('POST /api/chat/vip')).toBe(true);
  });

  it('returns 400 when message is missing and no fileAttachments provided', async () => {
    const register = await importChatRoutes();
    const routes = captureRoutes(register, () => {});
    const handler = routes.get('POST /api/chat/navbharat')!;

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.reply).toMatch(/message is required/i);
  });

  it('passes validation when fileAttachments array is present (even without message)', async () => {
    const register = await importChatRoutes();
    const routes = captureRoutes(register, () => {});
    const handler = routes.get('POST /api/chat/navbharat')!;

    // Empty fileAttachments array counts as "valid" — not 400
    const req = mockReq({ body: { fileAttachments: [] } });
    const res = mockRes();
    await handler(req, res);
    // Should proceed past validation (may 500/503 without real keys, but not 400)
    expect(res.statusCode).not.toBe(400);
  });

  it('returns 400 for vishwakarma-pro tier when message is missing', async () => {
    const register = await importChatRoutes();
    const routes = captureRoutes(register, () => {});
    const handler = routes.get('POST /api/chat/vishwakarma-pro')!;

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.reply).toMatch(/message is required/i);
  });
});

// ── Zip routes ────────────────────────────────────────────────────────────────

async function importZipRoutes() {
  const { registerZipRoutes } = await import('../src/server/routes/zip');
  return registerZipRoutes;
}

describe('Zip routes — /api/download-zip validation', () => {
  it('registers the download-zip endpoint', async () => {
    const register = await importZipRoutes();
    const routes = captureRoutes(register);
    expect(routes.has('POST /api/download-zip')).toBe(true);
  });

  it('returns 400 when files object is missing', async () => {
    const register = await importZipRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/download-zip')!;

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/no files/i);
  });
});
