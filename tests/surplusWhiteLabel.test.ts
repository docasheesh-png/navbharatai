import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { redactProviderError, redactProvidersText, hasProviderLeak } from '../src/server/lib/providerRedaction';
import { namesAProvider } from '../src/lib/engineLabels';
import { userFacingReport, type BuildDiagnosticsReport } from '../src/server/AgentV3/BuildDiagnostics';
import { userSafeUsageLog } from '../src/server/lib/usageLogPublic';
import { redactEventForUser } from '../src/server/AgentV3/SourceSecretRedactor';

describe('Surplus backend identity stays private without rewriting user integrations', () => {
  it.each(['Provider SURPLUS failed', 'Surplus Intelligence unavailable', 'getaddrinfo ENOTFOUND api.surplusintelligence.ai:443', 'https://api.surplusintelligence.ai/min90/v1/chat/completions failed'])('redacts operational identity: %s', text => {
    for (const view of [redactProviderError(text), redactProvidersText(text)]) {
      expect(view).not.toMatch(/surplus/i);
      expect(hasProviderLeak(view)).toBe(false);
    }
    expect(hasProviderLeak(text)).toBe(true);
  });
  it('preserves the ordinary financial word surplus', () => {
    expect(redactProvidersText('The budget has a surplus this month.')).toBe('The budget has a surplus this month.');
    expect(hasProviderLeak('The budget has a surplus this month.')).toBe(false);
  });
  it('recognizes the new internal engine identity in client label validation', () => {
    expect(namesAProvider('SURPLUS')).toBe(true);
    expect(namesAProvider('Surplus Intelligence')).toBe(true);
  });
  it('omits private receipts, model routing and raw metadata by construction', () => {
    const source = 'export const provider = "OpenAI";';
    const raw = {
      schema: 'navbharatai.v3.build-diagnostics/1', startedAt: 1,
      counts: { total: 1, errors: 1, warnings: 0, autoResolved: 0, unresolved: 1 },
      prompt: 'Build an OpenAI integration', generatedFiles: [{ path: 'app.ts', content: source }],
      issues: [{ ts: 1, phase: 'provider', severity: 'error', code: 'SURPLUS_ACCOUNTING_UNAVAILABLE', message: 'SURPLUS failed', autoResolved: false }], problems: [],
      summary: 'SURPLUS unavailable', model: 'deepseek-v4.1-flash', providerDelivery: { SURPLUS: 1 },
      providerCostReceipts: [{ providerId: 'private-supplier', endpoint: 'https://api.surplusintelligence.ai/min90/v1', actualCostUsd: '0.001' }],
      rawMetadata: { provider: 'private-supplier' }, supplierPrice: '0.001', surplusReceipt: { policyId: 'surplus-build-10x-official-cap-v1' },
    } as unknown as BuildDiagnosticsReport;
    const view = userFacingReport(raw);
    expect(JSON.stringify(view)).not.toMatch(/surplus|deepseek|private-supplier|actualCostUsd|supplierPrice|rawMetadata|providerCostReceipts/i);
    expect(view.issues[0].code).toBe('ENGINE_UNAVAILABLE');
    expect(view.prompt).toBe(raw.prompt);
    expect(view.generatedFiles).toEqual(raw.generatedFiles);
    expect(raw.issues[0].code).toBe('SURPLUS_ACCOUNTING_UNAVAILABLE');
  });
  it('does not blanket rewrite legitimate generated code or user discussion', () => {
    const event = { type: 'narration', text: 'Your app uses OpenAI and Surplus Intelligence with your own account.' };
    expect(redactEventForUser(event)).toEqual(event);
  });
  it('keeps user usage in the safe API projection without supplier fields', () => {
    expect(userSafeUsageLog('log', { createdAt: '2026-10-24', tier: 'mini', ok: true, inputTokens: 8, outputTokens: 3, usageMeasured: true, providerName: 'SURPLUS', modelName: 'deepseek-v4.1-flash', providerCostReceipts: [{}], rawMetadata: {} })).toEqual({ id: 'log', createdAt: '2026-10-24', tier: 'mini', ok: true, inputTokens: 8, outputTokens: 3, usageMeasured: true });
    const wallet = readFileSync('src/server/routes/wallet.ts', 'utf8');
    expect(wallet).toContain("app.get('/api/wallet/:userId/logs', requireUserMatch('userId')");
    expect(wallet).toContain('userSafeUsageLog(id, data)');
  });
  it('source rules deny raw usage rows to every client, including the owner (not an emulator test)', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    const block = rules.match(/match \/ai_usage_logs\/\{logId\} \{([^}]+)\}/)?.[1];
    expect(block).toMatch(/allow read, write: if false;/);
    expect(block).not.toMatch(/isOwner|isSignedIn|request\.auth/);
    expect(rules).toContain('match /{document=**} {\n      allow read, write: if false;');
  });
});
