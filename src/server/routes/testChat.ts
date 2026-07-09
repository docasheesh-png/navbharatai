/**
 * 🧪 Test Chat route — ISOLATED AWS Bedrock GLM-5 test endpoint (debug-only).
 *
 * POST /api/test-chat  { message: string }  →  full TestChatResult (text + complete debug/raw error)
 * GET  /api/test-chat/status                →  { enabled, region, modelConfigured, credsConfigured }
 *
 * This route talks ONLY to AWS Bedrock (see ../testChat/awsBedrockTest). It does NOT touch the
 * production provider router, model selector, or any live chat path.
 *
 * SAFETY GATE: a real Bedrock call costs money, so the endpoint is OFF unless TEST_CHAT_ENABLED
 * === 'true'. The admin flips it on only while validating GLM-5, then off again. When off it returns
 * an HONEST "disabled" state (never a fake success).
 */
import type { Express, Request, Response } from 'express';
import { runBedrockGlmTest } from '../testChat/awsBedrockTest';

function isEnabled(): boolean {
  return process.env.TEST_CHAT_ENABLED === 'true';
}

export function registerTestChatRoutes(app: Express): void {
  // Lightweight status so the UI can show an honest enabled/not-configured state without a paid call.
  app.get('/api/test-chat/status', (_req: Request, res: Response) => {
    res.json({
      enabled: isEnabled(),
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
      modelConfigured: Boolean(process.env.BEDROCK_GLM_MODEL && process.env.BEDROCK_GLM_MODEL.trim()),
      modelId: process.env.BEDROCK_GLM_MODEL || null,
      credsConfigured: Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
    });
  });

  app.post('/api/test-chat', async (req: Request, res: Response) => {
    if (!isEnabled()) {
      return res.status(503).json({
        ok: false,
        text: null,
        apiUsed: 'none',
        error: {
          name: 'TestChatDisabled',
          message:
            'Test Chat is disabled. Set the TEST_CHAT_ENABLED=true environment variable to enable it (it makes real, billable AWS Bedrock calls).',
        },
        logs: [],
      });
    }

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      return res.status(400).json({
        ok: false,
        text: null,
        apiUsed: 'none',
        error: { name: 'BadRequest', message: 'Body must include a non-empty "message" string.' },
        logs: [],
      });
    }

    // Never throws — runBedrockGlmTest captures every failure into a structured result.
    const result = await runBedrockGlmTest(message);
    // Always 200 at the HTTP layer for a completed attempt; result.ok carries the real success flag,
    // and result.error carries the COMPLETE raw AWS error for the UI to display verbatim.
    return res.json(result);
  });
}
