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
  it('classifies by exact code only, never by wording', () => {
    for (const code of ['ENGINE_COST_ESTIMATED', 'USAGE_NOT_REPORTED', 'DISCOUNT_COST_UNCONFIRMED', 'PRO_CHAIN_V2_USAGE_ESTIMATED',
      'PRO_CHAIN_V2_RATE_ESTIMATED', 'ROUTER_ONE_CATALOGUE_ESTIMATED', 'SURPLUS_STOP_COST_ESTIMATED']) expect(isBillingMethodIssue({ code })).toBe(true);
    for (const code of ['UNBILLED_BARREN_WORK', 'PROVIDER_RATE_LIMITED', 'CONTEXT_TOO_LARGE', 'PREVIEW_ERROR', 'RUNTIME_ERRORS_REMAIN',
      'RECEIPT_PAGE_BROKEN', 'X_RATE_Y', 'ESTIMATED']) expect(isBillingMethodIssue({ code })).toBe(false);
  });
  it('counts match the issues a user sees', () => {
    const user = userFacingReport(build());
    expect(user.counts.total).toBe(user.issues.length);
    const visibleWarnings = user.issues.filter(i => i.severity === 'warning').length;
    expect(user.counts.warnings).toBe(visibleWarnings);
    expect(build().counts.total).toBe(user.issues.length + 3);
  });
  it('a summary quoting a hidden line loses only that line', () => {
    const r = build();
    const msg = "A provider returned no token usage — this build's cost is an under-estimate";
    const user = userFacingReport({ ...r, summary: `Built 3 files. ${msg}. The receipt page shows the price per item.`, rootCause: `Cause: ${msg}` });
    expect(user.summary).toBe('Built 3 files. The receipt page shows the price per item.');
    expect(user.rootCause).not.toContain('under-estimate');
  });
});

// Reviewer near-misses: a user's OWN app problems about receipts, prices, invoices, GST, rate limits or token
// size must never be hidden by the billing-method filter, in English or Hindi.
describe('app problems that merely mention money words stay visible', () => {
  const NEAR_MISSES: Array<[string, 'error' | 'warning' | 'info', string]> = [
    ['PREVIEW_ERROR', 'error', 'TypeError: price is undefined at Receipt.jsx:12'],
    ['RUNTIME_ERRORS_REMAIN', 'error', 'The receipt page still throws when the cart is empty'],
    ['CONTEXT_TOO_LARGE', 'warning', 'Prompt too large: estimated 140k tokens'],
    ['PROVIDER_RATE_LIMITED', 'warning', 'Rate limited, retrying in 5s'],
    ['BUILD_ERROR', 'error', 'Invoice.tsx: GST rate per item is NaN, so the billed total is wrong'],
    ['PREVIEW_ERROR', 'error', 'रसीद पेज पर कीमत (price) नहीं दिख रही, अनुमानित GST गलत है'],
    ['RUNTIME_ERRORS_REMAIN', 'error', 'चालान (invoice) में दर ₹ गलत दिख रही है'],
    ['UNBILLED_BARREN_WORK', 'info', 'This step produced no files, so ₹0 was billed for it'],
    ['TOKEN_BUDGET', 'warning', 'Estimated cost per million tokens exceeded the app quota'],
  ];
  const report = () => {
    const d = new BuildDiagnostics({ now: () => 1000 });
    for (const [code, severity, message] of NEAR_MISSES) d.record({ phase: 'build', severity, code, autoResolved: false, message });
    return d.report();
  };
  it.each(NEAR_MISSES)('%s stays: %s', (code, _sev, message) => {
    const user = userFacingReport(report());
    expect(user.issues.some(i => i.code === code && i.message === message)).toBe(true);
  });
  it('counts are untouched when nothing is hidden', () => {
    const r = report();
    expect(userFacingReport(r).counts).toEqual(r.counts);
  });
  it('app sentences in summary, root cause and review are kept verbatim', () => {
    const r = report();
    const text = 'The receipt page shows the price per item. Estimated delivery: 3 days. रसीद में ₹ दर सही है.';
    const user = userFacingReport({ ...r, summary: text, rootCause: text, review: text });
    expect([user.summary, user.rootCause, user.review]).toEqual([text, text, text]);
  });
});

