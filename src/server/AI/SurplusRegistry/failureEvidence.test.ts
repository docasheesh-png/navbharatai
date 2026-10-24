import { describe, expect, it } from 'vitest';
import { surplusUnattemptedEvidence } from './failureEvidence';
const wire = () => ({ status: 404, receivedAt: 1800000000000, headers: {}, body: {
  error: { type: 'invalid_request_error', code: 'minimum_discount_not_met', message: 'Untrusted details never persisted' }, request_id: 'req_123',
} });
describe('documented affirmative pre-routing no-charge evidence', () => {
  it.each(['minimum_discount_not_met', 'no_sellers_for_model'])('accepts only a complete documented %s exclusion', code => {
    const raw = wire(); raw.body.error.code = code;
    expect(surplusUnattemptedEvidence(raw)).toEqual({ reason: code, traceRequestId: 'req_123', evidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/), reportedAt: raw.receivedAt });
  });
  it.each([200, 400, 401, 403, 429, 500, 503])('never treats HTTP%s as an affirmative no-attempt response', status => {
    const raw = wire(); raw.status = status; expect(surplusUnattemptedEvidence(raw)).toBeNull();
  });
  it.each(['no_healthy_sellers', 'rate_limit_exceeded', 'timeout', 'model_unavailable', 'unknown'])('does not guess %s is retryable', code => {
    const raw = wire(); raw.body.error.code = code; expect(surplusUnattemptedEvidence(raw)).toBeNull();
  });
  it.each(['usage', 'choices', 'surplus', 'data', 'model', 'attempts'])('blocks conflicting or unknown %s evidence', field => {
    const raw = wire(); Object.assign(raw.body, { [field]: field === 'usage' ? { buyer_cost_micro: 0 } : {} });
    expect(surplusUnattemptedEvidence(raw)).toBeNull();
  });
  it('requires safe trace identity and rejects unknown error detail', () => {
    const raw = wire(); raw.body.request_id = ''; expect(surplusUnattemptedEvidence(raw)).toBeNull();
    raw.body.request_id = 'req_123'; Object.assign(raw.body.error, { detail: { attempted: true } }); expect(surplusUnattemptedEvidence(raw)).toBeNull();
  });
  it('refuses missing metadata hidden by a bounded transport projection', () => {
    expect(surplusUnattemptedEvidence({ ...wire(), metadataIncomplete: true })).toBeNull();
  });
  it('cannot erase provider-route evidence', () => {
    const raw = wire(); raw.headers = { 'x-si-provider-family': 'actual-provider' }; expect(surplusUnattemptedEvidence(raw)).toBeNull();
  });
});
