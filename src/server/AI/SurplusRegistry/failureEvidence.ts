import { createHash } from 'node:crypto';
/** Documented HTTP404 pre-routing exclusions only; never inferred from a request-log lookup. */
export interface SurplusUnattemptedEvidence {
  reason: 'minimum_discount_not_met' | 'no_sellers_for_model';
  traceRequestId: string;
  evidenceSha256: string;
  reportedAt: number;
}
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
export function surplusUnattemptedEvidence(raw: unknown): SurplusUnattemptedEvidence | null {
  const wire = object(raw), body = object(wire?.body), error = object(body?.error), headers = object(wire?.headers);
  if (!wire || wire.metadataIncomplete !== undefined || wire.status !== 404 || !body || !error || !headers || !Number.isSafeInteger(wire.receivedAt) || Number(wire.receivedAt) < 0) return null;
  if (Object.keys(body).some(key => key !== 'error' && key !== 'request_id')) return null;
  if (Object.keys(error).some(key => !['type', 'code', 'message', 'detail', 'param'].includes(key))) return null;
  if (typeof body.request_id !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(body.request_id)) return null;
  if (error.code !== 'minimum_discount_not_met' && error.code !== 'no_sellers_for_model') return null;
  if (error.code === 'minimum_discount_not_met' && error.type !== 'invalid_request_error') return null;
  if (typeof error.type !== 'string' || !/^[a-z_]{1,80}$/.test(error.type)) return null;
  // Unknown detail/route/usage evidence may indicate an attempted call: never erase its liability.
  if (error.detail !== undefined && (!object(error.detail) || Object.keys(error.detail as object).length)) return null;
  if (Object.keys(headers).some(key => key.startsWith('x-si-') && headers[key])) return null;
  return { reason: error.code, traceRequestId: body.request_id, reportedAt: Number(wire.receivedAt),
    evidenceSha256: createHash('sha256').update(JSON.stringify([wire.status, body, headers])).digest('hex') };
}
