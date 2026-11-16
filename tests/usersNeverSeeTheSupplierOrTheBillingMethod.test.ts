import { describe, expect, it } from 'vitest';
import { BuildDiagnostics, isBillingMethodIssue, userFacingReport } from '../src/server/AgentV3/BuildDiagnostics';
import { hasProviderLeak, redactProviderError, redactProvidersText } from '../src/server/lib/providerRedaction';
import { mentionsVendorBrand, scrubVendorBrands, scrubVendorBrandsInPayload } from '../src/shared/brandScrub';
import { scrubStreamChunk } from '../src/server/lib/brandScrubMiddleware';
import { bluesmindsBuilderRungs } from '../src/server/AgentV3/bluesmindsBuilder';

// Owner t357u + t362u (2026-11-16): a user never learns which supplier served them or how the charge was
// worked out. Only the total in rupees is user-facing; supplier, estimate label and rate method are admin-only.
const SUPPLIER_TEXTS = [
  'Mitrify returned 429', 'mitrify.com timed out', 'Qubax refused the model', 'api.qubax.ai: 503',
  'BluesMinds quota exhausted', 'getaddrinfo ENOTFOUND api.bluesminds.com', 'CheaperInference 402',
  'ENGINE_BM failed', 'ENGINE_R1 failed', 'ENGINE_QX → ENGINE_MF', 'model openai/gpt-oss-20b not found',
];

describe('supplier names never reach a user', () => {
  it.each(SUPPLIER_TEXTS)('the report/error redactor removes it: %s', text => {
    const out = redactProvidersText(text);
    expect(hasProviderLeak(out)).toBe(false);
    expect(out).not.toMatch(/mitrify|qubax|blue?s?minds|cheaper\s*inference|ENGINE_|gpt-oss/i);
    expect(redactProviderError(text)).not.toMatch(/mitrify|qubax|blue?s?minds|ENGINE_/i);
  });
  it.each(SUPPLIER_TEXTS.filter(t => !/gpt-oss/.test(t)))('the response backstop removes it: %s', text => {
    expect(mentionsVendorBrand(text)).toBe(true);
    expect(scrubVendorBrands(text)).not.toMatch(/mitrify|qubax|blue?s?minds|cheaper\s*inference|ENGINE_/i);
  });
  it('error JSON and SSE status events are scrubbed; a user app on a mitrify domain keeps its link', () => {
    const body = scrubVendorBrandsInPayload({ error: 'BluesMinds failed', provider: 'ENGINE_BM', model: 'qubax-auto' });
    expect(JSON.stringify(body)).not.toMatch(/blue?s?minds|ENGINE_BM|qubax/i);
    const sse = scrubStreamChunk(`data: ${JSON.stringify({ type: 'error', error: 'Mitrify and Qubax both failed' })}\n\n`);
    expect(sse).not.toMatch(/mitrify|qubax/i);
    expect(scrubVendorBrands('Open https://my-app.mitrify.app now')).toContain('my-app.mitrify.app');
  });
  it('a failing BluesMinds builder rung throws only a neutral label, which the user redactor then removes', async () => {
    const runner = { runTurn: async () => { throw new Error('BluesMinds: 401 invalid token from api.bluesminds.com'); } };
    const [rung] = bluesmindsBuilderRungs(() => [{ name: 'ENGINE_BM', runner: runner as never }], { FREE_CHAIN_BLUESMINDS_API_KEY: 'k' } as never);
    const err = await rung.runner.runTurn({} as never).catch((e: Error) => e);
    expect((err as Error).message).not.toMatch(/blue?s?minds/i);
    expect(redactProviderError((err as Error).message)).not.toMatch(/ENGINE_BM|blue?s?minds/i);
  });
});

describe('the billing method never reaches a user', () => {
  const build = () => {
    const d = new BuildDiagnostics({ now: () => 1000 });
    d.record({ phase: 'provider', severity: 'warning', code: 'PRO_CHAIN_V2_RATE_ESTIMATED', autoResolved: true,
      message: '[v2] ENGINE_BM (openai/gpt-oss-20b) has no verified price — its turns are billed at a conservative ESTIMATE' });
    d.record({ phase: 'build', severity: 'info', code: 'SURPLUS_STOP_COST_ESTIMATED', autoResolved: true,
      message: 'Estimated Surplus stop charge from recorded token counts (receipts unsettled): $0.01' });
    d.record({ phase: 'build', severity: 'warning', code: 'USAGE_NOT_REPORTED', autoResolved: true,
      message: "A provider returned no token usage — this build's cost is an under-estimate" });
    d.record({ phase: 'provider', severity: 'warning', code: 'PROVIDER_FAILED', autoResolved: true,
      message: 'ENGINE_BM failed, the next engine answered', adminDetail: 'BluesMinds HTTP 429 at $0.06/M' } as never);
    d.record({ phase: 'build', severity: 'info', code: 'ETA', autoResolved: true, message: 'Still building, my rough estimate is 3 min' });
    return d.report();
  };
  it('drops every line about how a charge was estimated, rated or measured', () => {
    const out = JSON.stringify(userFacingReport(build()));
    expect(out).not.toMatch(/estimat\w*.*(cost|charge|bill|price)|rate|receipt|\$0\.0|per[- ]?million/i);
    expect(out).not.toMatch(/blue?s?minds|ENGINE_|gpt-oss|surplus/i);
    expect(out).not.toMatch(/under-estimate|token usage/i);
  });
  it('keeps provider-free progress lines and never carries adminDetail or the billing block', () => {
    const user = userFacingReport(build());
    expect(user.issues.map(i => i.message)).toEqual(expect.arrayContaining(['NavBharatAI failed, the next engine answered', 'Still building, my rough estimate is 3 min']));
    expect(JSON.stringify(user)).not.toContain('adminDetail');
    expect('billing' in user).toBe(false);
  });
  it('classifies by code and by method wording, not by the word "estimate" alone', () => {
    expect(isBillingMethodIssue({ code: 'ENGINE_COST_ESTIMATED', message: 'x' })).toBe(true);
    expect(isBillingMethodIssue({ code: 'X', message: 'charged from an estimate of tokens' })).toBe(true);
    expect(isBillingMethodIssue({ code: 'ETA', message: 'rough estimate: 3 min left' })).toBe(false);
  });
});
