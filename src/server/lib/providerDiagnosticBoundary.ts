import type { RequestHandler } from 'express';
import { requireAdmin } from './adminAuth';
import { DIAGNOSTIC_LIMITS, type DiagnosticProvider } from '../../shared/providerDiagnostics';

export interface DiagnosticInput { provider: DiagnosticProvider; idempotencyKey: string; prompt: string; maxOutputTokens?: number }

/** No client-selected model, endpoint, credential, budget or retry policy. */
export function parseDiagnosticInput(provider: unknown, body: unknown): DiagnosticInput | null {
  if (provider !== 'surplus' && provider !== 'cheaperinference') return null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const data = body as Record<string, unknown>;
  if (Object.keys(data).some(key => key !== 'idempotencyKey' && key !== 'prompt' && key !== 'maxOutputTokens')) return null;
  if (typeof data.idempotencyKey !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.idempotencyKey)) return null;
  if (typeof data.prompt !== 'string' || !data.prompt.trim()
    || Buffer.byteLength(data.prompt, 'utf8') > DIAGNOSTIC_LIMITS.promptBytes) return null;
  if (data.maxOutputTokens !== undefined && (!Number.isSafeInteger(data.maxOutputTokens) || Number(data.maxOutputTokens) <= 0)) return null;
  return { ...(data.maxOutputTokens === undefined ? {} : { maxOutputTokens: Number(data.maxOutputTokens) }), provider, idempotencyKey: data.idempotencyKey.toLowerCase(), prompt: data.prompt };
}

/** Apply to the entire future diagnostic router, including status/log reads and unknown paths. */
export const requireDiagnosticAdmin: RequestHandler = (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  requireAdmin(req, res, next);
};

/** Runs after the admin gate; validation never dispatches, logs a prompt or echoes input. */
export const validateDiagnosticRun: RequestHandler = (req, res, next) => {
  const input = parseDiagnosticInput(req.params.provider, req.body);
  if (!input) {
    res.status(400).json({ error: 'Invalid diagnostic request. Use a supported provider, a UUID v4 idempotency key and a nonempty prompt of at most 2048 UTF-8 bytes.' });
    return;
  }
  res.locals.diagnosticInput = input;
  next();
};
